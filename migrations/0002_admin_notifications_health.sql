-- ============================================================
-- Migration 0002 — Admin Notifications, Demotion Logs,
--                  Launch Health Scores, Client Weekly Digests
-- ============================================================

-- ── admin_notifications ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_notifications (
  id         VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  metadata   JSONB,
  read_at    TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_notif_website ON admin_notifications(website_id, created_at);

-- ── demotion_logs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS demotion_logs (
  id         VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  page_id    VARCHAR NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  from_tier  INTEGER NOT NULL,
  to_tier    INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_demotion_logs_website ON demotion_logs(website_id, created_at);

-- ── launch_health_scores ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS launch_health_scores (
  id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id    VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  score         INTEGER DEFAULT 0,
  max_score     INTEGER DEFAULT 100,
  breakdown     JSONB,
  calculated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_launch_health_website ON launch_health_scores(website_id);
CREATE INDEX IF NOT EXISTS idx_launch_health_date ON launch_health_scores(calculated_at);

-- ── client_weekly_digests ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_weekly_digests (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id       VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  account_id       VARCHAR NOT NULL,
  recipient_email  VARCHAR(255) NOT NULL,
  subject          VARCHAR(500),
  body_html        TEXT,
  body_text        TEXT,
  sent_at          TIMESTAMP,
  created_at       TIMESTAMP DEFAULT NOW(),
  status           VARCHAR(20) DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_client_digest_website ON client_weekly_digests(website_id);
CREATE INDEX IF NOT EXISTS idx_client_digest_status ON client_weekly_digests(status);
