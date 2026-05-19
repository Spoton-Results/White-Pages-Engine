-- ============================================================
-- Migration 0001 — Phase 10: Call Tracking, Tracked Leads, Booked Jobs
-- ============================================================

-- ── call_tracking_numbers ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_tracking_numbers (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id       VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  page_id          VARCHAR NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  service_id       VARCHAR NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  location_id      VARCHAR REFERENCES locations(id) ON DELETE SET NULL,
  dynamic_number   VARCHAR(20) NOT NULL,
  forward_to_number VARCHAR(20) NOT NULL,
  is_active        BOOLEAN DEFAULT true,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS call_tracking_numbers_dynamic_number_unique ON call_tracking_numbers(dynamic_number);
CREATE INDEX IF NOT EXISTS idx_call_tracking_page ON call_tracking_numbers(page_id);
CREATE INDEX IF NOT EXISTS idx_call_tracking_website ON call_tracking_numbers(website_id);

-- ── tracked_calls ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tracked_calls (
  id                    VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id            VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  page_id               VARCHAR NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  service_id            VARCHAR NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  location_id           VARCHAR REFERENCES locations(id) ON DELETE SET NULL,
  dynamic_number        VARCHAR(20) NOT NULL,
  caller_phone_hash     VARCHAR(255),
  call_duration_seconds INTEGER,
  call_timestamp        TIMESTAMP NOT NULL,
  call_status           VARCHAR(50),
  call_provider_id      VARCHAR(255),
  created_at            TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tracked_calls_website ON tracked_calls(website_id);
CREATE INDEX IF NOT EXISTS idx_tracked_calls_page ON tracked_calls(page_id);
CREATE INDEX IF NOT EXISTS idx_tracked_calls_timestamp ON tracked_calls(call_timestamp);

-- ── tracked_leads ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tracked_leads (
  id                 VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id         VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  page_id            VARCHAR NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  service_id         VARCHAR NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  location_id        VARCHAR REFERENCES locations(id) ON DELETE SET NULL,
  form_name          VARCHAR(255),
  submitter_name     VARCHAR(255),
  submitter_email    VARCHAR(255),
  submitter_phone    VARCHAR(20),
  message            TEXT,
  source_page_url    TEXT,
  source_page_title  VARCHAR(255),
  form_timestamp     TIMESTAMP NOT NULL,
  created_at         TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tracked_leads_website ON tracked_leads(website_id);
CREATE INDEX IF NOT EXISTS idx_tracked_leads_page ON tracked_leads(page_id);
CREATE INDEX IF NOT EXISTS idx_tracked_leads_timestamp ON tracked_leads(form_timestamp);

-- ── booked_jobs ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS booked_jobs (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     VARCHAR REFERENCES tracked_leads(id) ON DELETE SET NULL,
  website_id  VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  page_id     VARCHAR NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  account_id  VARCHAR NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  job_value   DECIMAL(10,2),
  booked_date TIMESTAMP NOT NULL,
  status      VARCHAR(50) DEFAULT 'pending',
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_booked_jobs_account ON booked_jobs(account_id);
CREATE INDEX IF NOT EXISTS idx_booked_jobs_page ON booked_jobs(page_id);
CREATE INDEX IF NOT EXISTS idx_booked_jobs_date ON booked_jobs(booked_date);
