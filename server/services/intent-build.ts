/**
 * intent-build.ts
 *
 * Provides the three functions consumed by server/routes/intent-actions.ts:
 *   - runIntentBuild        → triggers an async intent analysis pass for a website
 *   - getIntentBuildStatus  → returns the current in-progress / last-run status
 *   - getIntentBuildReport  → returns the last completed report snapshot
 *
 * The per-website state is kept in memory (Map). A Railway restart clears it,
 * which is fine — callers always check status before relying on a report.
 */

import { pool } from "../db";

// ─── Types ───────────────────────────────────────────────────────────────────

// ✅ CHANGED: status type now includes "complete" to match the frontend BuildStatus
// type which polls for "complete" — previously "done" was returned and the
// polling interval never stopped, leaving the UI stuck on "Running".
export type IntentBuildStatus = "idle" | "running" | "complete" | "failed";

export type IntentBuildState =
  | { status: "idle" }
  | { status: "running"; startedAt: string; websiteId: string; progress: number; currentStep: string; completedCount: number; totalCount: number; pagesAnalyzed: number }
  | { status: "complete"; startedAt: string; finishedAt: string; websiteId: string; report: IntentReport; progress: number; pagesAnalyzed: number }
  | { status: "failed"; startedAt: string; finishedAt: string; websiteId: string; error: string };

// ✅ CHANGED: IntentReport now matches the frontend IntentReport interface exactly.
// Previously the service returned a completely different shape (clusters[], totalPages, etc.)
// causing every field in the UI to be undefined and topCanonicalOwners to be missing entirely.
export interface CanonicalOwner {
  canonicalOwner: string;
  intentCluster: string;
  pagesOwned: number;
  strength: "Strong" | "Medium" | "Weak";
  risk: "Low" | "Medium" | "High";
  recommendedAction: string;
}

export interface IntentReport {
  totalPagesAnalyzed: number;
  canonicalOwnersFound: number;
  orphanIntentGroups: number;
  duplicateOverlapRisks: number;
  weakOwnerClusters: number;
  promotionCandidates: number;
  coveragePercentage: number;
  strongOwners: number;
  mediumOwners: number;
  weakOwners: number;
  missingCanonicalOwners: number;
  topCanonicalOwners: CanonicalOwner[];
}

// ─── In-memory state store ────────────────────────────────────────────────────

const stateMap = new Map<string, IntentBuildState>();

function getState(websiteId: string): IntentBuildState {
  return stateMap.get(websiteId) ?? { status: "idle" };
}

// ─── Strength / Risk / Action derivation ─────────────────────────────────────

function deriveStrength(minTier: number | null, pageCount: number): CanonicalOwner["strength"] {
  if (minTier !== null && minTier <= 1) return "Strong";
  if (minTier !== null && minTier <= 2) return pageCount >= 2 ? "Medium" : "Strong";
  if (pageCount >= 3) return "Weak";
  return "Medium";
}

function deriveRisk(hasOverlap: boolean, pageCount: number, strength: CanonicalOwner["strength"]): CanonicalOwner["risk"] {
  if (hasOverlap && pageCount >= 3) return "High";
  if (hasOverlap && pageCount >= 2) return "Medium";
  if (strength === "Weak") return "Medium";
  return "Low";
}

function deriveRecommendedAction(strength: CanonicalOwner["strength"], risk: CanonicalOwner["risk"], hasOverlap: boolean): string {
  if (risk === "High" && hasOverlap) return "Consolidate overlapping pages into canonical winner";
  if (strength === "Strong" && risk === "Low") return "Promote to Tier 1 and strengthen internal links";
  if (strength === "Medium") return "Add internal links to reinforce canonical ownership";
  if (strength === "Weak" && hasOverlap) return "Merge or consolidate — cluster has no clear owner";
  if (strength === "Weak") return "Improve page content and promote to higher tier";
  return "Review and improve canonical coverage";
}

// ─── Core analysis ───────────────────────────────────────────────────────────

