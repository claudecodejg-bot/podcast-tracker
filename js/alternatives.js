// =============================================
//  Cross-platform alternatives — "Also available on"
//  Finds the same show on other platforms (via live search),
//  adds it on demand, and best-effort matches the exact episode.
// =============================================
import { supabase } from './supabase-client.js'
import { searchPodcasts, addPodcast, groupPodcastResults, normalizeShowKey, PLATFORM_META } from './search.js?v=grouping2'

// Word-token Jaccard similarity, for matching an episode across platforms.
function titleSim(a, b) {
  const norm = (s) => new Set(
    String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2)
  )
  const A = norm(a), B = norm(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / (A.size + B.size - inter)
}

// Cache results per show for the tab session, so revisiting an episode/podcast
// page doesn't re-hit the search API. sessionStorage clears on tab close; a
// short TTL guards against staleness within a long-lived tab.
const ALT_CACHE_TTL_MS = 60 * 60 * 1000  // 1 hour

function readAltCache(cacheKey) {
  try {
    const raw = sessionStorage.getItem(cacheKey)
    if (!raw) return null
    const { at, alts } = JSON.parse(raw)
    if (Date.now() - at > ALT_CACHE_TTL_MS) return null
    return alts
  } catch { return null }
}

function writeAltCache(cacheKey, alts) {
  try { sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), alts })) } catch { /* quota/full — ignore */ }
}

/**
 * Same show on other platforms, via live search of the show title.
 * Cached per (show, platform) for the tab session.
 * @returns {Promise<Array>} search source objects on platforms != currentPlatform
 */
export async function findShowAlternatives(showTitle, currentPlatform) {
  if (!showTitle) return []
  const key      = normalizeShowKey({ title: showTitle })
  const cacheKey = `alt:${key}|${currentPlatform}`

  const cached = readAltCache(cacheKey)
  if (cached) return cached

  const results = await searchPodcasts(showTitle, { limit: 10 })
  if (!results.length) return []
  const groups = groupPodcastResults(results)
  const group  = groups.find(g => normalizeShowKey(g[0]) === key) || groups[0]
  const alts   = (group || []).filter(s => s.platform !== currentPlatform)

  writeAltCache(cacheKey, alts)
  return alts
}

/** Add (upsert) the alternative show; returns its podcast id. */
export async function addAlternativeShow(sourceObj) {
  const { podcast_id } = await addPodcast(sourceObj)
  return podcast_id
}

/**
 * Best-effort match of the shared episode within a freshly-added show.
 * add-podcast fetches episodes asynchronously, so this polls briefly.
 * @returns {Promise<string|null>} matching episode id, or null to fall back to the show
 */
export async function matchEpisode(podcastId, episodeTitle, publishedAt) {
  const targetMs = publishedAt ? new Date(publishedAt).getTime() : null
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: eps } = await supabase
      .from('episodes')
      .select('id, title, published_at')
      .eq('podcast_id', podcastId)

    if (eps?.length) {
      let best = null, bestScore = 0
      for (const e of eps) {
        let score = titleSim(episodeTitle, e.title)
        if (targetMs && e.published_at) {
          const daysApart = Math.abs(new Date(e.published_at).getTime() - targetMs) / 86400000
          if (daysApart <= 2) score += 0.3   // same episode usually lands within a day or two
        }
        if (score > bestScore) { bestScore = score; best = e }
      }
      if (best && bestScore >= 0.5) return best.id
      if (eps.length >= 3) return null       // episodes are loaded but nothing matched confidently
    }
    await new Promise(r => setTimeout(r, 800))
  }
  return null
}

/**
 * Order alternatives with the viewer's preferred platform first.
 * @param {Array} alts source objects
 * @param {string|null} preferred
 */
export function orderByPreferred(alts, preferred) {
  return [...alts].sort((a, b) =>
    (b.platform === preferred ? 1 : 0) - (a.platform === preferred ? 1 : 0))
}

/**
 * Renders the "Also available on" bar into `mountEl` and wires the buttons.
 * @param {object} opts
 *   mountEl        - container element
 *   showTitle      - the show's title
 *   currentPlatform- platform being viewed (excluded from alternatives)
 *   preferred      - viewer's preferred platform (or null)
 *   loggedIn       - whether a user is signed in (adding requires login)
 *   episode        - optional { title, published_at } to attempt exact-episode match
 */
export async function renderAlternatives(mountEl, { showTitle, currentPlatform, preferred, loggedIn, episode = null }) {
  if (!mountEl) return
  let alts = await findShowAlternatives(showTitle, currentPlatform)
  if (!alts.length) return
  alts = orderByPreferred(alts, preferred)

  const label = episode ? 'Listen to this episode on' : 'Also available on'
  mountEl.innerHTML = `
    <div class="card mt-2" style="padding:.75rem .9rem">
      <div style="font-size:.82rem;color:var(--gray-600);margin-bottom:.5rem">🔀 ${label}</div>
      <div style="display:flex;flex-wrap:wrap;gap:.4rem">
        ${alts.map((s, i) => {
          const [icon,, plabel] = PLATFORM_META[s.platform] || ['🎙️','', s.platform]
          const isPref = s.platform === preferred
          return `<button class="src-chip ${isPref ? 'active' : ''}" data-alt="${i}">${icon} ${plabel}${isPref ? ' · your default' : ''}</button>`
        }).join('')}
      </div>
    </div>`

  mountEl.querySelectorAll('[data-alt]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!loggedIn) { window.location.href = 'login.html'; return }
      const src = alts[Number(btn.dataset.alt)]
      const original = btn.textContent
      btn.disabled = true
      btn.textContent = 'Opening…'
      try {
        const podcastId = await addAlternativeShow(src)
        if (episode) {
          const epId = await matchEpisode(podcastId, episode.title, episode.published_at)
          window.location.href = epId ? `episode.html?id=${epId}` : `podcast.html?id=${podcastId}`
        } else {
          window.location.href = `podcast.html?id=${podcastId}`
        }
      } catch (err) {
        console.error('Alternative open failed:', err.message)
        btn.disabled = false
        btn.textContent = original
      }
    })
  })
}
