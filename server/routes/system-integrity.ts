import { Router } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();

type CheckStatus = "ok" | "warning" | "critical";

type IntegrityCheck = {
  key: string;
  label: string;
  status: CheckStatus;
  count: number;
  description: string;
  repairAction?: string;
};

function statusFor(count: number, critical = false): CheckStatus {
  if (count <= 0) return "ok";
  return critical ? "critical" : "warning";
}

function scopeClause(req: any, alias = "a") {
  if (req.session?.isSuperAdmin) return { clause: "", params: [] as any[] };
  return { clause: `WHERE ${alias}.id::text = $1::text`, params: [req.session?.accountId] as any[] };
}

function scopeAnd(req: any, alias = "a") {
  if (req.session?.isSuperAdmin) return { clause: "", params: [] as any[] };
  return { clause: `AND ${alias}.id::text = $1::text`, params: [req.session?.accountId] as any[] };
}

async function requireOpsAccess(req: any, res: any) {
  if (!req.session?.isSuperAdmin && !req.session?.accountId) {
    res.status(403).json({ message: "Forbidden" });
    return false;
  }
  return true;
}

async function ensureReportLinksTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS client_report_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    report_type TEXT NOT NULL DEFAULT 'monthly_visibility',
    expires_at TIMESTAMP,
    revoked_at TIMESTAMP,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    last_viewed_at TIMESTAMP,
    view_count INTEGER DEFAULT 0
  )`);
}

async function ensureRepairLogsTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS system_repair_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'success',
    scope_type TEXT NOT NULL DEFAULT 'platform',
    account_id TEXT,
    triggered_by TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    affected_count INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_system_repair_logs_created_at ON system_repair_logs(created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_system_repair_logs_account_id ON system_repair_logs(account_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_system_repair_logs_action ON system_repair_logs(action)`);
}

function actorFromReq(req: any) {
  return String(req.session?.userId || req.session?.user?.id || req.session?.username || req.session?.user?.username || "unknown");
}

async function writeRepairLog(req: any, input: {
  action: string;
  status?: "success" | "failed";
  affectedCount?: number;
  durationMs?: number;
  message?: string;
  metadata?: Record<string, any>;
}) {
  await ensureRepairLogsTable();
  const accountId = req.session?.isSuperAdmin ? null : String(req.session?.accountId || "") || null;
  await pool.query(
    `INSERT INTO system_repair_logs (action, status, scope_type, account_id, triggered_by, source, affected_count, duration_ms, message, metadata)
     VALUES ($1, $2, $3, $4, $5, 'manual', $6, $7, $8, $9::jsonb)`,
    [
      input.action,
      input.status || "success",
      req.session?.isSuperAdmin ? "platform" : "account",
      accountId,
      actorFromReq(req),
      Math.max(0, Number(input.affectedCount || 0)),
      Math.max(0, Number(input.durationMs || 0)),
      input.message || null,
      JSON.stringify(input.metadata || {}),
    ],
  );
}

