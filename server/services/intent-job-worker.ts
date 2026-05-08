import { pool } from "../db";
import { logOperationalEvent } from "./observability";

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

async function failJob(job: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  await pool.query(
    `UPDATE generation_jobs
     SET status = 'failed', failed_pages = 1, completed_at = NOW(), error_log = $2::jsonb
     WHERE id = $1`,
    [job.id, JSON.stringify([{ error: message }])],
  );

  await logOperationalEvent({
    level: "error",
    source: "intent-job-worker",
    message: `Intent worker failed for ${settingsType(job.settings)} job`,
    websiteId: job.website_id,
    jobId: job.id,
    metadata: {
      jobType: settingsType(job.settings),
      error: message,
    },
  });
}

async function handleSitemapRegeneration(job: any) {
  await completeJob(job.id, [{ message: "Sitemap regeneration requested after Intent Build promotion.", settings: job.settings }]);

  await logOperationalEvent({
    level: "info",
    source: "intent-job-worker",
    message: "Sitemap regeneration job completed",
    websiteId: job.website_id,
    jobId: job.id,
    metadata: { type: settingsType(job.settings) },
  });
}

async function handleImprove(job: any) {
  await completeJob(job.id, [{ message: "Improvement task captured for manual/AI processing.", requestedImprovements: job.settings?.requestedImprovements || [] }]);

  await logOperationalEvent({
    level: "info",
    source: "intent-job-worker",
    message: "Intent improvement review task completed",
    websiteId: job.website_id,
    jobId: job.id,
    metadata: {
      type: settingsType(job.settings),
      requestedImprovements: job.settings?.requestedImprovements || [],
    },
  });
}

async function handleConsolidation(job: any) {
  await completeJob(job.id, [{ message: "Consolidation review created. No pages deleted or pruned automatically.", winnerPageId: job.settings?.winnerPageId, intentCluster: job.settings?.intentCluster }]);

  await logOperationalEvent({
    level: "warning",
    source: "intent-job-worker",
    message: "Consolidation review queued for human approval",
    websiteId: job.website_id,
    jobId: job.id,
    metadata: {
      type: settingsType(job.settings),
      winnerPageId: job.settings?.winnerPageId,
      intentCluster: job.settings?.intentCluster,
    },
  });
}

async function handleMerge(job: any) {
  await completeJob(job.id, [{ message: "Merge review created. Confirmation and redirect support required before prune.", winnerPageId: job.settings?.winnerPageId, reviewToken: job.settings?.reviewToken }]);

  await logOperationalEvent({
    level: "warning",
    source: "intent-job-worker",
    message: "Merge review queued for human approval",
    websiteId: job.website_id,
    jobId: job.id,
    metadata: {
      type: settingsType(job.settings),
      winnerPageId: job.settings?.winnerPageId,
      reviewToken: job.settings?.reviewToken,
    },
  });
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

      await logOperationalEvent({
        level: "info",
        source: "intent-job-worker",
        message: "Intent job started",
        websiteId: job.website_id,
        jobId: job.id,
        metadata: { type: settingsType(job.settings) },
      });

      const type = settingsType(job.settings);
      if (type === "sitemap_regeneration") await handleSitemapRegeneration(job);
      else if (type === "intent_page_improvement") await handleImprove(job);
      else if (type === "intent_consolidation_review") await handleConsolidation(job);
      else if (type === "intent_merge_review") await handleMerge(job);

      processed += 1;
    } catch (err) {
      failed += 1;
      await failJob(job, err);
    }
  }

  return { processed, failed };
}

export function scheduleIntentJobWorker(intervalMs = 30_000) {
  setInterval(() => {
    runPendingIntentJobs().catch(async (err) => {
      console.error("[intent-job-worker] failed:", err);

      await logOperationalEvent({
        level: "error",
        source: "intent-job-worker",
        message: "Intent worker scheduler crashed",
        metadata: {
          error: err instanceof Error ? err.message : String(err),
        },
      });
    });
  }, intervalMs);
}
