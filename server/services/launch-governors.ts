// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7 — Launch Governors
// ═══════════════════════════════════════════════════════════════════════════
// Four governors decide WHAT draft pages get published and WHEN.
// All governors ONLY apply to websites where warmup_mode = true.
// Manual websites (warmup_mode=false) are completely untouched.
//
// Governor 1 — Per-Service Minimum Quality Gate
// Governor 2 — Coverage Sanity Check
// Governor 3 — Launch Cap (Wave 1 Publishing)
// Governor 4 — Manual Override Lock (enforced at publish-time, see routes.ts)
//
// After Wave 1, checkWaveReadiness() runs daily for all warmup websites and
// unlocks Wave 2+ on a 14-day cadence.
// ═══════════════════════════════════════════════════════════════════════════

import { db } from "../db";
import * as storage from "../storage";
import {
  pages as pagesTable,
  websites as websitesTable,
  onboardingSubmissions,
} from "@shared/schema";
import { eq, and, sql, desc, gte, lte, isNull } from "drizzle-orm";
import { computeBankCompleteness } from "./scoring";
import { generateSitemapsForWebsite } from "./sitemap";
import { submitUrlsToGoogle } from "./gsc-indexing";

const SERVICE_BANK_MIN_COMPLETENESS = 60;
const SERVICE_MIN_AVG_SCORE = 55;
const TIER1_SCORE_THRESHOLD = 80;
const WAVE_INTERVAL_DAYS = 14;

interface GovernorResults {
  governor_1_service_gate?: {
    ran_at: string;
    passed_services: string[];
    blocked_services: Array<{ name: string; reason: string; completeness?: number; avg_score?: number }>;
  };
  governor_2_coverage_sanity?: {
    ran_at: string;
    passed: boolean;
    plan_type: string | null;
    coverage_plan: string | null;
    location_count: number;
    eligible_page_count: number;
    warnings: string[];
    block_reason?: string;
  };
  governor_3_launch_cap?: {
    ran_at: string;
    launch_cap: number;
    tier1_eligible: number;
    wave1_published: number;
    sitemap_regenerated: boolean;
    indexing_submitted: number;
    indexing_queued: number;
  };
  governor_4_overrides?: Array<{
    ran_at: string;
    admin: string;
    page_count: number;
    page_ids: string[];
  }>;
  wave_unlocks?: Array<{
    ran_at: string;
    wave: number;
    pages_published: number;
  }>;
}

async function loadGovernorResults(submissionId: string): Promise<GovernorResults> {
  const [row] = await db
    .select({ gr: onboardingSubmissions.governorResults })
    .from(onboardingSubmissions)
    .where(eq(onboardingSubmissions.id, submissionId))
    .limit(1);
  return ((row?.gr as any) || {}) as GovernorResults;
}

async function saveGovernorResults(submissionId: string, results: GovernorResults): Promise<void> {
  await db
    .update(onboardingSubmissions)
    .set({ governorResults: results as any })
    .where(eq(onboardingSubmissions.id, submissionId));
}

async function findSubmissionByWebsite(websiteId: string): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: onboardingSubmissions.id })
    .from(onboardingSubmissions)
    .where(eq(onboardingSubmissions.websiteId, websiteId))
    .orderBy(desc(onboardingSubmissions.createdAt))
    .limit(1);
  return row || null;
}