async function analyseWebsite(websiteId: string): Promise<IntentReport> {
  const result = await pool.query(
    `SELECT id, slug, title, tier, page_type, status,
            COALESCE(NULLIF(TRIM(intent_cluster), ''), NULLIF(TRIM(h1), ''), slug) AS intent_cluster
     FROM pages
     WHERE website_id::text = $1::text
       AND status = 'published'
     ORDER BY COALESCE(tier, 99) ASC, updated_at DESC NULLS LAST`,
    [websiteId],
  );

  const rows: Array<{
    id: string;
    slug: string;
    title: string | null;
    tier: number | null;
    page_type: string | null;
    status: string;
    intent_cluster: string;
  }> = result.rows;

  // Group pages by normalised intent_cluster token
  const clusterMap = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.intent_cluster.toLowerCase().trim();
    if (!clusterMap.has(key)) clusterMap.set(key, []);
    clusterMap.get(key)!.push(row);
  }

  // ✅ CHANGED: build topCanonicalOwners[] with the exact shape the frontend expects
  const topCanonicalOwners: CanonicalOwner[] = [];

  let strongCount = 0;
  let mediumCount = 0;
  let weakCount = 0;
  let orphanCount = 0;
  let overlapCount = 0;
  let promotionCount = 0;
  let missingCount = 0;

  for (const [cluster, pages] of clusterMap.entries()) {
    const owner = pages[0]; // lowest tier, most recently updated (from ORDER BY)
    const hasOverlap = pages.length > 1;
    const minTier = pages.reduce((min: number | null, p) => {
      if (p.tier === null) return min;
      return min === null ? p.tier : Math.min(min, p.tier);
    }, null as number | null);

    if (!owner?.slug) { missingCount++; continue; }

    const strength = deriveStrength(minTier, pages.length);
    const risk = deriveRisk(hasOverlap, pages.length, strength);
    const recommendedAction = deriveRecommendedAction(strength, risk, hasOverlap);

    if (strength === "Strong") strongCount++;
    else if (strength === "Medium") mediumCount++;
    else weakCount++;

    if (hasOverlap) overlapCount++;
    if (pages.length === 1 && !owner.tier) orphanCount++;
    if (strength === "Strong" && risk === "Low") promotionCount++;

    topCanonicalOwners.push({
      canonicalOwner: owner.slug,
      intentCluster: cluster,
      pagesOwned: pages.length,
      strength,
      risk,
      recommendedAction,
    });
  }

  // Sort: High risk first, then Medium, then Low; within risk sort by pagesOwned desc
  topCanonicalOwners.sort((a, b) => {
    const riskOrder = { High: 0, Medium: 1, Low: 2 };
    const rDiff = riskOrder[a.risk] - riskOrder[b.risk];
    if (rDiff !== 0) return rDiff;
    return b.pagesOwned - a.pagesOwned;
  });

  const totalClusters = clusterMap.size;
  const coveragePercentage = totalClusters > 0
    ? Math.round(((totalClusters - missingCount) / totalClusters) * 100)
    : 0;

  return {
    totalPagesAnalyzed: rows.length,
    canonicalOwnersFound: topCanonicalOwners.length,
    orphanIntentGroups: orphanCount,
    duplicateOverlapRisks: overlapCount,
    weakOwnerClusters: weakCount,
    promotionCandidates: promotionCount,
    coveragePercentage,
    strongOwners: strongCount,
    mediumOwners: mediumCount,
    weakOwners: weakCount,
    missingCanonicalOwners: missingCount,
    // CHANGED: limit the rendered owner table for very large websites.
    topCanonicalOwners: topCanonicalOwners.slice(0, 100),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Trigger an intent-build analysis run for the given website.
 * Returns immediately; analysis runs async.
 */
export async function runIntentBuild(websiteId: string): Promise<{ ok: boolean; message: string; websiteId: string }> {
  const current = getState(websiteId);
  if (current.status === "running") {
    return { ok: false, message: "Intent build already running for this website", websiteId };
  }

  const startedAt = new Date().toISOString();
  stateMap.set(websiteId, {
    status: "running",
    startedAt,
    websiteId,
    progress: 0,
    currentStep: "Analysing published pages",
    completedCount: 0,
    totalCount: 6,
    pagesAnalyzed: 0,
  });

  // Fire-and-forget
  setImmediate(async () => {
    try {
      const report = await analyseWebsite(websiteId);
      // ✅ CHANGED: status is now "complete" (not "done") — matches frontend BuildStatus type
      stateMap.set(websiteId, {
        status: "complete",
        startedAt,
        finishedAt: new Date().toISOString(),
        websiteId,
        report,
        progress: 100,
        pagesAnalyzed: report.totalPagesAnalyzed,
      });
    } catch (err: any) {
      // ✅ CHANGED: status is now "failed" (not "error") — matches frontend BuildStatus type
      stateMap.set(websiteId, {
        status: "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        websiteId,
        error: String(err?.message ?? err),
      });
    }
  });

  return { ok: true, message: "Intent build started", websiteId };
}

/**
 * Return the current build status for a website.
 * Shape matches the frontend BuildStatusResponse interface exactly.
 */
export function getIntentBuildStatus(websiteId: string): {
  status: IntentBuildStatus;
  progress: number;
  currentStep: string;
  completedCount: number;
  totalCount: number;
  lastRunTime: string | null;
  pagesAnalyzed: number;
  hasReport: boolean;
  error?: string;
} {
  const state = getState(websiteId);

  if (state.status === "idle") {
    return { status: "idle", progress: 0, currentStep: "Waiting to run", completedCount: 0, totalCount: 6, lastRunTime: null, pagesAnalyzed: 0, hasReport: false };
  }
  if (state.status === "running") {
    return { status: "running", progress: state.progress, currentStep: state.currentStep, completedCount: state.completedCount, totalCount: state.totalCount, lastRunTime: null, pagesAnalyzed: state.pagesAnalyzed, hasReport: false };
  }
  if (state.status === "complete") {
    return { status: "complete", progress: 100, currentStep: "Complete", completedCount: 6, totalCount: 6, lastRunTime: state.finishedAt, pagesAnalyzed: state.pagesAnalyzed, hasReport: true };
  }
  // failed
  return { status: "failed", progress: 0, currentStep: "Failed", completedCount: 0, totalCount: 6, lastRunTime: state.finishedAt, pagesAnalyzed: 0, hasReport: false, error: state.error };
}

/**
 * Return the last completed intent-build report for a website.
 * Returns null if no completed run exists yet.
 */
export function getIntentBuildReport(websiteId: string): IntentReport | null {
  const state = getState(websiteId);
  if (state.status === "complete") return state.report;
  return null;
}
