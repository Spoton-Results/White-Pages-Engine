import { Router } from "express";
import { requireAuth } from "../auth";
import { pool } from "../db";
import { invalidateWebsiteDomainCache } from "../storage";
import { invalidatePageCache } from "../routes";
import { renderPublishedPagesBatchToR2 } from "../services/static-page-renderer";

const router = Router();

const SPOTON_ROOT_DOMAIN = "spotonresults.com";
const SPOTON_PAGES_DOMAIN = "pages.spotonresults.com";
const R2_REBUILD_LIMIT = Math.max(25, Math.min(Number(process.env.R2_REBUILD_AFTER_WEBSITE_EDIT_LIMIT || 500), 5000));

function normalizeHostname(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

function normalizeSettingsForPublicPages(domain: string, settings: any = {}) {
  const next = { ...(settings || {}) };

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

function isSpotonWebsite(row: any) {
  const settings = row?.settings || {};
  const values = [
    normalizeHostname(row?.domain),
    normalizeHostname(settings.parentDomain),
    normalizeHostname(settings.publicDomain),
    normalizeHostname(settings.legacyParentDomain),
  ];
  return values.includes(SPOTON_ROOT_DOMAIN) || values.includes(SPOTON_PAGES_DOMAIN);
}

function normalizeWebsiteRow(row: any) {
  if (!row || !isSpotonWebsite(row)) return row;
  return {
    ...row,
    domain: SPOTON_PAGES_DOMAIN,
    settings: normalizeSettingsForPublicPages(SPOTON_PAGES_DOMAIN, row.settings || {}),
  };
}

function toWebsite(rawRow: any) {
  const row = normalizeWebsiteRow(rawRow);
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

async function invalidatePublishedR2ForWebsite(websiteId: string) {
  const result = await pool.query(
    `UPDATE pages
     SET r2_key = NULL,
         content_hash = NULL,
         rendered_at = NULL,
         updated_at = NOW()
     WHERE website_id::text = $1::text
       AND status = 'published'`,
    [websiteId],
  );
  return result.rowCount || 0;
}

function rebuildPublishedR2InBackground(websiteId: string) {
  setImmediate(async () => {
    try {
      const result = await renderPublishedPagesBatchToR2({
        websiteId,
        limit: R2_REBUILD_LIMIT,
        force: true,
      });
      console.log("[WEBSITE_EDIT_R2_REBUILD]", {
        websiteId,
        attempted: result.attempted,
        rendered: result.rendered,
        skipped: result.skipped,
        failed: result.failed,
      });
    } catch (error) {
      console.error("[WEBSITE_EDIT_R2_REBUILD_FAILED]", { websiteId, error });
    }
  });
}

// Must be mounted before the main /api/websites route. This makes the Websites
// dropdown and Published Pages URL builder receive the corrected public host,
// even if production DB rows still contain the old spotonresults.com value.
router.get("/api/websites", requireAuth, async (req, res, next) => {
  try {
    const accountId = typeof req.query.accountId === "string" ? req.query.accountId : "";
    const result = accountId
      ? await pool.query(`SELECT * FROM websites WHERE account_id = $1 ORDER BY created_at DESC`, [accountId])
      : await pool.query(`SELECT * FROM websites ORDER BY created_at DESC`);

    return res.json(result.rows.map(toWebsite));
  } catch (err) {
    return next(err);
  }
});

router.get("/api/websites/:id", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT * FROM websites WHERE id = $1 LIMIT 1`, [req.params.id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ message: "Website not found" });
    return res.json(toWebsite(row));
  } catch (err) {
    return next(err);
  }
});

// System-wide website editor override.
router.patch("/api/websites/:id", requireAuth, async (req, res, next) => {
  try {
    const websiteId = req.params.id;
    const body = req.body || {};

    const currentResult = await pool.query(`SELECT * FROM websites WHERE id = $1 LIMIT 1`, [websiteId]);
    const current = currentResult.rows[0];
    if (!current) return res.status(404).json({ message: "Website not found" });

    const requestedDomain = body.domain != null ? normalizeHostname(body.domain) : normalizeHostname(current.domain);
    const nextDomain = requestedDomain === SPOTON_ROOT_DOMAIN ? SPOTON_PAGES_DOMAIN : requestedDomain;

    if (!nextDomain || !nextDomain.includes(".")) {
      return res.status(400).json({ message: "Website domain must be a valid hostname like pages.clientdomain.com" });
    }

    const incomingSettings = body.settings && typeof body.settings === "object" ? body.settings : {};
    const mergedSettings = {
      ...(current.settings || {}),
      ...incomingSettings,
    };

    const normalizedSettings = body.domain != null || nextDomain === SPOTON_PAGES_DOMAIN
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
    invalidatePageCache(websiteId);

    const invalidatedR2Pages = await invalidatePublishedR2ForWebsite(websiteId).catch((error) => {
      console.error("[WEBSITE_EDIT_R2_INVALIDATE_FAILED]", { websiteId, error });
      return 0;
    });

    rebuildPublishedR2InBackground(websiteId);

    return res.json({
      ...toWebsite(updated.rows[0]),
      publicPagesRefresh: {
        invalidatedR2Pages,
        rebuildStarted: true,
        rebuildLimit: R2_REBUILD_LIMIT,
      },
    });
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
          OR lower(settings->>'legacyParentDomain') = $2
       RETURNING *`,
      [SPOTON_PAGES_DOMAIN, SPOTON_ROOT_DOMAIN]
    );

    invalidateWebsiteDomainCache(SPOTON_ROOT_DOMAIN);
    invalidateWebsiteDomainCache(SPOTON_PAGES_DOMAIN);
    for (const row of result.rows) {
      invalidatePageCache(row.id);
      await invalidatePublishedR2ForWebsite(row.id).catch(() => 0);
      rebuildPublishedR2InBackground(row.id);
    }

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
