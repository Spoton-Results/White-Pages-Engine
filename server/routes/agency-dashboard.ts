import { Router } from "express";
import { randomBytes } from "crypto";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();
router.use(requireAuth);

function scopedWhere(req: any, alias = "a") {
  if (req.session.isSuperAdmin) return { where: "", and: "", params: [] as any[] };
  if (req.session.accountId) return { where: `WHERE ${alias}.id::text = $1::text`, and: `AND ${alias}.id::text = $1::text`, params: [req.session.accountId] as any[] };
  return { where: "", and: "", params: [] as any[] };
}

function searchReachEstimate(pagesLive: number, citiesCovered: number, servicesCovered: number) {
  return Math.round(pagesLive * 35 + citiesCovered * 120 + servicesCovered * 450);
}

type RoiInput = { pagesLive: number; citiesCovered: number; servicesCovered: number; last30DaysWork: number; failedJobs: number; thinBanks: number };
function roiScore(input: RoiInput) {
  let score = 0;
  if (input.pagesLive > 0) score += 25;
  if (input.pagesLive >= 100) score += 10;
  if (input.pagesLive >= 500) score += 10;
  if (input.citiesCovered > 0) score += 15;
  if (input.servicesCovered > 0) score += 15;
  if (input.last30DaysWork > 0) score += 20;
  score -= Math.min(input.failedJobs * 5, 20);
  score -= Math.min(input.thinBanks * 5, 20);
  return Math.max(0, Math.min(100, score));
}
function riskFlags(input: RoiInput) {
  const flags: string[] = [];
  if (input.pagesLive === 0) flags.push("No pages live");
  if (input.last30DaysWork === 0) flags.push("No work in 30 days");
  if (input.failedJobs > 0) flags.push("Failed jobs");
  if (input.thinBanks > 0) flags.push("Thin banks");
  if (input.citiesCovered < 3 || input.servicesCovered < 2) flags.push("Low coverage");
  return flags;
}
function nextAction(input: RoiInput) {
  if (input.pagesLive === 0) return "Publish first page batch.";
  if (input.last30DaysWork === 0) return "Run generation or publish new batch.";
  if (input.failedJobs > 0) return "Review failed generation jobs.";
  if (input.thinBanks > 0) return "Fill missing variation sections.";
  return "Send monthly report to client.";
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_client_report_links_token ON client_report_links(token)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_client_report_links_account ON client_report_links(account_id)`);
}

function publicUrl(req: any, token: string) {
  return `${req.protocol}://${req.get("host")}/r/${token}`;
}

async function assertClientAccess(req: any, res: any, accountId: string) {
  const result = await pool.query(`SELECT id, name, status FROM accounts WHERE id::text = $1::text LIMIT 1`, [accountId]);
  const account = result.rows[0];
  if (!account) {
    res.status(404).json({ message: "Client not found" });
    return null;
  }
  if (!req.session.isSuperAdmin && req.session.accountId && String(req.session.accountId) !== String(accountId)) {
    res.status(403).json({ message: "Forbidden: no access to this client" });
    return null;
  }
  return account;
}

