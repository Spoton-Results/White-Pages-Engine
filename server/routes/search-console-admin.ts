import { Router } from "express";
import crypto from "crypto";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

function isAgencyRole(req: any) {
  const role = String(req.session?.role || req.session?.user?.role || "").toLowerCase();
  return role === "agency" || role === "agency_admin" || role === "agency_user";
}

function requireInternalAdmin(req: any, res: any, next: any) {
  if (isAgencyRole(req)) return res.status(403).json({ message: "Forbidden: Search Console setup is admin-only" });
  return next();
}

function base64url(input: string | Buffer) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function normalizeDomain(domain: string) {
  return String(domain || "").trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").toLowerCase();
}

function propertyUrlFromDomain(domain: string) {
  const clean = normalizeDomain(domain);
  return clean ? `sc-domain:${clean}` : "";
}

function siteUrlFromDomain(domain: string) {
  const clean = normalizeDomain(domain);
  return clean ? `https://${clean}` : "";
}

function getGoogleServiceAccountConfig() {
  const projectId = process.env.GOOGLE_PROJECT_ID || "";
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GSC_ADMIN_EMAIL || "";
  const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY || process.env.PRIVATE_KEY || "";
  const privateKey = rawPrivateKey.replace(/\\n/g, "\n");
  const privateKeySource = process.env.GOOGLE_PRIVATE_KEY ? "GOOGLE_PRIVATE_KEY" : process.env.PRIVATE_KEY ? "PRIVATE_KEY" : null;
  return {
    projectId,
    clientEmail,
    privateKey,
    privateKeySource,
    hasProjectId: !!projectId,
    hasClientEmail: !!clientEmail,
    hasPrivateKey: !!privateKey,
    privateKeyLooksValid: privateKey.includes("BEGIN PRIVATE KEY") && privateKey.includes("END PRIVATE KEY"),
  };
}

