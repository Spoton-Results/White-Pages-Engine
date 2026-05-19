/**
 * intent-governance.ts
 * Intent governance run route — evaluates and processes AI-generated
 * action intents through the approval/rejection pipeline.
 * Graduated from intent-governance-run-hotfix.ts (logic unchanged).
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();
router.use(requireAuth);

function cleanSlug(value: unknown) {
  return String(value ?? "").trim().replace(/^\/+/, "").replace(/^pages\//, "");
}

function actor(req: any) {
  return String(req.session?.userId || req.session?.user?.id || req.session?.username || "unknown");
}

router.post("/api/intent-build/run-governance-action", async (req: Request, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const action = String(req.body?.action || "consolidate");
    if (!["consolidate", "merge"].includes(action))
      return res.status(400).json({ message: "action must be consolidate or merge" });

    const websiteId = String(req.body?.websiteId || "");
    if (!websiteId) return res.status(400).json({ message: "websiteId is required" });

    const website = (await pool.query(
      `SELECT id, account_id FROM websites WHERE id::text = $1::text LIMIT 1`,
      [websiteId]
    )).rows[0];
    if (!website) return res.status(404).json({ message: "Website not found" });
    if (!req.session.isSuperAdmin && String(req.session.accountId) !== String(website.account_id))
      return res.status(403).json({ message: "Forbidden: No access to this website" });

    const slug = cleanSlug(req.body?.slug || req.body?.canonicalOwner);
    const page = req.body?.pageId
      ? (await pool.query(`SELECT * FROM pages WHERE id::text = $1::text LIMIT 1`, [req.body.pageId])).rows[0]
      : (await pool.query(`SELECT * FROM pages WHERE website_id::text = $1::text AND slug = $2 LIMIT 1`, [websiteId, slug])).rows[0];
    if (!page) return res.status(404).json({ message: "Canonical winner page not found" });
    if (String(page.website_id) !== websiteId)
      return res.status(403).json({ message: "Forbidden: Page is outside selected website" });

    const tokens = String(req.body?.intentCluster || page.intent_cluster || page.title || page.slug || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4)
      .slice(0, 6);

    const params: any[] = [page.website_id, page.id, ...tokens.map((t) => `%${t}%`)];
    const where = tokens.length
      ? `AND (${tokens.map((_, i) => `(lower(COALESCE(title,'')) LIKE $${i + 3} OR lower(COALESCE(slug,'')) LIKE $${i + 3} OR lower(COALESCE(intent_cluster,'')) LIKE $${i + 3})`).join(" OR ")})`
      : "";

    const affected = (await pool.query(
      `SELECT id, slug, title, status, tier, page_type
       FROM pages
       WHERE website_id::text = $1::text
         AND id::text <> $2::text
         AND status = 'published'
         ${where}
       LIMIT 12`,
      params
    )).rows;
    const affectedIds = affected.map((p: any) => String(p.id));

    const preview = {
      action,
      winner: { id: page.id, slug: page.slug, title: page.title, tier: page.tier, pageType: page.page_type },
      affectedPages: affected.map((p: any) => ({ id: p.id, slug: p.slug, title: p.title, status: p.status, tier: p.tier, pageType: p.page_type })),
      plannedChanges: [
        `Keep ${page.slug} as the canonical winner`,
        `Repoint internal links from overlapping pages to ${page.slug}`,
        "Create governance audit log",
      ],
      safetyRules: ["No page deletion", "No automatic 301 redirects", "No sitemap removal", "Every change is logged"],
      counts: { affectedPages: affectedIds.length, internalLinksToRepair: 0 },
    };

    await client.query("BEGIN");
    await client.query(
      `CREATE TABLE IF NOT EXISTS intent_governance_actions (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         website_id TEXT NOT NULL,
         account_id TEXT,
         action TEXT NOT NULL,
         status TEXT NOT NULL DEFAULT 'previewed',
         winner_page_id TEXT,
         winner_slug TEXT,
         affected_page_ids JSONB DEFAULT '[]'::jsonb,
         internal_links_updated INTEGER NOT NULL DEFAULT 0,
         pages_updated INTEGER NOT NULL DEFAULT 0,
         preview JSONB DEFAULT '{}'::jsonb,
         executed_by TEXT,
         executed_at TIMESTAMP,
         created_at TIMESTAMP DEFAULT NOW()
       )`
    );

    let linksUpdated = 0;
    if (affectedIds.length) {
      const linkResult = await client.query(
        `UPDATE internal_links
         SET to_page_id = $3
         WHERE website_id::text = $1::text
           AND to_page_id::text = ANY($2::text[])
           AND to_page_id::text <> $3::text`,
        [page.website_id, affectedIds, page.id]
      );
      linksUpdated = linkResult.rowCount || 0;
    }
    preview.counts.internalLinksToRepair = linksUpdated;

    const job = await client.query(
      `INSERT INTO generation_jobs
         (account_id, website_id, name, status, total_pages, processed_pages, passed_pages, failed_pages, settings, created_at)
       VALUES ($1, $2, $3, 'pending', 1, 0, 0, 0, $4::jsonb, NOW())
       RETURNING id`,
      [
        website.account_id || null,
        page.website_id,
        action === "merge" ? "Intent Governance: approved merge action" : "Intent Governance: approved consolidation action",
        JSON.stringify({
          type: "intent_governance_execute",
          action,
          winnerPageId: page.id,
          winnerSlug: page.slug,
          affectedPageIds: affectedIds,
          approvedBy: actor(req),
          approvedAt: new Date().toISOString(),
          destructiveActionAllowed: false,
        }),
      ]
    );

    const log = await client.query(
      `INSERT INTO intent_governance_actions
         (website_id, account_id, action, status, winner_page_id, winner_slug,
          affected_page_ids, internal_links_updated, pages_updated, preview, executed_by, executed_at)
       VALUES ($1, $2, $3, 'executed', $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10, NOW())
       RETURNING id`,
      [page.website_id, website.account_id || null, action, page.id, page.slug,
       JSON.stringify(affectedIds), linksUpdated, affectedIds.length, JSON.stringify(preview), actor(req)]
    );

    await client.query("COMMIT");
    res.json({
      ok: true,
      action,
      governanceActionId: log.rows[0]?.id,
      jobId: job.rows[0]?.id,
      winnerPageId: page.id,
      winnerSlug: page.slug,
      affectedPages: affectedIds.length,
      internalLinksUpdated: linksUpdated,
      preview,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    next(err);
  } finally {
    client.release();
  }
});

export default router;
