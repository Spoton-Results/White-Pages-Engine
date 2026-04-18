// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8 — Advanced Safety Rails
// ═══════════════════════════════════════════════════════════════════════════
// Rails 1, 3, 4 (duplicate detector, warmup timer, protection mode).
// Rail 2 (brand input gate) is in brand-input-gate.ts.
//
// All rails apply ONLY when warmup_mode = true. They never alter behavior
// for manually-created websites.
// ═══════════════════════════════════════════════════════════════════════════

import { db } from "../db";
import * as storage from "../storage";
import { sql, eq } from "drizzle-orm";
import { onboardingSubmissions } from "@shared/schema";

const STOP_WORDS = new Set([
  "the","and","for","with","your","our","from","that","this","are","was","will",
  "can","has","have","been","being","best","top","near","services","service",
  "in","of","to","at","by","on","or","an","a","is",
]);

const DUPLICATE_THRESHOLD = 0.80;

const PROTECTION_TIER1_THRESHOLD = 90;
const PROTECTION_DEMOTION_DAYS = 30;
const STANDARD_TIER1_THRESHOLD = 80;
const STANDARD_DEMOTION_DAYS = 60;

const WARMUP_TOTAL_DAYS = 30;

export interface ProtectionThresholds {
  tier1_score_threshold: number;
  auto_demotion_days: number;
  sitemap_tier2_allowed: boolean;
  indexing_weekly_cap: number | null;
  protection_mode: boolean;
  protection_expires_in_days?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// RAIL 1 — Duplicate Intent Detector
// ═══════════════════════════════════════════════════════════════════════════

function tokenize(s: string): Set<string> {
  return new Set(
    (s || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((x) => { if (b.has(x)) inter++; });
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Extract location component from a title (after " in ") or fallback to whole title
function extractLocationTokens(title: string): Set<string> {
  const m = title.toLowerCase().match(/\bin\s+(.+)$/);
  return tokenize(m ? m[1] : title);
}

export async function detectDuplicateIntent(websiteId: string): Promise<{
  pages_scanned: number;
  duplicate_pairs_found: number;
  pages_flagged: number;
  sample_duplicates: Array<{ flagged_slug: string; duplicate_of: string; similarity: number }>;
}> {
  // Load all draft pages on warmup websites only
  const website = await storage.getWebsite(websiteId);
  if (!website) {
    return { pages_scanned: 0, duplicate_pairs_found: 0, pages_flagged: 0, sample_duplicates: [] };
  }
  if (!website.warmupMode || (website as any).onboardingStatus === "manual") {
    console.log(`[Duplicate Detector] Skipping ${website.domain} — not a warmup/onboarded site.`);
    return { pages_scanned: 0, duplicate_pairs_found: 0, pages_flagged: 0, sample_duplicates: [] };
  }

  const drafts = (await db.execute(sql`
    SELECT id, slug, title, service_id, COALESCE(quality_score, 0) AS quality_score
    FROM pages
    WHERE website_id = ${websiteId}
      AND is_draft = true
      AND (duplicate_flag IS NOT TRUE)
  `).then((r: any) => (r.rows ? r.rows : r))) as any[];

  const pagesScanned = drafts.length;
  if (pagesScanned === 0) {
    console.log(`[Duplicate Detector] Scanned 0 pages on ${website.domain}.`);
    return { pages_scanned: 0, duplicate_pairs_found: 0, pages_flagged: 0, sample_duplicates: [] };
  }

  // Group by service_id (null bucket allowed)
  const byService = new Map<string, any[]>();
  for (const p of drafts) {
    const key = p.service_id || "_none";
    if (!byService.has(key)) byService.set(key, []);
    byService.get(key)!.push({
      ...p,
      _titleTokens: tokenize(p.title || ""),
      _locTokens: extractLocationTokens(p.title || ""),
    });
  }

  const flaggedMap = new Map<string, { ofSlug: string; sim: number }>();
  let pairCount = 0;

  for (const group of byService.values()) {
    // O(n^2) within service group, gated by location-token overlap
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        // Cheap pre-filter: must share at least one location word
        let locOverlap = false;
        a._locTokens.forEach((t: string) => { if (b._locTokens.has(t)) locOverlap = true; });
        if (!locOverlap) continue;

        const sim = jaccard(a._titleTokens, b._titleTokens);
        if (sim < DUPLICATE_THRESHOLD) continue;

        pairCount++;
        // Flag the lower-scoring one
        const aScore = Number(a.quality_score) || 0;
        const bScore = Number(b.quality_score) || 0;
        const loser = aScore <= bScore ? a : b;
        const winner = loser === a ? b : a;
        const existing = flaggedMap.get(loser.id);
        if (!existing || sim > existing.sim) {
          flaggedMap.set(loser.id, { ofSlug: winner.slug, sim });
        }
      }
    }
  }

  // Apply flags
  const samples: Array<{ flagged_slug: string; duplicate_of: string; similarity: number }> = [];
  let flaggedCount = 0;
  const flagged = Array.from(flaggedMap.entries());
  for (const [pageId, info] of flagged) {
    await db.execute(sql`
      UPDATE pages
      SET duplicate_flag = true,
          duplicate_of_slug = ${info.ofSlug},
          duplicate_similarity = ${info.sim.toFixed(4)},
          draft_reason = 'duplicate_intent',
          updated_at = NOW()
      WHERE id = ${pageId} AND is_draft = true
    `);
    flaggedCount++;
    if (samples.length < 10) {
      const slugRow = drafts.find((d) => d.id === pageId);
      samples.push({
        flagged_slug: slugRow?.slug || pageId,
        duplicate_of: info.ofSlug,
        similarity: Math.round(info.sim * 10000) / 10000,
      });
    }
  }

  console.log(`[Duplicate Detector] Scanned ${pagesScanned} pages. Found ${pairCount} duplicate pairs. ${flaggedCount} pages flagged.`);
  return {
    pages_scanned: pagesScanned,
    duplicate_pairs_found: pairCount,
    pages_flagged: flaggedCount,
    sample_duplicates: samples,
  };
}

// Persist Rail 1 results into governor_results blob
export async function recordRail1Result(
  submissionId: string,
  result: Awaited<ReturnType<typeof detectDuplicateIntent>>,
): Promise<void> {
  const [row] = await db
    .select({ gr: onboardingSubmissions.governorResults })
    .from(onboardingSubmissions)
    .where(eq(onboardingSubmissions.id, submissionId))
    .limit(1);
  const existing = (row?.gr as any) || {};
  existing.rail_1_duplicate_detection = {
    ran_at: new Date().toISOString(),
    ...result,
  };
  await db
    .update(onboardingSubmissions)
    .set({ governorResults: existing })
    .where(eq(onboardingSubmissions.id, submissionId));
}

// ═══════════════════════════════════════════════════════════════════════════
// RAIL 3 — New-Site Warmup Timer
// ═══════════════════════════════════════════════════════════════════════════

export interface WarmupStatus {
  warmup_active: boolean;
  warmup_day: number;
  current_limit: number; // Infinity-equivalent: Number.MAX_SAFE_INTEGER
  next_tier_day: number | null;
  next_tier_limit: number | null;
  expires_at: Date | null;
}

function warmupLimitForDay(day: number): { limit: number; nextDay: number | null; nextLimit: number | null } {
  if (day <= 7) return { limit: 50, nextDay: 8, nextLimit: 150 };
  if (day <= 14) return { limit: 150, nextDay: 15, nextLimit: 300 };
  if (day <= 21) return { limit: 300, nextDay: 22, nextLimit: 500 };
  if (day <= 30) return { limit: 500, nextDay: 31, nextLimit: null };
  return { limit: Number.MAX_SAFE_INTEGER, nextDay: null, nextLimit: null };
}

export async function getWarmupPageLimit(websiteId: string): Promise<WarmupStatus> {
  const website = await storage.getWebsite(websiteId);
  if (!website) {
    return { warmup_active: false, warmup_day: 0, current_limit: Number.MAX_SAFE_INTEGER, next_tier_day: null, next_tier_limit: null, expires_at: null };
  }
  const fp = (website as any).firstPublishAt as Date | null;

  // Pre-launch: no pages should be live yet
  if (!fp) {
    return { warmup_active: !!website.warmupMode, warmup_day: 0, current_limit: 0, next_tier_day: 1, next_tier_limit: 50, expires_at: (website as any).warmupExpiresAt ?? null };
  }

  if (!website.warmupMode) {
    return { warmup_active: false, warmup_day: 0, current_limit: Number.MAX_SAFE_INTEGER, next_tier_day: null, next_tier_limit: null, expires_at: null };
  }

  const days = Math.floor((Date.now() - new Date(fp).getTime()) / (24 * 3600 * 1000));

  // Update warmup_day field
  await db.execute(sql`UPDATE websites SET warmup_day = ${days} WHERE id = ${websiteId}`);

  if (days >= WARMUP_TOTAL_DAYS + 1) {
    await db.execute(sql`UPDATE websites SET warmup_mode = false, warmup_expires_at = NULL WHERE id = ${websiteId}`);
    console.log(`[Warmup Timer] Website ${website.domain} warmup complete. Warmup mode disabled.`);
    return { warmup_active: false, warmup_day: days, current_limit: Number.MAX_SAFE_INTEGER, next_tier_day: null, next_tier_limit: null, expires_at: null };
  }

  const tier = warmupLimitForDay(days);
  const override = (website as any).warmupPageCapOverride;
  const limit = typeof override === "number" && override > 0 ? override : tier.limit;
  const expires = new Date(new Date(fp).getTime() + (WARMUP_TOTAL_DAYS + 1) * 24 * 3600 * 1000);
  return {
    warmup_active: true,
    warmup_day: days,
    current_limit: limit,
    next_tier_day: tier.nextDay,
    next_tier_limit: tier.nextLimit,
    expires_at: expires,
  };
}

export async function countLivePages(websiteId: string): Promise<number> {
  const [row] = (await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM pages WHERE website_id = ${websiteId} AND is_draft = false
  `).then((r: any) => (r.rows ? r.rows : r))) as any;
  return row?.cnt || 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// RAIL 4 — First-30-Day Protection Mode
// ═══════════════════════════════════════════════════════════════════════════

export async function getProtectionModeThresholds(websiteId: string): Promise<ProtectionThresholds> {
  const website = await storage.getWebsite(websiteId);
  const standardCap = (website as any)?.tier1WeeklySubmitCap ?? null;

  // Manual sites are NEVER subject to protection mode
  if (!website || (website as any).onboardingStatus === "manual") {
    return {
      tier1_score_threshold: STANDARD_TIER1_THRESHOLD,
      auto_demotion_days: STANDARD_DEMOTION_DAYS,
      sitemap_tier2_allowed: true,
      indexing_weekly_cap: standardCap,
      protection_mode: false,
    };
  }

  const fp = (website as any).firstPublishAt as Date | null;
  const inProtection = !!(website as any).protectionMode;

  if (!fp) {
    // Not yet launched — protection thresholds apply preemptively (governs Wave 1)
    return {
      tier1_score_threshold: PROTECTION_TIER1_THRESHOLD,
      auto_demotion_days: PROTECTION_DEMOTION_DAYS,
      sitemap_tier2_allowed: false,
      indexing_weekly_cap: standardCap,
      protection_mode: true,
      protection_expires_in_days: 30,
    };
  }

  const days = Math.floor((Date.now() - new Date(fp).getTime()) / (24 * 3600 * 1000));

  if (days >= 30 && inProtection) {
    await db.execute(sql`UPDATE websites SET protection_mode = false, protection_expires_at = NULL WHERE id = ${websiteId}`);
    console.log(`[Protection Mode] Website ${website.domain} protection expired. Reverting to standard thresholds.`);
    return {
      tier1_score_threshold: STANDARD_TIER1_THRESHOLD,
      auto_demotion_days: STANDARD_DEMOTION_DAYS,
      sitemap_tier2_allowed: true,
      indexing_weekly_cap: standardCap,
      protection_mode: false,
    };
  }

  if (days < 30 || inProtection) {
    return {
      tier1_score_threshold: PROTECTION_TIER1_THRESHOLD,
      auto_demotion_days: PROTECTION_DEMOTION_DAYS,
      sitemap_tier2_allowed: false,
      indexing_weekly_cap: standardCap,
      protection_mode: true,
      protection_expires_in_days: Math.max(0, 30 - days),
    };
  }

  return {
    tier1_score_threshold: STANDARD_TIER1_THRESHOLD,
    auto_demotion_days: STANDARD_DEMOTION_DAYS,
    sitemap_tier2_allowed: true,
    indexing_weekly_cap: standardCap,
    protection_mode: false,
  };
}

export async function activateProtectionMode(websiteId: string): Promise<void> {
  const website = await storage.getWebsite(websiteId);
  if (!website) return;
  if ((website as any).onboardingStatus === "manual") return;
  if (!website.warmupMode) return;
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  await db.execute(sql`
    UPDATE websites
    SET protection_mode = true, protection_expires_at = ${expires}
    WHERE id = ${websiteId}
  `);
  console.log(`[Protection Mode] Activated for ${website.domain}. Expires: ${expires.toISOString().split("T")[0]}.`);
}
