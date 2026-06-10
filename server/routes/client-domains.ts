import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";
import { resolveCname, resolve4 } from "node:dns/promises";
import { buildEnhancedPublicPageHtml, getPublicInternalLinks } from "../services/public-page-enhancements";

const router = Router();

function normalizeHostname(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

function getRequestHostname(req: Request) {
  return normalizeHostname(
    req.headers["x-nexus-host"] ||
    req.headers["cf-custom-hostname"] ||
    req.headers["x-forwarded-host"] ||
    req.headers.host,
  );
}

function dnsTarget() {
  return process.env.CLIENT_DOMAIN_CNAME_TARGET || process.env.NEXUS_CNAME_TARGET || "cname.spotonnexus.com";
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function notFoundHtml(message: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Page Not Found</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#0f172a}.box{max-width:520px;padding:32px;text-align:center}h1{font-size:34px;margin:0 0 10px}p{color:#64748b;line-height:1.6}</style></head><body><main class="box"><h1>404</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

async function ensureClientDomainsTable(client: any = pool) {
  await client.query(`CREATE TABLE IF NOT EXISTS client_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    website_id TEXT NOT NULL,
    account_id TEXT,
    hostname TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending_dns',
    cloudflare_hostname_id TEXT,
    ownership_txt_name TEXT,
    ownership_txt_value TEXT,
    ssl_status TEXT,
    error TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    verified_at TIMESTAMP
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_client_domains_website ON client_domains(website_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_client_domains_hostname ON client_domains(hostname)`);
}

async function ensureFallbackHitLogsTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS fallback_hit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    website_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 1,
    first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
    promoted BOOLEAN NOT NULL DEFAULT false,
    promoted_at TIMESTAMP
  )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_fallback_hit_logs_site_slug_unique ON fallback_hit_logs(website_id, slug)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fallback_hit_logs_site ON fallback_hit_logs(website_id)`);
}

async function logCustomDomainFallbackHit(websiteId: string, slug: string) {
  await ensureFallbackHitLogsTable();
  await pool.query(
    `INSERT INTO fallback_hit_logs (website_id, slug, hit_count, first_seen_at, last_seen_at)
     VALUES ($1, $2, 1, NOW(), NOW())
     ON CONFLICT (website_id, slug)
     DO UPDATE SET hit_count = fallback_hit_logs.hit_count + 1, last_seen_at = NOW()`,
    [websiteId, slug],
  );
}

async function resolveClientDomain(hostname: string) {
  if (!hostname) return null;
  await ensureClientDomainsTable();
  const result = await pool.query(
    `SELECT
       cd.id AS client_domain_id,
       cd.hostname,
       cd.status AS client_domain_status,
       cd.ssl_status,
       w.id AS website_id,
       w.account_id,
       w.brand_profile_id,
       w.name AS website_name,
       w.domain AS website_domain,
       w.status AS website_status,
       w.robots_txt,
       COALESCE(w.settings, '{}') AS website_settings,
       bp.name AS brand_name,
       bp.primary_color,
       bp.tagline,
       bp.phone,
       bp.email,
       bp.custom_fields
     FROM client_domains cd
     JOIN websites w ON w.id::text = cd.website_id::text
     LEFT JOIN brand_profiles bp ON bp.id::text = w.brand_profile_id::text
     WHERE lower(cd.hostname) = lower($1)
     LIMIT 1`,
    [hostname],
  );
  return result.rows[0] || null;
}

function shouldIgnorePublicResolver(req: Request) {
  const path = req.path || "/";
  if (path.startsWith("/sites/")) return true;
  if (path.startsWith("/api")) return true;
  if (path.startsWith("/assets")) return true;
  if (path.startsWith("/@vite") || path.startsWith("/src/")) return true;
  if (path === "/favicon.ico") return true;
  if (req.method !== "GET" && req.method !== "HEAD") return true;
  return false;
}

async function serveRobots(ctx: any, host: string, res: Response) {
  const customRobots = ctx.robots_txt || ctx.robotsTxt;
  const body = customRobots && String(customRobots).trim().length
    ? String(customRobots)
    : `User-agent: *\nAllow: /\n\nSitemap: https://${host}/sitemap.xml\n`;
  res.type("text/plain").send(body);
}

async function serveSitemap(ctx: any, host: string, slug: string, res: Response) {
  const sitemapSlug = slug || "sitemap.xml";
  const result = await pool.query(
    `SELECT slug, xml_content FROM sitemaps WHERE website_id::text = $1::text AND slug = $2 LIMIT 1`,
    [ctx.website_id, sitemapSlug],
  );
  let xml = result.rows[0]?.xml_content;
  if (!xml && sitemapSlug === "sitemap.xml") {
    const latest = await pool.query(
      `SELECT slug, xml_content FROM sitemaps WHERE website_id::text = $1::text ORDER BY last_generated DESC NULLS LAST, created_at DESC LIMIT 1`,
      [ctx.website_id],
    );
    xml = latest.rows[0]?.xml_content;
  }
  if (!xml) return res.status(404).type("text/html").send(notFoundHtml("Sitemap not found for this custom domain."));
  xml = String(xml).replaceAll(`https://${ctx.website_domain}`, `https://${host}`);
  res.type("application/xml").send(xml);
}

async function resolveHomepageSlug(ctx: any) {
  const settings = ctx.website_settings || {};
  const explicit = settings.homepageSlug || settings.home_slug || settings.homePageSlug || settings.defaultSlug;
  if (explicit) return String(explicit).replace(/^\/+/, "");

  const hub = await pool.query(
    `SELECT slug FROM hub_pages
     WHERE website_id::text = $1::text AND status = 'published'
     ORDER BY tier ASC, quality_score DESC NULLS LAST, updated_at DESC
     LIMIT 1`,
    [ctx.website_id],
  );
  if (hub.rows[0]?.slug) return hub.rows[0].slug;

  const page = await pool.query(
    `SELECT slug FROM pages
     WHERE website_id::text = $1::text AND status = 'published'
     ORDER BY tier ASC, quality_score DESC NULLS LAST, updated_at DESC
     LIMIT 1`,
    [ctx.website_id],
  );
  return page.rows[0]?.slug || null;
}

async function serveClientPage(ctx: any, host: string, slug: string, res: Response) {
  const pageResult = await pool.query(
    `SELECT * FROM pages WHERE website_id::text = $1::text AND slug = $2 AND status = 'published' LIMIT 1`,
    [ctx.website_id, slug],
  );
  const page = pageResult.rows[0];
  if (!page) {
    logCustomDomainFallbackHit(ctx.website_id, slug).catch(() => null);
    return res.status(404).type("text/html").send(notFoundHtml("No published Nexus page exists for this URL yet. The request was logged for promotion review."));
  }

  const versionResult = await pool.query(
    `SELECT * FROM page_versions WHERE page_id::text = $1::text AND is_active = true ORDER BY version DESC LIMIT 1`,
    [page.id],
  );
  const version = versionResult.rows[0];
  if (!version) return res.status(404).type("text/html").send(notFoundHtml("This page is published but does not have an active page version yet."));

  const contentHtml = version.content_html || version.contentHtml || page.content_html || page.contentHtml || page.html || page.body || "";
  const links = await getPublicInternalLinks(page.id, ctx.website_id);
  const canonicalUrl = `https://${host}/${page.slug}`;
  const settings = ctx.website_settings || {};
  const website = {
    id: ctx.website_id,
    accountId: ctx.account_id,
    account_id: ctx.account_id,
    domain: host,
    name: settings.brandName || settings.siteName || settings.businessName || ctx.brand_name || ctx.website_name || ctx.website_domain || host,
    brandName: settings.brandName || ctx.brand_name || ctx.website_name || ctx.website_domain || host,
    websiteName: settings.siteName || settings.brandName || ctx.website_name || ctx.website_domain || host,
    phone: settings.phone || ctx.phone,
    email: settings.email || ctx.email,
    primaryColor: settings.primaryColor || ctx.primary_color,
    settings: {
      ...(ctx.custom_fields || {}),
      ...settings,
      brandName: settings.brandName || ctx.brand_name || ctx.website_name || ctx.website_domain || host,
      siteName: settings.siteName || settings.brandName || ctx.brand_name || ctx.website_name || ctx.website_domain || host,
      businessName: settings.businessName || settings.brandName || ctx.brand_name || ctx.website_name || ctx.website_domain || host,
      phone: settings.phone || ctx.phone,
      email: settings.email || ctx.email,
    },
  };

  const html = buildEnhancedPublicPageHtml({ page, website, contentHtml, canonicalUrl, links });
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("X-Nexus-Public-Renderer", "client-domain-enhanced-v1");
  return res.type("text/html").send(
    html.replace("</head>", `<meta name="x-nexus-public-renderer" content="client-domain-enhanced-v1"/></head>`),
  );
}

async function serveHealth(ctx: any, host: string, res: Response) {
  const counts = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'published')::int AS published_pages,
       COUNT(*) FILTER (WHERE status = 'published' AND tier = 1)::int AS tier1_pages,
       COUNT(*) FILTER (WHERE status = 'published' AND noindex = true)::int AS noindex_pages
     FROM pages WHERE website_id::text = $1::text`,
    [ctx.website_id],
  );
  res.json({
    ok: true,
    hostname: host,
    websiteId: ctx.website_id,
    websiteDomain: ctx.website_domain,
    clientDomainStatus: ctx.client_domain_status,
    sslStatus: ctx.ssl_status,
    counts: counts.rows[0] || {},
  });
}

router.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (shouldIgnorePublicResolver(req)) return next();
    const host = getRequestHostname(req);
    const ctx = await resolveClientDomain(host);
    if (!ctx) return next();

    const pathname = decodeURIComponent((req.path || "/").replace(/^\/+/, ""));
    if (pathname === ".well-known/nexus-domain-health") return serveHealth(ctx, host, res);
    if (!pathname) {
      const homeSlug = await resolveHomepageSlug(ctx);
      if (!homeSlug) return res.status(404).type("text/html").send(notFoundHtml("This custom domain is connected, but no published homepage or hub page exists yet."));
      return serveClientPage(ctx, host, homeSlug, res);
    }
    if (pathname === "robots.txt") return serveRobots(ctx, host, res);
    if (/^sitemap(?:[-\w]*)?\.xml$/i.test(pathname)) return serveSitemap(ctx, host, pathname, res);
    return serveClientPage(ctx, host, pathname, res);
  } catch (err) {
    return next(err);
  }
});

router.use(requireAuth);

async function assertWebsiteAccess(req: Request, res: Response, websiteId: string) {
  const website = (await pool.query(`SELECT id, account_id, domain, name FROM websites WHERE id::text = $1::text LIMIT 1`, [websiteId])).rows[0];
  if (!website) { res.status(404).json({ message: "Website not found" }); return null; }
  if (!req.session.isSuperAdmin && String(req.session.accountId) !== String(website.account_id)) {
    res.status(403).json({ message: "Forbidden: No access to this website" }); return null;
  }
  return website;
}

async function cfRequest(path: string, init: RequestInit = {}) {
  const zoneId = process.env.CF_ZONE_ID || process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
  if (!zoneId || !apiToken) throw new Error("Cloudflare credentials missing. Add CF_ZONE_ID and CF_API_TOKEN in Railway.");
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    const msg = json.errors?.[0]?.message || `Cloudflare request failed: ${res.status}`;
    const err: any = new Error(msg);
    err.cloudflare = json;
    throw err;
  }
  return json.result;
}

function extractValidation(result: any) {
  const ownership = result?.ownership_verification || result?.ownership_verification_http || {};
  const ssl = result?.ssl || {};
  const sslTxt = ssl?.validation_records?.[0] || {};
  return {
    ownershipTxtName: ownership?.name || sslTxt?.txt_name || null,
    ownershipTxtValue: ownership?.value || sslTxt?.txt_value || null,
    sslStatus: ssl?.status || null,
  };
}

router.post("/api/websites/:websiteId/client-domains", requireAuth, async (req: Request, res: Response) => {
  await ensureClientDomainsTable();
  const access = await assertWebsiteAccess(req, res, req.params.websiteId);
  if (!access) return;
  const hostname = normalizeHostname(req.body?.hostname || req.body?.domain);
  if (!hostname || !hostname.includes(".")) return res.status(400).json({ message: "A valid hostname is required." });

  const existing = await pool.query(`SELECT id FROM client_domains WHERE lower(hostname) = lower($1) LIMIT 1`, [hostname]);
  if (existing.rows.length) return res.status(409).json({ message: "This hostname is already connected." });

  const created = await pool.query(
    `INSERT INTO client_domains (website_id, account_id, hostname, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'pending_dns', NOW(), NOW())
     RETURNING *`,
    [access.id, access.account_id, hostname],
  );

  try {
    const result = await cfRequest(`/custom_hostnames`, {
      method: "POST",
      body: JSON.stringify({
        hostname,
        ssl: { method: "txt", type: "dv", settings: { min_tls_version: "1.2" } },
      }),
    });
    const validation = extractValidation(result);
    await pool.query(
      `UPDATE client_domains
       SET cloudflare_hostname_id = $2,
           ownership_txt_name = $3,
           ownership_txt_value = $4,
           ssl_status = $5,
           updated_at = NOW()
       WHERE id = $1`,
      [created.rows[0].id, result.id || null, validation.ownershipTxtName, validation.ownershipTxtValue, validation.sslStatus],
    );
  } catch (err: any) {
    await pool.query(`UPDATE client_domains SET error = $2, updated_at = NOW() WHERE id = $1`, [created.rows[0].id, err?.message || "Cloudflare setup failed"]);
  }

  const row = (await pool.query(`SELECT * FROM client_domains WHERE id = $1`, [created.rows[0].id])).rows[0];
  res.status(201).json({ ...row, dnsTarget: dnsTarget() });
});

router.get("/api/websites/:websiteId/client-domains", requireAuth, async (req: Request, res: Response) => {
  await ensureClientDomainsTable();
  const access = await assertWebsiteAccess(req, res, req.params.websiteId);
  if (!access) return;
  const result = await pool.query(`SELECT * FROM client_domains WHERE website_id::text = $1::text ORDER BY created_at DESC`, [access.id]);
  res.json({ domains: result.rows, dnsTarget: dnsTarget() });
});

router.delete("/api/websites/:websiteId/client-domains/:domainId", requireAuth, async (req: Request, res: Response) => {
  await ensureClientDomainsTable();
  const access = await assertWebsiteAccess(req, res, req.params.websiteId);
  if (!access) return;
  const domain = (await pool.query(`SELECT * FROM client_domains WHERE id::text = $1::text AND website_id::text = $2::text LIMIT 1`, [req.params.domainId, access.id])).rows[0];
  if (!domain) return res.status(404).json({ message: "Client domain not found" });

  if (domain.cloudflare_hostname_id) {
    cfRequest(`/custom_hostnames/${domain.cloudflare_hostname_id}`, { method: "DELETE" }).catch(() => null);
  }
  await pool.query(`DELETE FROM client_domains WHERE id::text = $1::text`, [req.params.domainId]);
  res.json({ ok: true });
});

export default router;
