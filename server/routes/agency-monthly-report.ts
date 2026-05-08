import { Router } from "express";
import { randomBytes } from "crypto";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();

function fmt(value: number) {
  return Math.round(value || 0).toLocaleString();
}

function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M+`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K+`;
  return fmt(value);
}

function searchReachEstimate(pagesLive: number, citiesCovered: number, servicesCovered: number) {
  return Math.round((pagesLive * 35) + (citiesCovered * 120) + (servicesCovered * 450));
}

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char] as string));
}

async function ensureReportLinksTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_report_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id UUID NOT NULL,
      token TEXT NOT NULL UNIQUE,
      report_type TEXT NOT NULL DEFAULT 'monthly_visibility',
      expires_at TIMESTAMP,
      revoked_at TIMESTAMP,
      created_by UUID,
      created_at TIMESTAMP DEFAULT NOW(),
      last_viewed_at TIMESTAMP,
      view_count INTEGER DEFAULT 0
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_client_report_links_token ON client_report_links(token)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_client_report_links_account ON client_report_links(account_id)`);
}

async function assertClientAccess(req: any, res: any, accountId: string) {
  const result = await pool.query(`SELECT id, name, status FROM accounts WHERE id = $1 LIMIT 1`, [accountId]);
  const account = result.rows[0];
  if (!account) {
    res.status(404).send("Client not found");
    return null;
  }
  if (!req.session.isSuperAdmin && req.session.accountId !== accountId) {
    res.status(403).send("Forbidden");
    return null;
  }
  return account;
}

async function renderMonthlyReport(accountId: string, options: { publicView?: boolean } = {}) {
  const accountResult = await pool.query(`SELECT id, name, status FROM accounts WHERE id = $1 LIMIT 1`, [accountId]);
  const account = accountResult.rows[0];
  if (!account) return null;

  const [summary, pageTypes, topCities, topServices, workLog, health, websites] = await Promise.all([
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM pages p JOIN websites w ON w.id = p.website_id WHERE w.account_id = $1 AND p.status = 'published') AS pages_live,
      (SELECT COUNT(DISTINCT slug)::int FROM locations WHERE account_id = $1 AND type = 'city') AS cities_covered,
      (SELECT COUNT(DISTINCT slug)::int FROM services WHERE account_id = $1) AS services_covered,
      (SELECT COUNT(*)::int FROM pages p JOIN websites w ON w.id = p.website_id WHERE w.account_id = $1 AND p.status = 'published' AND p.created_at >= NOW() - INTERVAL '30 days') AS pages_30d,
      (SELECT COUNT(*)::int FROM internal_links il JOIN websites w ON w.id = il.website_id WHERE w.account_id = $1 AND il.created_at >= NOW() - INTERVAL '30 days') AS links_30d,
      (SELECT COUNT(*)::int FROM generation_jobs WHERE account_id = $1 AND settings->>'type' = 'intent_page_improvement' AND created_at >= NOW() - INTERVAL '30 days') AS improvements_30d,
      (SELECT COUNT(*)::int FROM sitemaps sm JOIN websites w ON w.id = sm.website_id WHERE w.account_id = $1 AND sm.updated_at >= NOW() - INTERVAL '30 days') AS sitemap_updates_30d`, [accountId]),
    pool.query(`SELECT p.page_type, COUNT(*)::int AS count FROM pages p JOIN websites w ON w.id = p.website_id WHERE w.account_id = $1 AND p.status = 'published' GROUP BY p.page_type ORDER BY count DESC`, [accountId]),
    pool.query(`SELECT name, state_code, population FROM locations WHERE account_id = $1 AND type = 'city' ORDER BY COALESCE(population,0) DESC LIMIT 8`, [accountId]),
    pool.query(`SELECT s.name, COUNT(p.id)::int AS pages_live FROM services s LEFT JOIN pages p ON p.service_id = s.id AND p.status = 'published' WHERE s.account_id = $1 GROUP BY s.name ORDER BY pages_live DESC, s.name ASC LIMIT 8`, [accountId]),
    pool.query(`SELECT 'Page created' AS type, p.title AS label, p.slug AS detail, p.created_at FROM pages p JOIN websites w ON w.id = p.website_id WHERE w.account_id = $1 AND p.created_at >= NOW() - INTERVAL '30 days' UNION ALL SELECT 'Job processed' AS type, gj.name AS label, gj.status AS detail, gj.created_at FROM generation_jobs gj WHERE gj.account_id = $1 AND gj.created_at >= NOW() - INTERVAL '30 days' UNION ALL SELECT 'Internal link added' AS type, 'Internal link added' AS label, il.link_type AS detail, il.created_at FROM internal_links il JOIN websites w ON w.id = il.website_id WHERE w.account_id = $1 AND il.created_at >= NOW() - INTERVAL '30 days' ORDER BY created_at DESC LIMIT 20`, [accountId]),
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM generation_jobs WHERE account_id = $1 AND status = 'failed' AND created_at >= NOW() - INTERVAL '30 days') AS failed_jobs,
      (SELECT COUNT(*)::int FROM generation_jobs WHERE account_id = $1 AND status IN ('pending','running') AND created_at < NOW() - INTERVAL '30 minutes') AS stuck_jobs,
      (SELECT COUNT(*)::int FROM variation_bank_completeness vbc JOIN websites w ON w.id = vbc.website_id WHERE w.account_id = $1 AND vbc.completeness_score < 70) AS thin_banks`, [accountId]),
    pool.query(`SELECT name, domain, status FROM websites WHERE account_id = $1 ORDER BY created_at DESC`, [accountId]),
  ]);

  const s = summary.rows[0] || {};
  const pagesLive = Number(s.pages_live || 0);
  const citiesCovered = Number(s.cities_covered || 0);
  const servicesCovered = Number(s.services_covered || 0);
  const estimatedReach = searchReachEstimate(pagesLive, citiesCovered, servicesCovered);
  const workTotal = Number(s.pages_30d || 0) + Number(s.links_30d || 0) + Number(s.improvements_30d || 0) + Number(s.sitemap_updates_30d || 0);
  const healthRow = health.rows[0] || {};
  const warnings = [];
  if (Number(healthRow.failed_jobs || 0) > 0) warnings.push(`${healthRow.failed_jobs} failed jobs in the last 30 days`);
  if (Number(healthRow.stuck_jobs || 0) > 0) warnings.push(`${healthRow.stuck_jobs} stuck jobs older than 30 minutes`);
  if (Number(healthRow.thin_banks || 0) > 0) warnings.push(`${healthRow.thin_banks} thin content bank sections`);
  if (pagesLive === 0) warnings.push("No published pages live yet");

  const reportMonth = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(account.name)} Monthly Visibility Report</title>
<style>
  body{font-family:Inter,Arial,sans-serif;margin:0;background:#f8fafc;color:#0f172a}.wrap{max-width:1040px;margin:0 auto;padding:36px}.hero{background:linear-gradient(135deg,#111827,#312e81);color:white;border-radius:24px;padding:34px;margin-bottom:22px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#c7d2fe}.title{font-size:38px;font-weight:800;margin:10px 0}.sub{color:#dbeafe;line-height:1.6;max-width:760px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{background:white;border:1px solid #e5e7eb;border-radius:18px;padding:18px;box-shadow:0 8px 24px rgba(15,23,42,.04)}.metric{font-size:30px;font-weight:800}.label{font-size:12px;color:#64748b;margin-top:5px}.section{margin-top:22px}.section h2{font-size:20px;margin:0 0 12px}.pill{display:inline-block;border-radius:999px;padding:6px 10px;background:#ecfdf5;color:#065f46;font-size:12px;font-weight:700}.warning{background:#fffbeb;border-color:#fde68a;color:#92400e}.list{display:grid;gap:10px}.row{display:flex;justify-content:space-between;gap:14px;border:1px solid #e5e7eb;background:#fff;border-radius:12px;padding:12px}.small{font-size:12px;color:#64748b}.print{position:fixed;right:24px;bottom:24px;background:#111827;color:white;border:0;border-radius:999px;padding:12px 18px;font-weight:700;cursor:pointer}.public{display:inline-block;margin-left:8px;border-radius:999px;background:#eef2ff;color:#3730a3;padding:4px 8px;font-size:11px;font-weight:700}@media(max-width:760px){.grid{grid-template-columns:1fr}.wrap{padding:18px}.title{font-size:30px}.print{position:static;margin:18px}}@media print{.print{display:none}.wrap{padding:0}.card,.hero{box-shadow:none}}
</style></head><body><button class="print" onclick="window.print()">Print / Save PDF</button><div class="wrap">
  <div class="hero"><div class="eyebrow">Monthly Visibility Report · ${esc(reportMonth)}${options.publicView ? `<span class="public">Shared Report</span>` : ""}</div><div class="title">${esc(account.name)}</div><p class="sub">This report summarizes the search infrastructure built, improved, linked, and monitored for this client over the last 30 days.</p></div>
  <div class="grid"><div class="card"><div class="metric">${fmt(pagesLive)}</div><div class="label">Pages Live</div></div><div class="card"><div class="metric">${fmt(citiesCovered)}</div><div class="label">Cities Covered</div></div><div class="card"><div class="metric">${fmt(servicesCovered)}</div><div class="label">Services Covered</div></div><div class="card"><div class="metric">${compact(estimatedReach)}</div><div class="label">Estimated Local Search Reach</div></div></div>
  <div class="section card"><h2>What We Built This Month</h2><div class="grid"><div><div class="metric">${fmt(s.pages_30d)}</div><div class="label">Pages Generated</div></div><div><div class="metric">${fmt(s.links_30d)}</div><div class="label">Links Added</div></div><div><div class="metric">${fmt(s.improvements_30d)}</div><div class="label">Pages Improved</div></div><div><div class="metric">${fmt(s.sitemap_updates_30d)}</div><div class="label">Sitemap Updates</div></div></div><p class="small">Total visible work actions this period: <strong>${fmt(workTotal)}</strong></p></div>
  <div class="section card"><h2>Search Architecture Coverage</h2><div class="list">${pageTypes.rows.map((r:any)=>`<div class="row"><span>${esc(r.page_type || "Other")}</span><strong>${fmt(r.count)}</strong></div>`).join("") || `<div class="small">No page type data yet.</div>`}</div></div>
  <div class="section card"><h2>Top Services</h2><div class="list">${topServices.rows.map((r:any)=>`<div class="row"><span>${esc(r.name)}</span><strong>${fmt(r.pages_live)} pages</strong></div>`).join("") || `<div class="small">No service data yet.</div>`}</div></div>
  <div class="section card"><h2>Top Expansion Markets</h2><div class="list">${topCities.rows.map((r:any)=>`<div class="row"><span>${esc(r.name)}, ${esc(r.state_code)}</span><span class="small">Population: ${fmt(r.population)}</span></div>`).join("") || `<div class="small">No city data yet.</div>`}</div></div>
  <div class="section card"><h2>Recent Work Log</h2><div class="list">${workLog.rows.map((r:any)=>`<div class="row"><span><strong>${esc(r.type)}</strong><br><span class="small">${esc(r.label)} · ${esc(r.detail)}</span></span><span class="small">${new Date(r.created_at).toLocaleDateString()}</span></div>`).join("") || `<div class="small">No recent work log yet.</div>`}</div></div>
  <div class="section card ${warnings.length ? "warning" : ""}"><h2>Infrastructure Health</h2>${warnings.length ? warnings.map(w=>`<div class="row warning"><span>${esc(w)}</span></div>`).join("") : `<span class="pill">No major health warnings found</span>`}</div>
  <div class="section card"><h2>Websites Monitored</h2><div class="list">${websites.rows.map((w:any)=>`<div class="row"><span>${esc(w.name)}<br><span class="small">${esc(w.domain)}</span></span><strong>${esc(w.status)}</strong></div>`).join("") || `<div class="small">No websites found.</div>`}</div></div>
</div></body></html>`;
}

