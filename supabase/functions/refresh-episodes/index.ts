// =============================================
//  Edge Function: refresh-episodes
//  Fetches new episodes and updates YouTube like/view counts.
//  Can be called with a specific podcast_id or without (refreshes all).
//  Use Supabase cron (pg_cron) to call this daily.
// =============================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const YOUTUBE_API_KEY      = Deno.env.get('YOUTUBE_API_KEY') || ''
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const { podcast_id } = body

    // Get podcasts to refresh
    let query = db.from('podcasts').select('id, platform, platform_id, feed_url, avg_platform_likes')
    if (podcast_id) query = query.eq('id', podcast_id)

    const { data: podcasts, error } = await query
    if (error) throw error

    const results: any[] = []
    for (const podcast of podcasts || []) {
      try {
        const result = await refreshPodcast(db, podcast)
        results.push({ podcast_id: podcast.id, ...result })
      } catch (err) {
        results.push({ podcast_id: podcast.id, error: String(err) })
      }
    }

    return Response.json({ refreshed: results.length, results }, { headers: CORS })
  } catch (err) {
    console.error(err)
    return Response.json({ error: String(err) }, { status: 500, headers: CORS })
  }
})

async function refreshPodcast(db: any, podcast: any) {
  const { id: podcastId, platform, platform_id, feed_url } = podcast
  let newEpisodes = 0

  if (platform === 'youtube' && YOUTUBE_API_KEY && platform_id) {
    if (platform_id.startsWith('playlist:')) {
      newEpisodes += await refreshYouTubePlaylist(db, podcastId, platform_id.replace('playlist:',''))
    } else {
      newEpisodes += await refreshYouTubeChannel(db, podcastId, platform_id)
    }
    await updateLikesVsAvg(db, podcastId)
    await takeSnapshot(db, podcastId)
  } else if (feed_url) {
    newEpisodes += await refreshRssFeed(db, podcastId, feed_url)
  }

  return { new_episodes: newEpisodes }
}

async function refreshYouTubeChannel(db: any, podcastId: string, channelId: string) {
  // Get the most recent episode we have
  const { data: latest } = await db
    .from('episodes')
    .select('published_at, platform_episode_id')
    .eq('podcast_id', podcastId)
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const publishedAfter = latest?.published_at
    ? new Date(new Date(latest.published_at).getTime() - 1000 * 60 * 60).toISOString()  // 1hr buffer
    : undefined

  let url = `https://www.googleapis.com/youtube/v3/search?part=id&channelId=${channelId}&type=video&order=date&maxResults=10&key=${YOUTUBE_API_KEY}`
  if (publishedAfter) url += `&publishedAfter=${publishedAfter}`

  const resp = await fetch(url)
  if (!resp.ok) return 0
  const { items } = await resp.json()
  if (!items?.length) return 0

  const videoIds = items.map((i: any) => i.id.videoId).join(',')
  return await fetchAndUpsertVideos(db, podcastId, videoIds)
}

async function refreshYouTubePlaylist(db: any, podcastId: string, playlistId: string) {
  const resp = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=10&key=${YOUTUBE_API_KEY}`
  )
  if (!resp.ok) return 0
  const { items } = await resp.json()
  if (!items?.length) return 0

  const videoIds = items.map((i: any) => i.snippet.resourceId.videoId).join(',')
  return await fetchAndUpsertVideos(db, podcastId, videoIds)
}

async function fetchAndUpsertVideos(db: any, podcastId: string, videoIds: string): Promise<number> {
  const resp = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${YOUTUBE_API_KEY}`
  )
  if (!resp.ok) return 0
  const { items } = await resp.json()
  if (!items?.length) return 0

  const rows = items.map((v: any) => ({
    podcast_id:          podcastId,
    title:               v.snippet.title,
    description:         v.snippet.description?.slice(0, 2000),
    platform_episode_id: v.id,
    published_at:        v.snippet.publishedAt,
    duration_seconds:    parseDuration(v.contentDetails?.duration || ''),
    episode_url:         `https://www.youtube.com/watch?v=${v.id}`,
    platform_likes:      parseInt(v.statistics?.likeCount || '0', 10) || null,
    platform_views:      parseInt(v.statistics?.viewCount || '0', 10) || null,
  }))

  const { error } = await db.from('episodes').upsert(rows, { onConflict: 'podcast_id,platform_episode_id' })
  return error ? 0 : rows.length
}

