-- =============================================
--  Pod Tracker — Seed Default Categories
--  Run after setup.sql
-- =============================================

INSERT INTO categories (name, icon, sort_order) VALUES
  ('Financial',        '💰', 1),
  ('Fantasy Baseball', '⚾', 2),
  ('Fantasy Football', '🏈', 3),
  ('Technology',       '💻', 4),
  ('News & Politics',  '📰', 5),
  ('Comedy',           '😂', 6),
  ('True Crime',       '🔍', 7),
  ('Health & Fitness', '💪', 8),
  ('Business',         '📊', 9),
  ('Sports',           '🏆', 10),
  ('Science',          '🔬', 11),
  ('Society & Culture','🌍', 12)
ON CONFLICT (name) DO NOTHING;
