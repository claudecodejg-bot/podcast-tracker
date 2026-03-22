-- =============================================
--  Pod Tracker — Database Setup
--  Run this on a fresh Supabase project
-- =============================================

-- =============================================
-- USERS
-- =============================================
CREATE TABLE IF NOT EXISTS users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  TEXT NOT NULL,
  email      TEXT,
  is_admin   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(auth_id)
);

-- =============================================
-- CATEGORIES
-- =============================================
CREATE TABLE IF NOT EXISTS categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  icon       TEXT DEFAULT '🎙️',
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE(name)
);

-- =============================================
-- PODCASTS
-- =============================================
CREATE TABLE IF NOT EXISTS podcasts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title               TEXT NOT NULL,
  description         TEXT,
  artwork_url         TEXT,
  author              TEXT,
  category_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
  platform            TEXT NOT NULL CHECK (platform IN ('youtube','apple','spotify','rss')),
  platform_id         TEXT,        -- YouTube channelId, iTunes collectionId, Spotify showId
  feed_url            TEXT,        -- RSS feed URL
  website_url         TEXT,
  avg_platform_likes  FLOAT,       -- rolling average episode likes (YouTube only)
  avg_computed_at     TIMESTAMPTZ,
  added_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Allow same show to exist once per platform
CREATE UNIQUE INDEX IF NOT EXISTS podcasts_platform_id
  ON podcasts(platform, platform_id)
  WHERE platform_id IS NOT NULL;

-- =============================================
-- EPISODES
-- =============================================
CREATE TABLE IF NOT EXISTS episodes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  podcast_id          UUID NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT,
  summary             TEXT,          -- AI-generated
  key_takeaways       TEXT[],        -- AI-generated array
  platform_episode_id TEXT,          -- YouTube videoId, Spotify episodeId, etc.
  published_at        TIMESTAMPTZ,
  duration_seconds    INT,
  episode_url         TEXT,
  platform_likes      INT,           -- YouTube likeCount (null for non-YouTube)
  platform_views      INT,           -- YouTube viewCount
  likes_vs_avg        FLOAT,         -- platform_likes / podcast avg (>1.0 = above average)
  ai_generated_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(podcast_id, platform_episode_id)
);

-- =============================================
-- SUBSCRIPTIONS
-- =============================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  podcast_id UUID NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, podcast_id)
);

-- =============================================
-- EPISODE LIKES (site-internal, all platforms)
-- =============================================
CREATE TABLE IF NOT EXISTS episode_likes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, episode_id)
);

-- =============================================
-- PODCAST LIKES (show-level endorsements)
-- =============================================
CREATE TABLE IF NOT EXISTS podcast_likes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  podcast_id UUID NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, podcast_id)
);

-- =============================================
-- SHARES (in-app sharing between members)
-- =============================================
CREATE TABLE IF NOT EXISTS shares (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  podcast_id   UUID REFERENCES podcasts(id) ON DELETE SET NULL,
  episode_id   UUID REFERENCES episodes(id) ON DELETE SET NULL,
  message      TEXT,
  read_at      TIMESTAMPTZ,   -- NULL = unread
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- EPISODE RANK SNAPSHOTS (weekly trend data)
-- =============================================
CREATE TABLE IF NOT EXISTS episode_rank_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id     UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  snapshot_date  DATE NOT NULL,
  platform_likes INT,
  site_likes     INT,
  likes_vs_avg   FLOAT,
  UNIQUE(episode_id, snapshot_date)
);

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

CREATE OR REPLACE FUNCTION current_user_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT id FROM users WHERE auth_id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT is_admin FROM users WHERE auth_id = auth.uid() LIMIT 1), FALSE)
$$;

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories             ENABLE ROW LEVEL SECURITY;
ALTER TABLE podcasts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE episode_likes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE podcast_likes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE shares                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE episode_rank_snapshots ENABLE ROW LEVEL SECURITY;

-- USERS
CREATE POLICY "users_read_own"   ON users FOR SELECT USING (auth_id = auth.uid() OR is_admin());
CREATE POLICY "users_insert_own" ON users FOR INSERT WITH CHECK (auth_id = auth.uid());
CREATE POLICY "users_update_own" ON users FOR UPDATE USING (auth_id = auth.uid());

-- CATEGORIES: public read, admin write
CREATE POLICY "categories_public_read"  ON categories FOR SELECT USING (TRUE);
CREATE POLICY "categories_admin_write"  ON categories FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- PODCASTS: public read, admin write (non-admins add via edge function with service role)
CREATE POLICY "podcasts_public_read"  ON podcasts FOR SELECT USING (TRUE);
CREATE POLICY "podcasts_admin_write"  ON podcasts FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- EPISODES: public read, admin write (edge functions use service role)
CREATE POLICY "episodes_public_read"  ON episodes FOR SELECT USING (TRUE);
CREATE POLICY "episodes_admin_write"  ON episodes FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- SUBSCRIPTIONS: own rows only
CREATE POLICY "subscriptions_own" ON subscriptions FOR ALL
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

-- EPISODE LIKES: everyone can read counts, own rows for write
CREATE POLICY "episode_likes_read"   ON episode_likes FOR SELECT USING (TRUE);
CREATE POLICY "episode_likes_insert" ON episode_likes FOR INSERT WITH CHECK (user_id = current_user_id());
CREATE POLICY "episode_likes_delete" ON episode_likes FOR DELETE USING (user_id = current_user_id());

-- PODCAST LIKES: everyone can read counts, own rows for write
CREATE POLICY "podcast_likes_read"   ON podcast_likes FOR SELECT USING (TRUE);
CREATE POLICY "podcast_likes_insert" ON podcast_likes FOR INSERT WITH CHECK (user_id = current_user_id());
CREATE POLICY "podcast_likes_delete" ON podcast_likes FOR DELETE USING (user_id = current_user_id());

-- SHARES: sender can insert; both sender & recipient can read; recipient can mark read
CREATE POLICY "shares_read" ON shares FOR SELECT
  USING (recipient_id = current_user_id() OR sender_id = current_user_id());
CREATE POLICY "shares_insert" ON shares FOR INSERT
  WITH CHECK (sender_id = current_user_id());
CREATE POLICY "shares_update" ON shares FOR UPDATE
  USING (recipient_id = current_user_id());

-- EPISODE RANK SNAPSHOTS: public read, edge function writes via service role
CREATE POLICY "snapshots_public_read" ON episode_rank_snapshots FOR SELECT USING (TRUE);
