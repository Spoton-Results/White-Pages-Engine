import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "crypto";
import { pool } from "../db";
import { requireAuth } from "../auth";
import { runIntentBuild, getIntentBuildStatus, getIntentBuildReport } from "../services/intent-build";

const router = Router();
router.use(requireAuth);

type PageRef = { pageId?: string; slug?: string; canonicalOwner?: string; websiteId?: string; intentCluster?: string };

function cleanSlug(value: unknown) { return String(value ?? "").trim().replace(/^\/+/, "").replace(/^pages\//, ""); }

async function assertWebsiteAccess(req: Request, res: Response, websiteId: string) {
  const result = await pool.query(`SELECT id, account_id FROM websites WHERE id::text = $1::text LIMIT 1`, [websiteId]);
  const website = result.rows[0];
  if (!website) { res.status(404).json({ message: "Website not found" }); return null; }
  if (!req.session.isSuperAdmin && String(req.session.accountId) !== String(website.account_id)) { res.status(403).json({ message: "Forbidden: No access to this website" }); return null; }
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
  if (body.pageId) return (await client.query(`SELECT * FROM pages WHERE id::text = $1::text LIMIT 1`, [body.pageId])).rows[0];
  const slug = cleanSlug(body.slug || body.canonicalOwner);
  if (!slug || !body.websiteId) return null;
  return (await client.query(`SELECT * FROM pages WHERE website_id::text = $1::text AND slug = $2 LIMIT 1`, [body.websiteId, slug])).rows[0];
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
  return (await client.query(`SELECT account_id FROM websites WHERE id::text = $1::text LIMIT 1`, [websiteId])).rows[0]?.account_id ?? null;
}

async function ensureGovernanceLogsTable(client: any = pool) {
  await client.query(`CREATE TABLE IF NOT EXISTS intent_governance_actions (
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
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_intent_governance_actions_website ON intent_governance_actions(website_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_intent_governance_actions_created_at ON intent_governance_actions(created_at DESC)`);
}

function actorFromReq(req: any) {
  return String(req.session?.userId || req.session?.user?.id || req.session?.username || req.session?.user?.username || "unknown");
}

function healthStatus(ok: boolean, warn = false) { return ok ? "pass" : warn ? "warning" : "fail"; }

async function findCandidatePages(client: any, page: any, intentCluster?: string | null) {
  const tokens = String(intentCluster || page.intent_cluster || page.title || page.slug || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4)
    .slice(0, 6);

  const likeClauses = tokens.map((_, i) => `(lower(COALESCE(title,'')) LIKE $${i + 3} OR lower(COALESCE(slug,'')) LIKE $${i + 3} OR lower(COALESCE(intent_cluster,'')) LIKE $${i + 3})`).join(" OR ");
  const params = [page.website_id, page.id, ...tokens.map((t) => `%${t}%`)];
  const whereSimilarity = likeClauses ? `AND (${likeClauses})` : `AND COALESCE(intent_cluster,'') = COALESCE($3,'')`;
  if (!likeClauses) params.push(String(intentCluster || page.intent_cluster || ""));

  const result = await client.query(
    `SELECT id, slug, title, status, tier, page_type, created_at, updated_at
     FROM pages
     WHERE website_id::text = $1::text
       AND id::text <> $2::text
       AND status = 'published'
       ${whereSimilarity}
     ORDER BY COALESCE(tier,99) ASC, updated_at DESC NULLS LAST, created_at ASC
     LIMIT 12`,
    params,
  );
  return result.rows;
}

function buildWinnerReason(page: any, affectedCount: number, linksToRepair: number) {
  const factors: string[] = [];

  if (page.tier) factors.push(`Winner is currently Tier ${page.tier}, giving it stronger governance priority than weaker overlapping pages.`);
  if (page.page_type) factors.push(`Winner page type is ${page.page_type}, which makes it a cleaner canonical owner for this intent group.`);
  if (page.slug) factors.push(`Winner has the canonical slug "${page.slug}", which is the target all repaired internal links will point toward.`);
  if (affectedCount > 0) factors.push(`${affectedCount} overlapping page(s) were found and will be treated as affected pages, not deleted.`);
  if (linksToRepair > 0) factors.push(`${linksToRepair} internal link(s) currently point toward affected pages and can be repointed to the winner.`);
  else factors.push("No existing internal links need repair, so this governance action mainly records the canonical decision.");

  return {
    summary: `${page.slug} was selected as the canonical winner because it is the approved owner for this intent cluster and can safely absorb internal-link equity from overlapping pages.`,
    factors,
    scoreSignals: { tier: page.tier ?? null, pageType: page.page_type ?? null, slug: page.slug, title: page.title ?? null, affectedPages: affectedCount, internalLinksToRepair: linksToRepair },
  };
}

async function buildInternalLinkDiff(client: any, page: any, affectedIds: string[]) {
  const winnerLinks = await client.query(
    `SELECT COUNT(*)::int AS count FROM internal_links WHERE website_id::text = $1::text AND to_page_id::text = $2::text`,
    [page.website_id, page.id],
  ).catch(() => ({ rows: [{ count: 0 }] }));
  const linksPointingToWinner = Number(winnerLinks.rows[0]?.count || 0);

  if (!affectedIds.length) {
    return { before: { linksPointingToWinner, linksPointingToAffectedPages: 0 }, after: { linksPointingToWinner, linksPointingToAffectedPages: 0 }, changes: [] };
  }

  const repairRows = await client.query(
    `SELECT il.id AS link_id, il.from_page_id, from_p.slug AS from_slug, from_p.title AS from_title,
            il.to_page_id AS old_to_page_id, to_p.slug AS old_to_slug, to_p.title AS old_to_title,
            il.anchor_text, il.link_type
     FROM internal_links il
     LEFT JOIN pages from_p ON from_p.id::text = il.from_page_id::text
     LEFT JOIN pages to_p ON to_p.id::text = il.to_page_id::text
     WHERE il.website_id::text = $1::text
       AND il.to_page_id = ANY($2::uuid[])
       AND il.to_page_id::text <> $3::text
     ORDER BY from_p.slug ASC NULLS LAST, to_p.slug ASC NULLS LAST
     LIMIT 50`,
    [page.website_id, affectedIds, page.id],
  ).catch(() => ({ rows: [] }));

  const linksPointingToAffectedPages = repairRows.rows.length;
  const changes = repairRows.rows.map((r: any) => ({
    linkId: String(r.link_id),
    fromPageId: String(r.from_page_id),
    fromSlug: r.from_slug,
    fromTitle: r.from_title,
    oldToPageId: String(r.old_to_page_id),
    oldToSlug: r.old_to_slug,
    oldToTitle: r.old_to_title,
    newToPageId: String(page.id),
    newToSlug: page.slug,
    newToTitle: page.title ?? null,
    anchorText: r.anchor_text ?? null,
    linkType: r.link_type ?? null,
  }));

  return {
    before: { linksPointingToWinner, linksPointingToAffectedPages },
    after: { linksPointingToWinner: linksPointingToWinner + linksPointingToAffectedPages, linksPointingToAffectedPages: 0 },
    changes,
  };
}

async function buildGovernancePreview(client: any, page: any, body: PageRef, action: "consolidate" | "merge") {
  const candidates = await findCandidatePages(client, page, body.intentCluster || null);
  const affected = candidates.map((p: any) => ({ id: p.id, slug: p.slug, title: p.title, status: p.status, tier: p.tier, pageType: p.page_type }));
  const affectedIds = affected.map((p: any) => p.id);
  const linkDiff = await buildInternalLinkDiff(client, page, affectedIds);
  const internalLinksToRepair = linkDiff.before.linksPointingToAffectedPages;
  const winnerReason = buildWinnerReason(page, affected.length, internalLinksToRepair);

  return {
    action,
    winner: { id: page.id, slug: page.slug, title: page.title, tier: page.tier, pageType: page.page_type },
    winnerReason,
    affectedPages: affected,
    linkDiff,
    plannedChanges: [
      `Keep ${page.slug} as the canonical winner`,
      `Mark ${affected.length} overlapping page(s) as governance reviewed`,
      `Repoint ${internalLinksToRepair} internal link(s) from overlapping pages to ${page.slug}`,
      action === "merge" ? "Queue merge review with redirect-required flag" : "Queue consolidation review without deleting pages",
      "Create governance audit log for rollback/review",
    ],
    safetyRules: [
      "No page deletion in this version",
      "No automatic 301 redirects in this version",
      "No sitemap removal until manual validation",
      "Every change is logged in intent_governance_actions",
    ],
    counts: { affectedPages: affected.length, internalLinksToRepair },
  };
}

router.get("/api/websites/:websiteId/production-validation", requireWebsiteParam, async (req, res, next) => {
  try {
    const websiteId = req.params.websiteId;
    const [pages, services, bankRows, jobs, reviewJobs, internalLinks, sitemaps] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM pages WHERE website_id::text = $1::text`, [websiteId]),
      pool.query(`SELECT COUNT(*)::int AS count FROM services WHERE account_id::text = $1::text`, [(req as any).website.account_id]),
      pool.query(`SELECT COUNT(*)::int AS count, COALESCE(AVG(completeness_score),0)::float AS avg_score FROM variation_bank_completeness WHERE website_id::text = $1::text`, [websiteId]),
      pool.query(`SELECT status, COUNT(*)::int AS count FROM generation_jobs WHERE website_id::text = $1::text GROUP BY status`, [websiteId]),
      pool.query(`SELECT COUNT(*)::int AS count FROM generation_jobs WHERE website_id::text = $1::text AND settings->>'type' IN ('intent_consolidation_review','intent_merge_review','intent_governance_execute')`, [websiteId]),
      pool.query(`SELECT COUNT(*)::int AS count FROM internal_links WHERE website_id::text = $1::text`, [websiteId]),
      pool.query(`SELECT COUNT(*)::int AS count FROM sitemaps WHERE website_id::text = $1::text`, [websiteId]),
    ]);

    const jobCounts = Object.fromEntries(jobs.rows.map((r: any) => [r.status, r.count]));
    const publishedPages = pages.rows[0]?.count ?? 0;
    const serviceCount = services.rows[0]?.count ?? 0;
    const bankCount = bankRows.rows[0]?.count ?? 0;
    const avgBankScore = Math.round(bankRows.rows[0]?.avg_score ?? 0);
    const linkCount = internalLinks.rows[0]?.count ?? 0;
    const sitemapCount = sitemaps.rows[0]?.count ?? 0;
    const failedJobs = jobCounts.failed ?? 0;
    const pendingJobs = jobCounts.pending ?? 0;

    const checks = [
      { key: "website_access", label: "Website access", status: "pass", detail: "Authenticated user can access this website." },
      { key: "published_pages", label: "Published pages", status: healthStatus(publishedPages > 0), detail: `${publishedPages} pages found.` },
      { key: "services", label: "Services configured", status: healthStatus(serviceCount > 0), detail: `${serviceCount} services found.` },
      { key: "bank_health", label: "Bank Health rows", status: healthStatus(bankCount >= serviceCount && serviceCount > 0, bankCount > 0), detail: `${bankCount}/${serviceCount} services have completeness rows. Average score: ${avgBankScore}%.` },
      { key: "internal_links", label: "Internal links", status: healthStatus(linkCount > 0, publishedPages > 0), detail: `${linkCount} internal links found.` },
      { key: "sitemaps", label: "Sitemaps", status: healthStatus(sitemapCount > 0, publishedPages > 0), detail: `${sitemapCount} sitemap records found.` },
      { key: "job_failures", label: "Failed jobs", status: healthStatus(failedJobs === 0, failedJobs > 0), detail: `${failedJobs} failed jobs.` },
      { key: "pending_jobs", label: "Pending jobs", status: healthStatus(pendingJobs < 25, pendingJobs >= 25), detail: `${pendingJobs} pending jobs.` },
      { key: "review_queue", label: "Action Review Queue", status: "pass", detail: `${reviewJobs.rows[0]?.count ?? 0} merge/consolidation review jobs tracked.` },
    ];

    const failCount = checks.filter(c => c.status === "fail").length;
    const warningCount = checks.filter(c => c.status === "warning").length;
    const launchStatus = failCount > 0 ? "not_ready" : warningCount > 0 ? "ready_with_warnings" : "ready";

    res.json({ websiteId, launchStatus, checkedAt: new Date().toISOString(), summary: { publishedPages, serviceCount, bankCount, avgBankScore, linkCount, sitemapCount, failedJobs, pendingJobs }, checks });
  } catch (err) { next(err); }
});

router.get("/api/websites/:websiteId/action-review", requireWebsiteParam, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT gj.id, gj.name, gj.status, gj.settings, gj.created_at, gj.completed_at, gj.error_log,
              p.slug AS winner_slug, p.title AS winner_title, p.tier AS winner_tier
       FROM generation_jobs gj
       LEFT JOIN pages p ON p.id::text = COALESCE(gj.settings->>'winnerPageId', gj.settings->>'pageId')
       WHERE gj.website_id::text = $1::text AND gj.settings->>'type' IN ('intent_consolidation_review', 'intent_merge_review', 'intent_governance_execute')
       ORDER BY gj.created_at DESC LIMIT 100`,
      [req.params.websiteId],
    );
    res.json(result.rows.map((r: any) => ({ id: r.id, name: r.name, status: r.status, type: r.settings?.type, intentCluster: r.settings?.intentCluster, winnerPageId: r.settings?.winnerPageId, winnerSlug: r.winner_slug || r.settings?.winnerSlug, winnerTitle: r.winner_title, winnerTier: r.winner_tier, requiresConfirmation: !!r.settings?.requiresConfirmation, redirectRequiredBeforePrune: !!r.settings?.redirectRequiredBeforePrune, destructiveActionAllowed: !!r.settings?.destructiveActionAllowed, createdAt: r.created_at, completedAt: r.completed_at, notes: r.error_log || [] })));
  } catch (err) { next(err); }
});

router.post("/api/action-review/:jobId/decision", async (req, res, next) => {
  try {
    const decision = String(req.body?.decision || "");
    if (!["approved", "rejected", "needs_changes"].includes(decision)) return res.status(400).json({ message: "Invalid decision" });
    const job = (await pool.query(`SELECT id, website_id, settings, error_log FROM generation_jobs WHERE id::text = $1::text LIMIT 1`, [req.params.jobId])).rows[0];
    if (!job) return res.status(404).json({ message: "Review job not found" });
    const website = await assertWebsiteAccess(req, res, job.website_id); if (!website) return;
    const notes = Array.isArray(job.error_log) ? job.error_log : [];
    notes.push({ decision, note: req.body?.note || null, decidedAt: new Date().toISOString(), decidedBy: req.session.userId });
    await pool.query(`UPDATE generation_jobs SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{reviewDecision}', $2::jsonb, true), error_log = $3::jsonb, updated_at = NOW() WHERE id::text = $1::text`, [req.params.jobId, JSON.stringify(decision), JSON.stringify(notes)]);
    res.json({ ok: true, jobId: req.params.jobId, decision });
  } catch (err) { next(err); }
});

router.post("/api/websites/:websiteId/intent-build/run", requireWebsiteParam, async (req, res, next) => { try { res.json(await runIntentBuild(req.params.websiteId)); } catch (err) { next(err); } });
router.get("/api/websites/:websiteId/intent-build/status", requireWebsiteParam, async (req, res, next) => { try { res.json(getIntentBuildStatus(req.params.websiteId)); } catch (err) { next(err); } });
router.get("/api/websites/:websiteId/intent-build/report", requireWebsiteParam, async (req, res, next) => { try { res.json(getIntentBuildReport(req.params.websiteId)); } catch (err) { next(err); } });

router.post("/api/intent-build/governance-preview", requireWebsiteParam, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const action = String(req.body?.action || "consolidate");
    if (!["consolidate", "merge"].includes(action)) return res.status(400).json({ message: "action must be consolidate or merge" });
    const page = await findPage(client, req.body || {});
    if (!page) return res.status(404).json({ message: "Canonical winner page not found" });
    if (String(page.website_id) !== String(req.body.websiteId)) return res.status(403).json({ message: "Forbidden: Page is outside selected website" });
    const preview = await buildGovernancePreview(client, page, req.body || {}, action as "consolidate" | "merge");
    res.json({ ok: true, preview });
  } catch (err) { next(err); } finally { client.release(); }
});

