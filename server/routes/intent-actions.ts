import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "crypto";
import { pool } from "../db";
import { requireAuth } from "../auth";
import { runIntentBuild, getIntentBuildStatus, getIntentBuildReport } from "../services/intent-build";

const router = Router();
router.use(requireAuth);

type PageRef = { pageId?: string; slug?: string; canonicalOwner?: string; websiteId?: string };

function cleanSlug(value: unknown) { return String(value ?? "").trim().replace(/^\/+/, "").replace(/^pages\//, ""); }

async function assertWebsiteAccess(req: Request, res: Response, websiteId: string) {
  const result = await pool.query(`SELECT id, account_id FROM websites WHERE id = $1 LIMIT 1`, [websiteId]);
  const website = result.rows[0];
  if (!website) { res.status(404).json({ message: "Website not found" }); return null; }
  if (!req.session.isSuperAdmin && req.session.accountId !== website.account_id) { res.status(403).json({ message: "Forbidden: No access to this website" }); return null; }
  return website;
}

async function requireWebsiteParam(req: Request, res: Response, next: NextFunction) {
  try {
    const websiteId = req.params.websiteId || req.body?.websiteId;
    if (!websiteId) return res.status(400).json({ message: "websiteId is required" });
    const website = await assertWebsiteAccess(req, res, websiteId);
    if (!website) return;
    (req as any).website = website;
    next();
  } catch (err) { next(err); }
}

async function findPage(client: any, body: PageRef) {
  if (body.pageId) return (await client.query(`SELECT * FROM pages WHERE id = $1 LIMIT 1`, [body.pageId])).rows[0];
  const slug = cleanSlug(body.slug || body.canonicalOwner);
  if (!slug || !body.websiteId) return null;
  return (await client.query(`SELECT * FROM pages WHERE website_id = $1 AND slug = $2 LIMIT 1`, [body.websiteId, slug])).rows[0];
}

async function queueJob(client: any, page: any, name: string, settings: Record<string, unknown>) {
  const result = await client.query(
    `INSERT INTO generation_jobs (account_id, website_id, name, status, total_pages, processed_pages, passed_pages, failed_pages, settings, created_at)
     VALUES ($1, $2, $3, 'pending', 1, 0, 0, 0, $4::jsonb, NOW()) RETURNING id`,
    [settings.accountId || null, page.website_id, name, JSON.stringify(settings)],
  );
  return result.rows[0]?.id;
}

async function websiteAccountId(client: any, websiteId: string) {
  return (await client.query(`SELECT account_id FROM websites WHERE id = $1 LIMIT 1`, [websiteId])).rows[0]?.account_id ?? null;
}

router.get("/api/websites/:websiteId/action-review", requireWebsiteParam, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT gj.id, gj.name, gj.status, gj.settings, gj.created_at, gj.completed_at, gj.error_log,
              p.slug AS winner_slug, p.title AS winner_title, p.tier AS winner_tier
       FROM generation_jobs gj
       LEFT JOIN pages p ON p.id = COALESCE(gj.settings->>'winnerPageId', gj.settings->>'pageId')
       WHERE gj.website_id = $1
         AND gj.settings->>'type' IN ('intent_consolidation_review', 'intent_merge_review')
       ORDER BY gj.created_at DESC
       LIMIT 100`,
      [req.params.websiteId],
    );
    res.json(result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      type: r.settings?.type,
      intentCluster: r.settings?.intentCluster,
      winnerPageId: r.settings?.winnerPageId,
      winnerSlug: r.winner_slug || r.settings?.winnerSlug,
      winnerTitle: r.winner_title,
      winnerTier: r.winner_tier,
      requiresConfirmation: !!r.settings?.requiresConfirmation,
      redirectRequiredBeforePrune: !!r.settings?.redirectRequiredBeforePrune,
      destructiveActionAllowed: !!r.settings?.destructiveActionAllowed,
      createdAt: r.created_at,
      completedAt: r.completed_at,
      notes: r.error_log || [],
    })));
  } catch (err) { next(err); }
});

router.post("/api/action-review/:jobId/decision", async (req, res, next) => {
  try {
    const decision = String(req.body?.decision || "");
    if (!["approved", "rejected", "needs_changes"].includes(decision)) return res.status(400).json({ message: "Invalid decision" });
    const jobResult = await pool.query(`SELECT id, website_id, settings, error_log FROM generation_jobs WHERE id = $1 LIMIT 1`, [req.params.jobId]);
    const job = jobResult.rows[0];
    if (!job) return res.status(404).json({ message: "Review job not found" });
    const website = await assertWebsiteAccess(req, res, job.website_id);
    if (!website) return;
    const notes = Array.isArray(job.error_log) ? job.error_log : [];
    notes.push({ decision, note: req.body?.note || null, decidedAt: new Date().toISOString(), decidedBy: req.session.userId });
    await pool.query(
      `UPDATE generation_jobs
       SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{reviewDecision}', $2::jsonb, true), error_log = $3::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [req.params.jobId, JSON.stringify(decision), JSON.stringify(notes)],
    );
    res.json({ ok: true, jobId: req.params.jobId, decision });
  } catch (err) { next(err); }
});

