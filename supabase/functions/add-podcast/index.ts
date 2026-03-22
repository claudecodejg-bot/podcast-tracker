// =============================================
//  Edge Function: add-podcast
//  Adds a podcast to the DB (upsert) using service role key.
//  Any logged-in user can add podcasts.
//  After adding, triggers initial episode fetch.
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

  // Verify the caller is logged in
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    const body = await req.json()
    const { title, author, description, artwork_url, platform, platform_id, feed_url, website_url, category_id } = body

    if (!title || !platform) {
      return Response.json({ error: 'title and platform are required' }, { status: 400, headers: CORS })
    }

    // Upsert podcast — if it already exists (same platform + platform_id), return existing id
    let podcastId: string

    if (platform_id) {
      // Check if already exists
      const { data: existing } = await db
        .from('podcasts')
        .select('id')
        .eq('platform', platform)
        .eq('platform_id', platform_id)
        .maybeSingle()

      if (existing) {
        podcastId = existing.id
      } else {
        const { data: inserted, error } = await db
          .from('podcasts')
          .insert({ title, author, description, artwork_url, platform, platform_id, feed_url, website_url, category_id })
          .select('id')
          .single()

        if (error) throw error
        podcastId = inserted.id

        // Kick off initial episode fetch in background (best effort)
        fetchInitialEpisodes(db, podcastId, platform, platform_id, feed_url)
      }
    } else {
      const { data: inserted, error } = await db
        .from('podcasts')
        .insert({ title, author, description, artwork_url, platform, platform_id, feed_url, website_url, category_id })
        .select('id')
        .single()

      if (error) throw error
      podcastId = inserted.id
      fetchInitialEpisodes(db, podcastId, platform, platform_id, feed_url)
    }

    return Response.json({ podcast_id: podcastId }, { headers: CORS })
  } catch (err) {
    console.error(err)
    return Response.json({ error: String(err) }, { status: 500, headers: CORS })
  }
})

// Fetch initial batch of episodes (up to 10) — called asynchronously
async function fetchInitialEpisodes(db: any, podcastId: string, platform: string, platformId: string, feedUrl: string | null) {
  try {
    if (platform === 'youtube' && YOUTUBE_API_KEY && platformId && !platformId.startsWith('playlist:')) {
      await fetchYouTubeEpisodes(db, podcastId, platformId, 10)
    } else if (platform === 'youtube' && platformId?.startsWith('playlist:')) {
      await fetchYouTubePlaylistEpisodes(db, podcastId, platformId.replace('playlist:',''), 10)
    } else if (feedUrl) {
      await fetchRssEpisodes(db, podcastId, feedUrl, 10)
    }
  } catch (err) {
    console.error('Episode fetch failed:', err)
  }
}

async function fetchYouTubeEpisodes(db: any, podcastId: string, channelId: string, maxResults = 20) {
  const resp = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=id&channelId=${channelId}&type=video&order=date&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}`
  )
  if (!resp.ok) return
  const { items } = await resp.json()
  if (!items?.length) return

  const videoIds = items.map((i: any) => i.id.videoId).join(',')
  const vResp = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${YOUTUBE_API_KEY}`
  )
  if (!vResp.ok) return
  const { items: videos } = await vResp.json()

  const rows = videos.map((v: any) => ({
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

  if (rows.length) {
    await db.from('episodes').upsert(rows, { onConflict: 'podcast_id,platform_episode_id' })
  }

  // Compute initial avg_platform_likes
  await recomputeAvgLikes(db, podcastId)
}

async function fetchYouTubePlaylistEpisodes(db: any, podcastId: string, playlistId: string, maxResults = 20) {
  const resp = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}`
  )
  if (!resp.ok) return
  const { items } = await resp.json()
  if (!items?.length) return

  const videoIds = items.map((i: any) => i.snippet.resourceId.videoId).join(',')
  const vResp = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${YOUTUBE_API_KEY}`
  )
  if (!vResp.ok) return
  const { items: videos } = await vResp.json()

  const rows = videos.map((v: any) => ({
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

  if (rows.length) {
    await db.from('episodes').upsert(rows, { onConflict: 'podcast_id,platform_episode_id' })
  }
  await recomputeAvgLikes(db, podcastId)
}

async function fetchRssEpisodes(db: any, podcastId: string, feedUrl: string, maxItems = 20) {
  const resp = await fetch(feedUrl, {
    headers: { 'User-Agent': 'PodTracker/1.0' }
  })
  if (!resp.ok) return
  const xml = await resp.text()

  const items = parseRssItems(xml, maxItems)
  if (!items.length) return

  const rows = items.map(item => ({
    podcast_id:          podcastId,
    title:               item.title,
    description:         item.description?.slice(0, 2000),
    platform_episode_id: item.guid,
    published_at:        item.pubDate ? new Date(item.pubDate).toISOString() : null,
    duration_seconds:    item.duration,
    episode_url:         item.enclosureUrl || item.link,
  }))

  if (rows.length) {
    await db.from('episodes').upsert(rows, { onConflict: 'podcast_id,platform_episode_id' })
  }
}

async function recomputeAvgLikes(db: any, podcastId: string) {
  const { data } = await db
    .from('episodes')
    .select('platform_likes')
    .eq('podcast_id', podcastId)
    .not('platform_likes', 'is', null)

  if (!data?.length) return

  const avg = data.reduce((sum: number, e: any) => sum + (e.platform_likes || 0), 0) / data.length
  await db.from('podcasts').update({
    avg_platform_likes: avg,
    avg_computed_at: new Date().toISOString()
  }).eq('id', podcastId)

  // Update likes_vs_avg for all episodes of this podcast
  for (const ep of data) {
    if (ep.id && ep.platform_likes != null) {
      await db.from('episodes').update({
        likes_vs_avg: avg > 0 ? ep.platform_likes / avg : null
      }).eq('id', ep.id)
    }
  }
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
    const item = match[1]
    const guid         = xmlTag(item, 'guid') || xmlTag(item, 'link')
    const title        = xmlTag(item, 'title')
    const description  = xmlTag(item, 'itunes:summary') || xmlTag(item, 'description')
    const pubDate      = xmlTag(item, 'pubDate')
    const link         = xmlTag(item, 'link')
    const enclosureUrl = xmlAttr(item, 'enclosure', 'url')
    const durationStr  = xmlTag(item, 'itunes:duration')
    const duration     = parseItunesDuration(durationStr)

    if (guid && title) {
      items.push({ guid, title, description, pubDate, link, enclosureUrl, duration })
    }
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
