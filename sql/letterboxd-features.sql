-- =============================================
--  Pod Tracker — Letterboxd-Inspired Features
--  Run AFTER setup.sql
-- =============================================

-- =============================================
-- EPISODE RATINGS (0.5 – 5 stars, half-star)
-- =============================================
CREATE TABLE IF NOT EXISTS episode_ratings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  rating     NUMERIC(2,1) NOT NULL CHECK (rating >= 0.5 AND rating <= 5.0 AND rating * 2 = FLOOR(rating * 2)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, episode_id)
);

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER episode_ratings_updated
  BEFORE UPDATE ON episode_ratings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- =============================================
-- LISTENING LOG / DIARY
-- Members log when they listened + optional review
-- =============================================
CREATE TABLE IF NOT EXISTS listening_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id  UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  listened_on DATE NOT NULL DEFAULT CURRENT_DATE,
  review      TEXT,            -- optional short review / reaction
  rating      NUMERIC(2,1) CHECK (rating IS NULL OR (rating >= 0.5 AND rating <= 5.0 AND rating * 2 = FLOOR(rating * 2))),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- NOT unique: same episode can be logged multiple times (re-listens)
);

CREATE INDEX IF NOT EXISTS listening_log_user_date ON listening_log(user_id, listened_on DESC);

-- =============================================
-- WANT TO LISTEN QUEUE
-- =============================================
CREATE TABLE IF NOT EXISTS listen_queue (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  podcast_id UUID REFERENCES podcasts(id) ON DELETE CASCADE,
  episode_id UUID REFERENCES episodes(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, podcast_id, episode_id)
);

-- =============================================
-- CURATED LISTS  (like Letterboxd Lists)
-- =============================================
CREATE TABLE IF NOT EXISTS curated_lists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  is_public   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER curated_lists_updated
  BEFORE UPDATE ON curated_lists
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS curated_list_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    UUID NOT NULL REFERENCES curated_lists(id) ON DELETE CASCADE,
  podcast_id UUID REFERENCES podcasts(id) ON DELETE CASCADE,
  episode_id UUID REFERENCES episodes(id) ON DELETE CASCADE,
  note       TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- EPISODE REVIEWS (standalone, not tied to log)
-- =============================================
CREATE TABLE IF NOT EXISTS episode_reviews (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  rating     NUMERIC(2,1) CHECK (rating IS NULL OR (rating >= 0.5 AND rating <= 5.0 AND rating * 2 = FLOOR(rating * 2))),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, episode_id)
);

CREATE TRIGGER episode_reviews_updated
  BEFORE UPDATE ON episode_reviews
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Review likes (thumbs up a review)
CREATE TABLE IF NOT EXISTS review_likes (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  review_id UUID NOT NULL REFERENCES episode_reviews(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, review_id)
);

-- =============================================
-- FAVORITE PODCASTS  (up to 4, like Letterboxd 4 fave films)
-- =============================================
CREATE TABLE IF NOT EXISTS favorite_podcasts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  podcast_id UUID NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  slot       INT NOT NULL CHECK (slot BETWEEN 1 AND 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, slot),
  UNIQUE(user_id, podcast_id)
);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

ALTER TABLE episode_ratings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE listening_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE listen_queue     ENABLE ROW LEVEL SECURITY;
ALTER TABLE curated_lists    ENABLE ROW LEVEL SECURITY;
ALTER TABLE curated_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE episode_reviews  ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_likes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorite_podcasts ENABLE ROW LEVEL SECURITY;

-- RATINGS: group members see all ratings (social transparency), own write
CREATE POLICY "ratings_read_all"   ON episode_ratings FOR SELECT USING (TRUE);
CREATE POLICY "ratings_insert_own" ON episode_ratings FOR INSERT WITH CHECK (user_id = current_user_id());
CREATE POLICY "ratings_update_own" ON episode_ratings FOR UPDATE USING (user_id = current_user_id());
CREATE POLICY "ratings_delete_own" ON episode_ratings FOR DELETE USING (user_id = current_user_id());

-- LISTENING LOG: members see all entries (activity feed), own write
CREATE POLICY "log_read_all"   ON listening_log FOR SELECT USING (TRUE);
CREATE POLICY "log_insert_own" ON listening_log FOR INSERT WITH CHECK (user_id = current_user_id());
CREATE POLICY "log_update_own" ON listening_log FOR UPDATE USING (user_id = current_user_id());
CREATE POLICY "log_delete_own" ON listening_log FOR DELETE USING (user_id = current_user_id());

-- QUEUE: private, own rows only
CREATE POLICY "queue_own" ON listen_queue FOR ALL
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

-- CURATED LISTS: public lists visible to all; private lists visible to owner only
CREATE POLICY "lists_read" ON curated_lists FOR SELECT
  USING (is_public = TRUE OR user_id = current_user_id());
CREATE POLICY "lists_write_own" ON curated_lists FOR ALL
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

-- LIST ITEMS: same visibility as parent list
CREATE POLICY "list_items_read" ON curated_list_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM curated_lists cl
    WHERE cl.id = list_id AND (cl.is_public = TRUE OR cl.user_id = current_user_id())
  ));
CREATE POLICY "list_items_write" ON curated_list_items FOR ALL
  USING (EXISTS (SELECT 1 FROM curated_lists cl WHERE cl.id = list_id AND cl.user_id = current_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM curated_lists cl WHERE cl.id = list_id AND cl.user_id = current_user_id()));

-- REVIEWS: public read, own write
CREATE POLICY "reviews_read_all"   ON episode_reviews FOR SELECT USING (TRUE);
CREATE POLICY "reviews_insert_own" ON episode_reviews FOR INSERT WITH CHECK (user_id = current_user_id());
CREATE POLICY "reviews_update_own" ON episode_reviews FOR UPDATE USING (user_id = current_user_id());
CREATE POLICY "reviews_delete_own" ON episode_reviews FOR DELETE USING (user_id = current_user_id());

-- REVIEW LIKES: public read, own write
CREATE POLICY "review_likes_read"   ON review_likes FOR SELECT USING (TRUE);
CREATE POLICY "review_likes_insert" ON review_likes FOR INSERT WITH CHECK (user_id = current_user_id());
CREATE POLICY "review_likes_delete" ON review_likes FOR DELETE USING (user_id = current_user_id());

-- FAVORITES: public read (everyone can see fave 4 on profile), own write
CREATE POLICY "faves_read_all"   ON favorite_podcasts FOR SELECT USING (TRUE);
CREATE POLICY "faves_write_own"  ON favorite_podcasts FOR ALL
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());