async function seedMissingReportLinks(req: any) {
  await ensureReportLinksTable();
  const scope = scopedWhere(req, "a");
  const accounts = await pool.query(
    `SELECT a.id
     FROM accounts a
     ${scope.where}
     ORDER BY a.created_at DESC NULLS LAST
     LIMIT 250`,
    scope.params,
  );
  for (const account of accounts.rows) {
    const existing = await pool.query(
      `SELECT id FROM client_report_links
       WHERE account_id::text = $1::text
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [account.id],
    );
    if (!existing.rows[0]) {
      await pool.query(
        `INSERT INTO client_report_links (account_id, token, expires_at, created_by)
         VALUES ($1::text, $2, NOW() + INTERVAL '90 days', $3::text)`,
        [account.id, randomBytes(24).toString("hex"), req.session.userId || null],
      );
    }
  }
}

router.get("/api/agency-dashboard/summary", async (req, res, next) => {
  try {
    const scope = scopedWhere(req, "a");
    const [clients, pages, pages30, clientsWork, cities, services, failedJobs] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM accounts a ${scope.where}`, scope.params),
      pool.query(`SELECT COUNT(*)::int AS count FROM pages p JOIN websites w ON w.id::text = p.website_id::text JOIN accounts a ON a.id::text = w.account_id::text WHERE p.status = 'published' ${scope.and}`, scope.params),
      pool.query(`SELECT COUNT(*)::int AS count FROM pages p JOIN websites w ON w.id::text = p.website_id::text JOIN accounts a ON a.id::text = w.account_id::text WHERE p.status = 'published' AND p.created_at >= NOW() - INTERVAL '30 days' ${scope.and}`, scope.params),
      pool.query(`SELECT COUNT(DISTINCT a.id)::int AS count FROM accounts a LEFT JOIN websites w ON w.account_id::text = a.id::text LEFT JOIN pages p ON p.website_id::text = w.id::text AND p.created_at >= NOW() - INTERVAL '30 days' LEFT JOIN generation_jobs gj ON gj.account_id::text = a.id::text AND gj.created_at >= NOW() - INTERVAL '30 days' ${scope.where} ${scope.where ? "AND" : "WHERE"} (p.id IS NOT NULL OR gj.id IS NOT NULL)`, scope.params),
      pool.query(`SELECT COUNT(DISTINCT l.slug)::int AS count FROM locations l JOIN accounts a ON a.id::text = l.account_id::text WHERE l.type = 'city' ${scope.and}`, scope.params),
      pool.query(`SELECT COUNT(DISTINCT s.slug)::int AS count FROM services s JOIN accounts a ON a.id::text = s.account_id::text ${scope.where}`, scope.params),
      pool.query(`SELECT COUNT(*)::int AS count FROM generation_jobs gj JOIN accounts a ON a.id::text = gj.account_id::text WHERE gj.status = 'failed' AND gj.created_at >= NOW() - INTERVAL '30 days' ${scope.and}`, scope.params),
    ]);
    const activeClients = clients.rows[0]?.count || 0;
    const pagesLive = pages.rows[0]?.count || 0;
    const pagesBuiltThisMonth = pages30.rows[0]?.count || 0;
    const clientsWithNewWork = clientsWork.rows[0]?.count || 0;
    const citiesCovered = cities.rows[0]?.count || 0;
    const servicesCovered = services.rows[0]?.count || 0;
    const failed = failedJobs.rows[0]?.count || 0;
    res.json({ activeClients, pagesLive, pagesBuiltThisMonth, clientsWithNewWork, failedJobs: failed, clientsAtRisk: Math.min(activeClients, failed + (pagesLive === 0 ? activeClients : 0)), reportsReady: activeClients, citiesCovered, servicesCovered, estimatedSearchReach: searchReachEstimate(pagesLive, citiesCovered, servicesCovered) });
  } catch (err) { next(err); }
});

router.get("/api/agency-dashboard/clients", async (req, res, next) => {
  try {
    const scope = scopedWhere(req, "a");
    const result = await pool.query(
      `WITH page_counts AS (
         SELECT w.account_id::text AS account_id,
                COUNT(p.id)::int AS pages_live,
                COUNT(CASE WHEN p.created_at >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS pages_30d
         FROM websites w
         LEFT JOIN pages p ON p.website_id::text = w.id::text AND p.status = 'published'
         GROUP BY w.account_id::text
       ), city_counts AS (
         SELECT account_id::text AS account_id, COUNT(DISTINCT slug)::int AS cities_covered
         FROM locations WHERE type = 'city' GROUP BY account_id::text
       ), service_counts AS (
         SELECT account_id::text AS account_id, COUNT(DISTINCT slug)::int AS services_covered
         FROM services GROUP BY account_id::text
       ), job_counts AS (
         SELECT account_id::text AS account_id,
                COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS jobs_30d,
                COUNT(CASE WHEN status = 'failed' AND created_at >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS failed_jobs_30d,
                MAX(created_at) AS last_job_date
         FROM generation_jobs GROUP BY account_id::text
       )
       SELECT a.id, a.name, a.status,
              COALESCE(pc.pages_live,0)::int AS pages_live,
              COALESCE(pc.pages_30d,0)::int AS pages_30d,
              COALESCE(cc.cities_covered,0)::int AS cities_covered,
              COALESCE(sc.services_covered,0)::int AS services_covered,
              COALESCE(jc.jobs_30d,0)::int AS jobs_30d,
              COALESCE(jc.failed_jobs_30d,0)::int AS failed_jobs_30d,
              jc.last_job_date,
              MAX(w.updated_at) AS last_activity_at
       FROM accounts a
       LEFT JOIN websites w ON w.account_id::text = a.id::text
       LEFT JOIN page_counts pc ON pc.account_id = a.id::text
       LEFT JOIN city_counts cc ON cc.account_id = a.id::text
       LEFT JOIN service_counts sc ON sc.account_id = a.id::text
       LEFT JOIN job_counts jc ON jc.account_id = a.id::text
       ${scope.where}
       GROUP BY a.id, a.name, a.status, pc.pages_live, pc.pages_30d, cc.cities_covered, sc.services_covered, jc.jobs_30d, jc.failed_jobs_30d, jc.last_job_date
       ORDER BY COALESCE(pc.pages_live,0) DESC, a.name ASC
       LIMIT 250`,
      scope.params,
    );
    res.json(result.rows.map((r: any) => {
      const last30DaysWork = Number(r.pages_30d || 0) + Number(r.jobs_30d || 0);
      const input = { pagesLive: Number(r.pages_live || 0), citiesCovered: Number(r.cities_covered || 0), servicesCovered: Number(r.services_covered || 0), last30DaysWork, failedJobs: Number(r.failed_jobs_30d || 0), thinBanks: 0 };
      return { id: r.id, name: r.name, status: r.status, pagesLive: input.pagesLive, pagesBuiltThisMonth: Number(r.pages_30d || 0), citiesCovered: input.citiesCovered, servicesCovered: input.servicesCovered, estimatedSearchReach: searchReachEstimate(input.pagesLive, input.citiesCovered, input.servicesCovered), last30DaysWork, failedJobs: input.failedJobs, thinBanks: 0, roiScore: roiScore(input), churnRiskFlags: riskFlags(input), recommendedNextAction: nextAction(input), lastJobDate: r.last_job_date, lastActivityAt: r.last_activity_at };
    }));
  } catch (err) { next(err); }
});