async function getGoogleAccessToken() {
  const cfg = getGoogleServiceAccountConfig();
  if (!cfg.clientEmail) throw new Error("Missing GOOGLE_CLIENT_EMAIL / GOOGLE_SERVICE_ACCOUNT_EMAIL / GSC_ADMIN_EMAIL");
  if (!cfg.privateKey) throw new Error("Missing GOOGLE_PRIVATE_KEY or PRIVATE_KEY");
  if (!cfg.privateKeyLooksValid) throw new Error("Private key does not look like a valid PEM private key");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: cfg.clientEmail,
    scope: GSC_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(cfg.privateKey);
  const assertion = `${signingInput}.${base64url(signature)}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const tokenJson: any = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) throw new Error(tokenJson.error_description || tokenJson.error || `Google token request failed: ${tokenRes.status}`);
  return String(tokenJson.access_token || "");
}

async function callSearchConsole(path: string, init: RequestInit = {}) {
  const token = await getGoogleAccessToken();
  const res = await fetch(`https://www.googleapis.com/webmasters/v3${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || json.error_description || `Search Console API failed: ${res.status}`);
  return json;
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

function mapPropertyRow(r: any) {
  return {
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
  };
}

router.get("/api/search-console/config", requireAuth, requireInternalAdmin, async (_req, res) => {
  const cfg = getGoogleServiceAccountConfig();
  const adminGoogleUser = cfg.clientEmail;
  res.json({
    adminGoogleUser,
    accessMethod: "delegated_admin_user",
    serviceAccountReady: cfg.hasClientEmail && cfg.hasPrivateKey && cfg.privateKeyLooksValid,
    hasProjectId: cfg.hasProjectId,
    hasClientEmail: cfg.hasClientEmail,
    hasPrivateKey: cfg.hasPrivateKey,
    privateKeyLooksValid: cfg.privateKeyLooksValid,
    privateKeySource: cfg.privateKeySource,
    clientInstruction: adminGoogleUser
      ? `Please add ${adminGoogleUser} as a Full user in your Google Search Console property.`
      : "Add your Google service account email as a Full user in the client's Google Search Console property.",
  });
});

router.get("/api/search-console/auth-test", requireAuth, requireInternalAdmin, async (_req, res) => {
  const cfg = getGoogleServiceAccountConfig();
  try {
    const token = await getGoogleAccessToken();
    res.json({
      ok: true,
      message: "Google service account authenticated successfully.",
      projectId: cfg.projectId || null,
      clientEmail: cfg.clientEmail || null,
      tokenReceived: !!token,
      privateKeySource: cfg.privateKeySource,
      checks: {
        hasProjectId: cfg.hasProjectId,
        hasClientEmail: cfg.hasClientEmail,
        hasPrivateKey: cfg.hasPrivateKey,
        privateKeyLooksValid: cfg.privateKeyLooksValid,
      },
    });
  } catch (err: any) {
    res.status(400).json({
      ok: false,
      message: err.message || "Google service account authentication failed.",
      projectId: cfg.projectId || null,
      clientEmail: cfg.clientEmail || null,
      privateKeySource: cfg.privateKeySource,
      checks: {
        hasProjectId: cfg.hasProjectId,
        hasClientEmail: cfg.hasClientEmail,
        hasPrivateKey: cfg.hasPrivateKey,
        privateKeyLooksValid: cfg.privateKeyLooksValid,
      },
    });
  }
});

router.post("/api/search-console/auto-create", requireAuth, requireInternalAdmin, async (_req, res) => {
  try {
    await ensureSearchConsoleTables();
    const cfg = getGoogleServiceAccountConfig();
    const websites = await pool.query(`
      SELECT id, account_id, name, domain
      FROM websites
      WHERE COALESCE(domain, '') <> ''
      ORDER BY id DESC
      LIMIT 1000
    `);

    let created = 0;
    let repaired = 0;
    let skipped = 0;
    const rows: any[] = [];

    for (const w of websites.rows) {
      const propertyUrl = propertyUrlFromDomain(w.domain);
      const siteUrl = siteUrlFromDomain(w.domain);
      if (!propertyUrl || !w.account_id) {
        skipped++;
        continue;
      }

      const existing = await pool.query(
        `SELECT id FROM search_console_properties
         WHERE website_id::text = $1::text
            OR (account_id::text = $2::text AND property_url = $3)
         LIMIT 1`,
        [w.id, w.account_id, propertyUrl],
      );

      if (existing.rows[0]) {
        await pool.query(
          `UPDATE search_console_properties
           SET website_id = COALESCE(website_id, $2::uuid),
               property_url = COALESCE(NULLIF(property_url, ''), $3),
               site_url = COALESCE(site_url, $4),
               access_method = 'delegated_admin_user',
               admin_google_user = COALESCE(admin_google_user, $5),
               updated_at = NOW()
           WHERE id::text = $1::text`,
          [existing.rows[0].id, w.id, propertyUrl, siteUrl, cfg.clientEmail || null],
        );
        repaired++;
        rows.push({ websiteId: w.id, domain: w.domain, propertyUrl, action: "repaired" });
      } else {
        await pool.query(
          `INSERT INTO search_console_properties (
            account_id, website_id, property_url, site_url, connection_status, access_method,
            admin_google_user, sitemap_submitted, indexed_pages, clicks, impressions, coverage_warnings, updated_at
           ) VALUES ($1::uuid, $2::uuid, $3, $4, 'access_pending', 'delegated_admin_user', $5, false, 0, 0, 0, 0, NOW())`,
          [w.account_id, w.id, propertyUrl, siteUrl, cfg.clientEmail || null],
        );
        created++;
        rows.push({ websiteId: w.id, domain: w.domain, propertyUrl, action: "created" });
      }
    }

    res.json({
      ok: true,
      message: `Auto-created ${created} and repaired ${repaired} Search Console tracking row(s).`,
      created,
      repaired,
      skipped,
      rows: rows.slice(0, 50),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message || "Auto-create failed." });
  }
});

router.post("/api/search-console/properties/:id/sync-test", requireAuth, requireInternalAdmin, async (req, res) => {
  try {
    await ensureSearchConsoleTables();
    const result = await pool.query(`SELECT id, property_url FROM search_console_properties WHERE id::text = $1::text LIMIT 1`, [req.params.id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ ok: false, message: "Search Console property not found" });

    const sites = await callSearchConsole("/sites");
    const propertyUrl = String(row.property_url || "");
    const matchedSite = (sites.siteEntry || []).find((site: any) => String(site.siteUrl) === propertyUrl);

    let searchAnalytics: any = null;
    if (matchedSite) {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 28);
      searchAnalytics = await callSearchConsole(`/sites/${encodeURIComponent(propertyUrl)}/searchAnalytics/query`, {
        method: "POST",
        body: JSON.stringify({ startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), rowLimit: 1 }),
      });
      const totals = (searchAnalytics.rows || []).reduce(
        (acc: any, r: any) => ({
          clicks: acc.clicks + Number(r.clicks || 0),
          impressions: acc.impressions + Number(r.impressions || 0),
          positionTotal: acc.positionTotal + Number(r.position || 0),
          count: acc.count + 1,
        }),
        { clicks: 0, impressions: 0, positionTotal: 0, count: 0 },
      );
      await pool.query(
        `UPDATE search_console_properties
         SET connection_status = 'sync_active', clicks = $2, impressions = $3, average_position = $4,
             last_sync_at = NOW(), updated_at = NOW()
         WHERE id::text = $1::text`,
        [req.params.id, totals.clicks, totals.impressions, totals.count ? totals.positionTotal / totals.count : null],
      );
    }

    res.json({
      ok: true,
      message: matchedSite
        ? "Property access confirmed and sample Search Console sync succeeded."
        : "Service account authenticated, but this property was not found in accessible Search Console sites.",
      propertyUrl,
      accessibleSitesCount: (sites.siteEntry || []).length,
      propertyMatched: !!matchedSite,
      matchedPermissionLevel: matchedSite?.permissionLevel || null,
      sampleRows: searchAnalytics?.rows?.length || 0,
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message || "Search Console sync test failed." });
  }
});

