-- Migration: 0006_startup_schema_adds
-- Previously orphaned outside Drizzle journal (was named 0002_startup_schema_adds.sql)
-- Registered in _journal.json as idx 6
-- All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS for full idempotency

-- sitemaps
ALTER TABLE sitemaps ADD COLUMN IF NOT EXISTS xml_content TEXT;

-- pages
ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS gsc_submitted_at     TIMESTAMP,
  ADD COLUMN IF NOT EXISTS duplicate_flag       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_of_slug    VARCHAR(500),
  ADD COLUMN IF NOT EXISTS duplicate_similarity DECIMAL(5,4),
  ADD COLUMN IF NOT EXISTS trust_score          INTEGER,
  ADD COLUMN IF NOT EXISTS evidence_score       INTEGER,
  ADD COLUMN IF NOT EXISTS content_quality_score INTEGER;

-- websites
ALTER TABLE websites
  ADD COLUMN IF NOT EXISTS protection_mode        BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS protection_expires_at  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS warmup_day             INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warmup_page_cap_override INTEGER;

-- onboarding_submissions
ALTER TABLE onboarding_submissions
  ADD COLUMN IF NOT EXISTS governor_results   JSONB,
  ADD COLUMN IF NOT EXISTS brand_input_score  INTEGER,
  ADD COLUMN IF NOT EXISTS brand_input_result JSONB,
  ADD COLUMN IF NOT EXISTS gap_report         JSONB;

-- accounts
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS monthly_seo_spend NUMERIC(10,2) DEFAULT 0;

-- client_domains
CREATE TABLE IF NOT EXISTS client_domains (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id           TEXT NOT NULL,
  account_id           TEXT,
  hostname             TEXT NOT NULL UNIQUE,
  status               TEXT NOT NULL DEFAULT 'pending_dns',
  cloudflare_hostname_id TEXT,
  ownership_txt_name   TEXT,
  ownership_txt_value  TEXT,
  ssl_status           TEXT,
  error                TEXT,
  created_at           TIMESTAMP DEFAULT NOW(),
  updated_at           TIMESTAMP DEFAULT NOW(),
  verified_at          TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_client_domains_website  ON client_domains(website_id);
CREATE INDEX IF NOT EXISTS idx_client_domains_hostname ON client_domains(hostname);

-- fallback_hit_logs
CREATE TABLE IF NOT EXISTS fallback_hit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id   TEXT NOT NULL,
  slug         TEXT NOT NULL,
  hit_count    INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  promoted     BOOLEAN NOT NULL DEFAULT false,
  promoted_at  TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fallback_hit_logs_site_slug_unique ON fallback_hit_logs(website_id, slug);
CREATE INDEX IF NOT EXISTS idx_fallback_hit_logs_site ON fallback_hit_logs(website_id);

-- client_report_links
CREATE TABLE IF NOT EXISTS client_report_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   TEXT NOT NULL,
  token        TEXT NOT NULL UNIQUE,
  report_type  TEXT NOT NULL DEFAULT 'monthly_visibility',
  expires_at   TIMESTAMP,
  revoked_at   TIMESTAMP,
  created_by   TEXT,
  created_at   TIMESTAMP DEFAULT NOW(),
  last_viewed_at TIMESTAMP,
  view_count   INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_client_report_links_token   ON client_report_links(token);
CREATE INDEX IF NOT EXISTS idx_client_report_links_account ON client_report_links(account_id);
