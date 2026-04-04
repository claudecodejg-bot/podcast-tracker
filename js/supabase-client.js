// =============================================
//  Supabase Client — shared across all pages
// =============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL  = 'https://ymbrhochaudjrbrrlwyz.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltYnJob2NoYXVkanJicnJsd3l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MjIwODAsImV4cCI6MjA4OTQ5ODA4MH0.fMhoiI3qEoUhR1K6CXZqv7wtaw6jvsufEEJDI2HX7A8'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)

// Base URL for Supabase Edge Functions
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`
