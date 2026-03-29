-- Run this once against your Postgres database to set up the schema.

CREATE TABLE IF NOT EXISTS users (
  slack_user_id    TEXT PRIMARY KEY,
  slack_team_id    TEXT NOT NULL,
  github_token     TEXT,                    -- AES-256-GCM encrypted
  github_username  TEXT,
  timezone         TEXT DEFAULT 'UTC',
  last_github_sync TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS log_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_user_id  TEXT NOT NULL REFERENCES users(slack_user_id),
  content        TEXT NOT NULL,
  entry_type     TEXT NOT NULL CHECK (entry_type IN ('update', 'blocker', 'status')),
  source         TEXT NOT NULL DEFAULT 'manual'
                   CHECK (source IN ('manual', 'github_commit', 'github_pr')),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Fast look-ups by user + date (used on every /summarise)
CREATE INDEX IF NOT EXISTS idx_log_entries_user_date
  ON log_entries(slack_user_id, created_at DESC);