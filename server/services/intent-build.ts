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

export type IntentBuildState =
  | { status: "idle" }
  | { status: "running"; startedAt: string; websiteId: string }
  | { status: "done"; startedAt: string; finishedAt: string; websiteId: string; report: IntentBuildReport }
  | { status: "error"; startedAt: string; finishedAt: string; websiteId: string; error: string };

export interface IntentClusterGroup {
  intentCluster: string;
  pages: Array<{
    id: string;
    slug: string;
    title: string | null;
    tier: number | null;
    pageType: string | null;
    status: string;
  }>;
  canonicalOwner: string | null;
  pageCount: number;
  hasOverlap: boolean;
}

export interface IntentBuildReport {
  websiteId: string;
  generatedAt: string;
  totalPages: number;
  clustersAnalysed: number;
  overlappingClusters: number;
  clusters: IntentClusterGroup[];
}

// ─── In-memory state store ────────────────────────────────────────────────────

const stateMap = new Map<string, IntentBuildState>();

function getState(websiteId: string): IntentBuildState {
  return stateMap.get(websiteId) ?? { status: "idle" };
}

// ─── Core analysis ───────────────────────────────────────────────────────────

async function analyseWebsite(websiteId: string): Promise<IntentBuildReport> {
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

  const clusters: IntentClusterGroup[] = [];
  for (const [cluster, pages] of clusterMap.entries()) {
    // Canonical owner = lowest tier, then most-recently updated
    const owner = pages[0];
    clusters.push({
      intentCluster: cluster,
      pages: pages.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        tier: p.tier,
        pageType: p.page_type,
        status: p.status,
      })),
      canonicalOwner: owner?.slug ?? null,
      pageCount: pages.length,
      hasOverlap: pages.length > 1,
    });
  }

  // Sort: overlapping clusters first, then by cluster name
  clusters.sort((a, b) => {
    if (a.hasOverlap !== b.hasOverlap) return a.hasOverlap ? -1 : 1;
    return a.intentCluster.localeCompare(b.intentCluster);
  });

  return {
    websiteId,
    generatedAt: new Date().toISOString(),
    totalPages: rows.length,
    clustersAnalysed: clusters.length,
    overlappingClusters: clusters.filter((c) => c.hasOverlap).length,
    clusters,
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
  stateMap.set(websiteId, { status: "running", startedAt, websiteId });

  // Fire-and-forget
  setImmediate(async () => {
    try {
      const report = await analyseWebsite(websiteId);
      stateMap.set(websiteId, {
        status: "done",
        startedAt,
        finishedAt: new Date().toISOString(),
        websiteId,
        report,
      });
    } catch (err: any) {
      stateMap.set(websiteId, {
        status: "error",
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
 * Return the current build status for a website (idle / running / done / error).
 * Strips the full report from the response to keep it lightweight.
 */
export function getIntentBuildStatus(websiteId: string): Omit<IntentBuildState, "report"> & { hasReport: boolean } {
  const state = getState(websiteId);
  if (state.status === "done") {
    const { report: _r, ...rest } = state;
    return { ...rest, hasReport: true };
  }
  return { ...state, hasReport: false };
}

/**
 * Return the last completed intent-build report for a website.
 * Returns null if no completed run exists yet.
 */
export function getIntentBuildReport(websiteId: string): IntentBuildReport | null {
  const state = getState(websiteId);
  if (state.status === "done") return state.report;
  return null;
}