// ─── Governor 1 — Per-Service Minimum Quality Gate ───────────────────────────
async function governor1ServiceGate(websiteId: string, accountId: string): Promise<{
  passed_services: string[];
  blocked_services: Array<{ name: string; reason: string; completeness?: number; avg_score?: number }>;
}> {
  const services = await storage.getServices(accountId);
  const passed: string[] = [];
  const blocked: Array<{ name: string; reason: string; completeness?: number; avg_score?: number }> = [];

  for (const svc of services) {
    // Avg score for this service's draft pages
    const [scoreRow] = (await db.execute(sql`
      SELECT
        COUNT(*)::int AS draft_count,
        COALESCE(AVG(quality_score) FILTER (WHERE quality_score IS NOT NULL), 0)::int AS avg_score
      FROM pages
      WHERE website_id = ${websiteId} AND service_id = ${svc.id} AND is_draft = true
    `).then((r: any) => (r.rows ? r.rows : r))) as any;

    const draftCount = scoreRow?.draft_count || 0;
    const avgScore = scoreRow?.avg_score || 0;
    if (draftCount === 0) {
      // No drafts for this service — nothing to block
      passed.push(svc.name);
      continue;
    }

    // Bank completeness for this service
    const banks = await storage.getVariationBanks(websiteId, svc.name);
    const bankResult = banks.length > 0 ? computeBankCompleteness(banks) : { completenessScore: 0 };
    const completeness = bankResult.completenessScore || 0;

    if (completeness < SERVICE_BANK_MIN_COMPLETENESS) {
      await db
        .update(pagesTable)
        .set({ draftReason: "service_bank_incomplete" })
        .where(and(
          eq(pagesTable.websiteId, websiteId),
          eq(pagesTable.serviceId, svc.id),
          eq(pagesTable.isDraft, true),
        ));
      console.log(`[Governor 1] Service '${svc.name}' blocked. Bank completeness: ${completeness}%.`);
      blocked.push({ name: svc.name, reason: "bank_incomplete", completeness });
      continue;
    }

    if (avgScore < SERVICE_MIN_AVG_SCORE) {
      await db
        .update(pagesTable)
        .set({ draftReason: "service_quality_low" })
        .where(and(
          eq(pagesTable.websiteId, websiteId),
          eq(pagesTable.serviceId, svc.id),
          eq(pagesTable.isDraft, true),
        ));
      console.log(`[Governor 1] Service '${svc.name}' blocked. Average score: ${avgScore}.`);
      blocked.push({ name: svc.name, reason: "quality_low", avg_score: avgScore });
      continue;
    }

    console.log(`[Governor 1] Service '${svc.name}' passed. Bank: ${completeness}%, Avg score: ${avgScore}.`);
    passed.push(svc.name);
  }

  console.log(`[Governor 1] ${passed.length} services passed, ${blocked.length} services blocked.`);
  return { passed_services: passed, blocked_services: blocked };
}

