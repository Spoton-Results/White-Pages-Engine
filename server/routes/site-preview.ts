/**
 * site-preview.ts
 * Admin/public preview route: GET /sites/:domain/:slug
 *
 * Serves rendered page HTML for ANY client domain (e.g. pages.elitepages.io).
 * The public renderer must hydrate website settings from the attached/default
 * brand profile so published pages match the admin preview branding, CTAs,
 * demo banner, phone, and website URL.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db";
import { buildEnhancedPublicPageHtml, getPublicInternalLinks } from "../services/public-page-enhancements";

const router = Router();

function requestHost(req: Request) {
  return String(
    req.headers["x-nexus-host"] ||
    req.headers["x-forwarded-host"] ||
    req.headers.host ||
    ""
  )
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

function compactSettings(value: any) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstNonEmpty(...values: any[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

async function loadBrandProfile(website: any) {
  const result = await pool.query(
    `SELECT *
     FROM brand_profiles
     WHERE account_id::text = $1::text
       AND ($2::text IS NULL OR id::text = $2::text OR $2::text = '')
     ORDER BY
       CASE WHEN id::text = COALESCE($2::text, '') THEN 0 ELSE 1 END,
       updated_at DESC NULLS LAST,
       created_at DESC NULLS LAST
     LIMIT 1`,
    [website.account_id, website.brand_profile_id || ""],
  );
  return result.rows[0] || null;
}

function buildPublicWebsite(website: any, brandProfile: any) {
  const websiteSettings = compactSettings(website.settings);
  const customFields = compactSettings(brandProfile?.custom_fields || brandProfile?.customFields);

  const hydratedSettings = {
    ...customFields,
    ...websiteSettings,
    brandName: firstNonEmpty(websiteSettings.brandName, websiteSettings.siteName, websiteSettings.businessName, brandProfile?.name, website.name, website.domain),
    siteName: firstNonEmpty(websiteSettings.siteName, websiteSettings.brandName, brandProfile?.name, website.name, website.domain),
    businessName: firstNonEmpty(websiteSettings.businessName, websiteSettings.brandName, brandProfile?.name, website.name, website.domain),
    websiteUrl: firstNonEmpty(websiteSettings.websiteUrl, websiteSettings.mainWebsiteUrl, websiteSettings.brandWebsiteUrl, brandProfile?.website_url, brandProfile?.websiteUrl, website.domain),
    mainWebsiteUrl: firstNonEmpty(websiteSettings.mainWebsiteUrl, websiteSettings.websiteUrl, websiteSettings.brandWebsiteUrl, brandProfile?.website_url, brandProfile?.websiteUrl, website.domain),
    brandWebsiteUrl: firstNonEmpty(websiteSettings.brandWebsiteUrl, websiteSettings.websiteUrl, websiteSettings.mainWebsiteUrl, brandProfile?.website_url, brandProfile?.websiteUrl, website.domain),
    phone: firstNonEmpty(websiteSettings.phone, brandProfile?.phone_override, brandProfile?.phoneOverride, brandProfile?.phone),
    email: firstNonEmpty(websiteSettings.email, brandProfile?.email),
    ctaHeading: firstNonEmpty(websiteSettings.ctaHeading, brandProfile?.cta_heading, brandProfile?.ctaHeading),
    ctaText: firstNonEmpty(websiteSettings.ctaText, websiteSettings.ctaBody, brandProfile?.cta_body, brandProfile?.ctaBody, brandProfile?.description),
    ctaButtonLabel: firstNonEmpty(websiteSettings.ctaButtonLabel, brandProfile?.cta_button_label, brandProfile?.ctaButtonLabel),
    demoBannerUrl: firstNonEmpty(websiteSettings.demoBannerUrl, brandProfile?.demo_banner_url, brandProfile?.demoBannerUrl),
    demoBannerHeading: firstNonEmpty(websiteSettings.demoBannerHeading, brandProfile?.demo_banner_heading, brandProfile?.demoBannerHeading),
    demoBannerSubtext: firstNonEmpty(websiteSettings.demoBannerSubtext, brandProfile?.demo_banner_subtext, brandProfile?.demoBannerSubtext),
    demoBannerButtonLabel: firstNonEmpty(websiteSettings.demoBannerButtonLabel, websiteSettings.demoBannerButton, brandProfile?.demo_banner_button, brandProfile?.demoBannerButton),
  };

  return {
    ...website,
    accountId: website.account_id,
    brandProfileId: website.brand_profile_id,
    primaryColor: firstNonEmpty(website.primary_color, brandProfile?.primary_color, brandProfile?.primaryColor),
    secondaryColor: firstNonEmpty(website.secondary_color, brandProfile?.secondary_color, brandProfile?.secondaryColor),
    publishedPages: website.published_pages,
    pageCount: website.page_count,
    createdAt: website.created_at,
    updatedAt: website.updated_at,
    name: hydratedSettings.brandName || website.name || website.domain,
    brandName: hydratedSettings.brandName,
    websiteName: hydratedSettings.siteName,
    mainWebsiteUrl: hydratedSettings.mainWebsiteUrl,
    brandWebsiteUrl: hydratedSettings.brandWebsiteUrl,
    phone: hydratedSettings.phone,
    settings: hydratedSettings,
  };
}

// ── GET /sites/:domain/:slug ────────────────────────────────────────────────
router.get("/sites/:domain/:slug", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { domain, slug } = req.params;

    if (!domain || !slug) return next();

    const websiteResult = await pool.query(
      `SELECT * FROM websites
       WHERE lower(domain) = lower($1)
          OR lower(settings->>'parentDomain') = lower($1)
          OR lower(settings->>'publicDomain') = lower($1)
          OR lower(settings->>'legacyParentDomain') = lower($1)
       LIMIT 1`,
      [domain]
    );

    const website = websiteResult.rows[0];
    if (!website) return next();

    const pageResult = await pool.query(
      `SELECT p.*
       FROM pages p
       WHERE p.website_id::text = $1::text
         AND p.slug = $2
         AND p.status = 'published'
       ORDER BY p.published_at DESC NULLS LAST, p.updated_at DESC NULLS LAST
       LIMIT 1`,
      [website.id, slug]
    );

    const page = pageResult.rows[0];
    if (!page) return next();

    const versionResult = await pool.query(
      `SELECT * FROM page_versions
       WHERE page_id::text = $1::text
       ORDER BY is_active DESC NULLS LAST, version DESC NULLS LAST, created_at DESC NULLS LAST
       LIMIT 1`,
      [page.id]
    );

    const version = versionResult.rows[0] || {};
    const contentHtml =
      version.content_html ||
      version.contentHtml ||
      page.content_html ||
      page.contentHtml ||
      page.html ||
      page.body ||
      "";

    const links = await getPublicInternalLinks(page.id, website.id);
    const brandProfile = await loadBrandProfile(website);
    const publicWebsite = buildPublicWebsite(website, brandProfile);
    const canonical = `https://${publicWebsite.domain}/${page.slug}`;

    console.log("[PUBLIC_PAGE_RENDER]", {
      host: requestHost(req),
      routeDomain: domain,
      websiteId: website.id,
      websiteDomain: website.domain,
      accountId: website.account_id,
      brandProfileId: brandProfile?.id || null,
      slug,
      pageFound: true,
      brandFound: !!brandProfile,
      brandName: publicWebsite.settings?.brandName || null,
      hasPhone: !!publicWebsite.settings?.phone,
      hasCta: !!publicWebsite.settings?.ctaHeading || !!publicWebsite.settings?.ctaText,
      hasDemoBanner: !!publicWebsite.settings?.demoBannerUrl,
      renderer: "enhanced-public-shell-brand-hydrated-v2",
    });

    const html = buildEnhancedPublicPageHtml({
      page,
      website: publicWebsite,
      contentHtml,
      canonicalUrl: canonical,
      links,
    });

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("X-Site-Preview", "brand-hydrated-v2");
    return res.type("html").send(html);
  } catch (err) {
    return next(err);
  }
});

export default router;