router.get("/api/agency-dashboard/clients/:accountId", async (req, res, next) => {
  try {
    const account = await assertClientAccess(req, res, req.params.accountId);
    if (!account) return;
    const accountId = req.params.accountId;
    const [summary, pageTypes, topCities, topServices, workLog, websites, health] = await Promise.all([
      pool.query(`SELECT
        (SELECT COUNT(*)::int FROM pages p JOIN websites w ON w.id::text = p.website_id::text WHERE w.account_id::text = $1::text AND p.status = 'published') AS pages_live,
        (SELECT COUNT(*)::int FROM pages p JOIN websites w ON w.id::text = p.website_id::text WHERE w.account_id::text = $1::text AND p.status = 'published' AND p.created_at >= NOW() - INTERVAL '30 days') AS pages_30d,
        (SELECT COUNT(DISTINCT slug)::int FROM locations WHERE account_id::text = $1::text AND type = 'city') AS cities_covered,
        (SELECT COUNT(DISTINCT slug)::int FROM services WHERE account_id::text = $1::text) AS services_covered`, [accountId]),
      pool.query(`SELECT p.page_type, COUNT(*)::int AS count FROM pages p JOIN websites w ON w.id::text = p.website_id::text WHERE w.account_id::text = $1::text AND p.status = 'published' GROUP BY p.page_type ORDER BY count DESC`, [accountId]),
      pool.query(`SELECT name, state_code, population FROM locations WHERE account_id::text = $1::text AND type = 'city' ORDER BY COALESCE(population,0) DESC LIMIT 12`, [accountId]),
      pool.query(`SELECT s.name, s.slug, COUNT(p.id)::int AS pages_live FROM services s LEFT JOIN pages p ON p.service_id::text = s.id::text AND p.status = 'published' WHERE s.account_id::text = $1::text GROUP BY s.name, s.slug ORDER BY pages_live DESC, s.name ASC LIMIT 12`, [accountId]),
      pool.query(`SELECT 'page' AS type, p.title AS label, p.slug AS detail, p.created_at FROM pages p JOIN websites w ON w.id::text = p.website_id::text WHERE w.account_id::text = $1::text AND p.created_at >= NOW() - INTERVAL '30 days' UNION ALL SELECT 'job' AS type, gj.name AS label, gj.status::text AS detail, gj.created_at FROM generation_jobs gj WHERE gj.account_id::text = $1::text UNION ALL SELECT 'link' AS type, 'Internal link added' AS label, il.link_type AS detail, il.created_at FROM internal_links il JOIN websites w ON w.id::text = il.website_id::text WHERE w.account_id::text = $1::text AND il.created_at >= NOW() - INTERVAL '30 days' ORDER BY created_at DESC LIMIT 30`, [accountId]),
      pool.query(`SELECT id, name, domain, status, onboarding_status FROM websites WHERE account_id::text = $1::text ORDER BY created_at DESC`, [accountId]),
      pool.query(`SELECT
        (SELECT COUNT(*)::int FROM generation_jobs WHERE account_id::text = $1::text AND status = 'failed' AND created_at >= NOW() - INTERVAL '30 days') AS failed_jobs,
        (SELECT COUNT(*)::int FROM generation_jobs WHERE account_id::text = $1::text AND status IN ('pending','running') AND created_at < NOW() - INTERVAL '30 minutes') AS stuck_jobs,
        (SELECT MAX(created_at) FROM generation_jobs WHERE account_id::text = $1::text) AS last_job_date,
        (SELECT COUNT(*)::int FROM variation_bank_completeness vbc JOIN websites w ON w.id::text = vbc.website_id::text WHERE w.account_id::text = $1::text AND vbc.completeness_score < 70) AS thin_banks`, [accountId]),
    ]);

    const s = summary.rows[0] || {};
    const pagesLive = Number(s.pages_live || 0);
    const pagesBuiltThisMonth = Number(s.pages_30d || 0);
    const citiesCovered = Number(s.cities_covered || 0);
    const servicesCovered = Number(s.services_covered || 0);
    const h = health.rows[0] || {};
    const failedJobs = Number(h.failed_jobs || 0);
    const thinBanks = Number(h.thin_banks || 0);
    const last30DaysWork = workLog.rows.length;
    const input = { pagesLive, citiesCovered, servicesCovered, last30DaysWork, failedJobs, thinBanks };
    const flags = riskFlags(input);
    const warnings = [...flags];
    if (Number(h.stuck_jobs || 0) > 0) warnings.push(`${h.stuck_jobs} stuck jobs older than 30 minutes`);

    res.json({
      client: { id: account.id, name: account.name, status: account.status },
      summary: { pagesLive, pagesBuiltThisMonth, citiesCovered, servicesCovered, estimatedSearchReach: searchReachEstimate(pagesLive, citiesCovered, servicesCovered), roiScore: roiScore(input), last30DaysWork, failedJobs, thinBanks, lastJobDate: h.last_job_date, churnRiskFlags: flags, recommendedNextAction: nextAction(input) },
      websites: websites.rows,
      pageTypes: Object.fromEntries(pageTypes.rows.map((r: any) => [r.page_type || "unknown", r.count])),
      topCities: topCities.rows,
      topServices: topServices.rows,
      workLog: workLog.rows.map((r: any) => ({ type: r.type, label: r.label, detail: r.detail, createdAt: r.created_at })),
      expansionOpportunities: topCities.rows.slice(0, 8).map((r: any) => ({ city: r.name, state: r.state_code, reason: "Expand service and problem-intent coverage in this high-value market.", population: r.population })),
      health: { failedJobs, stuckJobs: Number(h.stuck_jobs || 0), thinBanks, warnings, churnRiskFlags: flags, recommendedNextAction: nextAction(input), roiScore: roiScore(input), lastJobDate: h.last_job_date },
      searchConsole: { connected: false, status: "not_configured", recommendedAction: "Connect Google Search Console property." },
    });
  } catch (err) { next(err); }
});