// ─── Governor 2 — Coverage Sanity Check ──────────────────────────────────────
async function governor2CoverageSanity(
  websiteId: string,
  accountId: string,
  planType: string | null,
  coveragePlan: string | null,
  warmupMode: boolean,
): Promise<{
  passed: boolean;
  block_reason?: string;
  location_count: number;
  eligible_page_count: number;
  warnings: string[];
}> {
  const locations = await storage.getLocations(accountId);
  const locationCount = locations.length;

  const [eligRow] = (await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM pages
    WHERE website_id = ${websiteId} AND is_draft = true AND draft_reason = 'onboarding_initial'
  `).then((r: any) => (r.rows ? r.rows : r))) as any;
  const eligibleCount = eligRow?.cnt || 0;

  const warnings: string[] = [];

  if (planType === "local_launch" && coveragePlan === "national") {
    return {
      passed: false,
      block_reason: "Local Launch plan does not support national coverage. Please upgrade to Growth Bundle or reduce coverage area.",
      location_count: locationCount,
      eligible_page_count: eligibleCount,
      warnings,
    };
  }

  if (planType === "local_launch" && locationCount > 1000) {
    return {
      passed: false,
      block_reason: `Too many locations (${locationCount}) for Local Launch plan.`,
      location_count: locationCount,
      eligible_page_count: eligibleCount,
      warnings,
    };
  }

  if (eligibleCount > 50000 && warmupMode) {
    const w = `[Governor 2] WARNING: ${eligibleCount} eligible pages during warmup. Launch cap will limit initial publish.`;
    console.warn(w);
    warnings.push(w);
  }

  console.log(`[Governor 2] Coverage sanity check passed. Plan: ${planType}, Coverage: ${coveragePlan}, Locations: ${locationCount}, Eligible pages: ${eligibleCount}.`);
  return { passed: true, location_count: locationCount, eligible_page_count: eligibleCount, warnings };
}

// ─── Governor 3 — Launch Cap (Wave 1 Publishing) ─────────────────────────────
async function governor3LaunchCap(
  websiteId: string,
  website: { domain: string; settings?: any; launchCap?: number | null; tier1WeeklySubmitCap?: number | null },
): Promise<{
  launch_cap: number;
  tier1_eligible: number;
  wave1_published: number;
  sitemap_regenerated: boolean;
  indexing_submitted: number;
  indexing_queued: number;
}> {
  // Phase 8 — Rail 4 (protection thresholds) and Rail 3 (warmup cap)
  const { getProtectionModeThresholds, getWarmupPageLimit, countLivePages } = await import("./safety-rails");
  const protection = await getProtectionModeThresholds(websiteId);
  const warm = await getWarmupPageLimit(websiteId);
  const tier1Threshold = protection.tier1_score_threshold;
  const liveCount = await countLivePages(websiteId);
  const warmupHeadroom = Math.max(0, warm.current_limit - liveCount);

  const baseLaunchCap = website.launchCap ?? 100;
  const launchCap = Math.min(baseLaunchCap, warmupHeadroom);
  const weeklyCap = protection.indexing_weekly_cap ?? website.tier1WeeklySubmitCap ?? 50;

  if (warmupHeadroom <= 0) {
    console.log(`[Governor 3] Warmup page limit (${warm.current_limit}) reached on ${website.domain}. Holding remaining drafts.`);
  }

  // Eligible Tier 1 drafts (NOT blocked by Governor 1, NOT duplicates), ordered by quality_score DESC, capped
  const candidates = launchCap === 0 ? [] : (await db.execute(sql`
    SELECT id, slug, quality_score
    FROM pages
    WHERE website_id = ${websiteId}
      AND is_draft = true
      AND draft_reason = 'onboarding_initial'
      AND tier = 1
      AND (duplicate_flag IS NOT TRUE)
      AND COALESCE(quality_score, 0) >= ${tier1Threshold}
    ORDER BY quality_score DESC, id
    LIMIT ${launchCap}
  `).then((r: any) => (r.rows ? r.rows : r))) as any[];

  const [eligTotalRow] = (await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM pages
    WHERE website_id = ${websiteId}
      AND is_draft = true
      AND draft_reason = 'onboarding_initial'
      AND tier = 1
      AND (duplicate_flag IS NOT TRUE)
      AND COALESCE(quality_score, 0) >= ${tier1Threshold}
  `).then((r: any) => (r.rows ? r.rows : r))) as any;
  const tier1Eligible = eligTotalRow?.cnt || 0;

  if (candidates.length === 0) {
    console.log(`[Governor 3] No Tier 1 draft pages eligible for Wave 1 on ${website.domain}.`);
    return {
      launch_cap: launchCap,
      tier1_eligible: tier1Eligible,
      wave1_published: 0,
      sitemap_regenerated: false,
      indexing_submitted: 0,
      indexing_queued: 0,
    };
  }

  const now = new Date();
  const ids = candidates.map((p: any) => p.id);

  // Promote to live ATOMICALLY — only flip rows still in draft state.
  // Concurrent runs see is_draft=false and skip. RETURNING gives true count.
  const promoted = (await db.execute(sql`
    UPDATE pages
    SET status = 'published',
        is_draft = false,
        draft_reason = NULL,
        publish_wave = 1,
        published_at = ${now},
        updated_at = ${now}
    WHERE id = ANY(${ids}) AND is_draft = true
    RETURNING id, slug
  `).then((r: any) => (r.rows ? r.rows : r))) as any[];

  const wave1Published = promoted.length;
  const promotedSlugs = promoted.map((p: any) => p.slug);
  const promotedIds = promoted.map((p: any) => p.id);

  if (wave1Published === 0) {
    console.log(`[Governor 3] No drafts promoted (concurrent run or already promoted) for ${website.domain}.`);
    return {
      launch_cap: launchCap,
      tier1_eligible: tier1Eligible,
      wave1_published: 0,
      sitemap_regenerated: false,
      indexing_submitted: 0,
      indexing_queued: 0,
    };
  }

  // Atomic counter increment (no read-then-write race)
  await db.execute(sql`
    UPDATE websites SET published_pages = COALESCE(published_pages, 0) + ${wave1Published} WHERE id = ${websiteId}
  `);

  // Auto 3 — sitemap regen for this website
  let sitemapOk = false;
  try {
    const pDomain = (website.settings as any)?.parentDomain;
    const pPath = (website.settings as any)?.proxyPath || "";
    const canonBase = pDomain ? `https://${pDomain}${pPath}` : undefined;
    await generateSitemapsForWebsite(websiteId, website.domain, canonBase);
    sitemapOk = true;
    console.log(`[Governor 3] Sitemap regenerated for ${website.domain}.`);
  } catch (err: any) {
    console.error(`[Governor 3] Sitemap regen failed for ${website.domain}:`, err?.message);
  }

  // Auto 4 — submit to Google Indexing API, respecting weekly cap
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const [submittedRow] = (await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM pages
    WHERE website_id = ${websiteId}
      AND gsc_submitted_at IS NOT NULL
      AND gsc_submitted_at >= ${sevenDaysAgo}
  `).then((r: any) => (r.rows ? r.rows : r))) as any;
  const alreadySubmittedThisWeek = submittedRow?.cnt || 0;
  const remainingCap = Math.max(0, weeklyCap - alreadySubmittedThisWeek);
  const toSubmit = promoted.slice(0, remainingCap);
  const queued = promoted.length - toSubmit.length;

  let indexingSubmitted = 0;
  if (toSubmit.length > 0) {
    try {
      const pDomain = (website.settings as any)?.parentDomain;
      const pPath = (website.settings as any)?.proxyPath || "";
      const base = pDomain ? `https://${pDomain}${pPath}` : `https://${website.domain}`;
      const urls = toSubmit.map((p: any) => `${base}/${p.slug}`);
      await submitUrlsToGoogle(urls);
      const submitIds = toSubmit.map((p: any) => p.id);
      await db.execute(sql`
        UPDATE pages SET gsc_submitted_at = ${now} WHERE id = ANY(${submitIds})
      `);
      indexingSubmitted = toSubmit.length;
      console.log(`[Governor 3] Submitted ${indexingSubmitted} URL(s) to Google Indexing API for ${website.domain}. ${queued} queued for next week.`);
    } catch (err: any) {
      console.error(`[Governor 3] Indexing submission failed for ${website.domain}:`, err?.message);
    }
  } else if (promoted.length > 0) {
    console.log(`[Governor 3] Weekly indexing cap (${weeklyCap}) already reached for ${website.domain}. ${promoted.length} pages queued for next week.`);
  }

  // Mark website as launched
  await db
    .update(websitesTable)
    .set({ firstPublishAt: now, onboardingStatus: "published_live" })
    .where(eq(websitesTable.id, websiteId));

  console.log(`[Governor 3] Wave 1 published. ${wave1Published} pages published out of ${tier1Eligible} Tier 1 eligible. Launch cap: ${launchCap}. Sitemap regenerated. ${indexingSubmitted} pages submitted to Indexing API.`);

  return {
    launch_cap: launchCap,
    tier1_eligible: tier1Eligible,
    wave1_published: wave1Published,
    sitemap_regenerated: sitemapOk,
    indexing_submitted: indexingSubmitted,
    indexing_queued: queued,
  };
}

