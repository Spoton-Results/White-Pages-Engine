import { Router } from "express";
import { requireAuth } from "../auth";
import { pool } from "../db";
import { invalidateWebsiteDomainCache } from "../storage";

const router = Router();

const SPOTON_ROOT_DOMAIN = "spotonresults.com";
const SPOTON_PAGES_DOMAIN = "pages.spotonresults.com";

function normalizeHostname(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

function normalizePath(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function normalizeSettingsForPublicPages(domain: string, settings: any = {}) {
  const next = { ...(settings || {}) };

  // One-time SpotOn Results migration:
  // Old: https://spotonresults.com/pages/{slug}
  // New: https://pages.spotonresults.com/{slug}
  // Keep the same website/page ownership, but force public URLs, canonicals,
  // sitemap URLs, preview links, and proxy-aware builders to root on the pages subdomain.
  if (domain === SPOTON_ROOT_DOMAIN || domain === SPOTON_PAGES_DOMAIN) {
    next.parentDomain = SPOTON_PAGES_DOMAIN;
    next.publicDomain = SPOTON_PAGES_DOMAIN;
    next.proxyPath = "";
    next.publicBasePath = "";
    next.legacyParentDomain = SPOTON_ROOT_DOMAIN;
    next.legacyProxyPath = "pages";
    return next;
  }

  next.parentDomain = domain;
  next.proxyPath = "";
  return next;
}

function toWebsite(row: any) {
  return {
    id: row.id,
    accountId: row.account_id,
    brandProfileId: row.brand_profile_id,
    name: row.name,
    domain: row.domain,
    subdomain: row.subdomain,
    status: row.status,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    settings: row.settings || {},
    publishedPages: row.published_pages,
    pageCount: row.page_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// System-wide website editor override.
// Website domain = public SEO serving hostname, e.g. pages.clientdomain.com.
// Client/root business site belongs in settings.mainWebsiteUrl.
// When domain changes, force published URLs/canonicals/sitemaps to use it by
// syncing settings.parentDomain and clearing any old preview/proxy path.
router.patch("/api/websites/:id", requireAuth, async (req, res, next) => {
  try {
    const websiteId = req.params.id;
    const body = req.body || {};

    const currentResult = await pool.query(`SELECT * FROM websites WHERE id = $1 LIMIT 1`, [websiteId]);
    const current = currentResult.rows[0];
    if (!current) return res.status(404).json({ message: "Website not found" });

    const requestedDomain = body.domain != null ? normalizeHostname(body.domain) : current.domain;
    const nextDomain = requestedDomain === SPOTON_ROOT_DOMAIN ? SPOTON_PAGES_DOMAIN : requestedDomain;

    if (!nextDomain || !nextDomain.includes(".")) {
      return res.status(400).json({ message: "Website domain must be a valid hostname like pages.clientdomain.com" });
    }

    const incomingSettings = body.settings && typeof body.settings === "object" ? body.settings : {};
    const mergedSettings = {
      ...(current.settings || {}),
      ...incomingSettings,
    };

    const normalizedSettings = body.domain != null
      ? normalizeSettingsForPublicPages(nextDomain, mergedSettings)
      : mergedSettings;

    const updated = await pool.query(
      `UPDATE websites
       SET name = COALESCE($2, name),
           domain = $3,
           status = COALESCE($4, status),
           settings = $5::jsonb,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [websiteId, body.name ?? null, nextDomain, body.status ?? null, JSON.stringify(normalizedSettings)]
    );

    invalidateWebsiteDomainCache(current.domain);
    invalidateWebsiteDomainCache(nextDomain);
    if (nextDomain === SPOTON_PAGES_DOMAIN) invalidateWebsiteDomainCache(SPOTON_ROOT_DOMAIN);

    return res.json(toWebsite(updated.rows[0]));
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ message: "That website domain is already used by another website." });
    }
    return next(err);
  }
});

// One-time repair endpoint for the existing SpotOn Results tenant.
// This does not copy, delete, or regenerate pages. It only moves the website's
// public hostname to pages.spotonresults.com and clears the old /pages prefix.
router.post("/api/websites/repair/spoton-results-pages-domain", requireAuth, async (_req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE websites
       SET domain = $1,
           settings = (
             COALESCE(settings, '{}'::jsonb)
             || jsonb_build_object(
               'parentDomain', $1,
               'publicDomain', $1,
               'proxyPath', '',
               'publicBasePath', '',
               'legacyParentDomain', $2,
               'legacyProxyPath', 'pages'
             )
           ),
           updated_at = NOW()
       WHERE lower(domain) = $2
          OR lower(domain) = $1
          OR lower(settings->>'parentDomain') = $2
          OR lower(settings->>'parentDomain') = $1
       RETURNING *`,
      [SPOTON_PAGES_DOMAIN, SPOTON_ROOT_DOMAIN]
    );

    invalidateWebsiteDomainCache(SPOTON_ROOT_DOMAIN);
    invalidateWebsiteDomainCache(SPOTON_PAGES_DOMAIN);

    return res.json({
      message: "SpotOn Results public pages now use pages.spotonresults.com at the root path.",
      updatedWebsites: result.rows.map(toWebsite),
      nextUrlPattern: `https://${SPOTON_PAGES_DOMAIN}/{slug}`,
      oldUrlPattern: `https://${SPOTON_ROOT_DOMAIN}/pages/{slug}`,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
