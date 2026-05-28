import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db";

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
    req.headers["x-forwarded-host"] ||
    req.headers.host,
  );
}

function shouldIgnore(req: Request) {
  const path = req.path || "/";
  if (req.method !== "GET" && req.method !== "HEAD") return true;
  if (path.startsWith("/api")) return true;
  if (path.startsWith("/assets")) return true;
  if (path.startsWith("/@vite") || path.startsWith("/src/")) return true;
  if (path === "/favicon.ico") return true;

  const adminAppRoots = [
    "/login",
    "/logout",
    "/dashboard",
    "/accounts",
    "/agencies",
    "/websites",
    "/services",
    "/industries",
    "/brand-profiles",
    "/blueprints",
    "/query-clusters",
    "/hub-pages",
    "/locations",
    "/pages",
    "/generation-jobs",
    "/settings",
    "/admin",
  ];
  if (adminAppRoots.some((root) => path === root || path.startsWith(`${root}/`))) return true;

  return false;
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
}

function telHref(phone: string) {
  return phone.replace(/[^+\d]/g, "");
}

function notFoundHtml(message: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Page Not Found</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#0f172a}.box{max-width:620px;padding:32px;text-align:center}h1{font-size:34px;margin:0 0 10px}p{color:#64748b;line-height:1.6}</style></head><body><main class="box"><h1>404</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

async function resolveWebsiteByHost(hostname: string) {
  if (!hostname) return null;
  const result = await pool.query(
    `SELECT
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
     FROM websites w
     LEFT JOIN brand_profiles bp ON bp.id::text = w.brand_profile_id::text
     WHERE lower(w.domain) = lower($1)
        OR lower(w.settings->>'parentDomain') = lower($1)
        OR lower(w.settings->>'publicDomain')  = lower($1)
     LIMIT 1`,
    [hostname],
  );
  return result.rows[0] || null;
}

async function resolveHomepageSlug(ctx: any) {
  const settings = ctx.website_settings || {};
  const explicit = settings.homepageSlug || settings.home_slug || settings.homePageSlug || settings.defaultSlug;
  if (explicit) return String(explicit).replace(/^\/+/, "");

  const page = await pool.query(
    `SELECT slug FROM pages
     WHERE website_id::text = $1::text AND status = 'published'
     ORDER BY tier ASC NULLS LAST, quality_score DESC NULLS LAST, updated_at DESC NULLS LAST
     LIMIT 1`,
    [ctx.website_id],
  );
  return page.rows[0]?.slug || null;
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
    resolver: "direct_website_domain",
    hostname: host,
    websiteId: ctx.website_id,
    websiteDomain: ctx.website_domain,
    counts: counts.rows[0] || {},
  });
}

async function serveRobots(ctx: any, host: string, res: Response) {
  const customRobots = ctx.robots_txt || ctx.robotsTxt;
  const body = customRobots && String(customRobots).trim().length
    ? String(customRobots)
    : `User-agent: *\nAllow: /\n\nSitemap: https://${host}/sitemap.xml\n`;
  res.type("text/plain").send(body);
}

async function serveSitemap(ctx: any, host: string, slug: string, res: Response) {
  const sitemapSlug = (slug || "sitemap.xml").replace(/\.xml$/i, "");
  const result = await pool.query(
    `SELECT slug, xml_content FROM sitemaps WHERE website_id::text = $1::text AND slug = $2 LIMIT 1`,
    [ctx.website_id, sitemapSlug],
  );
  let xml = result.rows[0]?.xml_content;
  if (!xml && sitemapSlug === "sitemap") {
    const latest = await pool.query(
      `SELECT slug, xml_content FROM sitemaps
       WHERE website_id::text = $1::text
       ORDER BY last_generated DESC NULLS LAST, created_at DESC NULLS LAST
       LIMIT 1`,
      [ctx.website_id],
    );
    xml = latest.rows[0]?.xml_content;
  }
  if (!xml) return res.status(404).type("text/html").send(notFoundHtml("Sitemap not found for this public website domain."));
  xml = String(xml).replaceAll(`https://${ctx.website_domain}`, `https://${host}`);
  res.type("application/xml").send(xml);
}

