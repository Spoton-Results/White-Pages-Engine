import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db";
import { buildEnhancedPublicPageHtml, getPublicInternalLinks } from "../services/public-page-enhancements";

const router = Router();
const ROOT = "spotonresults.com";
const PAGES = "pages.spotonresults.com";

function sanitizeSpotOnCopy(value: string) {
  return String(value || "")
    .replace(
      /free equipment\s*&\s*fast setup for\s*\.\s*Get a free quote today\./gi,
      "free equipment & fast setup for local businesses. Get a free quote today.",
    )
    .replace(/\bfast setup for\s*\./gi, "fast setup for local businesses.")
    .replace(/\bsetup for\s*\./gi, "setup for local businesses.")
    .replace(/\bfor\s*\.\s*/gi, "for local businesses. ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ");
}

function requestHost(req: Request) {
  return String(req.headers["x-nexus-host"] || req.headers["x-forwarded-host"] || req.headers.host || "")
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

function isSkippablePath(path: string) {
  return path === "/api" || path.startsWith("/api/")
    || path.startsWith("/assets")
    || path.startsWith("/@vite")
    || path.startsWith("/src/")
    || path === "/favicon.ico";
}

function leadStatusHtml(req: Request) {
  const lead = String(req.query.lead || "").toLowerCase();
  if (lead === "success") return `<div class="nexus-alert nexus-alert-success" id="quote" style="max-width:1100px;margin:18px auto 0;padding:14px 18px;border-radius:16px;font-weight:750;background:#ecfdf5;border:1px solid #86efac;color:#166534">Thank you — your request was received. SpotOn Results will follow up shortly.</div>`;
  if (lead === "error") return `<div class="nexus-alert nexus-alert-error" id="quote" style="max-width:1100px;margin:18px auto 0;padding:14px 18px;border-radius:16px;font-weight:750;background:#fef2f2;border:1px solid #fecaca;color:#991b1b">The form could not be submitted. Please try again or use the phone/main website link.</div>`;
  return "";
}

function socialMetaHtml(page: any, canonical: string) {
  const title = sanitizeSpotOnCopy(String(page.title || page.h1 || page.slug || "SpotOn Results"));
  const desc = sanitizeSpotOnCopy(String(page.meta_description || page.metaDescription || "")).slice(0, 220);
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
  return `<meta property="og:type" content="website"/><meta property="og:url" content="${esc(canonical)}"/><meta property="og:title" content="${esc(title)}"/><meta property="og:description" content="${esc(desc)}"/><meta name="twitter:card" content="summary"/><meta name="twitter:title" content="${esc(title)}"/><meta name="twitter:description" content="${esc(desc)}"/>`;
}

function enhanceLiveHtml(html: string, page: any, canonical: string, req: Request) {
  let out = sanitizeSpotOnCopy(html);
  const status = leadStatusHtml(req);
  if (status) out = out.replace("<section class=\"hero\">", `${status}<section class="hero">`);
  out = out.replace("</head>", `${socialMetaHtml(page, canonical)}</head>`);
  return sanitizeSpotOnCopy(out);
}

async function getPublishedPage(slug: string) {
  const pageResult = await pool.query(
    `WITH spoton_websites AS (
       SELECT id, domain, settings, updated_at
       FROM websites
       WHERE lower(domain) IN ($1, $2)
          OR lower(settings->>'parentDomain') IN ($1, $2)
          OR lower(settings->>'publicDomain') IN ($1, $2)
          OR lower(settings->>'legacyParentDomain') = $2
     )
     SELECT p.*, w.domain, w.settings, COALESCE(w.settings->>'brandName', w.settings->>'siteName', w.domain) AS website_name
     FROM pages p
     JOIN spoton_websites w ON p.website_id::text = w.id::text
     WHERE p.slug = $3
       AND p.status = 'published'
     ORDER BY
       CASE WHEN lower(w.domain) = $1 THEN 0 ELSE 1 END,
       p.published_at DESC NULLS LAST,
       p.updated_at DESC NULLS LAST,
       w.updated_at DESC NULLS LAST
     LIMIT 1`,
    [PAGES, ROOT, slug]
  );
  return pageResult.rows[0] || null;
}

router.all("/api/spoton-pages-repair-copy", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const versionUpdate = await pool.query(
      `WITH spoton_websites AS (
         SELECT id FROM websites
         WHERE lower(domain) IN ($1, $2)
            OR lower(settings->>'parentDomain') IN ($1, $2)
            OR lower(settings->>'publicDomain') IN ($1, $2)
            OR lower(settings->>'legacyParentDomain') = $2
       ), target_pages AS (
         SELECT p.id
         FROM pages p
         JOIN spoton_websites w ON p.website_id::text = w.id::text
         WHERE p.status = 'published'
       )
       UPDATE page_versions pv
       SET content_html = regexp_replace(
         regexp_replace(
           regexp_replace(
             regexp_replace(pv.content_html, 'free equipment\\s*&\\s*fast setup for\\s*\\.\\s*Get a free quote today\\.', 'free equipment & fast setup for local businesses. Get a free quote today.', 'gi'),
             '\\bfast setup for\\s*\\.', 'fast setup for local businesses.', 'gi'
           ),
           '\\bsetup for\\s*\\.', 'setup for local businesses.', 'gi'
         ),
         '\\bfor\\s*\\.\\s*', 'for local businesses. ', 'gi'
       )
       WHERE pv.page_id::text IN (SELECT id::text FROM target_pages)
         AND pv.content_html ~* '(free equipment\\s*&\\s*fast setup for\\s*\\.|\\bfast setup for\\s*\\.|\\bsetup for\\s*\\.|\\bfor\\s*\\.)'
       RETURNING pv.page_id`
      , [PAGES, ROOT]
    );

    const pageUpdate = await pool.query(
      `WITH spoton_websites AS (
         SELECT id FROM websites
         WHERE lower(domain) IN ($1, $2)
            OR lower(settings->>'parentDomain') IN ($1, $2)
            OR lower(settings->>'publicDomain') IN ($1, $2)
            OR lower(settings->>'legacyParentDomain') = $2
       )
       UPDATE pages p
       SET r2_key = NULL,
           content_hash = NULL,
           rendered_at = NULL,
           updated_at = NOW(),
           meta_description = CASE WHEN meta_description IS NULL THEN meta_description ELSE regexp_replace(regexp_replace(regexp_replace(regexp_replace(meta_description, 'free equipment\\s*&\\s*fast setup for\\s*\\.\\s*Get a free quote today\\.', 'free equipment & fast setup for local businesses. Get a free quote today.', 'gi'), '\\bfast setup for\\s*\\.', 'fast setup for local businesses.', 'gi'), '\\bsetup for\\s*\\.', 'setup for local businesses.', 'gi'), '\\bfor\\s*\\.\\s*', 'for local businesses. ', 'gi') END,
           h1 = CASE WHEN h1 IS NULL THEN h1 ELSE regexp_replace(regexp_replace(regexp_replace(regexp_replace(h1, 'free equipment\\s*&\\s*fast setup for\\s*\\.\\s*Get a free quote today\\.', 'free equipment & fast setup for local businesses. Get a free quote today.', 'gi'), '\\bfast setup for\\s*\\.', 'fast setup for local businesses.', 'gi'), '\\bsetup for\\s*\\.', 'setup for local businesses.', 'gi'), '\\bfor\\s*\\.\\s*', 'for local businesses. ', 'gi') END,
           title = CASE WHEN title IS NULL THEN title ELSE regexp_replace(regexp_replace(regexp_replace(regexp_replace(title, 'free equipment\\s*&\\s*fast setup for\\s*\\.\\s*Get a free quote today\\.', 'free equipment & fast setup for local businesses. Get a free quote today.', 'gi'), '\\bfast setup for\\s*\\.', 'fast setup for local businesses.', 'gi'), '\\bsetup for\\s*\\.', 'setup for local businesses.', 'gi'), '\\bfor\\s*\\.\\s*', 'for local businesses. ', 'gi') END
       WHERE p.website_id::text IN (SELECT id::text FROM spoton_websites)
         AND p.status = 'published'
       RETURNING p.id, p.slug, p.page_type`
      , [PAGES, ROOT]
    );

    return res.json({ ok: true, pageVersionsRepaired: versionUpdate.rowCount || 0, pagesMarkedForRerender: pageUpdate.rowCount || 0, sample: pageUpdate.rows.slice(0, 10) });
  } catch (err) {
    return next(err);
  }
});

