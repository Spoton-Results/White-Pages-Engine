/**
 * site-preview.ts
 * Admin preview route: GET /sites/:domain/:slug
 *
 * Serves rendered page HTML for ANY client domain (e.g. pages.elitepages.io)
 * from the admin panel. Previously only pages.spotonresults.com was handled
 * by spoton-pages.ts — all other domains fell through to the Vite catch-all.
 *
 * Pipeline mirrors spoton-pages.ts exactly:
 *   1. Resolve website by domain (raw SQL — avoids Drizzle camelCase bug)
 *   2. Look up published page by website_id + slug
 *   3. Fetch active page_version
 *   4. Render via buildEnhancedPublicPageHtml
 *
 * 🔒 UNTOUCHED: spoton-pages.ts, storage.ts, core-api.ts, all other routes
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db";
import { buildEnhancedPublicPageHtml, getPublicInternalLinks } from "../services/public-page-enhancements";

const router = Router();

// ── GET /sites/:domain/:slug ────────────────────────────────────────────────
router.get("/sites/:domain/:slug", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { domain, slug } = req.params;

    if (!domain || !slug) return next();

    // 1. Resolve website by domain (raw SQL — avoids Drizzle camelCase→snake_case bug)
    const websiteResult = await pool.query(
      `SELECT * FROM websites
       WHERE lower(domain) = lower($1)
          OR lower(settings->>'parentDomain') = lower($1)
          OR lower(settings->>'publicDomain') = lower($1)
       LIMIT 1`,
      [domain]
    );

    const website = websiteResult.rows[0];
    if (!website) return next();

    // 2. Look up published page by website_id + slug
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

    // 3. Fetch active page_version
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

    // 4. Fetch internal links for this page
    const links = await getPublicInternalLinks(page.id, website.id);

    // 5. Build canonical URL using the website's domain
    const canonical = `https://${website.domain}/${page.slug}`;

    // 6. Render via the shared public-page builder
    const html = buildEnhancedPublicPageHtml({
      page,
      website: {
        ...website,
        accountId: website.account_id,
        brandProfileId: website.brand_profile_id,
        primaryColor: website.primary_color,
        secondaryColor: website.secondary_color,
        publishedPages: website.published_pages,
        pageCount: website.page_count,
        createdAt: website.created_at,
        updatedAt: website.updated_at,
        name: website.name || website.domain,
      },
      contentHtml,
      canonicalUrl: canonical,
      links,
    });

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("X-Site-Preview", "v1");
    return res.type("html").send(html);
  } catch (err) {
    return next(err);
  }
});

export default router;
