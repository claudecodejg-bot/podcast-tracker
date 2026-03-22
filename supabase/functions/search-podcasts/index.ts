// =============================================
//  Edge Function: search-podcasts
//  Fans out to Apple Podcasts (iTunes) and YouTube.
//  Returns a unified list of podcast objects.
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
    const { query, platforms, limit = 20 } = await req.json()
    if (!query) {
      return Response.json({ error: 'query required' }, { status: 400, headers: CORS })
    }

    const targetPlatforms: string[] = platforms || ['apple', 'youtube']
    const results: PodcastResult[] = []

    const searches: Promise<PodcastResult[]>[] = []

    if (targetPlatforms.includes('apple')) {
      searches.push(searchApple(query, limit))
    }
    if (targetPlatforms.includes('youtube') && YOUTUBE_API_KEY) {
      searches.push(searchYouTube(query, limit))
    }

    const batches = await Promise.allSettled(searches)
    for (const b of batches) {
      if (b.status === 'fulfilled') results.push(...b.value)
    }

    // Deduplicate by platform+platform_id
    const seen = new Set<string>()
    const unique = results.filter(r => {
      const key = `${r.platform}:${r.platform_id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    return Response.json({ results: unique }, { headers: CORS })
  } catch (err) {
    console.error(err)
    return Response.json({ error: String(err) }, { status: 500, headers: CORS })
  }
})

// ----- Apple Podcasts (iTunes Search API — free, no key) -----
async function searchApple(query: string, limit: number): Promise<PodcastResult[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=podcast&limit=${limit}&entity=podcast`
  const resp = await fetch(url)
  if (!resp.ok) return []
  const { results } = await resp.json()

  return (results || []).map((r: any): PodcastResult => ({
    title:       r.collectionName || r.trackName,
    author:      r.artistName,
    description: '', // iTunes search doesn't return episode descriptions
    artwork_url: (r.artworkUrl600 || r.artworkUrl100 || '').replace('100x100', '600x600'),
    platform:    'apple',
    platform_id: String(r.collectionId || r.trackId),
    feed_url:    r.feedUrl || null,
    website_url: r.collectionViewUrl || null,
  }))
}

// ----- YouTube (channels matching the query) -----
async function searchYouTube(query: string, limit: number): Promise<PodcastResult[]> {
  // Search for channels first
  const chUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(query)}&maxResults=${Math.min(limit, 10)}&key=${YOUTUBE_API_KEY}`
  const chResp = await fetch(chUrl)
  if (!chResp.ok) return []
  const chData = await chResp.json()
  const channels = chData.items || []

  // Also search for playlists that look like podcasts
  const plUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=playlist&q=${encodeURIComponent(query + ' podcast')}&maxResults=${Math.min(limit, 5)}&key=${YOUTUBE_API_KEY}`
  const plResp = await fetch(plUrl)
  const plData = plResp.ok ? await plResp.json() : { items: [] }
  const playlists = plData.items || []

  const channelResults: PodcastResult[] = channels.map((c: any): PodcastResult => ({
    title:       c.snippet.channelTitle || c.snippet.title,
    author:      c.snippet.channelTitle,
    description: c.snippet.description,
    artwork_url: c.snippet.thumbnails?.high?.url || c.snippet.thumbnails?.default?.url || '',
    platform:    'youtube',
    platform_id: c.snippet.channelId || c.id?.channelId,
    feed_url:    null,
    website_url: `https://www.youtube.com/channel/${c.snippet.channelId || c.id?.channelId}`,
  }))

  const playlistResults: PodcastResult[] = playlists.map((p: any): PodcastResult => ({
    title:       p.snippet.title,
    author:      p.snippet.channelTitle,
    description: p.snippet.description,
    artwork_url: p.snippet.thumbnails?.high?.url || p.snippet.thumbnails?.default?.url || '',
    platform:    'youtube',
    platform_id: `playlist:${p.id?.playlistId}`,
    feed_url:    null,
    website_url: `https://www.youtube.com/playlist?list=${p.id?.playlistId}`,
  }))

  return [...channelResults, ...playlistResults]
}

interface PodcastResult {
  title:       string
  author:      string
  description: string
  artwork_url: string
  platform:    'youtube' | 'apple' | 'spotify' | 'rss'
  platform_id: string
  feed_url:    string | null
  website_url: string | null
}
