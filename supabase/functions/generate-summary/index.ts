// =============================================
//  Edge Function: generate-summary
//  Calls Claude API to summarize a podcast episode.
//  Admin-only endpoint.
// =============================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.24.3'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY') || ''
const ANTHROPIC_API_KEY    = Deno.env.get('ANTHROPIC_API_KEY') || ''
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  // Verify caller is logged in and is an admin
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }

  const userDb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } }
  })
  const { data: { user } } = await userDb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: userRecord } = await db
    .from('users')
    .select('is_admin')
    .eq('auth_id', user.id)
    .single()

  if (!userRecord?.is_admin) {
    return Response.json({ error: 'Admin only' }, { status: 403, headers: CORS })
  }

  if (!ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500, headers: CORS })
  }

  try {
    const { episode_id } = await req.json()
    if (!episode_id) return Response.json({ error: 'episode_id required' }, { status: 400, headers: CORS })

    // Fetch episode + podcast info
    const { data: ep, error: epErr } = await db
      .from('episodes')
      .select('*, podcasts(title, author, platform)')
      .eq('id', episode_id)
      .single()

    if (epErr || !ep) {
      return Response.json({ error: 'Episode not found' }, { status: 404, headers: CORS })
    }

    const content = buildContext(ep)
    if (!content) {
      return Response.json({ error: 'No content available to summarize for this episode' }, { status: 422, headers: CORS })
    }

    const { summary, keyTakeaways } = await callClaude(
      ep.title,
      ep.podcasts?.title || '',
      ep.podcasts?.author || '',
      content
    )

    // Save to DB
    await db.from('episodes').update({
      summary,
      key_takeaways: keyTakeaways,
      ai_generated_at: new Date().toISOString()
    }).eq('id', episode_id)

    return Response.json({ summary, key_takeaways: keyTakeaways }, { headers: CORS })
  } catch (err) {
    console.error(err)
    return Response.json({ error: String(err) }, { status: 500, headers: CORS })
  }
})

function buildContext(ep: any): string {
  const parts: string[] = []
  if (ep.title) parts.push(`Episode Title: ${ep.title}`)
  if (ep.podcasts?.title) parts.push(`Podcast: ${ep.podcasts.title}`)
  if (ep.podcasts?.author) parts.push(`Host/Author: ${ep.podcasts.author}`)
  if (ep.description) parts.push(`\nDescription/Show Notes:\n${ep.description}`)
  return parts.join('\n')
}

async function callClaude(
  episodeTitle: string,
  podcastTitle: string,
  author: string,
  content: string
): Promise<{ summary: string; keyTakeaways: string[] }> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

  const prompt = `You are a podcast analyst. Based on the following episode information, provide:
1. A concise, engaging summary (3-5 sentences) of what this episode covers
2. Exactly 4-6 key takeaways as bullet points

Episode: "${episodeTitle}"
Podcast: "${podcastTitle}"
${author ? `Host: ${author}` : ''}

Content:
${content.slice(0, 6000)}

Respond in this exact JSON format:
{
  "summary": "Your 3-5 sentence summary here.",
  "key_takeaways": [
    "First key insight or takeaway",
    "Second key insight or takeaway",
    "Third key insight or takeaway",
    "Fourth key insight or takeaway"
  ]
}`

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  })

  const responseText = message.content[0].type === 'text' ? message.content[0].text : ''

  // Parse JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Claude did not return valid JSON')

  const parsed = JSON.parse(jsonMatch[0])
  return {
    summary:      parsed.summary || '',
    keyTakeaways: Array.isArray(parsed.key_takeaways) ? parsed.key_takeaways : []
  }
}
