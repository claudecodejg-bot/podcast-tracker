# Pod Tracker — Setup Guide

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Note your **Project URL** and **anon public key** (Project Settings → API)
3. Also note the **service role key** (keep this secret — only used in edge functions)

## 2. Run the Database SQL

In the Supabase dashboard → SQL Editor, run these files **in order**:

1. `sql/setup.sql` — creates all tables and RLS policies
2. `sql/seed-categories.sql` — adds default categories (Financial, Fantasy Baseball, etc.)
3. `sql/letterboxd-features.sql` — adds star ratings, listening diary, queue, curated lists, reviews, and favorite podcasts
4. `sql/allow-member-name-reads.sql` — allows signed-in members to see each other's names (needed for activity feed, profiles, share notifications)
5. `sql/user-categories.sql` — adds per-user podcast categories for the Library "Following" tab
6. `sql/social-features.sql` — adds the notifications table, user follows (People page), and listen-confirmation columns on shares
7. `sql/follow-requests.sql` — adds per-user follow policy (anyone / approve requests), pending follow requests, and fixes the notifications RLS so cross-user notifications (shares, follows) actually deliver

> **Important:** all seven files must be run. Skipping `user-categories.sql` or `social-features.sql` leaves the app pointing at tables that don't exist (e.g. the notification bell will 404).

## 3. Configure the Frontend

Edit `js/supabase-client.js` and replace:
```js
const SUPABASE_URL  = 'YOUR_SUPABASE_URL'
const SUPABASE_ANON = 'YOUR_SUPABASE_ANON_KEY'
```

## 4. Get API Keys

| Key | Where to get it |
|-----|-----------------|
| **YouTube Data API v3** | [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Enable YouTube Data API v3 → Create credentials → API Key |
| **Anthropic API Key** | [console.anthropic.com](https://console.anthropic.com) → API Keys |

## 5. Deploy Edge Functions

Install the [Supabase CLI](https://supabase.com/docs/guides/cli):
```bash
brew install supabase/tap/supabase
```

Link your project:
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Set secret environment variables:
```bash
supabase secrets set YOUTUBE_API_KEY=your_key_here
supabase secrets set ANTHROPIC_API_KEY=your_key_here
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

Deploy all edge functions:
```bash
supabase functions deploy search-podcasts
supabase functions deploy parse-url
supabase functions deploy add-podcast
supabase functions deploy refresh-episodes
supabase functions deploy generate-summary
```

## 6. Create the First Admin User

In Supabase dashboard → Authentication → Users → Add User:
- Set your email and a temporary password

Then in SQL Editor, create the users table record:
```sql
INSERT INTO users (auth_id, full_name, email, is_admin)
SELECT id, 'Your Name', email, TRUE
FROM auth.users
WHERE email = 'your@email.com';
```

## 7. Add Other Group Members

In Supabase → Authentication → Users → Add User for each member (any temporary password — they never see it).

Then tell them to go to the login page and click **"Forgot password?"** — the reset email lets them set their own password, and the app creates their `users` table record automatically on first sign-in (`ensureUserRow` in `js/auth.js`).

To set someone's display name (defaults to the part of their email before the `@`):
```sql
UPDATE users SET full_name = 'Member Name' WHERE email = 'member@email.com';
```

## 8. Deploy to GitHub Pages

```bash
cd podcast-tracker
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/podcast-tracker.git
git push -u origin main
```

Then in GitHub repo → Settings → Pages → Source: main branch / root.

## 9. Keep the Free-Tier Project Awake

Supabase free-tier projects **pause after ~1 week without API traffic**, which takes the whole site down (DNS stops resolving) until you click **Restore** in the dashboard.

`.github/workflows/keepalive.yml` pings the REST API daily to prevent this — it runs automatically once the repo is pushed to GitHub. If a friend ever reports the site is down, check https://supabase.com/dashboard and Restore the project.

## 10. Set Up Daily Episode Refresh (Optional)

In Supabase → Database → Extensions, enable `pg_cron`.

Then in SQL Editor:
```sql
SELECT cron.schedule(
  'daily-episode-refresh',
  '0 6 * * *',  -- 6 AM daily
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/refresh-episodes',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'),
    body := '{}'::jsonb
  )
  $$
);
```

## Features Overview

| Feature | Details |
|---------|---------|
| **Search** | Apple Podcasts + YouTube (via APIs), paste any URL |
| **AI Summaries** | Claude Haiku generates summary + 4-6 key takeaways |
| **Ranking** | YouTube podcasts: likes vs. channel average → 🔥 Above Avg / ⭐ Standout |
| **Non-YouTube ranking** | Internal site likes from group members |
| **Shares** | Send any podcast or episode to a group member with a message |
| **Notifications** | Bell icon in nav shows unread share count |
| **Library** | Your subscriptions feed + Shared With Me inbox |
