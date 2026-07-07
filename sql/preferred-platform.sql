-- =============================================
--  Preferred platform — a member's default source
--  (youtube / apple / spotify). Used to auto-order
--  the "Also available on" options on shared items.
--  NULL = no preference (fall back to inferring from
--  their subscriptions, else no auto-default).
-- =============================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_platform TEXT
  CHECK (preferred_platform IN ('youtube', 'apple', 'spotify'));

-- No new RLS needed: users_update_own already lets a member set their own
-- row, and users_read_all lets the app read it.
