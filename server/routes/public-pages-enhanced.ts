import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db";
import { buildEnhancedPublicPageHtml, getPublicInternalLinks } from "../services/public-page-enhancements";

const router = Router();

function requestHost(req: Request) {
  return String(req.headers["x-nexus-host"] || req.headers["x-forwarded-host"] || req.headers.host || "")
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

function isAdminAppPath(path: string) {
  const roots = [
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
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

function isSkippablePath(path: string) {
  return path === "/api" || path.startsWith("/api/")
    || path.startsWith("/assets")
    || path.startsWith("/@vite")
    || path.startsWith("/src/")
    || path === "/favicon.ico"
    || path === "/robots.txt"
    || path.endsWith(".xml")
    || isAdminAppPath(path);
}

function safeSlug(path: string) {
  return decodeURIComponent(String(path || "/").replace(/^\/+/, "").replace(/^pages\//, "")).trim();
}

function isNeverPublicHost(host: string) {
  return !host
    || host.includes("localhost")
    || host.includes("127.0.0.1")
    || host.includes("railway.app")
    || host.startsWith("admin.")
    || host.startsWith("app.");
}

function socialMetaHtml(page: any, canonical: string) {
  const title = String(page.title || page.h1 || page.slug || "");
  const desc = String(page.meta_description || page.metaDescription || "").slice(0, 220);
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
  return `<meta property="og:type" content="website"/><meta property="og:url" content="${esc(canonical)}"/><meta property="og:title" content="${esc(title)}"/><meta property="og:description" content="${esc(desc)}"/><meta name="twitter:card" content="summary"/><meta name="twitter:title" content="${esc(title)}"/><meta name="twitter:description" content="${esc(desc)}"/>`;
}

function leadStatusHtml(req: Request) {
  const lead = String(req.query.lead || "").toLowerCase();
  if (lead === "success") return `<div class="nexus-alert nexus-alert-success" id="quote" style="max-width:1100px;margin:18px auto 0;padding:14px 18px;border-radius:16px;font-weight:750;background:#ecfdf5;border:1px solid #86efac;color:#166534">Thank you — your request was received. We will follow up shortly.</div>`;
  if (lead === "error") return `<div class="nexus-alert nexus-alert-error" id="quote" style="max-width:1100px;margin:18px auto 0;padding:14px 18px;border-radius:16px;font-weight:750;background:#fef2f2;border:1px solid #fecaca;color:#991b1b">The form could not be submitted. Please try again or use the phone/main website link.</div>`;
  return "";
}

function postProcess(html: string, page: any, canonical: string, req: Request) {
  let out = html;
  const status = leadStatusHtml(req);
  if (status) out = out.replace("<section class=\"hero\">", `${status}<section class="hero">`);
  out = out.replace("</head>", `${socialMetaHtml(page, canonical)}<meta name="x-nexus-public-renderer" content="public-domain-brand-v4"/></head>`);
  return out;
}

function compactSettings(settings: any) {
  return Object.fromEntries(
    Object.entries(settings || {}).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== ""),
  );
}

function firstNonEmpty(...values: any[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function escapeAttr(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

async function getWebsiteForHost(host: string) {
  const result = await pool.query(
    `SELECT id, account_id, brand_profile_id, domain, name, COALESCE(settings, '{}'::jsonb) AS settings,
            COALESCE(settings->>'brandName', settings->>'siteName', settings->>'businessName', name, domain) AS website_name
     FROM websites
     WHERE lower(domain) = $1
        OR lower(settings->>'parentDomain') = $1
        OR lower(settings->>'publicDomain') = $1
        OR lower(settings->>'legacyParentDomain') = $1
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1`,
    [host]
  );
  return result.rows[0] || null;
}

async function getBrandProfile(website: any) {
  if (!website?.account_id) return null;
  const result = await pool.query(
    `SELECT *
     FROM brand_profiles
     WHERE account_id::text = $1::text
     ORDER BY
       CASE WHEN id::text = COALESCE($2::text, '') THEN 0 ELSE 1 END,
       updated_at DESC NULLS LAST,
       created_at DESC NULLS LAST
     LIMIT 1`,
    [website.account_id, website.brand_profile_id || ""],
  ).catch(() => ({ rows: [] as any[] }));
  return result.rows[0] || null;
}

async function getEffectiveSettings(website: any) {
  const current = compactSettings(website?.settings || {});
  const brand = await getBrandProfile(website);
  const brandFields = compactSettings(brand?.custom_fields || brand?.customFields || {});

  const inherited = brand ? {
    brandName: firstNonEmpty(brand.name),
    siteName: firstNonEmpty(brand.name),
    businessName: firstNonEmpty(brand.name),
    websiteUrl: firstNonEmpty(brand.website_url, brand.websiteUrl),
    mainWebsiteUrl: firstNonEmpty(brand.website_url, brand.websiteUrl),
    brandWebsiteUrl: firstNonEmpty(brand.website_url, brand.websiteUrl),
    phone: firstNonEmpty(brand.phone_override, brand.phoneOverride, brand.phone),
    email: firstNonEmpty(brand.email),
    ctaHeading: firstNonEmpty(brand.cta_heading, brand.ctaHeading),
    ctaText: firstNonEmpty(brand.cta_body, brand.ctaBody, brand.description),
    ctaButtonLabel: firstNonEmpty(brand.cta_button_label, brand.ctaButtonLabel),
    demoBannerUrl: firstNonEmpty(brand.demo_banner_url, brand.demoBannerUrl),
    demoBannerHeading: firstNonEmpty(brand.demo_banner_heading, brand.demoBannerHeading),
    demoBannerSubtext: firstNonEmpty(brand.demo_banner_subtext, brand.demoBannerSubtext),
    demoBannerButtonLabel: firstNonEmpty(brand.demo_banner_button, brand.demoBannerButton),
  } : {};

  return {
    ...brandFields,
    ...compactSettings(inherited),
    ...current,
    __brandProfileId: brand?.id || "",
  };
}

async function getPublishedPageForWebsite(websiteId: string, slug: string) {
  const result = await pool.query(
    `SELECT p.*
     FROM pages p
     WHERE p.website_id::text = $1::text
       AND p.slug = $2
       AND p.status = 'published'
     ORDER BY p.published_at DESC NULLS LAST, p.updated_at DESC NULLS LAST
     LIMIT 1`,
    [websiteId, slug]
  );
  return result.rows[0] || null;
}

async function getActiveContent(pageId: string, page: any) {
  const versionResult = await pool.query(
    `SELECT * FROM page_versions
     WHERE page_id::text = $1::text
     ORDER BY is_active DESC NULLS LAST, version DESC NULLS LAST, created_at DESC NULLS LAST
     LIMIT 1`,
    [pageId]
  );
  const version = versionResult.rows[0] || {};
  return version.content_html || version.contentHtml || page.content_html || page.contentHtml || page.html || page.body || "";
}

// ✅ CHANGED: public render fallback for old saved pages that were generated before brand images existed.
// 🔒 UNTOUCHED: stored page versions, generation jobs, slugs, metadata, and pages that already contain images.
async function getBrandImageFallbackHtml(website: any, effectiveSettings: any, page: any) {
  const brandProfileId = effectiveSettings.__brandProfileId || website.brand_profile_id || website.brandProfileId || "";
  if (!brandProfileId) return "";

  const result = await pool.query(
    `SELECT public_url, r2_key, alt_text, category, sort_order
     FROM brand_media
     WHERE brand_profile_id::text = $1::text
       AND active = true
       AND (website_id IS NULL OR website_id::text = $2::text)
     ORDER BY
       CASE category WHEN 'hero' THEN 0 WHEN 'service' THEN 1 WHEN 'business_general' THEN 2 ELSE 3 END,
       sort_order ASC,
       created_at ASC
     LIMIT 1`,
    [brandProfileId, website.id]
  ).catch(() => ({ rows: [] as any[] }));

  const media = result.rows[0];
  if (!media) return "";

  const imageUrl = media.public_url && /^https?:\/\//i.test(media.public_url)
    ? media.public_url
    : media.r2_key
      ? `https://pub-1e7626f01f4a4399915b608da09ccc25.r2.dev/${media.r2_key}`
      : "";

  if (!imageUrl) return "";

  const brandName = effectiveSettings.brandName || effectiveSettings.siteName || effectiveSettings.businessName || website.website_name || website.name || website.domain || "Brand image";
  const altText = media.alt_text || `${brandName} ${page.title || page.h1 || page.slug || "page image"}`;

  return `<figure data-nexus-image-fallback="true" style="margin:1.75rem 0 2rem;border-radius:.9rem;overflow:hidden;border:1px solid #e5e7eb;background:#f9fafb">` +
    `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(altText)}" loading="lazy" style="display:block;width:100%;height:auto;max-height:420px;object-fit:cover" />` +
    `</figure>`;
}

async function ensurePublicContentImageFallback(contentHtml: string, website: any, effectiveSettings: any, page: any) {
  const content = String(contentHtml || "");
  if (/<img\b/i.test(content)) return content;

  const imageHtml = await getBrandImageFallbackHtml(website, effectiveSettings, page);
  if (!imageHtml) return content;

  if (/<\/p>/i.test(content)) {
    return content.replace(/<\/p>/i, `</p>\n${imageHtml}`);
  }

  return `${imageHtml}\n${content}`;
}

router.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    const host = requestHost(req);
    if (isNeverPublicHost(host)) return next();

    const path = req.path || "/";
    if (isSkippablePath(path)) return next();

    const slug = safeSlug(path);
    if (!slug) return next();

    // Route by database ownership, not by hostname prefix. This supports
    // pages.*, seo.*, local.*, and bare custom domains as long as the domain is
    // registered in websites.domain/settings.
    const website = await getWebsiteForHost(host);
    if (!website) return next();

    const page = await getPublishedPageForWebsite(website.id, slug);
    if (!page) return next();

    const effectiveSettings = await getEffectiveSettings(website);
    const rawContent = await getActiveContent(page.id, page);
    const content = await ensurePublicContentImageFallback(rawContent, website, effectiveSettings, page);
    const canonical = `https://${host}/${page.slug}`;
    const links = await getPublicInternalLinks(page.id, page.website_id || page.websiteId || website.id);

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("X-Nexus-Public-Renderer", "public-domain-brand-v4");

    console.log("[PUBLIC_HOST_RENDER]", {
      host,
      websiteId: website.id,
      websiteDomain: website.domain,
      accountId: website.account_id,
      brandProfileId: effectiveSettings.__brandProfileId || null,
      slug,
      brandName: effectiveSettings.brandName || effectiveSettings.siteName || effectiveSettings.businessName || null,
      hasPhone: !!effectiveSettings.phone,
      hasCta: !!effectiveSettings.ctaHeading || !!effectiveSettings.ctaText,
      hasDemoBanner: !!effectiveSettings.demoBannerUrl,
      hasImageFallback: rawContent === content ? false : true,
      renderer: "public-domain-brand-v4",
    });

    const html = buildEnhancedPublicPageHtml({
      page,
      website: {
        ...website,
        ...page,
        settings: effectiveSettings,
        name: effectiveSettings.brandName || effectiveSettings.siteName || effectiveSettings.businessName || website.website_name,
        websiteName: effectiveSettings.siteName || effectiveSettings.brandName || website.website_name,
        brandName: effectiveSettings.brandName,
        mainWebsiteUrl: effectiveSettings.mainWebsiteUrl,
        brandWebsiteUrl: effectiveSettings.brandWebsiteUrl,
        phone: effectiveSettings.phone,
      },
      contentHtml: content,
      canonicalUrl: canonical,
      links,
    });

    return res.type("html").send(postProcess(html, page, canonical, req));
  } catch (error) {
    return next(error);
  }
});

export default router;
