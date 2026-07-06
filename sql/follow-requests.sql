-- =============================================
--  Follow Requests — per-user follow policy
--  ('anyone can follow me' vs 'approve requests'),
--  pending/accepted follows, and a fix for the
--  notifications RLS that silently blocked every
--  cross-user notification (shares, follows).
-- =============================================

-- 1. Per-user follow policy
ALTER TABLE users ADD COLUMN IF NOT EXISTS follow_policy TEXT NOT NULL DEFAULT 'open'
  CHECK (follow_policy IN ('open', 'approval'));

-- 2. Follow status: existing rows become 'accepted'
ALTER TABLE user_follows ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'accepted'
  CHECK (status IN ('pending', 'accepted'));

-- 3. The followee can accept (update) or decline/remove (delete) followers.
--    Follower keeps insert + delete (unfollow / cancel request) from before.
DROP POLICY IF EXISTS "follows_update_target" ON user_follows;
CREATE POLICY "follows_update_target" ON user_follows
  FOR UPDATE USING (following_id = current_user_id());

DROP POLICY IF EXISTS "follows_delete_target" ON user_follows;
CREATE POLICY "follows_delete_target" ON user_follows
  FOR DELETE USING (following_id = current_user_id());

-- 4. Register the new notification types
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('share_listened', 'new_share', 'new_follower', 'follow_activity',
                  'follow_request', 'follow_accepted'));

-- 5. FIX: the old "notif_own" policy applied user_id = current_user_id() to
--    INSERT as well, so no one could ever create a notification for another
--    user — share and follow notifications were silently dropped by RLS.
--    Members may now notify others, but only when related_user_id truthfully
--    identifies them as the sender.
DROP POLICY IF EXISTS "notif_own" ON notifications;

CREATE POLICY "notif_read_own" ON notifications
  FOR SELECT USING (user_id = current_user_id());

CREATE POLICY "notif_update_own" ON notifications
  FOR UPDATE USING (user_id = current_user_id());

CREATE POLICY "notif_delete_own" ON notifications
  FOR DELETE USING (user_id = current_user_id());

CREATE POLICY "notif_insert_member" ON notifications
  FOR INSERT WITH CHECK (
    user_id = current_user_id()            -- self-notifications
    OR related_user_id = current_user_id() -- notifying someone else, signed as yourself
  );
