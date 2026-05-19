import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../auth";
import { pool } from "../db";
import * as storage from "../storage";
import { JOB_STATUS } from "../../shared/job-status";

const router = Router();

type AnyJob = Record<string, any>;
const STALE_JOB_MINUTES = Number(process.env.DEAD_JOB_MINUTES || 30);
const STALE_JOB_INTERVAL_MS = Number(process.env.DEAD_JOB_INTERVAL_MS || 5 * 60 * 1000);
let staleJobRecoveryStarted = false;
let staleJobRecoveryRunning = false;

function progressTotals(settings: any) {
  const progress = Array.isArray(settings?.progress) ? settings.progress : [];
  const created = progress.reduce((sum: number, p: any) => sum + (p.created ?? 0) + (p.updated ?? 0), 0);
  const skipped = progress.reduce((sum: number, p: any) => sum + (p.skipped ?? 0), 0);
  const errors = progress.reduce((sum: number, p: any) => sum + (p.errors ?? 0), 0);
  return { created, skipped, errors, processed: created + skipped + errors };
}

function mapJobForDashboard(job: AnyJob) {
  const settings = job.settings || {};
  const totals = progressTotals(settings);
  const completedPages = job.completedPages ?? job.completed_pages ?? totals.created ?? 0;
  const failedPages = job.failedPages ?? job.failed_pages ?? totals.errors ?? 0;
  const processedPages = Math.max(job.processedPages ?? job.processed_pages ?? 0, totals.processed, completedPages + failedPages);

  return {
    ...job,
    name: job.name || job.jobName || `Generation job - ${(settings.services || []).length || 0} service(s)`,
    accountId: job.accountId ?? job.account_id,
    websiteId: job.websiteId ?? job.website_id,
    blueprintId: job.blueprintId ?? job.blueprint_id,
    totalPages: job.totalPages ?? job.total_pages ?? 0,
    completedPages,
    failedPages,
    processedPages,
    passedPages: job.passedPages ?? job.passed_pages ?? completedPages,
    createdAt: job.createdAt ?? job.created_at,
    startedAt: job.startedAt ?? job.started_at,
    completedAt: job.completedAt ?? job.completed_at,
    errorLog: job.errorLog ?? job.error_log ?? [],
  };
}

export async function recoverDeadGenerationJobs(minutes = STALE_JOB_MINUTES) {
  const thresholdMinutes = Math.max(5, Number(minutes || STALE_JOB_MINUTES));
  const reason = `Recovered stale generation job after ${thresholdMinutes} minutes without terminal status.`;

  const result = await pool.query(
    `UPDATE generation_jobs
     SET status = $1::job_status,
         completed_at = COALESCE(completed_at, NOW()),
         error_log = COALESCE(error_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('type', 'stale_job_recovery', 'message', $2::text, 'recoveredAt', NOW())),
         settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('fatalError', $2::text, 'staleJobRecoveredAt', NOW(), 'staleJobThresholdMinutes', $3::int)
     WHERE status IN ($4::job_status, $5::job_status)
       AND COALESCE(started_at, created_at) < NOW() - ($3::text || ' minutes')::interval
     RETURNING *`,
    [JOB_STATUS.FAILED, reason, thresholdMinutes, JOB_STATUS.PENDING, JOB_STATUS.RUNNING],
  );

  return result.rows.map((job: AnyJob) => mapJobForDashboard(job));
}

function startStaleJobRecoveryLoop() {
  if (staleJobRecoveryStarted || process.env.DISABLE_DEAD_JOB_RECOVERY === "true") return;
  staleJobRecoveryStarted = true;

  const run = async () => {
    if (staleJobRecoveryRunning) return;
    staleJobRecoveryRunning = true;
    try {
      const recovered = await recoverDeadGenerationJobs();
      if (recovered.length > 0) console.warn(`[job-recovery] Recovered ${recovered.length} stale generation job(s).`);
    } catch (error) {
      console.error("[job-recovery] Stale job recovery failed", error);
    } finally {
      staleJobRecoveryRunning = false;
    }
  };

  setTimeout(run, 15_000).unref?.();
  setInterval(run, STALE_JOB_INTERVAL_MS).unref?.();
}

startStaleJobRecoveryLoop();

router.get("/api/jobs", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const websiteId = typeof req.query.websiteId === "string" ? req.query.websiteId : undefined;
    const jobs = await storage.getGenerationJobs(websiteId);
    return res.json(jobs.map((job: AnyJob) => mapJobForDashboard(job)));
  } catch (error) {
    return next(error);
  }
});

router.post("/api/jobs/recover-dead", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const minutes = Number(req.body?.minutes || req.query.minutes || STALE_JOB_MINUTES);
    const recovered = await recoverDeadGenerationJobs(minutes);
    return res.json({ recovered: recovered.length, jobs: recovered });
  } catch (error) {
    return next(error);
  }
});

router.get("/api/jobs/:jobId", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await storage.getGenerationJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Generation job not found." });
    return res.json(mapJobForDashboard(job as AnyJob));
  } catch (error) {
    return next(error);
  }
});

router.post("/api/jobs/:jobId/cancel", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await storage.updateGenerationJob(req.params.jobId, { status: JOB_STATUS.CANCELLED as any, completedAt: new Date() } as any);
    if (!job) return res.status(404).json({ error: "Generation job not found." });
    return res.json(mapJobForDashboard(job as AnyJob));
  } catch (error) {
    return next(error);
  }
});

export default router;