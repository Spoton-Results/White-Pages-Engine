-- Migration: add unique index on content_variation_banks(website_id, service, section_name)
--
-- This index is required by the ON CONFLICT clause in createVariationBank.
-- Without it Postgres throws:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- which causes the route to crash and Express to return its HTML error page,
-- making the frontend JSON.parse fail with !DOCTYPE "... is not valid JSON.
--
-- CONCURRENTLY means this runs without locking the table on live deployments.
-- Remove CONCURRENTLY if you are running this inside a transaction block.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS cvb_website_service_section_unique
  ON content_variation_banks (website_id, service, section_name);