router.post("/api/intent-build/run-governance-action", requireWebsiteParam, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const action = String(req.body?.action || "consolidate");
    if (!["consolidate", "merge"].includes(action)) return res.status(400).json({ message: "action must be consolidate or merge" });
    await client.query("BEGIN");
    await ensureGovernanceLogsTable(client);
    const page = await findPage(client, req.body || {});
    if (!page) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Canonical winner page not found" }); }
    if (String(page.website_id) !== String(req.body.websiteId)) { await client.query("ROLLBACK"); return res.status(403).json({ message: "Forbidden: Page is outside selected website" }); }
    const accountId = await websiteAccountId(client, page.website_id);
    const preview = await buildGovernancePreview(client, page, req.body || {}, action as "consolidate" | "merge");
    const affectedIds = preview.affectedPages.map((p: any) => p.id);

    let linksUpdated = 0;
    if (affectedIds.length > 0) {
      // ✅ CHANGED: isolate the optional internal-link update so a schema/type mismatch
      // cannot poison the entire governance transaction.
      await client.query("SAVEPOINT intent_links_update");
      try {
        const linkResult = await client.query(
          `UPDATE internal_links
           SET to_page_id = $3
           WHERE website_id::text = $1::text
             AND to_page_id = ANY($2::uuid[])
             AND to_page_id::text <> $3::text`,
          [page.website_id, affectedIds, page.id],
        );
        linksUpdated = linkResult.rowCount || 0;
        await client.query("RELEASE SAVEPOINT intent_links_update");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT intent_links_update");
        await client.query("RELEASE SAVEPOINT intent_links_update");
        console.error("[intent-governance/internal-links]", error);
        linksUpdated = 0;
      }

      // ✅ CHANGED: isolate the optional governance-status update for the same reason.
      await client.query("SAVEPOINT intent_pages_update");
      try {
        await client.query(
          `UPDATE pages
           SET intent_governance_status = $3, updated_at = NOW()
           WHERE website_id::text = $1::text
             AND id = ANY($2::uuid[])`,
          [page.website_id, affectedIds, action === "merge" ? "merge_reviewed" : "consolidation_reviewed"],
        );
        await client.query("RELEASE SAVEPOINT intent_pages_update");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT intent_pages_update");
        await client.query("RELEASE SAVEPOINT intent_pages_update");
        console.error("[intent-governance/pages]", error);
      }
    }

    console.log("[intent-governance] queueJob:start", {
      websiteId: page.website_id,
      pageId: page.id,
      action,
      affectedCount: affectedIds.length,
    });

    const jobId = await queueJob(client, page, action === "merge" ? "Intent Governance: approved merge action" : "Intent Governance: approved consolidation action", {
      type: "intent_governance_execute",
      accountId,
      action,
      winnerPageId: page.id,
      winnerSlug: page.slug,
      affectedPageIds: affectedIds,
      intentCluster: req.body?.intentCluster || null,
      destructiveActionAllowed: false,
      redirectRequiredBeforePrune: action === "merge",
      approvedBy: actorFromReq(req),
      approvedAt: new Date().toISOString(),
    });

    console.log("[intent-governance] queueJob:success", { jobId });

    console.log("[intent-governance] auditInsert:start", {
      websiteId: page.website_id,
      pageId: page.id,
      action,
    });

    const log = await client.query(
      `INSERT INTO intent_governance_actions (website_id, account_id, action, status, winner_page_id, winner_slug, affected_page_ids, internal_links_updated, pages_updated, preview, executed_by, executed_at)
       VALUES ($1, $2, $3, 'executed', $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10, NOW()) RETURNING id`,
      [page.website_id, accountId, action, page.id, page.slug, JSON.stringify(affectedIds), linksUpdated, affectedIds.length, JSON.stringify(preview), actorFromReq(req)],
    );

    console.log("[intent-governance] auditInsert:success", {
      governanceActionId: log.rows[0]?.id,
    });

    console.log("[intent-governance] commit:start");
    await client.query("COMMIT");
    console.log("[intent-governance] commit:success");
    res.json({ ok: true, action, governanceActionId: log.rows[0]?.id, jobId, winnerPageId: page.id, winnerSlug: page.slug, affectedPages: affectedIds.length, internalLinksUpdated: linksUpdated, preview });
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); next(err); } finally { client.release(); }
});