router.get("/api/search-console/properties", requireAuth, requireInternalAdmin, async (_req, res, next) => {
  try {
    await ensureSearchConsoleTables();
    const result = await pool.query(`
      SELECT scp.id, scp.account_id, a.name AS account_name, scp.website_id, w.name AS website_name,
             w.domain AS website_domain, scp.property_url, scp.site_url, scp.connection_status,
             scp.access_method, scp.admin_google_user, scp.sitemap_submitted, scp.indexed_pages,
             scp.clicks, scp.impressions, scp.average_position, scp.coverage_warnings,
             scp.last_sync_at, scp.updated_at
      FROM search_console_properties scp
      JOIN accounts a ON a.id::text = scp.account_id::text
      LEFT JOIN websites w ON w.id::text = scp.website_id::text
      ORDER BY COALESCE(scp.last_sync_at, scp.updated_at, scp.created_at) DESC
      LIMIT 500
    `);
    res.json(result.rows.map(mapPropertyRow));
  } catch (err) {
    next(err);
  }
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
    const adminGoogleUser = String(req.body?.adminGoogleUser || process.env.GSC_ADMIN_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || "").trim() || null;
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

    const result = await pool.query(
      `INSERT INTO search_console_properties (
        account_id, website_id, property_url, site_url, connection_status, access_method, admin_google_user,
        sitemap_submitted, indexed_pages, clicks, impressions, average_position, coverage_warnings, last_sync_at, updated_at
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
      RETURNING id`,
      [accountId, websiteId, propertyUrl, siteUrl, connectionStatus, accessMethod, adminGoogleUser, sitemapSubmitted, indexedPages, clicks, impressions, averagePosition, coverageWarnings, lastSyncAt],
    );

    res.json({ ok: true, id: result.rows[0]?.id });
  } catch (err) {
    next(err);
  }
});

router.put("/api/search-console/properties/:id", requireAuth, requireInternalAdmin, async (req, res, next) => {
  try {
    await ensureSearchConsoleTables();
    const id = req.params.id;
    const propertyUrl = String(req.body?.propertyUrl || "").trim();
    const siteUrl = String(req.body?.siteUrl || "").trim() || null;
    const connectionStatus = String(req.body?.connectionStatus || "access_confirmed");
    const accessMethod = String(req.body?.accessMethod || "delegated_admin_user");
    const adminGoogleUser = String(req.body?.adminGoogleUser || process.env.GSC_ADMIN_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || "").trim() || null;
    const sitemapSubmitted = !!req.body?.sitemapSubmitted;
    const indexedPages = Math.max(0, Number(req.body?.indexedPages || 0));
    const clicks = Math.max(0, Number(req.body?.clicks || 0));
    const impressions = Math.max(0, Number(req.body?.impressions || 0));
    const averagePositionRaw = req.body?.averagePosition;
    const averagePosition = averagePositionRaw === "" || averagePositionRaw === null || averagePositionRaw === undefined ? null : Number(averagePositionRaw);
    const coverageWarnings = Math.max(0, Number(req.body?.coverageWarnings || 0));
    const lastSyncAt = req.body?.lastSyncAt ? new Date(req.body.lastSyncAt) : new Date();

    if (!propertyUrl) return res.status(400).json({ message: "propertyUrl is required" });

    const result = await pool.query(
      `UPDATE search_console_properties
       SET property_url = $2, site_url = $3, connection_status = $4, access_method = $5,
           admin_google_user = $6, sitemap_submitted = $7, indexed_pages = $8,
           clicks = $9, impressions = $10, average_position = $11, coverage_warnings = $12,
           last_sync_at = $13, updated_at = NOW()
       WHERE id::text = $1::text
       RETURNING id`,
      [id, propertyUrl, siteUrl, connectionStatus, accessMethod, adminGoogleUser, sitemapSubmitted, indexedPages, clicks, impressions, averagePosition, coverageWarnings, lastSyncAt],
    );

    if (!result.rows[0]) return res.status(404).json({ message: "Search Console property not found" });
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    next(err);
  }
});

router.delete("/api/search-console/properties/:id", requireAuth, requireInternalAdmin, async (req, res, next) => {
  try {
    await ensureSearchConsoleTables();
    const result = await pool.query(`DELETE FROM search_console_properties WHERE id::text = $1::text RETURNING id`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ message: "Search Console property not found" });
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    next(err);
  }
});

export default router;
