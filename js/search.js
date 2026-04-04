// =============================================
//  Search — calls search-podcasts edge function
//  and handles URL paste via parse-url
// =============================================

import { supabase, FUNCTIONS_URL } from './supabase-client.js'

/**
 * Search for podcasts across Apple Podcasts, YouTube, and Podcast Index.
 * Returns an array of unified podcast objects.
 * @param {string} query
 * @param {object} opts - { platforms?: string[], limit?: number }
 */
export async function searchPodcasts(query, opts = {}) {
  if (!query.trim()) return []

  const session = (await supabase.auth.getSession()).data.session
  const headers = { 'Content-Type': 'application/json' }
  if (session) headers['Authorization'] = `Bearer ${session.access_token}`

  const resp = await fetch(`${FUNCTIONS_URL}/search-podcasts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, ...opts })
  })

  if (!resp.ok) {
    console.error('Search failed:', await resp.text())
    return []
  }

  const { results } = await resp.json()
  return results || []
}

/**
 * Parse a URL (YouTube video/channel, RSS feed, Apple Podcast link)
 * and return unified podcast/episode metadata.
 * @param {string} url
 */
export async function parseUrl(url) {
  const session = (await supabase.auth.getSession()).data.session
  const headers = { 'Content-Type': 'application/json' }
  if (session) headers['Authorization'] = `Bearer ${session.access_token}`

  const resp = await fetch(`${FUNCTIONS_URL}/parse-url`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url })
  })

  if (!resp.ok) { console.error('Parse URL failed:', await resp.text()); return null }
  return resp.json()
}

/**
 * Add a podcast to the database (calls add-podcast edge function).
 * Uses service role key server-side, so any logged-in user can add.
 * @param {object} podcastData - unified podcast object from search results
 * @param {string} categoryId - optional
 */
export async function addPodcast(podcastData, categoryId = null) {
  const session = (await supabase.auth.getSession()).data.session
  if (!session) throw new Error('Must be logged in to add podcasts')

  const resp = await fetch(`${FUNCTIONS_URL}/add-podcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ ...podcastData, category_id: categoryId })
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(err || 'Failed to add podcast')
  }
  return resp.json()  // { podcast_id }
}

/** Format a URL-like query detection — returns true if looks like a URL */
export function looksLikeUrl(text) {
  return /^https?:\/\//i.test(text.trim()) ||
    /^(youtube\.com|youtu\.be|podcasts\.apple\.com|open\.spotify\.com)/i.test(text.trim())
}

/** Returns the platform badge HTML for a given platform string */
export function platformBadge(platform) {
  const map = {
    youtube:  ['▶', 'badge-platform-youtube',  'YouTube'],
    apple:    ['🎵', 'badge-platform-apple',   'Apple'],
    spotify:  ['🎧', 'badge-platform-spotify', 'Spotify'],
    rss:      ['📡', 'badge-platform-rss',     'RSS'],
  }
  const [icon, cls, label] = map[platform] || ['🎙️', '', platform]
  return `<span class="badge ${cls}">${icon} ${label}</span>`
}

/** Returns rank badge HTML based on likes_vs_avg score */
export function rankBadge(likesVsAvg) {
  if (!likesVsAvg) return ''
  if (likesVsAvg >= 2.0) return '<span class="badge badge-standout">⭐ Standout</span>'
  if (likesVsAvg >= 1.0) return '<span class="badge badge-hot">🔥 Above Avg</span>'
  return ''
}

/** Format seconds as "1h 23m" or "45m" */
export function formatDuration(seconds) {
  if (!seconds) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Format a date as "Mar 15, 2025" */
export function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Format large numbers as "12.4K", "1.2M" */
export function formatCount(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}
