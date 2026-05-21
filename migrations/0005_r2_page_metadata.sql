-- Migration: 0005_r2_page_metadata
-- Previously orphaned outside Drizzle journal (was named 0000_r2_page_metadata.sql)
-- Registered in _journal.json as idx 5

-- Copy content from original 0000_r2_page_metadata.sql verbatim:
-- (original file preserved for reference; this is the canonical registered version)

-- Allow pages table to store R2 object key for generated HTML
ALTER TABLE pages ADD COLUMN IF NOT EXISTS r2_key TEXT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS r2_bucket TEXT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS r2_region TEXT;
