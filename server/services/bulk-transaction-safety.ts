import { pool } from "../db";

// ── Idempotency guard ─────────────────────────────────────────────────────────
// The trigger functions & triggers are now created by migration 0003.
// This module only runs the orphan-page repair on boot (cheap, safe to repeat).
// A DB-level flag ensures we never re-create triggers from application code.

let ensured = false;
let ensuring: Promise<void> | null = null;

/**
 * Verifies that the page_version triggers exist in the DB.
 * If they are already present (installed by migration 0003), this is a no-op.
 * This replaces the old pattern of running CREATE OR REPLACE on every boot.
 */
export async function ensureBulkTransactionSafety(): Promise<void> {
  if (ensured) return;
  if (ensuring) return ensuring;

  ensuring = (async () => {
    // Check whether the triggers already exist — installed by migration 0003.
    const result = await pool.query<{ count: string }>({
      text: `SELECT COUNT(*) AS count FROM pg_trigger
             WHERE tgname IN (
               'trg_page_versions_single_active',
               'trg_pages_placeholder_version'
             )`,
    });

    const count = parseInt(result.rows[0]?.count ?? "0", 10);

    if (count < 2) {
      // Migration 0003 has not run yet on this DB (e.g. a brand-new environment).
      // Install the triggers now as a one-time fallback — identical SQL to the migration.
      console.warn(
        "[bulk-transaction-safety] Triggers missing — installing via fallback (run migration 0003 to silence this)."
      );

      await pool.query(`
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
      `);

      await pool.query(`
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
              jsonb_build_object('placeholder', true, 'source', 'bulk_transaction_safety_fallback', 'createdAt', NOW()),
              true,
              NOW()
            );
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      await pool.query(`DROP TRIGGER IF EXISTS trg_page_versions_single_active ON page_versions`);
      await pool.query(`
        CREATE TRIGGER trg_page_versions_single_active
        BEFORE INSERT ON page_versions
        FOR EACH ROW
        WHEN (NEW.is_active = true)
        EXECUTE FUNCTION nexus_page_versions_single_active();
      `);

      await pool.query(`DROP TRIGGER IF EXISTS trg_pages_placeholder_version ON pages`);
      await pool.query(`
        CREATE TRIGGER trg_pages_placeholder_version
        AFTER INSERT ON pages
        FOR EACH ROW
        EXECUTE FUNCTION nexus_pages_placeholder_version();
      `);
    }

    ensured = true;
  })().finally(() => {
    ensuring = null;
  });

  return ensuring;
}

export async function repairPagesMissingActiveVersions(websiteId?: string): Promise<number> {
  await ensureBulkTransactionSafety();

  const result = await pool.query(
    `INSERT INTO page_versions (id, page_id, version, content_html, content_json, is_active, created_at)
     SELECT
       gen_random_uuid(),
       p.id,
       COALESCE((SELECT MAX(version) + 1 FROM page_versions pv WHERE pv.page_id = p.id), 0),
       '',
       jsonb_build_object('placeholder', true, 'source', 'bulk_transaction_repair', 'createdAt', NOW()),
       true,
       NOW()
     FROM pages p
     WHERE p.status = 'published'
       AND ($1::text IS NULL OR p.website_id::text = $1::text)
       AND NOT EXISTS (
         SELECT 1 FROM page_versions pv WHERE pv.page_id = p.id AND pv.is_active = true
       )`,
    [websiteId || null],
  );

  return result.rowCount || 0;
}
