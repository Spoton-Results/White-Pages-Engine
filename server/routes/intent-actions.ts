import { Router } from "express";
import { randomUUID } from "crypto";
import { pool } from "../db";
import { runIntentBuild, getIntentBuildStatus, getIntentBuildReport } from "../services/intent-build";

const router = Router();

type PageRef = { pageId?: string; slug?: string; canonicalOwner?: string; websiteId?: string };

function cleanSlug(value: unknown) {
  return String(value ?? "").trim().replace(/^\/+/, "").replace(/^pages\//, "");
}

async function findPage(client: any, body: PageRef) {
  if (body.pageId) {
    const result = await client.query(`SELECT * FROM pages WHERE id = $1 LIMIT 1`, [body.pageId]);
    return result.rows[0];
  }
  const slug = cleanSlug(body.slug || body.canonicalOwner);
  if (!slug || !body.websiteId) return null;
  const result = await client.query(
    `SELECT * FROM pages WHERE website_id = $1 AND slug = $2 LIMIT 1`,
    [body.websiteId, slug],
  );
  return result.rows[0];
}

async function queueJob(client: any, page: any, name: string, settings: Record<string, unknown>) {
  const result = await client.query(
    `INSERT INTO generation_jobs (
      account_id, website_id, name, status, total_pages, processed_pages, passed_pages, failed_pages, settings, created_at
    ) VALUES ($1, $2, $3, 'pending', 1, 0, 0, 0, $4::jsonb, NOW()) RETURNING id`,
    [settings.accountId || null, page.website_id, name, JSON.stringify(settings)],
  );
  return result.rows[0]?.id;
}

async function websiteAccountId(client: any, websiteId: string) {
  const result = await client.query(`SELECT account_id FROM websites WHERE id = $1 LIMIT 1`, [websiteId]);
  return result.rows[0]?.account_id ?? null;
}

router.post("/api/websites/:websiteId/intent-build/run", async (req, res, next) => {
  try {
    const result = await runIntentBuild(req.params.websiteId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/api/websites/:websiteId/intent-build/status", async (req, res, next) => {
  try {
    res.json(getIntentBuildStatus(req.params.websiteId));
  } catch (err) {
    next(err);
  }
});

router.get("/api/websites/:websiteId/intent-build/report", async (req, res, next) => {
  try {
    res.json(getIntentBuildReport(req.params.websiteId));
  } catch (err) {
    next(err);
  }
});

router.post("/api/intent-build/promote", async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const page = await findPage(client, req.body || {});
    if (!page) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Page not found" });
    }
    await client.query(
      `UPDATE pages SET tier = 1, promotion_status = 'promoted', noindex = false, updated_at = NOW() WHERE id = $1`,
      [page.id],
    );
    const accountId = await websiteAccountId(client, page.website_id);
    const sitemapJobId = await queueJob(client, { ...page, website_id: page.website_id }, "Intent Build: sitemap regeneration after promotion", {
      type: "sitemap_regeneration",
      reason: "intent_build_promote",
      accountId,
      pageId: page.id,
      slug: page.slug,
    });
    await client.query("COMMIT");
    res.json({ ok: true, action: "promote", pageId: page.id, slug: page.slug, tier: 1, promotionStatus: "promoted", noindex: false, sitemapJobId });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

router.post("/api/intent-build/improve", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const page = await findPage(client, req.body || {});
    if (!page) return res.status(404).json({ message: "Page not found" });
    const accountId = await websiteAccountId(client, page.website_id);
    const jobId = await queueJob(client, page, "Intent Build: improve page", {
      type: "intent_page_improvement",
      accountId,
      pageId: page.id,
      slug: page.slug,
      requestedImprovements: ["title", "h1", "meta", "faq", "proof", "local_section", "rescore"],
    });
    res.json({ ok: true, action: "improve", pageId: page.id, slug: page.slug, jobId });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

router.post("/api/intent-build/add-links", async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const page = await findPage(client, req.body || {});
    if (!page) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Page not found" });
    }
    const sources = await client.query(
      `SELECT id, title, slug, page_type FROM pages
       WHERE website_id = $1 AND id <> $2 AND status = 'published'
       ORDER BY CASE page_type WHEN 'state_hub' THEN 1 WHEN 'city_hub' THEN 2 WHEN 'service_city' THEN 3 WHEN 'problem_intent' THEN 4 ELSE 5 END, updated_at DESC
       LIMIT 10`,
      [page.website_id, page.id],
    );
    let created = 0;
    for (const source of sources.rows) {
      const insertResult = await client.query(
        `INSERT INTO internal_links (website_id, from_page_id, to_page_id, anchor_text, link_type, created_at)
         SELECT $1, $2, $3, $4, 'intent_support', NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM internal_links WHERE website_id = $1 AND from_page_id = $2 AND to_page_id = $3
         )
         RETURNING id`,
        [page.website_id, source.id, page.id, page.h1 || page.title || page.slug],
      );
      created += insertResult.rowCount ?? 0;
    }
    await client.query("COMMIT");
    res.json({ ok: true, action: "add-links", pageId: page.id, slug: page.slug, linksCreated: created });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

router.post("/api/intent-build/consolidate", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const page = await findPage(client, req.body || {});
    if (!page) return res.status(404).json({ message: "Page not found" });
    const accountId = await websiteAccountId(client, page.website_id);
    const jobId = await queueJob(client, page, "Intent Build: consolidation review", {
      type: "intent_consolidation_review",
      accountId,
      winnerPageId: page.id,
      winnerSlug: page.slug,
      intentCluster: req.body?.intentCluster || null,
      destructiveActionAllowed: false,
    });
    res.json({ ok: true, action: "consolidate", queuedForReview: true, pageId: page.id, slug: page.slug, jobId });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

router.post("/api/intent-build/merge", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const page = await findPage(client, req.body || {});
    if (!page) return res.status(404).json({ message: "Page not found" });
    const accountId = await websiteAccountId(client, page.website_id);
    const jobId = await queueJob(client, page, "Intent Build: merge review", {
      type: "intent_merge_review",
      accountId,
      winnerPageId: page.id,
      winnerSlug: page.slug,
      intentCluster: req.body?.intentCluster || null,
      requiresConfirmation: true,
      destructiveActionAllowed: false,
      redirectRequiredBeforePrune: true,
      reviewToken: randomUUID(),
    });
    res.json({ ok: true, action: "merge", queuedForReview: true, pageId: page.id, slug: page.slug, jobId });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

export default router;
