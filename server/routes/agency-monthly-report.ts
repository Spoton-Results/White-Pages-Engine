import { Router } from "express";
import { randomBytes } from "crypto";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();

type RoiInputs = { pagesLive: number; citiesCovered: number; servicesCovered: number; last30DaysWork: number; failedJobs: number; thinBanks: number };

function fmt(value: number) { return Math.round(value || 0).toLocaleString(); }
function compact(value: number) { if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M+`; if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K+`; return fmt(value); }
function searchReachEstimate(pagesLive: number, citiesCovered: number, servicesCovered: number) { return Math.round((pagesLive * 35) + (citiesCovered * 120) + (servicesCovered * 450)); }
function esc(value: unknown) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char] as string)); }
function calculateRoiScore(input: RoiInputs) { let score = 0; if (input.pagesLive > 0) score += 25; if (input.pagesLive >= 100) score += 10; if (input.pagesLive >= 500) score += 10; if (input.citiesCovered > 0) score += 15; if (input.servicesCovered > 0) score += 15; if (input.last30DaysWork > 0) score += 20; score -= Math.min(input.failedJobs * 5, 20); score -= Math.min(input.thinBanks * 5, 20); return Math.max(0, Math.min(100, score)); }
function getChurnRiskFlags(input: RoiInputs) { const flags: string[] = []; if (input.pagesLive === 0) flags.push("No pages live"); if (input.last30DaysWork === 0) flags.push("No work in 30 days"); if (input.failedJobs > 0) flags.push("Failed jobs"); if (input.thinBanks > 0) flags.push("Thin banks"); if (input.citiesCovered < 3 || input.servicesCovered < 2) flags.push("Low coverage"); return flags; }
function getRecommendedNextAction(input: RoiInputs) { if (input.pagesLive === 0) return "Publish first page batch."; if (input.last30DaysWork === 0) return "Run generation or publish new batch."; if (input.failedJobs > 0) return "Review failed generation jobs."; if (input.thinBanks > 0) return "Fill missing variation sections."; return "Send monthly report to client."; }

async function ensureReportLinksTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS client_report_links (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id UUID NOT NULL, token TEXT NOT NULL UNIQUE, report_type TEXT NOT NULL DEFAULT 'monthly_visibility', expires_at TIMESTAMP, revoked_at TIMESTAMP, created_by UUID, created_at TIMESTAMP DEFAULT NOW(), last_viewed_at TIMESTAMP, view_count INTEGER DEFAULT 0)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_client_report_links_token ON client_report_links(token)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_client_report_links_account ON client_report_links(account_id)`);
}

async function assertClientAccess(req: any, res: any, accountId: string) {
  const result = await pool.query(`SELECT id, name, status FROM accounts WHERE id = $1 LIMIT 1`, [accountId]);
  const account = result.rows[0];
  if (!account) { res.status(404).send("Client not found"); return null; }
  if (!req.session.isSuperAdmin && req.session.accountId !== accountId) { res.status(403).send("Forbidden"); return null; }
  return account;
}

async function assertLinkAccess(req: any, res: any, linkId: string) {
  await ensureReportLinksTable();
  const result = await pool.query(`SELECT crl.*, a.name AS account_name FROM client_report_links crl JOIN accounts a ON a.id::text = crl.account_id::text WHERE crl.id = $1 LIMIT 1`, [linkId]);
  const link = result.rows[0];
  if (!link) { res.status(404).json({ message: "Report link not found" }); return null; }
  if (!req.session.isSuperAdmin && req.session.accountId !== link.account_id) { res.status(403).json({ message: "Forbidden" }); return null; }
  return link;
}

function publicUrl(req: any, token: string) { return `${req.protocol}://${req.get("host")}/r/${token}`; }
function rowsHtml(rows: any[], empty: string, render: (row: any) => string) { return rows.length ? rows.map(render).join("") : `<div class="small">${esc(empty)}</div>`; }

