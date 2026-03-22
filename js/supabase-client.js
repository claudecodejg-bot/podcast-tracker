// =============================================
//  Supabase Client — shared across all pages
// =============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL  = 'https://ymbrhochaudjrbrrlwyz.supabase.co'
const SUPABASE_ANON = 'sb_publishable_PTQzs8c8ww4u-mAN4SD2ng_BvVE8dd9'

// The sb_publishable_ key must NOT be sent as a Bearer token.
// This custom fetch removes the Authorization header when it contains
// the anon key, but keeps it when it contains a real user JWT.
function customFetch(url, options = {}) {
  const headers = new Headers(options.headers)
  const auth = headers.get('Authorization')
  if (auth === `Bearer ${SUPABASE_ANON}`) {
    headers.delete('Authorization')
  }
  return fetch(url, { ...options, headers })
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  global: { fetch: customFetch }
})

// Base URL for Supabase Edge Functions
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`