function renderHtml(ctx: any, page: any, version: any, host: string) {
  const settings = ctx.website_settings || {};
  const brandName = ctx.brand_name || settings.brandName || settings.siteName || ctx.website_name || ctx.website_domain || host;
  const primaryColor = ctx.primary_color || settings.primaryColor || "#2563eb";
  const phone = settings.phone || ctx.phone || "";
  const email = settings.email || ctx.email || "";
  const mainWebsiteUrl = normalizeUrl(settings.mainWebsiteUrl || settings.main_website_url || settings.websiteUrl || "");
  const ctaHeading = settings.ctaHeading || `Visit ${brandName}`;
  const ctaText = settings.ctaText || "See how we can help your business grow.";
  const ctaButtonLabel = settings.ctaButtonLabel || "Learn More";
  const demoBannerUrl = normalizeUrl(settings.demoBannerUrl || "");
  const demoBannerHeading = settings.demoBannerHeading || "See This Platform in Action";
  const demoBannerSubtext = settings.demoBannerSubtext || "See how this page was built and how the system works.";
  const demoBannerButtonLabel = settings.demoBannerButtonLabel || "Watch the Live Demo →";
  const title = page.title || page.h1 || brandName;
  const description = page.meta_description || page.metaDescription || "";
  const contentHtml = version?.content_html || version?.contentHtml || "";
  const canonicalUrl = `https://${host}/${page.slug}`;
  const noindex = page.noindex === true || page.tier === 3 || page.status !== "published";
  const demoBanner = demoBannerUrl
    ? `<section class="demo"><div class="wrap"><div><p class="eyebrow">Live walkthrough</p><h2>${escapeHtml(demoBannerHeading)}</h2><p>${escapeHtml(demoBannerSubtext)}</p></div><a class="btn light" href="${escapeHtml(demoBannerUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(demoBannerButtonLabel)}</a></div></section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <meta name="robots" content="${noindex ? "noindex,follow" : "index,follow"}" />
  <style>
    :root{--brand:${primaryColor};--ink:#0f172a;--muted:#64748b;--bg:#f8fafc;--card:#ffffff;}
    *{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--ink);line-height:1.6}
    .wrap,main,.footer-inner{max-width:1100px;margin:0 auto}.demo{background:linear-gradient(135deg,#0f172a,var(--brand));color:white}.demo .wrap{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:18px 20px}.demo h2{font-size:clamp(22px,3vw,34px);line-height:1.15;margin:0 0 4px}.demo p{margin:0;opacity:.92}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.12em;font-weight:800;color:#bfdbfe;margin:0 0 8px}
    header{background:linear-gradient(135deg,var(--brand),#0f172a);color:white;padding:54px 20px 42px}.brand{font-weight:800;letter-spacing:.02em;margin-bottom:20px}h1{font-size:clamp(34px,5vw,58px);line-height:1.05;margin:0 0 16px}.lead{font-size:20px;max-width:760px;opacity:.92}
    main{padding:42px 20px}.content{background:var(--card);border:1px solid #e2e8f0;border-radius:24px;box-shadow:0 18px 45px rgba(15,23,42,.08);padding:clamp(24px,4vw,48px)}
    h2{font-size:30px;line-height:1.2;margin:34px 0 12px}h3{font-size:22px;margin:28px 0 10px}p{margin:0 0 16px}a{color:var(--brand)}ul,ol{padding-left:24px}.cta{margin-top:34px;padding:24px;border-radius:18px;background:#f1f5f9;border:1px solid #e2e8f0}.btn{display:inline-block;margin-top:12px;background:var(--brand);color:white!important;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700}.btn.light{background:white;color:#0f172a!important;border:1px solid white}
    footer{padding:30px 20px;color:var(--muted)}@media(max-width:760px){.demo .wrap{align-items:flex-start;flex-direction:column}.btn{width:100%;text-align:center}}
  </style>
</head>
<body>
  ${demoBanner}
  <header><div class="wrap"><div class="brand">${escapeHtml(brandName)}</div><h1>${escapeHtml(page.h1 || title)}</h1>${description ? `<p class="lead">${escapeHtml(description)}</p>` : ""}</div></header>
  <main><article class="content">${contentHtml}<section class="cta"><h2>${escapeHtml(ctaHeading)}</h2><p>${escapeHtml(ctaText)}</p>${mainWebsiteUrl ? `<a class="btn" href="${escapeHtml(mainWebsiteUrl)}">${escapeHtml(ctaButtonLabel)}</a>` : ""}${phone ? `<p>Call: <a href="tel:${escapeHtml(telHref(phone))}">${escapeHtml(phone)}</a></p>` : ""}${email ? `<p>Email: <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>` : ""}</section></article></main>
  <footer><div class="footer-inner">&copy; ${new Date().getFullYear()} ${escapeHtml(brandName)}</div></footer>
</body>
</html>`;
}

async function servePage(ctx: any, host: string, slug: string, res: Response) {
  const pageResult = await pool.query(
    `SELECT * FROM pages
     WHERE website_id::text = $1::text
       AND slug = $2
       AND status = 'published'
     LIMIT 1`,
    [ctx.website_id, slug],
  );
  const page = pageResult.rows[0];
  if (!page) return res.status(404).type("text/html").send(notFoundHtml("No published Nexus page exists for this URL yet."));

  const versionResult = await pool.query(
    `SELECT * FROM page_versions
     WHERE page_id::text = $1::text
       AND is_active = true
     ORDER BY version DESC NULLS LAST, created_at DESC NULLS LAST
     LIMIT 1`,
    [page.id],
  );
  const version = versionResult.rows[0];
  if (!version) return res.status(404).type("text/html").send(notFoundHtml("This page is published but does not have an active page version yet."));

  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-Nexus-Public-Renderer", "website-settings-cta-demo-v1");
  res.type("text/html").send(renderHtml(ctx, page, version, host));
}

router.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (shouldIgnore(req)) return next();
    const host = getRequestHostname(req);
    const ctx = await resolveWebsiteByHost(host);
    if (!ctx) return next();

    const pathname = decodeURIComponent((req.path || "/").replace(/^\/+/, ""));
    if (pathname === ".well-known/nexus-domain-health") return serveHealth(ctx, host, res);
    if (pathname === "robots.txt") return serveRobots(ctx, host, res);
    if (/^sitemap(?:[-\w]*)?\.xml$/i.test(pathname)) return serveSitemap(ctx, host, pathname, res);

    if (!pathname) {
      const homeSlug = await resolveHomepageSlug(ctx);
      if (!homeSlug) return res.status(404).type("text/html").send(notFoundHtml("This website domain is connected, but no published homepage or hub page exists yet."));
      return servePage(ctx, host, homeSlug, res);
    }

    return servePage(ctx, host, pathname, res);
  } catch (err) {
    return next(err);
  }
});

export default router;
