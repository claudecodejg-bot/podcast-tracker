-- =============================================
--  Allow authenticated users to read other
--  members' names (needed for activity feed,
--  profiles, share modal, notifications).
--  Private group only — all signed-in users
--  are trusted members.
-- =============================================

-- Drop the restrictive own-only policy
DROP POLICY IF EXISTS "users_read_own" ON users;

-- Members can read all profiles (name, id, is_admin)
-- Unauthenticated visitors see nothing.
CREATE POLICY "users_read_members"
  ON users FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Keep the self-write policies unchanged
-- (users_insert_own and users_update_own remain)