router.post("/api/intent-build/promote", requireWebsiteParam, async (req, res, next) => {
  const client = await pool.connect(); try { await client.query("BEGIN"); const page = await findPage(client, req.body || {}); if (!page) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Page not found" }); } if (String(page.website_id) !== String(req.body.websiteId)) { await client.query("ROLLBACK"); return res.status(403).json({ message: "Forbidden: Page is outside selected website" }); } await client.query(`UPDATE pages SET tier = 1, promotion_status = 'promoted', noindex = false, updated_at = NOW() WHERE id::text = $1::text`, [page.id]); const accountId = await websiteAccountId(client, page.website_id); const sitemapJobId = await queueJob(client, page, "Intent Build: sitemap regeneration after promotion", { type: "sitemap_regeneration", reason: "intent_build_promote", accountId, pageId: page.id, slug: page.slug }); await client.query("COMMIT"); res.json({ ok: true, action: "promote", pageId: page.id, slug: page.slug, tier: 1, promotionStatus: "promoted", noindex: false, sitemapJobId }); } catch (err) { await client.query("ROLLBACK").catch(() => {}); next(err); } finally { client.release(); }
});
router.post("/api/intent-build/improve", requireWebsiteParam, async (req, res, next) => { const client = await pool.connect(); try { const page = await findPage(client, req.body || {}); if (!page) return res.status(404).json({ message: "Page not found" }); if (String(page.website_id) !== String(req.body.websiteId)) return res.status(403).json({ message: "Forbidden: Page is outside selected website" }); const accountId = await websiteAccountId(client, page.website_id); const jobId = await queueJob(client, page, "Intent Build: improve page", { type: "intent_page_improvement", accountId, pageId: page.id, slug: page.slug, requestedImprovements: ["title", "h1", "meta", "faq", "proof", "local_section", "rescore"] }); res.json({ ok: true, action: "improve", pageId: page.id, slug: page.slug, jobId }); } catch (err) { next(err); } finally { client.release(); } });
router.post("/api/intent-build/add-links", requireWebsiteParam, async (req, res, next) => { const client = await pool.connect(); try { await client.query("BEGIN"); const page = await findPage(client, req.body || {}); if (!page) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Page not found" }); } if (String(page.website_id) !== String(req.body.websiteId)) { await client.query("ROLLBACK"); return res.status(403).json({ message: "Forbidden: Page is outside selected website" }); } const sources = await client.query(`SELECT id, title, slug, page_type FROM pages WHERE website_id::text = $1::text AND id::text <> $2::text AND status = 'published' ORDER BY CASE page_type WHEN 'state_hub' THEN 1 WHEN 'city_hub' THEN 2 WHEN 'service_city' THEN 3 WHEN 'problem_intent' THEN 4 ELSE 5 END, updated_at DESC LIMIT 10`, [page.website_id, page.id]); let created = 0; for (const source of sources.rows) { const insertResult = await client.query(`INSERT INTO internal_links (website_id, from_page_id, to_page_id, anchor_text, link_type, created_at) SELECT $1, $2, $3, $4, 'intent_support', NOW() WHERE NOT EXISTS (SELECT 1 FROM internal_links WHERE website_id = $1 AND from_page_id = $2 AND to_page_id = $3) RETURNING id`, [page.website_id, source.id, page.id, page.h1 || page.title || page.slug]); created += insertResult.rowCount ?? 0; } await client.query("COMMIT"); res.json({ ok: true, action: "add-links", pageId: page.id, slug: page.slug, linksCreated: created }); } catch (err) { await client.query("ROLLBACK").catch(() => {}); next(err); } finally { client.release(); } });
router.post("/api/intent-build/consolidate", requireWebsiteParam, async (req, res, next) => { const client = await pool.connect(); try { const page = await findPage(client, req.body || {}); if (!page) return res.status(404).json({ message: "Page not found" }); if (String(page.website_id) !== String(req.body.websiteId)) return res.status(403).json({ message: "Forbidden: Page is outside selected website" }); const accountId = await websiteAccountId(client, page.website_id); const jobId = await queueJob(client, page, "Intent Build: consolidation review", { type: "intent_consolidation_review", accountId, winnerPageId: page.id, winnerSlug: page.slug, intentCluster: req.body?.intentCluster || null, destructiveActionAllowed: false }); res.json({ ok: true, action: "consolidate", queuedForReview: true, pageId: page.id, slug: page.slug, jobId }); } catch (err) { next(err); } finally { client.release(); } });
router.post("/api/intent-build/merge", requireWebsiteParam, async (req, res, next) => { const client = await pool.connect(); try { const page = await findPage(client, req.body || {}); if (!page) return res.status(404).json({ message: "Page not found" }); if (String(page.website_id) !== String(req.body.websiteId)) return res.status(403).json({ message: "Forbidden: Page is outside selected website" }); const accountId = await websiteAccountId(client, page.website_id); const jobId = await queueJob(client, page, "Intent Build: merge review", { type: "intent_merge_review", accountId, winnerPageId: page.id, winnerSlug: page.slug, intentCluster: req.body?.intentCluster || null, requiresConfirmation: true, destructiveActionAllowed: false, redirectRequiredBeforePrune: true, reviewToken: randomUUID() }); res.json({ ok: true, action: "merge", queuedForReview: true, pageId: page.id, slug: page.slug, jobId }); } catch (err) { next(err); } finally { client.release(); } });

export default router;
