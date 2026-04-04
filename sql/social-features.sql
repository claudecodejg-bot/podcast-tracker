-- =============================================
--  Social Features — listen-confirmation loop,
--  notifications, user follows
-- =============================================

-- 1. Add listen-confirmation columns to shares
ALTER TABLE shares ADD COLUMN IF NOT EXISTS listened_at TIMESTAMPTZ;
ALTER TABLE shares ADD COLUMN IF NOT EXISTS listener_reaction TEXT CHECK (listener_reaction IN ('👍', '🔥', '😐', '🎯', '❤️'));

-- 2. Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('share_listened', 'new_share', 'new_follower', 'follow_activity')),
  title             TEXT NOT NULL,
  body              TEXT,
  link              TEXT,
  related_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  related_episode_id UUID REFERENCES episodes(id) ON DELETE SET NULL,
  related_share_id  UUID REFERENCES shares(id) ON DELETE SET NULL,
  read_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_own" ON notifications
  FOR ALL
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

CREATE INDEX IF NOT EXISTS notifications_user_unread
  ON notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

-- 3. User follows table
CREATE TABLE IF NOT EXISTS user_follows (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(follower_id, following_id),
  CHECK (follower_id != following_id)
);

ALTER TABLE user_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "follows_read_all" ON user_follows
  FOR SELECT USING (TRUE);

CREATE POLICY "follows_write_own" ON user_follows
  FOR INSERT WITH CHECK (follower_id = current_user_id());

CREATE POLICY "follows_delete_own" ON user_follows
  FOR DELETE USING (follower_id = current_user_id());

-- 4. Allow all authenticated users to read all user records
--    (needed for follows, people directory, profile viewing, etc.)
DROP POLICY IF EXISTS "users_read_own" ON users;
CREATE POLICY "users_read_all" ON users
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- 5. Also create a new_share notification when a share is sent
--    (handled in JS, but the notification type is registered above)
