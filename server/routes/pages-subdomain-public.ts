import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db";
import { buildEnhancedPublicPageHtml, getPublicInternalLinks } from "../services/public-page-enhancements";

const router = Router();

function host(req: Request) {
  return String(
    req.headers["x-nexus-host"] ||
    req.headers["x-forwarded-host"] ||
    req.headers["x-original-host"] ||
    req.headers["x-host"] ||
    req.headers["cf-connecting-host"] ||
    req.headers.host ||
    ""
  )
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

function slug(path: string) {
  return decodeURIComponent(
    String(path || "/")
      .replace(/^\/+/, "")
      .replace(/^sites\/[^/]+\//, "")
      .replace(/^pages\//, "")
  ).trim();
}

function rootHost(h: string) {
  return h.replace(/^(pages|page|seo|local)\./, "");
}

function clean(v: any) {
  return Object.fromEntries(Object.entries(v || {}).filter(([, x]) => x !== undefined && x !== null && String(x).trim() !== ""));
}

function first(...values: any[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function normalizePublicSettings(settings: any) {
  const s = settings || {};
  return {
    ...s,
    mainWebsiteUrl: first(s.mainWebsiteUrl, s.main_website_url, s.websiteUrl, s.website_url, s.brandWebsiteUrl, s.brand_website_url),
    websiteUrl: first(s.websiteUrl, s.website_url, s.mainWebsiteUrl, s.main_website_url),
    brandWebsiteUrl: first(s.brandWebsiteUrl, s.brand_website_url, s.websiteUrl, s.website_url),
    ctaHeading: first(s.ctaHeading, s.cta_heading),
    ctaText: first(s.ctaText, s.ctaBody, s.cta_body),
    ctaButtonLabel: first(s.ctaButtonLabel, s.cta_button_label),
    demoBannerUrl: first(s.demoBannerUrl, s.demo_banner_url),
    demoBannerHeading: first(s.demoBannerHeading, s.demo_banner_heading),
    demoBannerSubtext: first(s.demoBannerSubtext, s.demo_banner_subtext),
    demoBannerButtonLabel: first(s.demoBannerButtonLabel, s.demoBannerButton, s.demo_banner_button),
  };
}

async function websiteForHost(h: string) {
  const root = rootHost(h);
  const candidates = Array.from(new Set([h, root])).filter(Boolean);
  const r = await pool.query(
    `SELECT id, account_id, brand_profile_id, domain, name, COALESCE(settings, '{}'::jsonb) AS settings,
            COALESCE(settings->>'brandName', settings->>'siteName', settings->>'businessName', name, domain) AS website_name
     FROM websites
     WHERE lower(domain) = ANY($1::text[])
        OR lower(settings->>'parentDomain') = ANY($1::text[])
        OR lower(settings->>'publicDomain') = ANY($1::text[])
        OR lower(settings->>'legacyParentDomain') = ANY($1::text[])
     ORDER BY CASE WHEN lower(domain) = $2 THEN 0 ELSE 1 END, updated_at DESC NULLS LAST
     LIMIT 1`,
    [candidates, h],
  );
  return r.rows[0] || null;
}

async function brandForWebsite(w: any) {
  if (!w?.account_id) return null;
  const r = await pool.query(
    `SELECT * FROM brand_profiles
     WHERE account_id::text = $1::text
     ORDER BY CASE WHEN id::text = COALESCE($2::text, '') THEN 0 ELSE 1 END,
              updated_at DESC NULLS LAST, created_at DESC NULLS LAST
     LIMIT 1`,
    [w.account_id, w.brand_profile_id || ""],
  ).catch(() => ({ rows: [] as any[] }));
  return r.rows[0] || null;
}

async function effectiveWebsite(w: any) {
  const b = await brandForWebsite(w);
  const inherited = b ? {
    brandName: first(b.name), siteName: first(b.name), businessName: first(b.name),
    websiteUrl: first(b.website_url, b.websiteUrl), mainWebsiteUrl: first(b.website_url, b.websiteUrl), brandWebsiteUrl: first(b.website_url, b.websiteUrl),
    phone: first(b.phone_override, b.phoneOverride, b.phone), email: first(b.email),
    ctaHeading: first(b.cta_heading, b.ctaHeading), ctaText: first(b.cta_body, b.ctaBody, b.description), ctaButtonLabel: first(b.cta_button_label, b.ctaButtonLabel),
    demoBannerUrl: first(b.demo_banner_url, b.demoBannerUrl), demoBannerHeading: first(b.demo_banner_heading, b.demoBannerHeading), demoBannerSubtext: first(b.demo_banner_subtext, b.demoBannerSubtext), demoBannerButtonLabel: first(b.demo_banner_button, b.demoBannerButton),
  } : {};
  const settings = normalizePublicSettings({ ...clean(b?.custom_fields || b?.customFields), ...clean(inherited), ...clean(w.settings) });
  return { ...w, settings, name: settings.brandName || settings.siteName || settings.businessName || w.website_name || w.name || w.domain, websiteName: settings.siteName || settings.brandName || w.website_name, brandName: settings.brandName, phone: settings.phone, mainWebsiteUrl: settings.mainWebsiteUrl, brandWebsiteUrl: settings.brandWebsiteUrl, __brandProfileId: b?.id || "" };
}

router.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const h = host(req);
    if (!/^(pages|page|seo|local)\./.test(h)) return next();
    const p = req.path || "/";
    if (p.startsWith("/api/") || p.startsWith("/assets") || p === "/favicon.ico" || p.endsWith(".xml") || p === "/robots.txt") return next();
    const s = slug(p);
    if (!s) return next();

    const w = await websiteForHost(h);
    if (!w) return next();
    const pageResult = await pool.query(
      `SELECT * FROM pages WHERE website_id::text = $1::text AND slug = $2 AND status = 'published' ORDER BY published_at DESC NULLS LAST, updated_at DESC NULLS LAST LIMIT 1`,
      [w.id, s],
    );
    const page = pageResult.rows[0];
    if (!page) return next();

    const versionResult = await pool.query(
      `SELECT * FROM page_versions WHERE page_id::text = $1::text ORDER BY is_active DESC NULLS LAST, version DESC NULLS LAST, created_at DESC NULLS LAST LIMIT 1`,
      [page.id],
    );
    const version = versionResult.rows[0] || {};
    const contentHtml = version.content_html || version.contentHtml || page.content_html || page.contentHtml || page.html || page.body || "";
    const ew = await effectiveWebsite(w);
    const links = await getPublicInternalLinks(page.id, page.website_id || w.id);
    const canonical = `https://${h}/${page.slug}`;
    const html = buildEnhancedPublicPageHtml({ page, website: { ...ew, ...page, settings: ew.settings, name: ew.name, websiteName: ew.websiteName }, contentHtml, canonicalUrl: canonical, links });

    console.log("[PAGES_SUBDOMAIN_RENDER]", { host: h, rootHost: rootHost(h), websiteId: w.id, websiteDomain: w.domain, slug: s, brandProfileId: ew.__brandProfileId || null, brandName: ew.settings?.brandName || null });
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("X-Nexus-Public-Renderer", "pages-subdomain-root-v1");
    return res.type("html").send(html.replace("</head>", `<meta name="x-nexus-public-renderer" content="pages-subdomain-root-v1"/></head>`));
  } catch (err) {
    return next(err);
  }
});

export default router;