async function getCounts(req: any) {
  const s = scopeClause(req, "a");
  const and = scopeAnd(req, "a");

  await ensureReportLinksTable().catch(() => undefined);
  await ensureRepairLogsTable().catch(() => undefined);

  const [
    totals,
    staleCounters,
    missingBankCompleteness,
    thinBanks,
    stuckJobs,
    failedJobs30d,
    missingSitemaps,
    brokenInternalLinks,
    pagesWithoutVersions,
    emptyClients,
    reportlessClients,
  ] = await Promise.all([
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM accounts a ${s.clause}) AS accounts,
      (SELECT COUNT(*)::int FROM websites w JOIN accounts a ON a.id = w.account_id ${s.clause}) AS websites,
      (SELECT COUNT(*)::int FROM pages p JOIN websites w ON w.id = p.website_id JOIN accounts a ON a.id = w.account_id WHERE p.status = 'published' ${and.clause}) AS published_pages,
      (SELECT COUNT(*)::int FROM generation_jobs gj JOIN accounts a ON a.id = gj.account_id WHERE gj.created_at >= NOW() - INTERVAL '30 days' ${and.clause}) AS jobs_30d`, s.params),
    pool.query(`SELECT COUNT(*)::int AS count FROM websites w JOIN accounts a ON a.id = w.account_id LEFT JOIN LATERAL (SELECT COUNT(*)::int AS actual FROM pages p WHERE p.website_id = w.id AND p.status = 'published') pc ON true WHERE COALESCE(w.published_pages,0) <> COALESCE(pc.actual,0) ${and.clause}`, s.params),
    pool.query(`SELECT COUNT(*)::int AS count FROM websites w JOIN accounts a ON a.id = w.account_id JOIN services sv ON sv.account_id = a.id LEFT JOIN variation_bank_completeness vbc ON vbc.website_id = w.id AND lower(vbc.service) = lower(sv.name) WHERE vbc.id IS NULL ${and.clause}`, s.params),
    pool.query(`SELECT COUNT(*)::int AS count FROM variation_bank_completeness vbc JOIN websites w ON w.id = vbc.website_id JOIN accounts a ON a.id = w.account_id WHERE vbc.completeness_score < 70 ${and.clause}`, s.params),
    pool.query(`SELECT COUNT(*)::int AS count FROM generation_jobs gj JOIN accounts a ON a.id = gj.account_id WHERE gj.status IN ('pending','running') AND gj.created_at < NOW() - INTERVAL '30 minutes' ${and.clause}`, s.params),
    pool.query(`SELECT COUNT(*)::int AS count FROM generation_jobs gj JOIN accounts a ON a.id = gj.account_id WHERE gj.status = 'failed' AND gj.created_at >= NOW() - INTERVAL '30 days' ${and.clause}`, s.params),
    pool.query(`SELECT COUNT(*)::int AS count FROM websites w JOIN accounts a ON a.id = w.account_id WHERE EXISTS (SELECT 1 FROM pages p WHERE p.website_id = w.id AND p.status = 'published') AND NOT EXISTS (SELECT 1 FROM sitemaps sm WHERE sm.website_id = w.id) ${and.clause}`, s.params),
    pool.query(`SELECT COUNT(*)::int AS count FROM internal_links il JOIN websites w ON w.id = il.website_id JOIN accounts a ON a.id = w.account_id LEFT JOIN pages fp ON fp.id = il.from_page_id LEFT JOIN pages tp ON tp.id = il.to_page_id WHERE (fp.id IS NULL OR tp.id IS NULL) ${and.clause}`, s.params),
    pool.query(`SELECT COUNT(*)::int AS count FROM pages p JOIN websites w ON w.id = p.website_id JOIN accounts a ON a.id = w.account_id WHERE p.status = 'published' AND NOT EXISTS (SELECT 1 FROM page_versions pv WHERE pv.page_id = p.id AND pv.is_active = true) ${and.clause}`, s.params),
    pool.query(`SELECT COUNT(*)::int AS count FROM accounts a ${s.clause} ${s.clause ? "AND" : "WHERE"} NOT EXISTS (SELECT 1 FROM websites w WHERE w.account_id = a.id)`, s.params),
    pool.query(`SELECT COUNT(*)::int AS count FROM accounts a ${s.clause} ${s.clause ? "AND" : "WHERE"} NOT EXISTS (SELECT 1 FROM client_report_links crl WHERE crl.account_id::text = a.id::text AND crl.revoked_at IS NULL AND (crl.expires_at IS NULL OR crl.expires_at > NOW()))`, s.params),
  ]);

  const t = totals.rows[0] || { accounts: 0, websites: 0, published_pages: 0, jobs_30d: 0 };
  const checks: IntegrityCheck[] = [
    { key: "stale_published_counts", label: "Stale website page counters", status: statusFor(staleCounters.rows[0]?.count || 0), count: staleCounters.rows[0]?.count || 0, description: "Websites where published_pages does not match actual published page count.", repairAction: "sync_published_counts" },
    { key: "missing_bank_completeness", label: "Missing bank-completeness rows", status: statusFor(missingBankCompleteness.rows[0]?.count || 0), count: missingBankCompleteness.rows[0]?.count || 0, description: "Website/service pairs missing variation_bank_completeness records.", repairAction: "recompute_bank_completeness" },
    { key: "thin_banks", label: "Thin variation banks", status: statusFor(thinBanks.rows[0]?.count || 0), count: thinBanks.rows[0]?.count || 0, description: "Variation banks below the Tier-1 readiness threshold." },
    { key: "stuck_jobs", label: "Stuck jobs", status: statusFor(stuckJobs.rows[0]?.count || 0, true), count: stuckJobs.rows[0]?.count || 0, description: "Pending/running jobs older than 30 minutes." },
    { key: "failed_jobs_30d", label: "Failed jobs in last 30 days", status: statusFor(failedJobs30d.rows[0]?.count || 0), count: failedJobs30d.rows[0]?.count || 0, description: "Recent generation jobs that failed and may explain missing dashboard activity." },
    { key: "missing_sitemaps", label: "Websites with pages but no sitemap", status: statusFor(missingSitemaps.rows[0]?.count || 0), count: missingSitemaps.rows[0]?.count || 0, description: "Published websites where sitemap rows are missing." },
    { key: "broken_internal_links", label: "Broken internal links", status: statusFor(brokenInternalLinks.rows[0]?.count || 0, true), count: brokenInternalLinks.rows[0]?.count || 0, description: "Internal links pointing to missing source or target pages.", repairAction: "delete_broken_internal_links" },
    { key: "published_pages_without_active_version", label: "Published pages missing active content version", status: statusFor(pagesWithoutVersions.rows[0]?.count || 0, true), count: pagesWithoutVersions.rows[0]?.count || 0, description: "Published page records without an active page_versions row." },
    { key: "empty_clients", label: "Clients without websites", status: statusFor(emptyClients.rows[0]?.count || 0), count: emptyClients.rows[0]?.count || 0, description: "Accounts that have no website records." },
    { key: "clients_without_active_report_link", label: "Clients without active report link", status: statusFor(reportlessClients.rows[0]?.count || 0), count: reportlessClients.rows[0]?.count || 0, description: "Accounts that do not currently have a non-expired client report link." },
  ];

  const criticalCount = checks.filter((c) => c.status === "critical").length;
  const warningCount = checks.filter((c) => c.status === "warning").length;
  const healthScore = Math.max(0, 100 - criticalCount * 18 - warningCount * 8);

  return {
    scannedAt: new Date().toISOString(),
    healthScore,
    summary: {
      accounts: Number(t.accounts || 0),
      websites: Number(t.websites || 0),
      publishedPages: Number(t.published_pages || 0),
      jobs30d: Number(t.jobs_30d || 0),
      criticalCount,
      warningCount,
    },
    checks,
  };
}

async function recomputeBankCompleteness(req: any) {
  const and = scopeAnd(req, "a");
  const params = and.params;

  await pool.query(`INSERT INTO variation_bank_completeness (website_id, service)
    SELECT w.id, sv.name
    FROM websites w
    JOIN accounts a ON a.id = w.account_id
    JOIN services sv ON sv.account_id = a.id
    LEFT JOIN variation_bank_completeness vbc ON vbc.website_id = w.id AND lower(vbc.service) = lower(sv.name)
    WHERE vbc.id IS NULL ${and.clause}
    ON CONFLICT DO NOTHING`, params);

  const result = await pool.query(`WITH bank AS (
      SELECT cvb.website_id,
             cvb.service,
             bool_or(lower(cvb.section_name) LIKE '%intro%') AS has_intro,
             bool_or(lower(cvb.section_name) LIKE '%how%' OR lower(cvb.section_name) LIKE '%process%') AS has_how_it_works,
             bool_or(lower(cvb.section_name) LIKE '%benefit%' OR lower(cvb.section_name) LIKE '%why%') AS has_benefits,
             bool_or(lower(cvb.section_name) LIKE '%faq%') AS has_faq,
             bool_or(lower(cvb.section_name) LIKE '%cta%' OR lower(cvb.section_name) LIKE '%call%') AS has_cta,
             count(*)::int AS total_rows,
             COALESCE(sum(jsonb_array_length(CASE WHEN jsonb_typeof(cvb.variations) = 'array' THEN cvb.variations ELSE '[]'::jsonb END)),0)::int AS total_variations
      FROM content_variation_banks cvb
      JOIN websites w ON w.id = cvb.website_id
      JOIN accounts a ON a.id = w.account_id
      WHERE 1=1 ${and.clause}
      GROUP BY cvb.website_id, cvb.service
    )
    UPDATE variation_bank_completeness vbc
    SET has_intro = COALESCE(bank.has_intro,false),
        has_how_it_works = COALESCE(bank.has_how_it_works,false),
        has_benefits = COALESCE(bank.has_benefits,false),
        has_faq = COALESCE(bank.has_faq,false),
        has_cta = COALESCE(bank.has_cta,false),
        total_variations = COALESCE(bank.total_variations,0),
        avg_variations_per_section = CASE WHEN COALESCE(bank.total_rows,0) = 0 THEN 0 ELSE GREATEST(0, FLOOR(bank.total_variations::numeric / bank.total_rows::numeric))::int END,
        completeness_score = LEAST(100, ((CASE WHEN COALESCE(bank.has_intro,false) THEN 20 ELSE 0 END) + (CASE WHEN COALESCE(bank.has_how_it_works,false) THEN 20 ELSE 0 END) + (CASE WHEN COALESCE(bank.has_benefits,false) THEN 20 ELSE 0 END) + (CASE WHEN COALESCE(bank.has_faq,false) THEN 20 ELSE 0 END) + (CASE WHEN COALESCE(bank.has_cta,false) THEN 20 ELSE 0 END)))::int,
        is_eligible_for_tier1 = LEAST(100, ((CASE WHEN COALESCE(bank.has_intro,false) THEN 20 ELSE 0 END) + (CASE WHEN COALESCE(bank.has_how_it_works,false) THEN 20 ELSE 0 END) + (CASE WHEN COALESCE(bank.has_benefits,false) THEN 20 ELSE 0 END) + (CASE WHEN COALESCE(bank.has_faq,false) THEN 20 ELSE 0 END) + (CASE WHEN COALESCE(bank.has_cta,false) THEN 20 ELSE 0 END))) >= 70,
        last_computed_at = NOW()
    FROM bank
    WHERE vbc.website_id = bank.website_id AND lower(vbc.service) = lower(bank.service)
    RETURNING vbc.id`, params);

  return result.rowCount || 0;
}

router.get("/api/system-integrity/scan", requireAuth, async (req, res, next) => {
  try {
    if (!(await requireOpsAccess(req, res))) return;
    res.json(await getCounts(req));
  } catch (err) {
    next(err);
  }
});

router.get("/api/system-integrity/repair-logs", requireAuth, async (req, res, next) => {
  try {
    if (!(await requireOpsAccess(req, res))) return;
    await ensureRepairLogsTable();
    const params: any[] = [];
    let where = "";
    if (!req.session?.isSuperAdmin) {
      where = "WHERE account_id::text = $1::text OR account_id IS NULL";
      params.push(req.session.accountId);
    }
    const result = await pool.query(
      `SELECT id, action, status, scope_type, account_id, triggered_by, source, affected_count, duration_ms, message, metadata, created_at
       FROM system_repair_logs
       ${where}
       ORDER BY created_at DESC
       LIMIT 50`,
      params,
    );
    res.json(result.rows.map((r: any) => ({
      id: r.id,
      action: r.action,
      status: r.status,
      scopeType: r.scope_type,
      accountId: r.account_id,
      triggeredBy: r.triggered_by,
      source: r.source,
      affectedCount: Number(r.affected_count || 0),
      durationMs: Number(r.duration_ms || 0),
      message: r.message,
      metadata: r.metadata || {},
      createdAt: r.created_at,
    })));
  } catch (err) {
    next(err);
  }
});

router.post("/api/system-integrity/repair/:action", requireAuth, async (req, res, next) => {
  const startedAt = Date.now();
  const action = String(req.params.action || "");
  try {
    if (!(await requireOpsAccess(req, res))) return;
    const and = scopeAnd(req, "a");

    if (action === "sync_published_counts") {
      const result = await pool.query(`UPDATE websites w
        SET published_pages = COALESCE(pc.actual,0), updated_at = NOW()
        FROM accounts a
        LEFT JOIN LATERAL (SELECT COUNT(*)::int AS actual FROM pages p WHERE p.website_id = w.id AND p.status = 'published') pc ON true
        WHERE a.id = w.account_id ${and.clause}
        RETURNING w.id`, and.params);
      const repaired = result.rowCount || 0;
      await writeRepairLog(req, { action, affectedCount: repaired, durationMs: Date.now() - startedAt, message: "Synced website published page counters." });
      return res.json({ ok: true, action, repaired, scan: await getCounts(req) });
    }

    if (action === "recompute_bank_completeness") {
      const repaired = await recomputeBankCompleteness(req);
      await writeRepairLog(req, { action, affectedCount: repaired, durationMs: Date.now() - startedAt, message: "Recomputed variation bank completeness rows." });
      return res.json({ ok: true, action, repaired, scan: await getCounts(req) });
    }

    if (action === "delete_broken_internal_links") {
      const result = await pool.query(`DELETE FROM internal_links il
        USING websites w, accounts a
        WHERE w.id = il.website_id AND a.id = w.account_id
        AND (NOT EXISTS (SELECT 1 FROM pages fp WHERE fp.id = il.from_page_id) OR NOT EXISTS (SELECT 1 FROM pages tp WHERE tp.id = il.to_page_id))
        ${and.clause}
        RETURNING il.id`, and.params);
      const repaired = result.rowCount || 0;
      await writeRepairLog(req, { action, affectedCount: repaired, durationMs: Date.now() - startedAt, message: "Deleted orphaned internal-link rows." });
      return res.json({ ok: true, action, repaired, scan: await getCounts(req) });
    }

    return res.status(400).json({ message: `Unknown repair action: ${action}` });
  } catch (err: any) {
    try {
      await writeRepairLog(req, { action: action || "unknown", status: "failed", affectedCount: 0, durationMs: Date.now() - startedAt, message: err?.message || "Repair action failed." });
    } catch {
      // Never let audit logging hide the original repair failure.
    }
    next(err);
  }
});

export default router;
