-- =============================================
--  User Categories — personal podcast organizer
--  Run this in the Supabase SQL Editor
-- =============================================

-- Table: each user can create their own categories
CREATE TABLE IF NOT EXISTS user_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '📁',
  sort_order INT  NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Add category column to subscriptions (per-user assignment)
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS user_category_id UUID
    REFERENCES user_categories(id) ON DELETE SET NULL;

-- RLS: users can only see and manage their own categories
ALTER TABLE user_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_categories"
  ON user_categories FOR ALL
  USING     (user_id = (SELECT id FROM users WHERE auth_id = auth.uid()))
  WITH CHECK (user_id = (SELECT id FROM users WHERE auth_id = auth.uid()));
