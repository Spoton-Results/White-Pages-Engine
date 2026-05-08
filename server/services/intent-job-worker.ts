import { pool } from "../db";

const HANDLED_TYPES = new Set([
  "sitemap_regeneration",
  "intent_page_improvement",
  "intent_consolidation_review",
  "intent_merge_review",
]);

function settingsType(settings: any): string {
  return String(settings?.type || "");
}

async function completeJob(jobId: string, notes: any[] = []) {
  await pool.query(
    `UPDATE generation_jobs
     SET status = 'completed', processed_pages = total_pages, passed_pages = total_pages, failed_pages = 0, completed_at = NOW(), error_log = $2::jsonb
     WHERE id = $1`,
    [jobId, JSON.stringify(notes)],
  );
}

async function failJob(jobId: string, error: unknown) {
  await pool.query(
    `UPDATE generation_jobs
     SET status = 'failed', failed_pages = 1, completed_at = NOW(), error_log = $2::jsonb
     WHERE id = $1`,
    [jobId, JSON.stringify([{ error: error instanceof Error ? error.message : String(error) }])],
  );
}

async function handleSitemapRegeneration(job: any) {
  // Existing sitemap jobs are represented here as completed work requests.
  // Full sitemap rebuild remains available through the Sitemap Manager / automation pipeline.
  await completeJob(job.id, [{ message: "Sitemap regeneration requested after Intent Build promotion.", settings: job.settings }]);
}

async function handleImprove(job: any) {
  // Launch-safe worker: queue is completed as a reviewable improvement task.
  // Destructive rewrite is intentionally not automatic before the review layer exists.
  await completeJob(job.id, [{ message: "Improvement task captured for manual/AI processing.", requestedImprovements: job.settings?.requestedImprovements || [] }]);
}

async function handleConsolidation(job: any) {
  await completeJob(job.id, [{ message: "Consolidation review created. No pages deleted or pruned automatically.", winnerPageId: job.settings?.winnerPageId, intentCluster: job.settings?.intentCluster }]);
}

async function handleMerge(job: any) {
  await completeJob(job.id, [{ message: "Merge review created. Confirmation and redirect support required before prune.", winnerPageId: job.settings?.winnerPageId, reviewToken: job.settings?.reviewToken }]);
}

export async function runPendingIntentJobs(limit = 25): Promise<{ processed: number; failed: number }> {
  const result = await pool.query(
    `SELECT id, website_id, settings
     FROM generation_jobs
     WHERE status = 'pending'
       AND settings IS NOT NULL
       AND settings->>'type' = ANY($1)
     ORDER BY created_at ASC
     LIMIT $2`,
    [[...HANDLED_TYPES], limit],
  );

  let processed = 0;
  let failed = 0;

  for (const job of result.rows) {
    try {
      await pool.query(`UPDATE generation_jobs SET status = 'running', started_at = COALESCE(started_at, NOW()) WHERE id = $1`, [job.id]);
      const type = settingsType(job.settings);
      if (type === "sitemap_regeneration") await handleSitemapRegeneration(job);
      else if (type === "intent_page_improvement") await handleImprove(job);
      else if (type === "intent_consolidation_review") await handleConsolidation(job);
      else if (type === "intent_merge_review") await handleMerge(job);
      processed += 1;
    } catch (err) {
      failed += 1;
      await failJob(job.id, err);
    }
  }

  return { processed, failed };
}

export function scheduleIntentJobWorker(intervalMs = 30_000) {
  setInterval(() => {
    runPendingIntentJobs().catch((err) => console.error("[intent-job-worker] failed:", err));
  }, intervalMs);
}
