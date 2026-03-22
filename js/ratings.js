// =============================================
//  Ratings Module — star rating + diary/log
// =============================================
import { supabase } from './supabase-client.js'
import { getCurrentUser } from './auth.js'

// ---- Star display helpers -------------------

/**
 * Render a read-only star display (filled/half/empty SVG stars).
 * @param {number|null} rating  0.5–5.0 or null
 * @param {string} size         CSS size string e.g. '1rem'
 */
export function renderStars(rating, size = '1.1rem') {
  if (!rating) return `<span class="stars-empty" style="font-size:${size};opacity:.35">★★★★★</span>`
  const stars = []
  for (let i = 1; i <= 5; i++) {
    if (rating >= i) {
      stars.push(`<span class="star full" style="font-size:${size}">★</span>`)
    } else if (rating >= i - 0.5) {
      stars.push(`<span class="star half" style="font-size:${size}">½</span>`)
    } else {
      stars.push(`<span class="star empty" style="font-size:${size};opacity:.25">★</span>`)
    }
  }
  return `<span class="star-display">${stars.join('')}</span>`
}

/**
 * Format a numeric rating as a string like "3.5" or "4"
 */
export function formatRating(rating) {
  if (!rating) return '—'
  return rating % 1 === 0 ? String(rating) : rating.toFixed(1)
}

// ---- Interactive star widget ----------------

/**
 * Mount an interactive star-rating widget into a container element.
 * Calls onRate(rating) when the user clicks. Supports half-stars via
 * clicking left vs right half of each star.
 *
 * @param {HTMLElement} container
 * @param {object} opts
 *   - initialRating {number|null}  current rating
 *   - episodeId     {string}
 *   - onRate        {function}     called with new rating value
 *   - readonly      {boolean}
 */
export function mountStarWidget(container, { initialRating = null, episodeId, onRate, readonly = false } = {}) {
  let hovered = null
  let current = initialRating

  function render(displayRating) {
    const val = displayRating || current
    container.innerHTML = ''
    for (let i = 1; i <= 5; i++) {
      const star = document.createElement('span')
      star.className = 'star-widget-star'
      star.dataset.value = i

      // Determine fill state
      if (val >= i) star.classList.add('full')
      else if (val >= i - 0.5) star.classList.add('half')
      else star.classList.add('empty')

      star.textContent = '★'
      if (!readonly) {
        star.addEventListener('mousemove', e => {
          const rect = star.getBoundingClientRect()
          const half = (e.clientX - rect.left) < rect.width / 2
          hovered = half ? i - 0.5 : i
          render(hovered)
        })
        star.addEventListener('mouseleave', () => {
          hovered = null
          render(null)
        })
        star.addEventListener('click', e => {
          const rect = star.getBoundingClientRect()
          const half = (e.clientX - rect.left) < rect.width / 2
          const newRating = half ? i - 0.5 : i
          // Toggle off if clicking same value
          current = (current === newRating) ? null : newRating
          render(null)
          if (onRate) onRate(current)
        })
      }
      container.appendChild(star)
    }

    // Show numeric label next to stars
    let label = container.querySelector('.star-label')
    if (!label) {
      label = document.createElement('span')
      label.className = 'star-label'
      container.appendChild(label)
    }
    label.textContent = val ? (val % 1 === 0 ? `${val}.0` : `${val}`) : ''
  }

  render(null)
  return {
    getValue: () => current,
    setValue: v => { current = v; render(null) }
  }
}

// ---- DB read/write --------------------------

/**
 * Fetch the current user's rating for an episode.
 * Returns the rating value (number) or null.
 */
export async function getUserRating(episodeId) {
  const user = await getCurrentUser()
  if (!user) return null

  const { data } = await supabase
    .from('episode_ratings')
    .select('rating')
    .eq('user_id', user.id)
    .eq('episode_id', episodeId)
    .maybeSingle()

  return data?.rating ?? null
}

/**
 * Upsert the current user's rating for an episode.
 * Pass null to delete the rating.
 */
export async function saveRating(episodeId, rating) {
  const user = await getCurrentUser()
  if (!user) return { error: 'Not logged in' }

  if (rating === null) {
    return supabase
      .from('episode_ratings')
      .delete()
      .eq('user_id', user.id)
      .eq('episode_id', episodeId)
  }

  return supabase.from('episode_ratings').upsert({
    user_id:    user.id,
    episode_id: episodeId,
    rating
  }, { onConflict: 'user_id,episode_id' })
}

/**
 * Fetch rating statistics for an episode: average + histogram.
 * Returns { avg, count, histogram: {0.5:n, 1:n, … 5:n} }
 */
export async function getEpisodeRatingStats(episodeId) {
  const { data } = await supabase
    .from('episode_ratings')
    .select('rating')
    .eq('episode_id', episodeId)

  if (!data?.length) return { avg: null, count: 0, histogram: {} }

  const histogram = {}
  let total = 0
  for (const row of data) {
    const v = Number(row.rating)
    histogram[v] = (histogram[v] || 0) + 1
    total += v
  }

  return {
    avg: Math.round((total / data.length) * 10) / 10,
    count: data.length,
    histogram
  }
}

