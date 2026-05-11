import { Router } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();
router.use(requireAuth);

async function assertWebsiteAccess(req: any, res: any, websiteId: string) {
  const result = await pool.query(
    `SELECT id, account_id, domain, name, COALESCE(settings, '{}') AS settings
     FROM websites
     WHERE id::text = $1::text
     LIMIT 1`,
    [websiteId],
  );
  const website = result.rows[0];
  if (!website) {
    res.status(404).json({ message: "Website not found" });
    return null;
  }
  if (!req.session.isSuperAdmin && String(req.session.accountId) !== String(website.account_id)) {
    res.status(403).json({ message: "Forbidden: No access to this website" });
    return null;
  }
  return website;
}

function currentHomepageSlug(settings: any) {
  return settings?.homepageSlug || settings?.home_slug || settings?.homePageSlug || settings?.defaultSlug || "";
}

router.get("/api/websites/:websiteId/client-domain-homepage/candidates", async (req, res, next) => {
  try {
    const website = await assertWebsiteAccess(req, res, req.params.websiteId);
    if (!website) return;

    const result = await pool.query(
      `SELECT id, slug, title, h1, page_type, tier, quality_score, updated_at
       FROM pages
       WHERE website_id::text = $1::text
         AND status = 'published'
       ORDER BY tier ASC NULLS LAST, quality_score DESC NULLS LAST, updated_at DESC NULLS LAST
       LIMIT 250`,
      [website.id],
    );

    res.json({
      website: { id: website.id, name: website.name, domain: website.domain },
      currentHomepageSlug: currentHomepageSlug(website.settings),
      candidates: result.rows.map((row: any) => ({
        id: row.id,
        slug: row.slug,
        title: row.title || row.h1 || row.slug,
        pageType: row.page_type,
        tier: row.tier,
        qualityScore: row.quality_score,
        updatedAt: row.updated_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/api/websites/:websiteId/client-domain-homepage", async (req, res, next) => {
  try {
    const website = await assertWebsiteAccess(req, res, req.params.websiteId);
    if (!website) return;

    const slug = String(req.body?.slug || "").trim().replace(/^\/+/, "");
    if (!slug) return res.status(400).json({ message: "Homepage slug is required." });

    const page = await pool.query(
      `SELECT id, slug, title, status
       FROM pages
       WHERE website_id::text = $1::text
         AND slug = $2
         AND status = 'published'
       LIMIT 1`,
      [website.id, slug],
    );
    if (!page.rows[0]) {
      return res.status(400).json({ message: "Homepage must be an existing published page for this website." });
    }

    const settings = { ...(website.settings || {}), homepageSlug: slug };
    await pool.query(
      `UPDATE websites SET settings = $2::jsonb, updated_at = NOW() WHERE id::text = $1::text`,
      [website.id, JSON.stringify(settings)],
    );

    res.json({ ok: true, homepageSlug: slug, page: page.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete("/api/websites/:websiteId/client-domain-homepage", async (req, res, next) => {
  try {
    const website = await assertWebsiteAccess(req, res, req.params.websiteId);
    if (!website) return;
    const settings = { ...(website.settings || {}) };
    delete settings.homepageSlug;
    delete settings.home_slug;
    delete settings.homePageSlug;
    delete settings.defaultSlug;
    await pool.query(
      `UPDATE websites SET settings = $2::jsonb, updated_at = NOW() WHERE id::text = $1::text`,
      [website.id, JSON.stringify(settings)],
    );
    res.json({ ok: true, homepageSlug: "" });
  } catch (err) {
    next(err);
  }
});

export default router;