router.get("/api/agency-dashboard/clients/:accountId/monthly-report", requireAuth, async (req, res, next) => {
  try {
    const accountId = req.params.accountId;
    const account = await assertClientAccess(req, res, accountId);
    if (!account) return;
    const html = await renderMonthlyReport(accountId);
    if (!html) return res.status(404).send("Client not found");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    next(err);
  }
});

router.post("/api/agency-dashboard/clients/:accountId/monthly-report/share", requireAuth, async (req, res, next) => {
  try {
    await ensureReportLinksTable();
    const accountId = req.params.accountId;
    const account = await assertClientAccess(req, res, accountId);
    if (!account) return;
    const token = randomBytes(24).toString("hex");
    const expiresDays = Math.max(1, Math.min(365, Number(req.body?.expiresDays || 90)));
    await pool.query(
      `INSERT INTO client_report_links (account_id, token, expires_at, created_by)
       VALUES ($1, $2, NOW() + ($3 || ' days')::interval, $4)`,
      [accountId, token, expiresDays, req.session.userId || null],
    );
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    res.json({ ok: true, token, url: `${baseUrl}/r/${token}`, expiresDays });
  } catch (err) {
    next(err);
  }
});

router.get("/r/:token", async (req, res, next) => {
  try {
    await ensureReportLinksTable();
    const token = String(req.params.token || "");
    const result = await pool.query(
      `SELECT * FROM client_report_links
       WHERE token = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [token],
    );
    const link = result.rows[0];
    if (!link) return res.status(404).send("Report link not found or expired");
    await pool.query(`UPDATE client_report_links SET view_count = view_count + 1, last_viewed_at = NOW() WHERE id = $1`, [link.id]);
    const html = await renderMonthlyReport(link.account_id, { publicView: true });
    if (!html) return res.status(404).send("Client not found");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    next(err);
  }
});

export default router;