router.post("/api/websites/:websiteId/intent-build/run", requireWebsiteParam, async (req, res, next) => { try { res.json(await runIntentBuild(req.params.websiteId)); } catch (err) { next(err); } });
router.get("/api/websites/:websiteId/intent-build/status", requireWebsiteParam, async (req, res, next) => { try { res.json(getIntentBuildStatus(req.params.websiteId)); } catch (err) { next(err); } });
router.get("/api/websites/:websiteId/intent-build/report", requireWebsiteParam, async (req, res, next) => { try { res.json(getIntentBuildReport(req.params.websiteId)); } catch (err) { next(err); } });

router.post("/api/intent-build/promote", requireWebsiteParam, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const page = await findPage(client, req.body || {});
    if (!page) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Page not found" }); }
    if (page.website_id !== req.body.websiteId) { await client.query("ROLLBACK"); return res.status(403).json({ message: "Forbidden: Page is outside selected website" }); }
    await client.query(`UPDATE pages SET tier = 1, promotion_status = 'promoted', noindex = false, updated_at = NOW() WHERE id = $1`, [page.id]);
    const accountId = await websiteAccountId(client, page.website_id);
    const sitemapJobId = await queueJob(client, page, "Intent Build: sitemap regeneration after promotion", { type: "sitemap_regeneration", reason: "intent_build_promote", accountId, pageId: page.id, slug: page.slug });
    await client.query("COMMIT");
    res.json({ ok: true, action: "promote", pageId: page.id, slug: page.slug, tier: 1, promotionStatus: "promoted", noindex: false, sitemapJobId });
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); next(err); } finally { client.release(); }
});

router.post("/api/intent-build/improve", requireWebsiteParam, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const page = await findPage(client, req.body || {});
    if (!page) return res.status(404).json({ message: "Page not found" });
    if (page.website_id !== req.body.websiteId) return res.status(403).json({ message: "Forbidden: Page is outside selected website" });
    const accountId = await websiteAccountId(client, page.website_id);
    const jobId = await queueJob(client, page, "Intent Build: improve page", { type: "intent_page_improvement", accountId, pageId: page.id, slug: page.slug, requestedImprovements: ["title", "h1", "meta", "faq", "proof", "local_section", "rescore"] });
    res.json({ ok: true, action: "improve", pageId: page.id, slug: page.slug, jobId });
  } catch (err) { next(err); } finally { client.release(); }
});

router.post("/api/intent-build/add-links", requireWebsiteParam, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const page = await findPage(client, req.body || {});
    if (!page) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Page not found" }); }
    if (page.website_id !== req.body.websiteId) { await client.query("ROLLBACK"); return res.status(403).json({ message: "Forbidden: Page is outside selected website" }); }
    const sources = await client.query(`SELECT id, title, slug, page_type FROM pages WHERE website_id = $1 AND id <> $2 AND status = 'published' ORDER BY CASE page_type WHEN 'state_hub' THEN 1 WHEN 'city_hub' THEN 2 WHEN 'service_city' THEN 3 WHEN 'problem_intent' THEN 4 ELSE 5 END, updated_at DESC LIMIT 10`, [page.website_id, page.id]);
    let created = 0;
    for (const source of sources.rows) {
      const insertResult = await client.query(`INSERT INTO internal_links (website_id, from_page_id, to_page_id, anchor_text, link_type, created_at) SELECT $1, $2, $3, $4, 'intent_support', NOW() WHERE NOT EXISTS (SELECT 1 FROM internal_links WHERE website_id = $1 AND from_page_id = $2 AND to_page_id = $3) RETURNING id`, [page.website_id, source.id, page.id, page.h1 || page.title || page.slug]);
      created += insertResult.rowCount ?? 0;
    }
    await client.query("COMMIT");
    res.json({ ok: true, action: "add-links", pageId: page.id, slug: page.slug, linksCreated: created });
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); next(err); } finally { client.release(); }
});

router.post("/api/intent-build/consolidate", requireWebsiteParam, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const page = await findPage(client, req.body || {});
    if (!page) return res.status(404).json({ message: "Page not found" });
    if (page.website_id !== req.body.websiteId) return res.status(403).json({ message: "Forbidden: Page is outside selected website" });
    const accountId = await websiteAccountId(client, page.website_id);
    const jobId = await queueJob(client, page, "Intent Build: consolidation review", { type: "intent_consolidation_review", accountId, winnerPageId: page.id, winnerSlug: page.slug, intentCluster: req.body?.intentCluster || null, destructiveActionAllowed: false });
    res.json({ ok: true, action: "consolidate", queuedForReview: true, pageId: page.id, slug: page.slug, jobId });
  } catch (err) { next(err); } finally { client.release(); }
});

router.post("/api/intent-build/merge", requireWebsiteParam, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const page = await findPage(client, req.body || {});
    if (!page) return res.status(404).json({ message: "Page not found" });
    if (page.website_id !== req.body.websiteId) return res.status(403).json({ message: "Forbidden: Page is outside selected website" });
    const accountId = await websiteAccountId(client, page.website_id);
    const jobId = await queueJob(client, page, "Intent Build: merge review", { type: "intent_merge_review", accountId, winnerPageId: page.id, winnerSlug: page.slug, intentCluster: req.body?.intentCluster || null, requiresConfirmation: true, destructiveActionAllowed: false, redirectRequiredBeforePrune: true, reviewToken: randomUUID() });
    res.json({ ok: true, action: "merge", queuedForReview: true, pageId: page.id, slug: page.slug, jobId });
  } catch (err) { next(err); } finally { client.release(); }
});

export default router;
