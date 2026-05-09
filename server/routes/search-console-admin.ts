import { Router } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();

function isAgencyRole(req: any) {
  const role = String(req.session?.role || req.session?.user?.role || "").toLowerCase();
  return role === "agency" || role === "agency_admin" || role === "agency_user";
}

function requireInternalAdmin(req: any, res: any, next: any) {
  if (isAgencyRole(req)) return res.status(403).json({ message: "Forbidden: Search Console setup is admin-only" });
  return next();
}

async function ensureSearchConsoleTables() {
  await pool.query(`CREATE TABLE IF NOT EXISTS search_console_properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL,
    website_id UUID,
    property_url TEXT NOT NULL,
    site_url TEXT,
    connection_status TEXT NOT NULL DEFAULT 'access_pending',
    access_method TEXT NOT NULL DEFAULT 'delegated_admin_user',
    admin_google_user TEXT,
    sitemap_submitted BOOLEAN NOT NULL DEFAULT false,
    indexed_pages INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    average_position NUMERIC(10,2),
    coverage_warnings INTEGER NOT NULL DEFAULT 0,
    last_sync_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);
  await pool.query(`ALTER TABLE search_console_properties ADD COLUMN IF NOT EXISTS access_method TEXT NOT NULL DEFAULT 'delegated_admin_user'`);
  await pool.query(`ALTER TABLE search_console_properties ADD COLUMN IF NOT EXISTS admin_google_user TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_search_console_properties_account ON search_console_properties(account_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_search_console_properties_website ON search_console_properties(website_id)`);
}

router.get("/api/search-console/properties", requireAuth, requireInternalAdmin, async (_req, res, next) => {
  try {
    await ensureSearchConsoleTables();
    const result = await pool.query(`
      SELECT
        scp.id,
        scp.account_id,
        a.name AS account_name,
        scp.website_id,
        w.name AS website_name,
        w.domain AS website_domain,
        scp.property_url,
        scp.site_url,
        scp.connection_status,
        scp.access_method,
        scp.admin_google_user,
        scp.sitemap_submitted,
        scp.indexed_pages,
        scp.clicks,
        scp.impressions,
        scp.average_position,
        scp.coverage_warnings,
        scp.last_sync_at,
        scp.updated_at
      FROM search_console_properties scp
      JOIN accounts a ON a.id::text = scp.account_id::text
      LEFT JOIN websites w ON w.id::text = scp.website_id::text
      ORDER BY COALESCE(scp.last_sync_at, scp.updated_at, scp.created_at) DESC
      LIMIT 500
    `);
    res.json(result.rows.map((r: any) => ({
      id: r.id,
      accountId: r.account_id,
      accountName: r.account_name,
      websiteId: r.website_id,
      websiteName: r.website_name,
      websiteDomain: r.website_domain,
      propertyUrl: r.property_url,
      siteUrl: r.site_url,
      connectionStatus: r.connection_status,
      accessMethod: r.access_method,
      adminGoogleUser: r.admin_google_user,
      sitemapSubmitted: !!r.sitemap_submitted,
      indexedPages: Number(r.indexed_pages || 0),
      clicks: Number(r.clicks || 0),
      impressions: Number(r.impressions || 0),
      averagePosition: r.average_position === null ? null : Number(r.average_position),
      coverageWarnings: Number(r.coverage_warnings || 0),
      lastSyncAt: r.last_sync_at,
      updatedAt: r.updated_at,
    })));
  } catch (err) { next(err); }
});

router.post("/api/search-console/properties", requireAuth, requireInternalAdmin, async (req, res, next) => {
  try {
    await ensureSearchConsoleTables();
    const accountId = String(req.body?.accountId || "");
    const websiteId = req.body?.websiteId ? String(req.body.websiteId) : null;
    const propertyUrl = String(req.body?.propertyUrl || "").trim();
    const siteUrl = String(req.body?.siteUrl || "").trim() || null;
    const connectionStatus = String(req.body?.connectionStatus || "access_confirmed");
    const accessMethod = String(req.body?.accessMethod || "delegated_admin_user");
    const adminGoogleUser = String(req.body?.adminGoogleUser || "").trim() || null;
    const sitemapSubmitted = !!req.body?.sitemapSubmitted;
    const indexedPages = Math.max(0, Number(req.body?.indexedPages || 0));
    const clicks = Math.max(0, Number(req.body?.clicks || 0));
    const impressions = Math.max(0, Number(req.body?.impressions || 0));
    const averagePositionRaw = req.body?.averagePosition;
    const averagePosition = averagePositionRaw === "" || averagePositionRaw === null || averagePositionRaw === undefined ? null : Number(averagePositionRaw);
    const coverageWarnings = Math.max(0, Number(req.body?.coverageWarnings || 0));
    const lastSyncAt = req.body?.lastSyncAt ? new Date(req.body.lastSyncAt) : new Date();

    if (!accountId) return res.status(400).json({ message: "accountId is required" });
    if (!propertyUrl) return res.status(400).json({ message: "propertyUrl is required" });

    const accountCheck = await pool.query(`SELECT id FROM accounts WHERE id::text = $1::text LIMIT 1`, [accountId]);
    if (!accountCheck.rows[0]) return res.status(404).json({ message: "Account not found" });

    if (websiteId) {
      const websiteCheck = await pool.query(`SELECT id FROM websites WHERE id::text = $1::text AND account_id::text = $2::text LIMIT 1`, [websiteId, accountId]);
      if (!websiteCheck.rows[0]) return res.status(404).json({ message: "Website not found for this account" });
    }

    const result = await pool.query(`
      INSERT INTO search_console_properties (
        account_id, website_id, property_url, site_url, connection_status, access_method, admin_google_user,
        sitemap_submitted, indexed_pages, clicks, impressions, average_position, coverage_warnings, last_sync_at, updated_at
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
      RETURNING id
    `, [accountId, websiteId, propertyUrl, siteUrl, connectionStatus, accessMethod, adminGoogleUser, sitemapSubmitted, indexedPages, clicks, impressions, averagePosition, coverageWarnings, lastSyncAt]);

    res.json({ ok: true, id: result.rows[0]?.id });
  } catch (err) { next(err); }
});

router.put("/api/search-console/properties/:id", requireAuth, requireInternalAdmin, async (req, res, next) => {
  try {
    await ensureSearchConsoleTables();
    const id = req.params.id;
    const propertyUrl = String(req.body?.propertyUrl || "").trim();
    const siteUrl = String(req.body?.siteUrl || "").trim() || null;
    const connectionStatus = String(req.body?.connectionStatus || "access_confirmed");
    const accessMethod = String(req.body?.accessMethod || "delegated_admin_user");
    const adminGoogleUser = String(req.body?.adminGoogleUser || "").trim() || null;
    const sitemapSubmitted = !!req.body?.sitemapSubmitted;
    const indexedPages = Math.max(0, Number(req.body?.indexedPages || 0));
    const clicks = Math.max(0, Number(req.body?.clicks || 0));
    const impressions = Math.max(0, Number(req.body?.impressions || 0));
    const averagePositionRaw = req.body?.averagePosition;
    const averagePosition = averagePositionRaw === "" || averagePositionRaw === null || averagePositionRaw === undefined ? null : Number(averagePositionRaw);
    const coverageWarnings = Math.max(0, Number(req.body?.coverageWarnings || 0));
    const lastSyncAt = req.body?.lastSyncAt ? new Date(req.body.lastSyncAt) : new Date();

    if (!propertyUrl) return res.status(400).json({ message: "propertyUrl is required" });

    const result = await pool.query(`
      UPDATE search_console_properties
      SET property_url = $2,
          site_url = $3,
          connection_status = $4,
          access_method = $5,
          admin_google_user = $6,
          sitemap_submitted = $7,
          indexed_pages = $8,
          clicks = $9,
          impressions = $10,
          average_position = $11,
          coverage_warnings = $12,
          last_sync_at = $13,
          updated_at = NOW()
      WHERE id::text = $1::text
      RETURNING id
    `, [id, propertyUrl, siteUrl, connectionStatus, accessMethod, adminGoogleUser, sitemapSubmitted, indexedPages, clicks, impressions, averagePosition, coverageWarnings, lastSyncAt]);

    if (!result.rows[0]) return res.status(404).json({ message: "Search Console property not found" });
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) { next(err); }
});

router.delete("/api/search-console/properties/:id", requireAuth, requireInternalAdmin, async (req, res, next) => {
  try {
    await ensureSearchConsoleTables();
    const result = await pool.query(`DELETE FROM search_console_properties WHERE id::text = $1::text RETURNING id`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ message: "Search Console property not found" });
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) { next(err); }
});

export default router;
