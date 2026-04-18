// ═══════════════════════════════════════════════════════════════════════════
// PHASE 9 — Launch Health Score
// ═══════════════════════════════════════════════════════════════════════════
// Measures whether a published site is performing well enough to scale up.
// DIFFERENT from the onboarding readiness score (which gates START).
// Score 0-100 stored historically in launch_health_scores.
// ═══════════════════════════════════════════════════════════════════════════

import { db } from "../db";
import { sql } from "drizzle-orm";
import * as storage from "../storage";
import { computeBankCompleteness } from "./scoring";

export interface HealthBreakdown {
  tier1_performance: { score: number; max: number; notes: string };
  average_quality: { score: number; max: number; notes: string };
  content_completeness: { score: number; max: number; notes: string };
  duplicate_health: { score: number; max: number; notes: string };
  site_age: { score: number; max: number; notes: string };
  index_coverage: { score: number; max: number; notes: string };
  total: number;
  max: number;
  message: string;
}

function messageForScore(s: number): string {
  if (s >= 70) return "Your site is performing well. More pages will be promoted as performance data comes in.";
  if (s >= 50) return "Your site is building momentum. Some pages need more time to prove themselves.";
  return "Your site needs attention. We are holding back new pages until existing ones show activity.";
}

export async function calculateLaunchHealthScore(websiteId: string): Promise<HealthBreakdown> {
  const website = await storage.getWebsite(websiteId);
  if (!website) throw new Error("website not found");

  const fp = (website as any).firstPublishAt as Date | null;
  const daysSinceLaunch = fp ? Math.floor((Date.now() - new Date(fp).getTime()) / (24 * 3600 * 1000)) : 0;

  // ── Tier 1 performance (25) ──
  const tier1 = { score: 0, max: 25, notes: "" };
  const [t1Row] = (await db.execute(sql`
    SELECT COUNT(*)::int AS total,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM page_metrics pm WHERE pm.page_id = p.id AND pm.impressions > 0 AND pm.created_at >= NOW() - INTERVAL '14 days') THEN 1 ELSE 0 END)::int AS with_imp
    FROM pages p
    WHERE p.website_id = ${websiteId} AND p.is_draft = false AND p.tier = 1
  `).then((r: any) => (r.rows ? r.rows : r)).catch(() => [{ total: 0, with_imp: 0 }])) as any;
  const t1Total = t1Row?.total || 0;
  const t1WithImp = t1Row?.with_imp || 0;
  if (t1Total === 0) {
    tier1.score = daysSinceLaunch > 14 ? 15 : 10;
    tier1.notes = "No Tier 1 pages yet — using time-based estimate.";
  } else {
    const pct = t1WithImp / t1Total;
    if (pct > 0.5) { tier1.score = 25; tier1.notes = `${Math.round(pct * 100)}% of Tier 1 pages have impressions.`; }
    else if (pct >= 0.25) { tier1.score = 15; tier1.notes = `${Math.round(pct * 100)}% of Tier 1 pages have impressions.`; }
    else if (pct > 0) { tier1.score = 5; tier1.notes = `Only ${Math.round(pct * 100)}% of Tier 1 pages have impressions.`; }
    else {
      tier1.score = daysSinceLaunch > 14 ? 15 : 10;
      tier1.notes = "No impression data available yet — using time-based estimate.";
    }
  }

  // ── Average quality (20) ──
  const avgQ = { score: 0, max: 20, notes: "" };
  const [qRow] = (await db.execute(sql`
    SELECT AVG(quality_score)::float AS avg FROM pages
    WHERE website_id = ${websiteId} AND is_draft = false AND quality_score IS NOT NULL
  `).then((r: any) => (r.rows ? r.rows : r))) as any;
  const avg = qRow?.avg ? Math.round(qRow.avg) : 0;
  if (avg > 80) avgQ.score = 20;
  else if (avg >= 65) avgQ.score = 15;
  else if (avg >= 55) avgQ.score = 10;
  else avgQ.score = 0;
  avgQ.notes = `Average page quality: ${avg}/100`;

  // ── Content completeness (15) ──
  const cc = { score: 0, max: 15, notes: "" };
  try {
    const services = website.accountId ? await storage.getServices(website.accountId) : [];
    let totalCompleteness = 0;
    let serviceCount = 0;
    for (const svc of services) {
      const banks = await storage.getVariationBanks(websiteId, svc.name);
      if (banks.length > 0) {
        const r = computeBankCompleteness(banks);
        totalCompleteness += r.completenessScore || 0;
        serviceCount++;
      }
    }
    const avgC = serviceCount > 0 ? totalCompleteness / serviceCount : 0;
    if (avgC > 80) cc.score = 15;
    else if (avgC >= 60) cc.score = 10;
    else cc.score = 5;
    cc.notes = `Content completeness: ${Math.round(avgC)}%`;
  } catch {
    cc.score = 5;
    cc.notes = "Content completeness unavailable.";
  }

  // ── Duplicate health (10) ──
  const dh = { score: 0, max: 10, notes: "" };
  const [dupRow] = (await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM pages WHERE website_id = ${websiteId} AND duplicate_flag = true
  `).then((r: any) => (r.rows ? r.rows : r))) as any;
  const dupCount = dupRow?.cnt || 0;
  if (dupCount === 0) dh.score = 10;
  else if (dupCount <= 5) dh.score = 5;
  else dh.score = 0;
  dh.notes = `${dupCount} duplicate(s) flagged.`;

  // ── Site age (15) ──
  const age = { score: 0, max: 15, notes: "" };
  if (daysSinceLaunch > 60) age.score = 15;
  else if (daysSinceLaunch >= 30) age.score = 10;
  else age.score = 5;
  age.notes = `${daysSinceLaunch} day(s) since first publish.`;

  // ── Index coverage (15) ──
  const idx = { score: 0, max: 15, notes: "" };
  const [subRow] = (await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM pages
    WHERE website_id = ${websiteId} AND gsc_submitted_at IS NOT NULL
  `).then((r: any) => (r.rows ? r.rows : r))) as any;
  const submitted = subRow?.cnt || 0;
  if (submitted > 0) { idx.score = 10; idx.notes = `${submitted} page(s) submitted for search engine review.`; }
  else { idx.score = 5; idx.notes = "No pages submitted for search engine review yet."; }

  const total = tier1.score + avgQ.score + cc.score + dh.score + age.score + idx.score;
  const breakdown: HealthBreakdown = {
    tier1_performance: tier1,
    average_quality: avgQ,
    content_completeness: cc,
    duplicate_health: dh,
    site_age: age,
    index_coverage: idx,
    total,
    max: 100,
    message: messageForScore(total),
  };

  // Persist historical record
  await db.execute(sql`
    INSERT INTO launch_health_scores (website_id, score, max_score, breakdown, calculated_at)
    VALUES (${websiteId}, ${total}, 100, ${JSON.stringify(breakdown)}::jsonb, NOW())
  `);

  console.log(`[Launch Health] ${website.domain} scored ${total}/100`);
  return breakdown;
}

export async function getLatestHealthScore(websiteId: string): Promise<{ score: number; breakdown: HealthBreakdown } | null> {
  const [row] = (await db.execute(sql`
    SELECT score, breakdown FROM launch_health_scores
    WHERE website_id = ${websiteId}
    ORDER BY calculated_at DESC LIMIT 1
  `).then((r: any) => (r.rows ? r.rows : r))) as any;
  if (!row) return null;
  return { score: row.score, breakdown: row.breakdown };
}

export async function runWeeklyLaunchHealth(): Promise<void> {
  console.log("[Launch Health] Weekly calculation starting...");
  try {
    const rows = (await db.execute(sql`
      SELECT id, domain FROM websites WHERE onboarding_status = 'published_live'
    `).then((r: any) => (r.rows ? r.rows : r))) as any[];
    for (const row of rows) {
      try { await calculateLaunchHealthScore(row.id); }
      catch (err: any) { console.error(`[Launch Health] ${row.domain} failed:`, err?.message); }
    }
    console.log(`[Launch Health] Weekly run complete. ${rows.length} sites processed.`);
  } catch (err: any) {
    console.error("[Launch Health] Weekly run failed:", err?.message);
  }
}
