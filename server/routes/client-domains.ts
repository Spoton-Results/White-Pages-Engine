import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";
import { resolveCname, resolve4 } from "node:dns/promises";

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
    .replace(/"/g, "&quot;")
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
  if (path.startsWith("/api")) return true;
  if (path.startsWith("/assets")) return true;
  if (path.startsWith("/@vite") || path.startsWith("/src/")) return true;
  if (path === "/favicon.ico") return true;
  if (req.method !== "GET" && req.method !== "HEAD") return true;
  return false;
}

function renderClientPageHtml(ctx: any, page: any, version: any, host: string) {
  const brandName = ctx.brand_name || ctx.website_name || ctx.website_domain || host;
  const primaryColor = ctx.primary_color || "#2563eb";
  const title = page.title || page.h1 || brandName;
  const description = page.meta_description || page.metaDescription || "";
  const contentHtml = version?.content_html || version?.contentHtml || "";
  const canonicalUrl = `https://${host}/${page.slug}`;
  const noindex = page.noindex === true || page.tier === 3 || page.status !== "published";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  ${noindex ? `<meta name="robots" content="noindex,follow" />` : `<meta name="robots" content="index,follow" />`}
  <style>
    :root{--brand:${primaryColor};--ink:#0f172a;--muted:#64748b;--bg:#f8fafc;--card:#ffffff;}
    *{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--ink);line-height:1.6}
    header{background:linear-gradient(135deg,var(--brand),#0f172a);color:white;padding:54px 20px 42px}header .wrap,main,.footer-inner{max-width:1100px;margin:0 auto} .brand{font-weight:800;letter-spacing:.02em;margin-bottom:20px}h1{font-size:clamp(34px,5vw,58px);line-height:1.05;margin:0 0 16px} .lead{font-size:20px;max-width:760px;opacity:.92}
    main{padding:42px 20px}.content{background:var(--card);border:1px solid #e2e8f0;border-radius:24px;box-shadow:0 18px 45px rgba(15,23,42,.08);padding:clamp(24px,4vw,48px)}
    h2{font-size:30px;line-height:1.2;margin:34px 0 12px}h3{font-size:22px;margin:28px 0 10px}p{margin:0 0 16px}a{color:var(--brand)}ul,ol{padding-left:24px}.cta{margin-top:34px;padding:24px;border-radius:18px;background:#f1f5f9;border:1px solid #e2e8f0}.btn{display:inline-block;margin-top:12px;background:var(--brand);color:white;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700}
    footer{padding:30px 20px;color:var(--muted)}
  </style>
</head>
<body>
  <header><div class="wrap"><div class="brand">${escapeHtml(brandName)}</div><h1>${escapeHtml(page.h1 || title)}</h1>${description ? `<p class="lead">${escapeHtml(description)}</p>` : ""}</div></header>
  <main><article class="content">${contentHtml}<section class="cta"><strong>${escapeHtml(brandName)}</strong>${ctx.phone ? `<p>Call us: <a href="tel:${escapeHtml(ctx.phone)}">${escapeHtml(ctx.phone)}</a></p>` : ""}${ctx.email ? `<p>Email: <a href="mailto:${escapeHtml(ctx.email)}">${escapeHtml(ctx.email)}</a></p>` : ""}</section></article></main>
  <footer><div class="footer-inner">&copy; ${new Date().getFullYear()} ${escapeHtml(brandName)}</div></footer>
</body>
</html>`;
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

  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=60");
  res.type("text/html").send(renderClientPageHtml(ctx, page, version, host));
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

// Public hostname resolver: this is the bridge from pages.clientdomain.com to the correct Nexus website.
// It must run before requireAuth so Cloudflare custom-hostname traffic can render public pages.
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
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!zoneId || !apiToken) throw new Error("Cloudflare credentials missing. Add CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN in Railway.");
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

async function createCloudflareHostname(hostname: string) {
  try {
    return await cfRequest(`/custom_hostnames`, {
      method: "POST",
      body: JSON.stringify({ hostname, ssl: { method: "http", type: "dv", settings: { http2: "on", min_tls_version: "1.2", tls_1_3: "on" } } }),
    });
  } catch (err: any) {
    const code = err.cloudflare?.errors?.[0]?.code;
    if (code === 1406) {
      const list = await cfRequest(`/custom_hostnames?hostname=${encodeURIComponent(hostname)}`);
      return Array.isArray(list) ? list[0] : list?.[0];
    }
    throw err;
  }
}

async function fetchStatus(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal, redirect: "follow" });
    return { ok: res.ok, status: res.status, url: res.url };
  } catch (err: any) {
    return { ok: false, status: 0, error: err?.name === "AbortError" ? "Timed out" : err?.message || "Fetch failed" };
  } finally {
    clearTimeout(timeout);
  }
}

async function buildReadiness(row: any) {
  const hostname = row.hostname;
  const expectedTarget = dnsTarget().replace(/\.$/, "").toLowerCase();
  let cnameRecords: string[] = [];
  let aRecords: string[] = [];
  let dnsError: string | null = null;
  try { cnameRecords = (await resolveCname(hostname)).map((r) => r.replace(/\.$/, "").toLowerCase()); }
  catch (err: any) { dnsError = err?.code || err?.message || "CNAME lookup failed"; }
  try { aRecords = await resolve4(hostname); } catch { /* A records are optional when CNAME exists. */ }

  const dnsDetected = cnameRecords.includes(expectedTarget) || cnameRecords.some((r) => r.endsWith(expectedTarget)) || aRecords.length > 0;
  const cloudflareActive = row.status === "active";
  const sslActive = row.ssl_status === "active" || row.ssl_status === "issued" || row.status === "active";

  const homepageSlug = await resolveHomepageSlug({ website_id: row.website_id, website_settings: row.website_settings || {} });
  const homepageAssigned = !!homepageSlug;
  const [health, homepage, robots, sitemap] = await Promise.all([
    fetchStatus(`https://${hostname}/.well-known/nexus-domain-health`),
    fetchStatus(`https://${hostname}/`),
    fetchStatus(`https://${hostname}/robots.txt`),
    fetchStatus(`https://${hostname}/sitemap.xml`),
  ]);

  const checks = {
    dns: { ok: dnsDetected, label: dnsDetected ? "DNS detected" : "DNS not detected", expectedTarget, cnameRecords, aRecords, error: dnsError },
    cloudflare: { ok: cloudflareActive, label: cloudflareActive ? "Cloudflare active" : "Cloudflare pending", status: row.status },
    ssl: { ok: sslActive, label: sslActive ? "SSL active" : "SSL pending", status: row.ssl_status || row.status },
    resolver: { ok: health.ok, label: health.ok ? "Hostname resolves to Nexus" : "Hostname not resolving to Nexus", ...health },
    homepage: { ok: homepageAssigned && homepage.ok, label: homepageAssigned ? (homepage.ok ? "Homepage reachable" : "Homepage assigned but not reachable") : "No homepage assigned", slug: homepageSlug, ...homepage },
    robots: { ok: robots.ok, label: robots.ok ? "Robots reachable" : "Robots not reachable", ...robots },
    sitemap: { ok: sitemap.ok, label: sitemap.ok ? "Sitemap reachable" : "Sitemap not reachable", ...sitemap },
  };
  const ready = Object.values(checks).every((check: any) => check.ok);
  return { ready, hostname, checkedAt: new Date().toISOString(), checks };
}

router.get("/api/websites/:websiteId/client-domains", async (req, res, next) => {
  try {
    await ensureClientDomainsTable();
    const website = await assertWebsiteAccess(req, res, req.params.websiteId); if (!website) return;
    const rows = (await pool.query(`SELECT * FROM client_domains WHERE website_id::text = $1::text ORDER BY created_at DESC`, [req.params.websiteId])).rows;
    res.json({ dnsTarget: dnsTarget(), domains: rows });
  } catch (err) { next(err); }
});

router.post("/api/websites/:websiteId/client-domains", async (req, res, next) => {
  try {
    await ensureClientDomainsTable();
    const website = await assertWebsiteAccess(req, res, req.params.websiteId); if (!website) return;
    const hostname = normalizeHostname(req.body?.hostname);
    if (!hostname || !hostname.includes(".")) return res.status(400).json({ message: "Enter a valid hostname like pages.client.com" });
    if (hostname === normalizeHostname(website.domain)) return res.status(400).json({ message: "Use a client subdomain, not the website origin domain." });

    let cfResult: any = null;
    let cfError: string | null = null;
    try { cfResult = await createCloudflareHostname(hostname); } catch (e: any) { cfError = e.message || "Cloudflare registration failed"; }
    const validation = extractValidation(cfResult);
    const status = cfResult?.status === "active" ? "active" : cfError ? "cloudflare_error" : "pending_dns";

    const row = (await pool.query(
      `INSERT INTO client_domains (website_id, account_id, hostname, status, cloudflare_hostname_id, ownership_txt_name, ownership_txt_value, ssl_status, error, verified_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (hostname) DO UPDATE SET website_id = EXCLUDED.website_id, account_id = EXCLUDED.account_id, status = EXCLUDED.status, cloudflare_hostname_id = EXCLUDED.cloudflare_hostname_id, ownership_txt_name = EXCLUDED.ownership_txt_name, ownership_txt_value = EXCLUDED.ownership_txt_value, ssl_status = EXCLUDED.ssl_status, error = EXCLUDED.error, verified_at = EXCLUDED.verified_at, updated_at = NOW()
       RETURNING *`,
      [website.id, website.account_id, hostname, status, cfResult?.id || null, validation.ownershipTxtName, validation.ownershipTxtValue, validation.sslStatus, cfError, status === "active" ? new Date() : null],
    )).rows[0];

    res.json({ ok: true, dnsTarget: dnsTarget(), domain: row, cloudflare: cfResult ? { id: cfResult.id, status: cfResult.status, sslStatus: cfResult.ssl?.status } : null });
  } catch (err) { next(err); }
});

router.post("/api/client-domains/:id/check", async (req, res, next) => {
  try {
    await ensureClientDomainsTable();
    const row = (await pool.query(`SELECT * FROM client_domains WHERE id::text = $1::text LIMIT 1`, [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ message: "Client domain not found" });
    const website = await assertWebsiteAccess(req, res, row.website_id); if (!website) return;

    let result: any = null;
    let error: string | null = null;
    try {
      result = row.cloudflare_hostname_id ? await cfRequest(`/custom_hostnames/${row.cloudflare_hostname_id}`) : await createCloudflareHostname(row.hostname);
    } catch (e: any) { error = e.message || "Cloudflare check failed"; }
    const validation = extractValidation(result);
    const status = result?.status === "active" ? "active" : error ? "cloudflare_error" : "pending_dns";
    const updated = (await pool.query(
      `UPDATE client_domains SET status=$2, cloudflare_hostname_id=COALESCE($3, cloudflare_hostname_id), ownership_txt_name=COALESCE($4, ownership_txt_name), ownership_txt_value=COALESCE($5, ownership_txt_value), ssl_status=COALESCE($6, ssl_status), error=$7, verified_at=CASE WHEN $2='active' THEN NOW() ELSE verified_at END, updated_at=NOW() WHERE id::text=$1::text RETURNING *`,
      [row.id, status, result?.id || null, validation.ownershipTxtName, validation.ownershipTxtValue, validation.sslStatus, error],
    )).rows[0];
    res.json({ ok: true, dnsTarget: dnsTarget(), domain: updated });
  } catch (err) { next(err); }
});

router.get("/api/client-domains/:id/readiness", async (req, res, next) => {
  try {
    await ensureClientDomainsTable();
    const row = (await pool.query(
      `SELECT cd.*, COALESCE(w.settings, '{}') AS website_settings
       FROM client_domains cd
       JOIN websites w ON w.id::text = cd.website_id::text
       WHERE cd.id::text = $1::text
       LIMIT 1`,
      [req.params.id],
    )).rows[0];
    if (!row) return res.status(404).json({ message: "Client domain not found" });
    const website = await assertWebsiteAccess(req, res, row.website_id); if (!website) return;
    const readiness = await buildReadiness(row);
    res.json(readiness);
  } catch (err) { next(err); }
});

router.delete("/api/client-domains/:id", async (req, res, next) => {
  try {
    await ensureClientDomainsTable();
    const row = (await pool.query(`SELECT * FROM client_domains WHERE id::text = $1::text LIMIT 1`, [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ message: "Client domain not found" });
    const website = await assertWebsiteAccess(req, res, row.website_id); if (!website) return;
    if (row.cloudflare_hostname_id) await cfRequest(`/custom_hostnames/${row.cloudflare_hostname_id}`, { method: "DELETE" }).catch(() => null);
    await pool.query(`DELETE FROM client_domains WHERE id::text = $1::text`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