async function refreshRssFeed(db: any, podcastId: string, feedUrl: string) {
  const resp = await fetch(feedUrl, { headers: { 'User-Agent': 'PodTracker/1.0' } })
  if (!resp.ok) return 0
  const xml = await resp.text()

  const { data: existing } = await db
    .from('episodes')
    .select('platform_episode_id')
    .eq('podcast_id', podcastId)

  const existingGuids = new Set((existing || []).map((e: any) => e.platform_episode_id))

  const items = parseRssItems(xml, 20)
  const newItems = items.filter(i => !existingGuids.has(i.guid))
  if (!newItems.length) return 0

  const rows = newItems.map(item => ({
    podcast_id:          podcastId,
    title:               item.title,
    description:         item.description?.slice(0, 2000),
    platform_episode_id: item.guid,
    published_at:        item.pubDate ? new Date(item.pubDate).toISOString() : null,
    duration_seconds:    item.duration,
    episode_url:         item.enclosureUrl || item.link,
  }))

  await db.from('episodes').upsert(rows, { onConflict: 'podcast_id,platform_episode_id' })
  return rows.length
}

async function updateLikesVsAvg(db: any, podcastId: string) {
  const { data: episodes } = await db
    .from('episodes')
    .select('id, platform_likes')
    .eq('podcast_id', podcastId)
    .not('platform_likes', 'is', null)

  if (!episodes?.length) return

  const avg = episodes.reduce((s: number, e: any) => s + (e.platform_likes || 0), 0) / episodes.length

  // Update avg on podcast
  await db.from('podcasts').update({
    avg_platform_likes: avg,
    avg_computed_at: new Date().toISOString()
  }).eq('id', podcastId)

  // Update likes_vs_avg on each episode
  for (const ep of episodes) {
    if (ep.platform_likes != null) {
      await db.from('episodes').update({
        likes_vs_avg: avg > 0 ? ep.platform_likes / avg : null
      }).eq('id', ep.id)
    }
  }
}

async function takeSnapshot(db: any, podcastId: string) {
  const today = new Date().toISOString().slice(0, 10)

  const { data: episodes } = await db
    .from('episodes')
    .select('id, platform_likes, likes_vs_avg')
    .eq('podcast_id', podcastId)

  if (!episodes?.length) return

  // Get site likes per episode
  const epIds = episodes.map((e: any) => e.id)
  const { data: siteLikes } = await db
    .from('episode_likes')
    .select('episode_id')
    .in('episode_id', epIds)

  const siteMap: Record<string, number> = {}
  for (const l of siteLikes || []) {
    siteMap[l.episode_id] = (siteMap[l.episode_id] || 0) + 1
  }

  const rows = episodes.map((ep: any) => ({
    episode_id:    ep.id,
    snapshot_date: today,
    platform_likes: ep.platform_likes,
    site_likes:    siteMap[ep.id] || 0,
    likes_vs_avg:  ep.likes_vs_avg,
  }))

  await db.from('episode_rank_snapshots')
    .upsert(rows, { onConflict: 'episode_id,snapshot_date' })
}

// ----- Helpers -----
function parseDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return (parseInt(m[1]||'0')*3600) + (parseInt(m[2]||'0')*60) + parseInt(m[3]||'0')
}

function parseRssItems(xml: string, max: number) {
  const items: any[] = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match
  while ((match = itemRegex.exec(xml)) !== null && items.length < max) {
    const item      = match[1]
    const guid      = xmlTag(item, 'guid') || xmlTag(item, 'link')
    const title     = xmlTag(item, 'title')
    const description = xmlTag(item, 'itunes:summary') || xmlTag(item, 'description')
    const pubDate   = xmlTag(item, 'pubDate')
    const link      = xmlTag(item, 'link')
    const enclosureUrl = xmlAttr(item, 'enclosure', 'url')
    const durationStr = xmlTag(item, 'itunes:duration')
    const duration  = parseItunesDuration(durationStr)
    if (guid && title) items.push({ guid, title, description, pubDate, link, enclosureUrl, duration })
  }
  return items
}

function parseItunesDuration(s: string): number | null {
  if (!s) return null
  const parts = s.split(':').map(Number)
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2]
  if (parts.length === 2) return parts[0]*60 + parts[1]
  return parseInt(s) || null
}

function xmlTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([^<]*)</${tag}>`))
  return (match?.[1] || match?.[2] || '').trim()
}

function xmlAttr(xml: string, tag: string, attr: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i'))
  return match?.[1] || ''
}
