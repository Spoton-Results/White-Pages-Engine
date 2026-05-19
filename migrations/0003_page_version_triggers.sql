-- Migration 0003: page_version triggers & functions
-- Previously ran as runtime DDL on every server boot in
-- server/services/bulk-transaction-safety.ts
-- Now idempotent via CREATE OR REPLACE / DROP IF EXISTS.

-- ── Function: enforce single active version per page ────────────────────────
CREATE OR REPLACE FUNCTION nexus_page_versions_single_active()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE page_versions
    SET is_active = false
    WHERE page_id = NEW.page_id
      AND is_active = true
      AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Function: auto-create placeholder version on page insert ─────────────────
CREATE OR REPLACE FUNCTION nexus_pages_placeholder_version()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM page_versions WHERE page_id = NEW.id AND is_active = true
  ) THEN
    INSERT INTO page_versions (id, page_id, version, content_html, content_json, is_active, created_at)
    VALUES (
      gen_random_uuid(),
      NEW.id,
      0,
      '',
      jsonb_build_object('placeholder', true, 'source', 'migration_0003', 'createdAt', NOW()),
      true,
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Triggers ─────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_page_versions_single_active ON page_versions;
CREATE TRIGGER trg_page_versions_single_active
  BEFORE INSERT ON page_versions
  FOR EACH ROW
  WHEN (NEW.is_active = true)
  EXECUTE FUNCTION nexus_page_versions_single_active();

DROP TRIGGER IF EXISTS trg_pages_placeholder_version ON pages;
CREATE TRIGGER trg_pages_placeholder_version
  AFTER INSERT ON pages
  FOR EACH ROW
  EXECUTE FUNCTION nexus_pages_placeholder_version();
