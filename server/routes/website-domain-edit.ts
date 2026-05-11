import { Router } from "express";
import { requireAuth } from "../auth";
import { pool } from "../db";
import { invalidateWebsiteDomainCache } from "../storage";

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

    const nextDomain = body.domain != null ? normalizeHostname(body.domain) : current.domain;
    if (!nextDomain || !nextDomain.includes(".")) {
      return res.status(400).json({ message: "Website domain must be a valid hostname like pages.clientdomain.com" });
    }

    const incomingSettings = body.settings && typeof body.settings === "object" ? body.settings : {};
    const mergedSettings = {
      ...(current.settings || {}),
      ...incomingSettings,
    };

    if (body.domain != null) {
      mergedSettings.parentDomain = nextDomain;
      mergedSettings.proxyPath = "";
    }

    const updated = await pool.query(
      `UPDATE websites
       SET name = COALESCE($2, name),
           domain = $3,
           status = COALESCE($4, status),
           settings = $5::jsonb,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [websiteId, body.name ?? null, nextDomain, body.status ?? null, JSON.stringify(mergedSettings)]
    );

    invalidateWebsiteDomainCache(current.domain);
    invalidateWebsiteDomainCache(nextDomain);

    return res.json(toWebsite(updated.rows[0]));
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ message: "That website domain is already used by another website." });
    }
    return next(err);
  }
});

export default router;