router.get("/api/spoton-pages-debug/:slug", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug;
    const host = requestHost(req);
    const websites = await pool.query(
      `SELECT id, domain, settings->>'parentDomain' AS parent_domain, settings->>'publicDomain' AS public_domain, settings->>'legacyParentDomain' AS legacy_parent_domain, updated_at
       FROM websites
       WHERE lower(domain) IN ($1, $2)
          OR lower(settings->>'parentDomain') IN ($1, $2)
          OR lower(settings->>'publicDomain') IN ($1, $2)
          OR lower(settings->>'legacyParentDomain') = $2
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 20`,
      [PAGES, ROOT]
    );
    const pages = await pool.query(
      `SELECT p.id, p.website_id, p.slug, p.status, p.title, p.published_at, p.updated_at, w.domain
       FROM pages p
       LEFT JOIN websites w ON p.website_id::text = w.id::text
       WHERE p.slug = $1
       ORDER BY p.updated_at DESC NULLS LAST
       LIMIT 20`,
      [slug]
    );
    const page = await getPublishedPage(slug);
    return res.json({ host, slug, spotonWebsiteCount: websites.rowCount, spotonWebsites: websites.rows, exactSlugPageCount: pages.rowCount, exactSlugPages: pages.rows, matchedPublishedPage: page ? { id: page.id, website_id: page.website_id, slug: page.slug, status: page.status, title: page.title } : null });
  } catch (err) {
    return next(err);
  }
});

router.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const h = requestHost(req);
    if (h !== PAGES && h !== ROOT) return next();

    const path = req.path || "/";
    if (isSkippablePath(path)) return next();

    const slug = decodeURIComponent(path.replace(/^\/+/, "").replace(/^pages\//, ""));
    if (!slug || slug === "robots.txt" || slug.endsWith(".xml")) return next();

    const page = await getPublishedPage(slug);
    if (!page) return next();

    if (h === ROOT) return res.redirect(301, `https://${PAGES}/${slug}`);

    const versionResult = await pool.query(
      `SELECT * FROM page_versions WHERE page_id::text = $1::text ORDER BY is_active DESC NULLS LAST, version DESC NULLS LAST, created_at DESC NULLS LAST LIMIT 1`,
      [page.id]
    );

    const version = versionResult.rows[0] || {};
    const content = sanitizeSpotOnCopy(version.content_html || version.contentHtml || page.content_html || page.contentHtml || page.html || page.body || "");
    const canonical = `https://${PAGES}/${page.slug}`;
    const links = await getPublicInternalLinks(page.id, page.website_id || page.websiteId);

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const html = buildEnhancedPublicPageHtml({ page, website: { ...page, name: page.website_name }, contentHtml: content, canonicalUrl: canonical, links });
    return res.type("html").send(enhanceLiveHtml(html, page, canonical, req));
  } catch (err) {
    return next(err);
  }
});

export default router;
