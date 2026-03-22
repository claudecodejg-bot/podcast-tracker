// =============================================
//  Edge Function: parse-url
//  Given any URL, detect type and return unified podcast/episode metadata.
//  Supports: YouTube video/channel/@handle, Apple Podcasts, RSS feeds
// =============================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const YOUTUBE_API_KEY = Deno.env.get('YOUTUBE_API_KEY') || ''
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    const { url } = await req.json()
    if (!url) return Response.json({ error: 'url required' }, { status: 400, headers: CORS })

    const result = await parseUrl(url.trim())
    if (!result) {
      return Response.json({ error: 'Could not parse this URL' }, { status: 422, headers: CORS })
    }

    return Response.json(result, { headers: CORS })
  } catch (err) {
    console.error(err)
    return Response.json({ error: String(err) }, { status: 500, headers: CORS })
  }
})

async function parseUrl(url: string) {
  // YouTube video: youtube.com/watch?v=VIDEO_ID or youtu.be/VIDEO_ID
  const ytVideoMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  if (ytVideoMatch) {
    return await parseYouTubeVideo(ytVideoMatch[1])
  }

  // YouTube channel: /channel/UC..., /c/handle, /@handle
  const ytChannelMatch = url.match(/youtube\.com\/(?:channel\/|c\/|@)([^/?&]+)/)
  if (ytChannelMatch) {
    return await parseYouTubeChannel(ytChannelMatch[1], url)
  }

  // Apple Podcasts: podcasts.apple.com/...
  if (url.includes('podcasts.apple.com')) {
    return await parseApplePodcast(url)
  }

  // Spotify show: open.spotify.com/show/...
  if (url.includes('open.spotify.com/show')) {
    return parseSpotifyUrl(url)
  }

  // Default: treat as RSS feed
  return await parseRssFeed(url)
}

async function parseYouTubeVideo(videoId: string) {
  if (!YOUTUBE_API_KEY) return null

  const resp = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoId}&key=${YOUTUBE_API_KEY}`
  )
  if (!resp.ok) return null
  const { items } = await resp.json()
  if (!items?.length) return null

  const v = items[0]
  const channelId = v.snippet.channelId

  // Also get channel info for artwork
  const chResp = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${YOUTUBE_API_KEY}`
  )
  const chData = chResp.ok ? await chResp.json() : null
  const ch = chData?.items?.[0]

  // Parse ISO 8601 duration
  const durationStr = v.contentDetails?.duration || ''
  const durationSec = parseDuration(durationStr)

  return {
    // Podcast (channel) info
    title:       v.snippet.channelTitle,
    author:      v.snippet.channelTitle,
    description: ch?.snippet?.description || '',
    artwork_url: ch?.snippet?.thumbnails?.high?.url || v.snippet?.thumbnails?.high?.url || '',
    platform:    'youtube',
    platform_id: channelId,
    feed_url:    null,
    website_url: `https://www.youtube.com/channel/${channelId}`,
    // Episode info (this specific video)
    episode: {
      title:               v.snippet.title,
      description:         v.snippet.description,
      platform_episode_id: videoId,
      episode_url:         `https://www.youtube.com/watch?v=${videoId}`,
      published_at:        v.snippet.publishedAt,
      duration_seconds:    durationSec,
      platform_likes:      parseInt(v.statistics?.likeCount || '0', 10) || null,
      platform_views:      parseInt(v.statistics?.viewCount || '0', 10) || null,
    }
  }
}

async function parseYouTubeChannel(handle: string, originalUrl: string) {
  if (!YOUTUBE_API_KEY) return null

  // Try to find channel by handle or custom URL
  let channelId: string | null = null

  // If handle starts with UC, it's already a channel ID
  if (handle.startsWith('UC')) {
    channelId = handle
  } else {
    // Search for channel by username/handle
    const resp = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=${encodeURIComponent(handle.replace('@',''))}&key=${YOUTUBE_API_KEY}`
    )
    if (resp.ok) {
      const data = await resp.json()
      channelId = data.items?.[0]?.id || null
    }
    if (!channelId) {
      // Fallback: search
      const sResp = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(handle)}&maxResults=1&key=${YOUTUBE_API_KEY}`
      )
      if (sResp.ok) {
        const sData = await sResp.json()
        channelId = sData.items?.[0]?.snippet?.channelId || null
      }
    }
  }

  if (!channelId) return null

  const chResp = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}&key=${YOUTUBE_API_KEY}`
  )
  if (!chResp.ok) return null
  const chData = await chResp.json()
  const ch = chData.items?.[0]
  if (!ch) return null

  return {
    title:       ch.snippet.title,
    author:      ch.snippet.title,
    description: ch.snippet.description,
    artwork_url: ch.snippet.thumbnails?.high?.url || '',
    platform:    'youtube',
    platform_id: channelId,
    feed_url:    null,
    website_url: originalUrl,
  }
}

async function parseApplePodcast(url: string) {
  // Extract iTunes ID from URL like podcasts.apple.com/us/podcast/name/id123456789
  const idMatch = url.match(/\/id(\d+)/)
  if (!idMatch) return null

  const resp = await fetch(
    `https://itunes.apple.com/lookup?id=${idMatch[1]}&media=podcast`
  )
  if (!resp.ok) return null
  const { results } = await resp.json()
  const r = results?.[0]
  if (!r) return null

  return {
    title:       r.collectionName || r.trackName,
    author:      r.artistName,
    description: '',
    artwork_url: (r.artworkUrl600 || r.artworkUrl100 || '').replace('100x100', '600x600'),
    platform:    'apple',
    platform_id: String(r.collectionId || r.trackId),
    feed_url:    r.feedUrl || null,
    website_url: r.collectionViewUrl || url,
  }
}

function parseSpotifyUrl(url: string) {
  const match = url.match(/open\.spotify\.com\/show\/([a-zA-Z0-9]+)/)
  if (!match) return null
  // Spotify doesn't expose public metadata without OAuth — return minimal data
  return {
    title:       'Spotify Podcast',
    author:      '',
    description: 'Add Spotify API credentials to fetch full details',
    artwork_url: '',
    platform:    'spotify',
    platform_id: match[1],
    feed_url:    null,
    website_url: url,
  }
}

async function parseRssFeed(url: string) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'PodTracker/1.0 (RSS parser)' }
  })
  if (!resp.ok) return null

  const xml = await resp.text()

  // Simple regex-based RSS parser (no external deps)
  const title   = xmlTag(xml, 'title') || 'Unknown Podcast'
  const author  = xmlTag(xml, 'itunes:author') || xmlTag(xml, 'author') || ''
  const desc    = xmlTag(xml, 'description') || ''
  const image   = xmlAttr(xml, 'itunes:image', 'href') || xmlTag(xml, 'url') || ''
  const link    = xmlTag(xml, 'link') || url

  return {
    title,
    author,
    description: desc,
    artwork_url: image,
    platform:    'rss',
    platform_id: url,   // use the feed URL as platform_id for RSS
    feed_url:    url,
    website_url: link,
  }
}

// ----- Helpers -----
function xmlTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([^<]*)</${tag}>`))
  return (match?.[1] || match?.[2] || '').trim()
}

function xmlAttr(xml: string, tag: string, attr: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i'))
  return match?.[1] || ''
}

function parseDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return (parseInt(m[1]||'0')*3600) + (parseInt(m[2]||'0')*60) + parseInt(m[3]||'0')
}
