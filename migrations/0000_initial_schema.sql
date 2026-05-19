-- ============================================================
-- Migration 0000 — Initial Schema Baseline
-- Generated from shared/schema.ts
-- Safe to run on empty DB. All statements use IF NOT EXISTS.
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('super_admin', 'account_admin', 'editor', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE account_plan AS ENUM ('starter', 'pro', 'enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE account_status AS ENUM ('active', 'paused', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE website_status AS ENUM ('live', 'syncing', 'error', 'paused');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE page_status AS ENUM ('draft', 'review', 'approved', 'published', 'pruned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE page_type AS ENUM ('state_hub', 'city_hub', 'service_city', 'industry_city', 'problem_intent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE location_type AS ENUM ('state', 'city', 'neighborhood', 'county');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── agencies ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agencies (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  contact_name TEXT,
  email       TEXT,
  phone       TEXT,
  monthly_fee DECIMAL,
  start_date  TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── accounts ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id           VARCHAR REFERENCES agencies(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  plan                account_plan NOT NULL DEFAULT 'starter',
  status              account_status NOT NULL DEFAULT 'active',
  client_status       VARCHAR(20) NOT NULL DEFAULT 'active',
  report_token        VARCHAR(64),
  monthly_seo_spend   DECIMAL(10,2) DEFAULT 0,
  settings            JSONB DEFAULT '{}',
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_accounts_agency_id ON accounts(agency_id);

-- ── users ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id             VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     VARCHAR REFERENCES accounts(id) ON DELETE CASCADE,
  username       TEXT NOT NULL UNIQUE,
  email          TEXT NOT NULL UNIQUE,
  password       TEXT NOT NULL,
  role           user_role NOT NULL DEFAULT 'viewer',
  is_super_admin BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_account_id ON users(account_id);

-- ── brand_profiles ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brand_profiles (
  id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      VARCHAR NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  logo_url        TEXT,
  primary_color   TEXT,
  secondary_color TEXT,
  tagline         TEXT,
  description     TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  social_links    JSONB DEFAULT '{}',
  voice_and_tone  TEXT,
  custom_fields   JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── onboarding_submissions (forward-declared for FK in websites) ──
CREATE TABLE IF NOT EXISTS onboarding_submissions (
  id                      VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  token                   VARCHAR(64) NOT NULL,
  stripe_session_id       VARCHAR(255),
  stripe_customer_id      VARCHAR(255),
  plan_type               VARCHAR(50),
  agency_id               VARCHAR REFERENCES accounts(id),
  account_id              VARCHAR,
  website_id              VARCHAR,
  status                  VARCHAR(30) DEFAULT 'pending',
  form_data               JSONB,
  readiness_score         INTEGER DEFAULT 0,
  readiness_result        JSONB,
  onboarding_notes        TEXT,
  governor_results        JSONB,
  brand_input_score       INTEGER,
  brand_input_result      JSONB,
  gap_report              JSONB,
  created_at              TIMESTAMP DEFAULT NOW(),
  submitted_at            TIMESTAMP,
  generation_started_at   TIMESTAMP,
  completed_at            TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_submissions_token_unique ON onboarding_submissions(token);

-- ── websites ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS websites (
  id                        VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                VARCHAR NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  brand_profile_id          VARCHAR REFERENCES brand_profiles(id),
  name                      TEXT NOT NULL,
  domain                    TEXT NOT NULL UNIQUE,
  subdomain                 TEXT,
  status                    website_status NOT NULL DEFAULT 'paused',
  primary_industry          TEXT,
  target_locale             TEXT DEFAULT 'en-US',
  robots_txt                TEXT,
  custom_head               TEXT,
  r2_prefix                 TEXT,
  published_pages           INTEGER NOT NULL DEFAULT 0,
  settings                  JSONB DEFAULT '{}',
  onboarding_status         VARCHAR(30) DEFAULT 'manual',
  onboarding_submission_id  VARCHAR REFERENCES onboarding_submissions(id),
  launch_cap                INTEGER DEFAULT 100,
  warmup_mode               BOOLEAN DEFAULT true,
  warmup_expires_at         TIMESTAMP,
  first_publish_at          TIMESTAMP,
  coverage_plan             VARCHAR(20) DEFAULT 'regional',
  tier1_weekly_submit_cap   INTEGER DEFAULT 50,
  protection_mode           BOOLEAN DEFAULT false,
  protection_expires_at     TIMESTAMP,
  warmup_day                INTEGER DEFAULT 0,
  warmup_page_cap_override  INTEGER,
  created_at                TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_websites_account_id ON websites(account_id);
CREATE INDEX IF NOT EXISTS idx_websites_domain_lower ON websites(lower(domain));
CREATE INDEX IF NOT EXISTS idx_websites_protection_mode ON websites(protection_mode);

-- ── locations ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS locations (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  VARCHAR NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type        location_type NOT NULL,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  state_code  TEXT,
  state_name  TEXT,
  population  INTEGER,
  city_tier   INTEGER,
  lat         DECIMAL(10,7),
  lng         DECIMAL(10,7),
  parent_id   VARCHAR,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_locations_account_id ON locations(account_id);

-- ── services ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  VARCHAR NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  description TEXT,
  keywords    TEXT[] DEFAULT '{}',
  industry_id VARCHAR,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_services_account_id ON services(account_id);

-- ── industries ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS industries (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  VARCHAR NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  description TEXT,
  naics_code  TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── query_clusters ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS query_clusters (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          VARCHAR NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  service_id          VARCHAR REFERENCES services(id),
  name                TEXT NOT NULL,
  intent_type         TEXT NOT NULL,
  primary_keyword     TEXT NOT NULL,
  secondary_keywords  TEXT[] DEFAULT '{}',
  search_volume       INTEGER,
  difficulty          INTEGER,
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_query_clusters_account_id ON query_clusters(account_id);

-- ── blueprints ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blueprints (
  id                        VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                VARCHAR NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  website_id                VARCHAR REFERENCES websites(id),
  name                      TEXT NOT NULL,
  page_type                 page_type NOT NULL,
  title_template            TEXT NOT NULL,
  meta_desc_template        TEXT NOT NULL,
  h1_template               TEXT NOT NULL,
  slug_template             TEXT NOT NULL,
  sections                  JSONB NOT NULL DEFAULT '[]',
  required_word_count       INTEGER NOT NULL DEFAULT 600,
  min_publish_score         DECIMAL(4,2) NOT NULL DEFAULT 0.70,
  min_local_signal          DECIMAL(4,2) NOT NULL DEFAULT 0.60,
  max_similarity_threshold  DECIMAL(4,2) NOT NULL DEFAULT 0.85,
  prompt_family             TEXT NOT NULL DEFAULT 'local_service',
  faq_enabled               BOOLEAN NOT NULL DEFAULT true,
  schema_types              TEXT[] DEFAULT '{LocalBusiness,FAQPage}',
  is_active                 BOOLEAN NOT NULL DEFAULT true,
  default_tier              INTEGER NOT NULL DEFAULT 2,
  min_score_for_tier1       INTEGER NOT NULL DEFAULT 80,
  city_tier_rules           JSONB,
  min_bank_completeness     INTEGER NOT NULL DEFAULT 70,
  max_cities_per_state      INTEGER,
  state_allowlist           TEXT[],
  metadata                  JSONB DEFAULT '{}',
  created_at                TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blueprints_account_id ON blueprints(account_id);
CREATE INDEX IF NOT EXISTS idx_blueprints_website_id ON blueprints(website_id);

-- ── pages ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pages (
  id                    VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id            VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  blueprint_id          VARCHAR REFERENCES blueprints(id),
  location_id           VARCHAR REFERENCES locations(id),
  service_id            VARCHAR REFERENCES services(id),
  industry_id           VARCHAR REFERENCES industries(id),
  query_cluster_id      VARCHAR REFERENCES query_clusters(id),
  page_type             page_type NOT NULL,
  slug                  TEXT NOT NULL,
  title                 TEXT NOT NULL,
  meta_description      TEXT,
  h1                    TEXT NOT NULL,
  canonical_url         TEXT,
  status                page_status NOT NULL DEFAULT 'draft',
  publish_score         DECIMAL(4,2),
  local_signal_score    DECIMAL(4,2),
  word_count            INTEGER,
  passed_qa             BOOLEAN,
  qa_report             JSONB,
  published_at          TIMESTAMP,
  prune_reason          TEXT,
  r2_key                TEXT,
  tier                  INTEGER NOT NULL DEFAULT 2,
  quality_score         INTEGER,
  score_breakdown       JSONB,
  index_status          TEXT NOT NULL DEFAULT 'queued',
  fallback_hit_count    INTEGER NOT NULL DEFAULT 0,
  last_evaluated_at     TIMESTAMP,
  rollout_phase         TEXT,
  promotion_status      TEXT NOT NULL DEFAULT 'default',
  noindex               BOOLEAN NOT NULL DEFAULT false,
  is_draft              BOOLEAN DEFAULT false,
  draft_reason          VARCHAR(50),
  publish_wave          INTEGER DEFAULT 0,
  override_published_by VARCHAR(100),
  override_published_at TIMESTAMP,
  gsc_submitted_at      TIMESTAMP,
  duplicate_flag        BOOLEAN DEFAULT false,
  duplicate_of_slug     VARCHAR(500),
  duplicate_similarity  DECIMAL(5,4),
  trust_score           INTEGER,
  evidence_score        INTEGER,
  content_quality_score INTEGER,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pages_website_id ON pages(website_id);
CREATE INDEX IF NOT EXISTS idx_pages_website_slug ON pages(website_id, slug);
CREATE INDEX IF NOT EXISTS idx_pages_website_status ON pages(website_id, status);
CREATE INDEX IF NOT EXISTS idx_pages_website_updated ON pages(website_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_pages_website_created ON pages(website_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status);
CREATE INDEX IF NOT EXISTS idx_pages_updated_at ON pages(updated_at);
CREATE INDEX IF NOT EXISTS idx_pages_duplicate_flag ON pages(website_id, duplicate_flag);
CREATE INDEX IF NOT EXISTS idx_pages_gsc_submitted ON pages(website_id, gsc_submitted_at);
CREATE INDEX IF NOT EXISTS idx_pages_publish_wave ON pages(website_id, publish_wave);
CREATE INDEX IF NOT EXISTS idx_pages_pub_tier ON pages(website_id, tier) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_pages_pub_slug ON pages(website_id, slug) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_pages_pub_quality ON pages(website_id, quality_score) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_pages_pub_updated ON pages(website_id, updated_at) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_pages_pub_tier_qscore ON pages(website_id, tier) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_pages_recent_activity ON pages(website_id, updated_at);

-- ── page_versions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS page_versions (
  id                VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id           VARCHAR NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  version           INTEGER NOT NULL DEFAULT 1,
  content_html      TEXT NOT NULL,
  content_json      JSONB,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  review_notes      TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_page_versions_page_id ON page_versions(page_id);
CREATE INDEX IF NOT EXISTS idx_page_versions_active ON page_versions(page_id, is_active);

-- ── internal_links ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS internal_links (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id  VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  from_page_id VARCHAR NOT NULL REFERENCES pages(id),
  to_page_id  VARCHAR NOT NULL REFERENCES pages(id),
  anchor_text TEXT NOT NULL,
  link_type   TEXT NOT NULL DEFAULT 'contextual',
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_internal_links_website_id ON internal_links(website_id);

-- ── generation_jobs ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS generation_jobs (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       VARCHAR NOT NULL REFERENCES accounts(id),
  website_id       VARCHAR NOT NULL REFERENCES websites(id),
  blueprint_id     VARCHAR REFERENCES blueprints(id),
  name             TEXT NOT NULL,
  status           job_status NOT NULL DEFAULT 'pending',
  total_pages      INTEGER NOT NULL DEFAULT 0,
  processed_pages  INTEGER NOT NULL DEFAULT 0,
  passed_pages     INTEGER NOT NULL DEFAULT 0,
  failed_pages     INTEGER NOT NULL DEFAULT 0,
  error_log        JSONB DEFAULT '[]',
  settings         JSONB DEFAULT '{}',
  started_at       TIMESTAMP,
  completed_at     TIMESTAMP,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_account_id ON generation_jobs(account_id);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_website_id ON generation_jobs(website_id);

-- ── sitemaps ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sitemaps (
  id             VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id     VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL,
  url_count      INTEGER NOT NULL DEFAULT 0,
  r2_key         TEXT,
  xml_content    TEXT,
  last_generated TIMESTAMP,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sitemaps_website_id ON sitemaps(website_id);

-- ── page_metrics ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS page_metrics (
  id           VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id      VARCHAR NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  website_id   VARCHAR NOT NULL REFERENCES websites(id),
  date         TEXT NOT NULL,
  impressions  INTEGER NOT NULL DEFAULT 0,
  clicks       INTEGER NOT NULL DEFAULT 0,
  avg_position DECIMAL(6,2),
  ctr          DECIMAL(6,4),
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── content_variation_banks ───────────────────────────────────
CREATE TABLE IF NOT EXISTS content_variation_banks (
  id           VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   VARCHAR NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  website_id   VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  service      TEXT NOT NULL,
  section_name TEXT NOT NULL,
  variations   JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── state_data ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS state_data (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  state_name           TEXT NOT NULL,
  state_abbr           TEXT NOT NULL,
  population           INTEGER NOT NULL,
  business_count       INTEGER NOT NULL,
  major_cities         JSONB NOT NULL DEFAULT '[]',
  landmarks            JSONB NOT NULL DEFAULT '[]',
  business_culture     TEXT NOT NULL,
  payment_regulations  TEXT NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS state_data_state_abbr_unique ON state_data(state_abbr);

-- ── leads ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id    VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  page_id       VARCHAR REFERENCES pages(id) ON DELETE SET NULL,
  page_slug     TEXT,
  name          TEXT NOT NULL,
  business_name TEXT,
  email         TEXT NOT NULL,
  phone         TEXT,
  message       TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── fallback_hit_logs ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fallback_hit_logs (
  id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id    VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  hit_count     INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  promoted      BOOLEAN NOT NULL DEFAULT false,
  promoted_at   TIMESTAMP
);

-- ── variation_bank_completeness ───────────────────────────────
CREATE TABLE IF NOT EXISTS variation_bank_completeness (
  id                        VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id                VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  service                   TEXT NOT NULL,
  has_intro                 BOOLEAN NOT NULL DEFAULT false,
  has_how_it_works          BOOLEAN NOT NULL DEFAULT false,
  has_benefits              BOOLEAN NOT NULL DEFAULT false,
  has_faq                   BOOLEAN NOT NULL DEFAULT false,
  has_cta                   BOOLEAN NOT NULL DEFAULT false,
  has_local_context         BOOLEAN NOT NULL DEFAULT false,
  has_use_case              BOOLEAN NOT NULL DEFAULT false,
  has_proof_trust           BOOLEAN NOT NULL DEFAULT false,
  has_pain_point            BOOLEAN NOT NULL DEFAULT false,
  has_local_stat            BOOLEAN NOT NULL DEFAULT false,
  total_variations          INTEGER NOT NULL DEFAULT 0,
  avg_variations_per_section INTEGER NOT NULL DEFAULT 0,
  completeness_score        INTEGER NOT NULL DEFAULT 0,
  is_eligible_for_tier1     BOOLEAN NOT NULL DEFAULT false,
  last_computed_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── hub_pages ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub_pages (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id       VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  account_id       VARCHAR NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  hub_type         TEXT NOT NULL,
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL,
  tier             INTEGER NOT NULL DEFAULT 1,
  quality_score    INTEGER,
  status           TEXT NOT NULL DEFAULT 'draft',
  content          TEXT,
  parent_slug      TEXT,
  max_child_links  INTEGER NOT NULL DEFAULT 30,
  meta_description TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hub_pages_account_id ON hub_pages(account_id);
CREATE INDEX IF NOT EXISTS idx_hub_pages_website_id ON hub_pages(website_id);