async function renderMonthlyReport(accountId: string, options: { publicView?: boolean } = {}) {
  const accountResult = await pool.query(`SELECT id, name, status FROM accounts WHERE id = $1 LIMIT 1`, [accountId]);
  const account = accountResult.rows[0];
  if (!account) return null;

  const [summary, pageTypes, topCities, topServices, workLog, websites] = await Promise.all([
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM pages p JOIN websites w ON w.id = p.website_id WHERE w.account_id = $1 AND p.status = 'published') AS pages_live,
      (SELECT COUNT(DISTINCT slug)::int FROM locations WHERE account_id = $1 AND type = 'city') AS cities_covered,
      (SELECT COUNT(DISTINCT slug)::int FROM services WHERE account_id = $1) AS services_covered,
      (SELECT COUNT(*)::int FROM pages p JOIN websites w ON w.id = p.website_id WHERE w.account_id = $1 AND p.status = 'published' AND p.created_at >= NOW() - INTERVAL '30 days') AS pages_30d,
      (SELECT COUNT(*)::int FROM internal_links il JOIN websites w ON w.id = il.website_id WHERE w.account_id = $1 AND il.created_at >= NOW() - INTERVAL '30 days') AS links_30d,
      (SELECT COUNT(*)::int FROM generation_jobs WHERE account_id = $1 AND settings->>'type' = 'intent_page_improvement' AND created_at >= NOW() - INTERVAL '30 days') AS improvements_30d,
      (SELECT COUNT(*)::int FROM sitemaps sm JOIN websites w ON w.id = sm.website_id WHERE w.account_id = $1 AND sm.updated_at >= NOW() - INTERVAL '30 days') AS sitemap_updates_30d,
      (SELECT COUNT(*)::int FROM generation_jobs WHERE account_id = $1 AND status = 'failed' AND created_at >= NOW() - INTERVAL '30 days') AS failed_jobs,
      (SELECT COUNT(*)::int FROM generation_jobs WHERE account_id = $1 AND status IN ('pending','running') AND created_at < NOW() - INTERVAL '30 minutes') AS stuck_jobs,
      (SELECT COUNT(*)::int FROM variation_bank_completeness vbc JOIN websites w ON w.id = vbc.website_id WHERE w.account_id = $1 AND vbc.completeness_score < 70) AS thin_banks`, [accountId]),
    pool.query(`SELECT p.page_type, COUNT(*)::int AS count FROM pages p JOIN websites w ON w.id = p.website_id WHERE w.account_id = $1 AND p.status = 'published' GROUP BY p.page_type ORDER BY count DESC`, [accountId]),
    pool.query(`SELECT name, state_code, population FROM locations WHERE account_id = $1 AND type = 'city' ORDER BY COALESCE(population,0) DESC LIMIT 8`, [accountId]),
    pool.query(`SELECT s.name, COUNT(p.id)::int AS pages_live FROM services s LEFT JOIN pages p ON p.service_id = s.id AND p.status = 'published' WHERE s.account_id = $1 GROUP BY s.name ORDER BY pages_live DESC, s.name ASC LIMIT 8`, [accountId]),
    pool.query(`SELECT 'Page created' AS type, p.title AS label, p.slug AS detail, p.created_at FROM pages p JOIN websites w ON w.id = p.website_id WHERE w.account_id = $1 AND p.created_at >= NOW() - INTERVAL '30 days' UNION ALL SELECT 'Job processed' AS type, gj.name AS label, gj.status::text AS detail, gj.created_at FROM generation_jobs gj WHERE gj.account_id = $1 AND gj.created_at >= NOW() - INTERVAL '30 days' UNION ALL SELECT 'Internal link added' AS type, 'Internal link added' AS label, il.link_type AS detail, il.created_at FROM internal_links il JOIN websites w ON w.id = il.website_id WHERE w.account_id = $1 AND il.created_at >= NOW() - INTERVAL '30 days' ORDER BY created_at DESC LIMIT 20`, [accountId]),
    pool.query(`SELECT name, domain, status FROM websites WHERE account_id = $1 ORDER BY created_at DESC`, [accountId]),
  ]);

  const s = summary.rows[0] || {};
  const pagesLive = Number(s.pages_live || 0);
  const pages30d = Number(s.pages_30d || 0);
  const links30d = Number(s.links_30d || 0);
  const improvements30d = Number(s.improvements_30d || 0);
  const sitemapUpdates30d = Number(s.sitemap_updates_30d || 0);
  const citiesCovered = Number(s.cities_covered || 0);
  const servicesCovered = Number(s.services_covered || 0);
  const failedJobs = Number(s.failed_jobs || 0);
  const stuckJobs = Number(s.stuck_jobs || 0);
  const thinBanks = Number(s.thin_banks || 0);
  const workTotal = pages30d + links30d + improvements30d + sitemapUpdates30d;
  const estimatedReach = searchReachEstimate(pagesLive, citiesCovered, servicesCovered);
  const roiInput = { pagesLive, citiesCovered, servicesCovered, last30DaysWork: workTotal, failedJobs, thinBanks };
  const roiScore = calculateRoiScore(roiInput);
  const churnFlags = getChurnRiskFlags(roiInput);
  if (stuckJobs > 0) churnFlags.push("Stuck jobs");
  const recommendedNextAction = getRecommendedNextAction(roiInput);
  const healthClass = churnFlags.length ? "warning" : "healthy";
  const reportMonth = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(account.name)} Monthly Visibility Report</title><style>
  body{font-family:Inter,Arial,sans-serif;margin:0;background:#f8fafc;color:#0f172a}.wrap{max-width:1080px;margin:0 auto;padding:36px}.hero{background:linear-gradient(135deg,#020617,#312e81);color:white;border-radius:26px;padding:34px;margin-bottom:22px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#c7d2fe}.title{font-size:40px;font-weight:900;margin:10px 0}.sub{color:#dbeafe;line-height:1.6;max-width:780px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.card{background:white;border:1px solid #e5e7eb;border-radius:18px;padding:18px;box-shadow:0 8px 24px rgba(15,23,42,.04)}.metric{font-size:31px;font-weight:900}.label{font-size:12px;color:#64748b;margin-top:5px}.section{margin-top:22px}.section h2{font-size:20px;margin:0 0 12px}.pill{display:inline-block;border-radius:999px;padding:7px 11px;background:#ecfdf5;color:#065f46;font-size:12px;font-weight:800;margin:3px}.pill.warn{background:#fffbeb;color:#92400e}.pill.red{background:#fee2e2;color:#991b1b}.warning{background:#fffbeb;border-color:#fde68a;color:#92400e}.healthy{background:#f0fdf4;border-color:#bbf7d0;color:#166534}.list{display:grid;gap:10px}.row{display:flex;justify-content:space-between;gap:14px;border:1px solid #e5e7eb;background:#fff;border-radius:12px;padding:12px}.small{font-size:12px;color:#64748b}.score{font-size:54px;font-weight:900;line-height:1}.print{position:fixed;right:24px;bottom:24px;background:#111827;color:white;border:0;border-radius:999px;padding:12px 18px;font-weight:800;cursor:pointer}.public{display:inline-block;margin-left:8px;border-radius:999px;background:#eef2ff;color:#3730a3;padding:4px 8px;font-size:11px;font-weight:800}@media(max-width:760px){.grid,.grid3{grid-template-columns:1fr}.wrap{padding:18px}.title{font-size:30px}.print{position:static;margin:18px}}@media print{.print{display:none}.wrap{padding:0}.card,.hero{box-shadow:none}}
</style></head><body><button class="print" onclick="window.print()">Print / Save PDF</button><div class="wrap">
  <div class="hero"><div class="eyebrow">Monthly Visibility Report · ${esc(reportMonth)}${options.publicView ? `<span class="public">Shared Report</span>` : ""}</div><div class="title">${esc(account.name)}</div><p class="sub">Here’s what we built for your local search footprint this month: pages live, coverage gained, infrastructure work completed, and the next best action.</p></div>
  <div class="grid3"><div class="card"><div class="label">ROI Score</div><div class="score">${roiScore}</div><div class="label">out of 100</div></div><div class="card ${healthClass}"><div class="label">Health Status</div><div class="metric">${churnFlags.length ? "Needs Attention" : "Healthy"}</div><div>${churnFlags.length ? churnFlags.map(f => `<span class="pill warn">${esc(f)}</span>`).join("") : `<span class="pill">No churn-risk flags</span>`}</div></div><div class="card"><div class="label">Recommended Next Action</div><div class="metric" style="font-size:22px;line-height:1.25">${esc(recommendedNextAction)}</div></div></div>
  <div class="section grid"><div class="card"><div class="metric">${fmt(pagesLive)}</div><div class="label">Pages Live</div></div><div class="card"><div class="metric">${fmt(citiesCovered)}</div><div class="label">Cities Covered</div></div><div class="card"><div class="metric">${fmt(servicesCovered)}</div><div class="label">Services Covered</div></div><div class="card"><div class="metric">${compact(estimatedReach)}</div><div class="label">Estimated Local Search Reach</div></div></div>
  <div class="section card"><h2>What We Built This Month</h2><div class="grid"><div><div class="metric">${fmt(pages30d)}</div><div class="label">Pages Generated</div></div><div><div class="metric">${fmt(links30d)}</div><div class="label">Links Added</div></div><div><div class="metric">${fmt(improvements30d)}</div><div class="label">Pages Improved</div></div><div><div class="metric">${fmt(sitemapUpdates30d)}</div><div class="label">Sitemap Updates</div></div></div><p class="small">Total visible work actions this period: <strong>${fmt(workTotal)}</strong></p></div>
  <div class="section card"><h2>Search Architecture Coverage</h2><div class="list">${rowsHtml(pageTypes.rows, "No page type data yet.", (r:any)=>`<div class="row"><span>${esc(r.page_type || "Other")}</span><strong>${fmt(r.count)}</strong></div>`)}</div></div>
  <div class="section card"><h2>Top Services</h2><div class="list">${rowsHtml(topServices.rows, "No service data yet.", (r:any)=>`<div class="row"><span>${esc(r.name)}</span><strong>${fmt(r.pages_live)} pages</strong></div>`)}</div></div>
  <div class="section card"><h2>Top Expansion Markets</h2><div class="list">${rowsHtml(topCities.rows, "No city data yet.", (r:any)=>`<div class="row"><span>${esc(r.name)}, ${esc(r.state_code)}</span><span class="small">Population: ${fmt(r.population)}</span></div>`)}</div></div>
  <div class="section card"><h2>Recent Work Log</h2><div class="list">${rowsHtml(workLog.rows, "No recent work log yet.", (r:any)=>`<div class="row"><span><strong>${esc(r.type)}</strong><br><span class="small">${esc(r.label)} · ${esc(r.detail)}</span></span><span class="small">${new Date(r.created_at).toLocaleDateString()}</span></div>`)}</div></div>
  <div class="section card ${healthClass}"><h2>Infrastructure Health</h2>${churnFlags.length ? churnFlags.map(f=>`<span class="pill warn">${esc(f)}</span>`).join("") : `<span class="pill">No major health warnings found</span>`}<div class="small" style="margin-top:10px">Failed jobs: ${fmt(failedJobs)} · Thin banks: ${fmt(thinBanks)} · Stuck jobs: ${fmt(stuckJobs)}</div></div>
  <div class="section card"><h2>Websites Monitored</h2><div class="list">${rowsHtml(websites.rows, "No websites found.", (w:any)=>`<div class="row"><span>${esc(w.name)}<br><span class="small">${esc(w.domain)}</span></span><strong>${esc(w.status)}</strong></div>`)}</div></div>
</div></body></html>`;
}

router.get("/api/agency-dashboard/clients/:accountId/monthly-report", requireAuth, async (req, res, next) => { try { const account = await assertClientAccess(req, res, req.params.accountId); if (!account) return; const html = await renderMonthlyReport(req.params.accountId); if (!html) return res.status(404).send("Client not found"); res.setHeader("Content-Type", "text/html; charset=utf-8"); res.send(html); } catch (err) { next(err); } });
router.post("/api/agency-dashboard/clients/:accountId/monthly-report/share", requireAuth, async (req, res, next) => { try { await ensureReportLinksTable(); const account = await assertClientAccess(req, res, req.params.accountId); if (!account) return; const token = randomBytes(24).toString("hex"); const expiresDays = Math.max(1, Math.min(365, Number(req.body?.expiresDays || 90))); await pool.query(`INSERT INTO client_report_links (account_id, token, expires_at, created_by) VALUES ($1::text, $2, NOW() + ($3 || ' days')::interval, $4)`, [req.params.accountId, token, expiresDays, req.session.userId || null]); res.json({ ok: true, token, url: publicUrl(req, token), expiresDays }); } catch (err) { next(err); } });
router.get("/api/agency-dashboard/report-links", requireAuth, async (req, res, next) => { try { await ensureReportLinksTable(); const params: any[] = []; const where = req.session.isSuperAdmin ? "" : "WHERE crl.account_id::text = $1::text"; if (!req.session.isSuperAdmin) params.push(req.session.accountId); const result = await pool.query(`SELECT crl.id, crl.account_id, a.name AS client_name, crl.token, crl.report_type, crl.expires_at, crl.revoked_at, crl.created_at, crl.last_viewed_at, crl.view_count, CASE WHEN crl.revoked_at IS NOT NULL THEN 'revoked' WHEN crl.expires_at IS NOT NULL AND crl.expires_at <= NOW() THEN 'expired' ELSE 'active' END AS status FROM client_report_links crl JOIN accounts a ON a.id::text = crl.account_id::text ${where} ORDER BY crl.created_at DESC LIMIT 250`, params); res.json(result.rows.map((r: any) => ({ id: r.id, accountId: r.account_id, clientName: r.client_name, token: r.token, url: publicUrl(req, r.token), reportType: r.report_type, expiresAt: r.expires_at, revokedAt: r.revoked_at, createdAt: r.created_at, lastViewedAt: r.last_viewed_at, viewCount: r.view_count || 0, status: r.status }))); } catch (err) { next(err); } });
router.post("/api/agency-dashboard/report-links/:linkId/revoke", requireAuth, async (req, res, next) => { try { const link = await assertLinkAccess(req, res, req.params.linkId); if (!link) return; await pool.query(`UPDATE client_report_links SET revoked_at = NOW() WHERE id = $1`, [req.params.linkId]); res.json({ ok: true, id: req.params.linkId, status: "revoked" }); } catch (err) { next(err); } });
router.post("/api/agency-dashboard/report-links/:linkId/regenerate", requireAuth, async (req, res, next) => { try { const link = await assertLinkAccess(req, res, req.params.linkId); if (!link) return; await pool.query(`UPDATE client_report_links SET revoked_at = NOW() WHERE id = $1`, [req.params.linkId]); const token = randomBytes(24).toString("hex"); const expiresDays = Math.max(1, Math.min(365, Number(req.body?.expiresDays || 90))); const created = await pool.query(`INSERT INTO client_report_links (account_id, token, expires_at, created_by) VALUES ($1::text, $2, NOW() + ($3 || ' days')::interval, $4) RETURNING id, token, expires_at, created_at`, [link.account_id, token, expiresDays, req.session.userId || null]); res.json({ ok: true, oldLinkId: req.params.linkId, id: created.rows[0].id, token, url: publicUrl(req, token), expiresAt: created.rows[0].expires_at, createdAt: created.rows[0].created_at }); } catch (err) { next(err); } });
router.get("/r/:token", async (req, res, next) => { try { await ensureReportLinksTable(); const result = await pool.query(`SELECT * FROM client_report_links WHERE token = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`, [String(req.params.token || "")]); const link = result.rows[0]; if (!link) return res.status(404).send("Report link not found or expired"); await pool.query(`UPDATE client_report_links SET view_count = view_count + 1, last_viewed_at = NOW() WHERE id = $1`, [link.id]); const html = await renderMonthlyReport(link.account_id, { publicView: true }); if (!html) return res.status(404).send("Client not found"); res.setHeader("Content-Type", "text/html; charset=utf-8"); res.send(html); } catch (err) { next(err); } });

export default router;