// ─── Main orchestrator ───────────────────────────────────────────────────────
export async function runLaunchGovernors(websiteId: string): Promise<{
  success: boolean;
  governor_results?: GovernorResults;
  blocked_at?: string;
  error?: string;
}> {
  console.log(`[Launch Governors] Starting for website ${websiteId}`);
  try {
    const website = await storage.getWebsite(websiteId);
    if (!website) throw new Error(`Website ${websiteId} not found`);

    // ENFORCEMENT — only run for warmup websites
    if (!website.warmupMode) {
      console.log(`[Launch Governors] Website ${website.domain} has warmup_mode=false. Skipping (manual sites are not governed).`);
      return { success: true, error: "warmup_mode_disabled" };
    }

    const submission = await findSubmissionByWebsite(websiteId);
    if (!submission) {
      console.warn(`[Launch Governors] No onboarding submission found for website ${websiteId}. Skipping (governors only run on onboarded sites).`);
      return { success: true, error: "no_submission" };
    }
    const submissionId = submission.id;

    const [sub] = await db
      .select({
        accountId: onboardingSubmissions.accountId,
        planType: onboardingSubmissions.planType,
      })
      .from(onboardingSubmissions)
      .where(eq(onboardingSubmissions.id, submissionId))
      .limit(1);

    const accountId = sub?.accountId || website.accountId;
    const planType = sub?.planType || null;
    const coveragePlan = (website as any).coveragePlan ?? null;

    const results = await loadGovernorResults(submissionId);

    // ── Phase 8 Rail 1 — Duplicate Intent Detector (run BEFORE Governor 1) ──
    try {
      const { detectDuplicateIntent, recordRail1Result } = await import("./safety-rails");
      const r1 = await detectDuplicateIntent(websiteId);
      await recordRail1Result(submissionId, r1);
    } catch (err: any) {
      console.error(`[Rail 1] Duplicate detection failed for ${websiteId} (non-fatal):`, err?.message);
    }

    // ── Governor 1 ──
    const g1 = await governor1ServiceGate(websiteId, accountId);
    results.governor_1_service_gate = {
      ran_at: new Date().toISOString(),
      passed_services: g1.passed_services,
      blocked_services: g1.blocked_services,
    };
    await saveGovernorResults(submissionId, results);

    // ── Governor 2 ──
    const g2 = await governor2CoverageSanity(websiteId, accountId, planType, coveragePlan, !!website.warmupMode);
    results.governor_2_coverage_sanity = {
      ran_at: new Date().toISOString(),
      passed: g2.passed,
      plan_type: planType,
      coverage_plan: coveragePlan,
      location_count: g2.location_count,
      eligible_page_count: g2.eligible_page_count,
      warnings: g2.warnings,
      ...(g2.block_reason ? { block_reason: g2.block_reason } : {}),
    };
    await saveGovernorResults(submissionId, results);

    if (!g2.passed) {
      // Append note and block
      const [cur] = await db
        .select({ notes: onboardingSubmissions.onboardingNotes })
        .from(onboardingSubmissions)
        .where(eq(onboardingSubmissions.id, submissionId))
        .limit(1);
      const note = `Coverage sanity check failed: ${g2.block_reason}`;
      const newNotes = (cur?.notes || "") + (cur?.notes ? "\n" : "") + note;
      await db
        .update(onboardingSubmissions)
        .set({ onboardingNotes: newNotes })
        .where(eq(onboardingSubmissions.id, submissionId));
      console.log(`[Governor 2] BLOCKED. ${g2.block_reason}`);
      return { success: false, governor_results: results, blocked_at: "governor_2" };
    }

    // ── Governor 3 ──
    const g3 = await governor3LaunchCap(websiteId, {
      domain: website.domain,
      settings: (website as any).settings,
      launchCap: (website as any).launchCap,
      tier1WeeklySubmitCap: (website as any).tier1WeeklySubmitCap,
    });
    results.governor_3_launch_cap = {
      ran_at: new Date().toISOString(),
      ...g3,
    };
    await saveGovernorResults(submissionId, results);

    // Final status flip (only if Governor 3 actually published something)
    if (g3.wave1_published > 0) {
      await db
        .update(onboardingSubmissions)
        .set({ status: "published_live", completedAt: new Date() })
        .where(eq(onboardingSubmissions.id, submissionId));
      console.log(`[Launch Governors] Submission ${submissionId} → status: published_live.`);

      // Phase 8 Rail 4 — Activate 30-day protection mode after first wave goes live
      try {
        const { activateProtectionMode } = await import("./safety-rails");
        await activateProtectionMode(websiteId);
      } catch (err: any) {
        console.error(`[Rail 4] activateProtectionMode failed for ${websiteId} (non-fatal):`, err?.message);
      }
    } else {
      console.warn(`[Launch Governors] Governor 3 published 0 pages — leaving submission in 'generated_draft_only'.`);
    }

    // Phase 9 — Refresh customer-friendly gap report after Phase 7
    try {
      const { generateGapReport } = await import("./gap-report");
      await generateGapReport(submissionId);
    } catch (err: any) {
      console.error("[Gap Report] Phase 7 generation failed (non-fatal):", err?.message);
    }

    return { success: true, governor_results: results };
  } catch (err: any) {
    console.error(`[Launch Governors] FAILED for website ${websiteId}:`, err?.message);
    return { success: false, error: err?.message || String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// checkWaveReadiness — daily; unlocks Wave 2+ on 14-day cadence (time-based)
// ═══════════════════════════════════════════════════════════════════════════
export async function checkWaveReadiness(websiteId: string): Promise<{
  unlocked: boolean;
  wave?: number;
  pages_published?: number;
  reason?: string;
}> {
  const website = await storage.getWebsite(websiteId);
  if (!website) return { unlocked: false, reason: "website_not_found" };
  if (!website.warmupMode) return { unlocked: false, reason: "warmup_disabled" };
  if (!(website as any).firstPublishAt) return { unlocked: false, reason: "no_first_publish" };

  const firstPublish = new Date((website as any).firstPublishAt);
  const daysSince = Math.floor((Date.now() - firstPublish.getTime()) / (24 * 3600 * 1000));
  if (daysSince < WAVE_INTERVAL_DAYS) {
    return { unlocked: false, reason: `only ${daysSince} days since first publish (need ${WAVE_INTERVAL_DAYS})` };
  }

  // Determine current highest wave for this website
  const [maxRow] = (await db.execute(sql`
    SELECT COALESCE(MAX(publish_wave), 0)::int AS max_wave
    FROM pages
    WHERE website_id = ${websiteId} AND publish_wave > 0
  `).then((r: any) => (r.rows ? r.rows : r))) as any;
  const currentMaxWave = maxRow?.max_wave || 0;

  // Time-based: each wave unlocks every WAVE_INTERVAL_DAYS days
  // Wave N is unlockable when daysSince >= (N-1) * 14
  const targetWave = Math.floor(daysSince / WAVE_INTERVAL_DAYS) + 1;
  if (targetWave <= currentMaxWave) {
    return { unlocked: false, reason: `wave ${currentMaxWave} already published; next eligible at day ${currentMaxWave * WAVE_INTERVAL_DAYS}` };
  }

  const nextWave = currentMaxWave + 1;
  const launchCap = (website as any).launchCap ?? 100;
  const weeklyCap = (website as any).tier1WeeklySubmitCap ?? 50;

  // Next batch — Tier 1 drafts first, then Tier 2 if no Tier 1 left
  let candidates = (await db.execute(sql`
    SELECT id, slug
    FROM pages
    WHERE website_id = ${websiteId}
      AND is_draft = true
      AND draft_reason = 'onboarding_initial'
      AND tier = 1
      AND COALESCE(quality_score, 0) >= ${TIER1_SCORE_THRESHOLD}
    ORDER BY quality_score DESC, id
    LIMIT ${launchCap}
  `).then((r: any) => (r.rows ? r.rows : r))) as any[];

  if (candidates.length < launchCap) {
    const remaining = launchCap - candidates.length;
    const t2 = (await db.execute(sql`
      SELECT id, slug
      FROM pages
      WHERE website_id = ${websiteId}
        AND is_draft = true
        AND draft_reason = 'onboarding_initial'
        AND tier = 2
        AND COALESCE(quality_score, 0) >= 55
      ORDER BY quality_score DESC, id
      LIMIT ${remaining}
    `).then((r: any) => (r.rows ? r.rows : r))) as any[];
    candidates = [...candidates, ...t2];
  }

  if (candidates.length === 0) {
    return { unlocked: false, reason: "no_remaining_eligible_drafts" };
  }

  const now = new Date();
  const ids = candidates.map((p: any) => p.id);

  // Atomic promote — only flip rows still in draft. RETURNING gives true count.
  const promoted = (await db.execute(sql`
    UPDATE pages
    SET status = 'published',
        is_draft = false,
        draft_reason = NULL,
        publish_wave = ${nextWave},
        published_at = ${now},
        updated_at = ${now}
    WHERE id = ANY(${ids}) AND is_draft = true
    RETURNING id, slug
  `).then((r: any) => (r.rows ? r.rows : r))) as any[];

  if (promoted.length === 0) {
    return { unlocked: false, reason: "concurrent_run_or_already_promoted" };
  }

  // Atomic counter increment
  await db.execute(sql`
    UPDATE websites SET published_pages = COALESCE(published_pages, 0) + ${promoted.length} WHERE id = ${websiteId}
  `);

  // Sitemap regen
  try {
    const pDomain = (website.settings as any)?.parentDomain;
    const pPath = (website.settings as any)?.proxyPath || "";
    const canonBase = pDomain ? `https://${pDomain}${pPath}` : undefined;
    await generateSitemapsForWebsite(websiteId, website.domain, canonBase);
  } catch (err: any) {
    console.error(`[Wave Unlock] Sitemap regen failed for ${website.domain}:`, err?.message);
  }

  // Indexing — respect weekly cap
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const [submittedRow] = (await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM pages
    WHERE website_id = ${websiteId} AND gsc_submitted_at IS NOT NULL AND gsc_submitted_at >= ${sevenDaysAgo}
  `).then((r: any) => (r.rows ? r.rows : r))) as any;
  const alreadySubmitted = submittedRow?.cnt || 0;
  const remainingCap = Math.max(0, weeklyCap - alreadySubmitted);
  const toSubmit = promoted.slice(0, remainingCap);
  if (toSubmit.length > 0) {
    try {
      const pDomain = (website.settings as any)?.parentDomain;
      const pPath = (website.settings as any)?.proxyPath || "";
      const base = pDomain ? `https://${pDomain}${pPath}` : `https://${website.domain}`;
      const urls = toSubmit.map((p: any) => `${base}/${p.slug}`);
      await submitUrlsToGoogle(urls);
      const submitIds = toSubmit.map((p: any) => p.id);
      await db.execute(sql`UPDATE pages SET gsc_submitted_at = ${now} WHERE id = ANY(${submitIds})`);
    } catch (err: any) {
      console.error(`[Wave Unlock] Indexing submission failed for ${website.domain}:`, err?.message);
    }
  }

  // Append wave_unlocks to governor_results if this site has a submission
  const submission = await findSubmissionByWebsite(websiteId);
  if (submission) {
    const results = await loadGovernorResults(submission.id);
    results.wave_unlocks = results.wave_unlocks || [];
    results.wave_unlocks.push({
      ran_at: now.toISOString(),
      wave: nextWave,
      pages_published: promoted.length,
    });
    await saveGovernorResults(submission.id, results);
  }

  console.log(`[Wave Unlock] Wave ${nextWave} published for website ${website.domain}. ${promoted.length} pages published.`);
  return { unlocked: true, wave: nextWave, pages_published: promoted.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// runDailyWaveCheck — iterate all warmup websites and call checkWaveReadiness
// Registered as 24-hour setInterval in server/index.ts
// ═══════════════════════════════════════════════════════════════════════════
export async function runDailyWaveCheck(): Promise<void> {
  console.log("[Wave Unlock] Daily wave readiness check starting...");
  try {
    const rows = (await db.execute(sql`
      SELECT id, domain
      FROM websites
      WHERE warmup_mode = true
        AND first_publish_at IS NOT NULL
        AND onboarding_status = 'published_live'
    `).then((r: any) => (r.rows ? r.rows : r))) as any[];

    for (const row of rows) {
      try {
        const result = await checkWaveReadiness(row.id);
        if (result.unlocked) {
          console.log(`[Wave Unlock] ${row.domain}: Wave ${result.wave} unlocked, ${result.pages_published} pages published.`);
        }
      } catch (err: any) {
        console.error(`[Wave Unlock] ${row.domain} check failed:`, err?.message);
      }
    }
    console.log(`[Wave Unlock] Daily check complete. ${rows.length} warmup website(s) checked.`);
  } catch (err: any) {
    console.error("[Wave Unlock] Daily check failed:", err?.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// recordGovernor4Override — called from the publish-override route
// ═══════════════════════════════════════════════════════════════════════════
export async function recordGovernor4Override(
  websiteId: string,
  admin: string,
  pageIds: string[],
): Promise<void> {
  const submission = await findSubmissionByWebsite(websiteId);
  if (!submission) return; // Only record on onboarded sites
  const results = await loadGovernorResults(submission.id);
  results.governor_4_overrides = results.governor_4_overrides || [];
  results.governor_4_overrides.push({
    ran_at: new Date().toISOString(),
    admin,
    page_count: pageIds.length,
    page_ids: pageIds,
  });
  await saveGovernorResults(submission.id, results);
}