/**
 * Render a rating histogram bar chart into a container.
 */
export function renderHistogram(container, histogram, totalCount) {
  const steps = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5]
  const max = Math.max(...Object.values(histogram), 1)

  container.innerHTML = steps.map(v => {
    const count = histogram[v] || 0
    const pct   = Math.round((count / max) * 100)
    return `
      <div class="hist-row">
        <span class="hist-label">${v}</span>
        <div class="hist-bar-wrap">
          <div class="hist-bar" style="width:${pct}%"></div>
        </div>
        <span class="hist-count">${count}</span>
      </div>`
  }).join('')
}

// ---- Listening Log --------------------------

/**
 * Log an episode as listened (diary entry).
 * @param {string} episodeId
 * @param {object} opts  { listenedOn, review, rating }
 */
export async function logEpisode(episodeId, { listenedOn, review = null, rating = null } = {}) {
  const user = await getCurrentUser()
  if (!user) return { error: 'Not logged in' }

  return supabase.from('listening_log').insert({
    user_id:     user.id,
    episode_id:  episodeId,
    listened_on: listenedOn || new Date().toISOString().slice(0, 10),
    review,
    rating
  })
}

/**
 * Fetch listening log entries for the current user, newest first.
 * @param {number} limit
 */
export async function getMyLog(limit = 50) {
  const user = await getCurrentUser()
  if (!user) return []

  const { data } = await supabase
    .from('listening_log')
    .select(`
      id, listened_on, review, rating, created_at,
      episodes(id, title, published_at, podcasts(id, title, artwork_url, platform))
    `)
    .eq('user_id', user.id)
    .order('listened_on', { ascending: false })
    .limit(limit)

  return data || []
}

/**
 * Fetch listening log entries for ALL users (activity feed).
 */
export async function getGroupActivity(limit = 30) {
  const { data } = await supabase
    .from('listening_log')
    .select(`
      id, listened_on, review, rating, created_at,
      users(id, full_name),
      episodes(id, title, podcasts(id, title, artwork_url, platform))
    `)
    .order('created_at', { ascending: false })
    .limit(limit)

  return data || []
}

// ---- Listen Queue ---------------------------

/**
 * Add an episode or podcast to the current user's queue.
 */
export async function addToQueue({ podcastId = null, episodeId = null } = {}) {
  const user = await getCurrentUser()
  if (!user) return { error: 'Not logged in' }

  // Get next sort position
  const { data: existing } = await supabase
    .from('listen_queue')
    .select('sort_order')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextPos = (existing?.[0]?.sort_order ?? -1) + 1

  return supabase.from('listen_queue').upsert({
    user_id:    user.id,
    podcast_id: podcastId,
    episode_id: episodeId,
    sort_order: nextPos
  }, { onConflict: 'user_id,podcast_id,episode_id' })
}

/**
 * Remove an item from the queue.
 */
export async function removeFromQueue(queueItemId) {
  const user = await getCurrentUser()
  if (!user) return { error: 'Not logged in' }

  return supabase
    .from('listen_queue')
    .delete()
    .eq('id', queueItemId)
    .eq('user_id', user.id)
}

/**
 * Check if an episode is in the user's queue.
 */
export async function isInQueue({ podcastId = null, episodeId = null } = {}) {
  const user = await getCurrentUser()
  if (!user) return false

  let q = supabase.from('listen_queue').select('id').eq('user_id', user.id)
  if (episodeId) q = q.eq('episode_id', episodeId)
  else if (podcastId) q = q.eq('podcast_id', podcastId)

  const { data } = await q.maybeSingle()
  return !!data
}

/**
 * Fetch the current user's full queue.
 */
export async function getMyQueue() {
  const user = await getCurrentUser()
  if (!user) return []

  const { data } = await supabase
    .from('listen_queue')
    .select(`
      id, sort_order, created_at,
      podcasts(id, title, artwork_url, platform, author),
      episodes(id, title, published_at, podcasts(id, title, artwork_url, platform))
    `)
    .eq('user_id', user.id)
    .order('sort_order', { ascending: true })

  return data || []
}

// ---- Favorite Podcasts ----------------------

/**
 * Fetch favorite podcasts for a user (1–4 slots).
 * @param {string} userId
 */
export async function getFavoritePodcasts(userId) {
  const { data } = await supabase
    .from('favorite_podcasts')
    .select('slot, podcasts(id, title, artwork_url, platform)')
    .eq('user_id', userId)
    .order('slot')

  return data || []
}

/**
 * Set a favorite podcast in a specific slot (1–4).
 * Upserts so updating slot replaces previous podcast.
 */
export async function setFavoritePodcast(slot, podcastId) {
  const user = await getCurrentUser()
  if (!user) return { error: 'Not logged in' }

  if (!podcastId) {
    return supabase
      .from('favorite_podcasts')
      .delete()
      .eq('user_id', user.id)
      .eq('slot', slot)
  }

  return supabase.from('favorite_podcasts').upsert({
    user_id:    user.id,
    podcast_id: podcastId,
    slot
  }, { onConflict: 'user_id,slot' })
}