router.get("/api/agency-dashboard/report-links", async (req, res, next) => {
  try {
    await seedMissingReportLinks(req);
    const scope = scopedWhere(req, "a");
    const result = await pool.query(
      `SELECT crl.id, crl.account_id, a.name AS client_name, crl.token, crl.report_type,
              crl.expires_at, crl.revoked_at, crl.created_at, crl.last_viewed_at, crl.view_count,
              CASE WHEN crl.revoked_at IS NOT NULL THEN 'revoked'
                   WHEN crl.expires_at IS NOT NULL AND crl.expires_at <= NOW() THEN 'expired'
                   ELSE 'active' END AS status
       FROM client_report_links crl
       JOIN accounts a ON a.id::text = crl.account_id::text
       ${scope.where}
       ORDER BY crl.created_at DESC
       LIMIT 250`,
      scope.params,
    );
    res.json(result.rows.map((r: any) => ({ id: r.id, accountId: r.account_id, clientName: r.client_name, token: r.token, url: publicUrl(req, r.token), reportType: r.report_type, expiresAt: r.expires_at, revokedAt: r.revoked_at, createdAt: r.created_at, lastViewedAt: r.last_viewed_at, viewCount: r.view_count || 0, status: r.status })));
  } catch (err) { next(err); }
});

export default router;
