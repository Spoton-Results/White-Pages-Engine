import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../auth";
import { pool } from "../db";
import * as storage from "../storage";
import { runBulkBackgroundJob, type BulkJobSettings } from "../services/bulk-background";
import { JOB_STATUS } from "../../shared/job-status";

const router = Router();

type AnyJob = Record<string, any>;
const DEAD_JOB_MINUTES = Number(process.env.DEAD_JOB_MINUTES || 30);
const DEAD_JOB_INTERVAL_MS = Number(process.env.DEAD_JOB_INTERVAL_MS || 5 * 60 * 1000);
const PENDING_BULK_JOB_INTERVAL_MS = Number(process.env.PENDING_BULK_JOB_INTERVAL_MS || 15 * 1000);
const PENDING_BULK_JOB_BATCH_LIMIT = Math.max(1, Number(process.env.PENDING_BULK_JOB_BATCH_LIMIT || 3));
const NO_CLUSTER_SENTINEL = "__NO_CLUSTERS__";
let deadJobRecoveryStarted = false;
let deadJobRecoveryRunning = false;
let pendingBulkJobPumpStarted = false;
let pendingBulkJobPumpRunning = false;
const locallyActiveBulkJobs = new Set<string>();
const locallyActiveCampaigns = new Set<string>();

function normalizeProgress(services: string[]) {
  return services.map((service) => ({
    service,
    status: "pending" as const,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  }));
}

function normalizeSettings(body: any): BulkJobSettings {
  const services = Array.isArray(body?.services) ? body.services.filter(Boolean).map(String) : [];
  const mode = body?.mode === "specific_cities" || body?.mode === "specific_states" || body?.mode === "all_states"
    ? body.mode
    : "all_states";

  return {
    services,
    blueprintId: body?.blueprintId || undefined,
    queryClusterIds: Array.isArray(body?.queryClusterIds) ? body.queryClusterIds.map(String).filter(Boolean) : undefined,
    mode,
    states: Array.isArray(body?.states) ? body.states.map(String) : undefined,
    cities: Array.isArray(body?.cities)
      ? body.cities.map((c: any) => ({ name: String(c.name || ""), stateAbbr: String(c.stateAbbr || "") })).filter((c: any) => c.name && c.stateAbbr)
      : undefined,
    overwrite: Boolean(body?.overwrite),
    progress: normalizeProgress(services),
  };
}

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
  const processedPages = Math.max(
    job.processedPages ?? job.processed_pages ?? 0,
    totals.processed,
    completedPages + failedPages,
  );

  return {
    ...job,
    name: job.name || job.jobName || `Bulk generation — ${(settings.services || []).length || 0} service(s)`,
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

function getTargetCount(settings: BulkJobSettings) {
  if (settings.mode === "specific_states") return settings.states?.length || 0;
  if (settings.mode === "specific_cities") return settings.cities?.length || 0;
  return 50;
}

function getEffectiveClusters(settings: BulkJobSettings) {
  const requestedClusterIds = (settings.queryClusterIds || []).filter((id) => id && id !== NO_CLUSTER_SENTINEL);
  return {
    requestedClusterIds,
    effectiveQueryClusterIds: requestedClusterIds.length > 0 ? requestedClusterIds : [NO_CLUSTER_SENTINEL],
    clusterCount: requestedClusterIds.length || 1,
  };
}

async function getAccountBlueprintIds(accountId: string) {
  const result = await pool.query(
    `SELECT id FROM blueprints WHERE account_id = $1 ORDER BY created_at ASC`,
    [accountId],
  );
  return result.rows.map((row: AnyJob) => String(row.id)).filter(Boolean);
}

async function recoverDeadGenerationJobs(minutes = DEAD_JOB_MINUTES) {
  const thresholdMinutes = Math.max(5, Number(minutes || DEAD_JOB_MINUTES));

  const result = await pool.query(
    `UPDATE generation_jobs
     SET status = $1::job_status,
         completed_at = COALESCE(completed_at, NOW())
     WHERE status = $2::job_status
       AND started_at IS NULL
       AND created_at < NOW() - ($3::text || ' minutes')::interval
     RETURNING *`,
    [JOB_STATUS.FAILED, JOB_STATUS.PENDING, thresholdMinutes],
  );

  return result.rows.map((job: AnyJob) => mapJobForDashboard(job));
}

function startDeadJobRecoveryLoop() {
  if (deadJobRecoveryStarted || process.env.DISABLE_DEAD_JOB_RECOVERY === "true") return;
  deadJobRecoveryStarted = true;

  const run = async () => {
    if (deadJobRecoveryRunning) return;
    deadJobRecoveryRunning = true;
    try {
      const recovered = await recoverDeadGenerationJobs();
      if (recovered.length > 0) {
        console.warn(`[job-recovery] Recovered ${recovered.length} stale generation job(s).`);
      }
    } catch (error) {
      console.error("[job-recovery] Failed to recover stale jobs", error);
    } finally {
      deadJobRecoveryRunning = false;
    }
  };

  setTimeout(run, 15_000).unref?.();
  setInterval(run, DEAD_JOB_INTERVAL_MS).unref?.();
}

function launchBulkJob(jobId: string, source: "route" | "pump") {
  if (locallyActiveBulkJobs.has(jobId)) return;
  locallyActiveBulkJobs.add(jobId);

  setImmediate(async () => {
    try {
      console.log(`[bulk-generate-job-fast] Launching ${source} runner for job ${jobId}`);
      await runBulkBackgroundJob(jobId);
    } catch (error: any) {
      console.error(`[bulk-generate-job-fast] Job ${jobId} failed`, error);
      const job = await storage.getGenerationJob(jobId).catch(() => null);
      await storage.updateGenerationJob(jobId, {
        status: JOB_STATUS.FAILED as any,
        completedAt: new Date(),
        settings: {
          ...((job as any)?.settings || {}),
          fatalError: error?.message || "Unknown bulk generation failure",
          failedBy: source,
          failedAt: new Date().toISOString(),
        } as any,
      } as any).catch(() => {});
    } finally {
      locallyActiveBulkJobs.delete(jobId);
    }
  });
}

async function runBulkCampaign(parentJobId: string) {
  if (locallyActiveCampaigns.has(parentJobId)) return;
  locallyActiveCampaigns.add(parentJobId);

  try {
    const parentJob = await storage.getGenerationJob(parentJobId);
    if (!parentJob) return;
    const settings = ((parentJob as any).settings || {}) as AnyJob;
    const blueprintIds = Array.isArray(settings.blueprintIds) ? settings.blueprintIds.map(String).filter(Boolean) : [];
    const services = Array.isArray(settings.services) ? settings.services.map(String) : [];
    const targetCount = Number(settings.targetCount || 0);
    const clusterCount = Number(settings.clusterCount || 1);
    const childTotalPages = services.length * targetCount * clusterCount;

    await storage.updateGenerationJob(parentJobId, {
      status: JOB_STATUS.RUNNING as any,
      startedAt: new Date(),
      settings: { ...settings, currentBlueprintIndex: 0, childTotalPages } as any,
    } as any);

    let processedPages = Number((parentJob as any).processedPages || 0);
    let passedPages = Number((parentJob as any).passedPages || 0);
    let failedPages = Number((parentJob as any).failedPages || 0);
    const childJobs: AnyJob[] = Array.isArray(settings.childJobs) ? settings.childJobs : [];

    for (let i = 0; i < blueprintIds.length; i++) {
      const latestParent = await storage.getGenerationJob(parentJobId);
      if (!latestParent || (latestParent as any).status === JOB_STATUS.CANCELLED) {
        await storage.updateGenerationJob(parentJobId, {
          status: JOB_STATUS.CANCELLED as any,
          completedAt: new Date(),
        } as any).catch(() => {});
        return;
      }

      await storage.updateGenerationJob(parentJobId, {
        settings: {
          ...(((latestParent as any).settings || {}) as AnyJob),
          currentBlueprintIndex: i,
          currentBlueprintId: blueprintIds[i],
          childJobs,
        } as any,
      } as any);

      const childSettings = {
        ...settings.childBaseSettings,
        blueprintId: blueprintIds[i],
        progress: normalizeProgress(services),
        jobType: "bulk-background-child",
        parentJobId,
        campaignBlueprintIndex: i + 1,
        campaignBlueprintTotal: blueprintIds.length,
      } as any;

      const childJob = await storage.createGenerationJob({
        accountId: (parentJob as any).accountId,
        websiteId: (parentJob as any).websiteId,
        blueprintId: blueprintIds[i],
        name: `Bulk campaign child ${i + 1}/${blueprintIds.length}`,
        status: JOB_STATUS.PENDING,
        totalPages: childTotalPages,
        processedPages: 0,
        passedPages: 0,
        failedPages: 0,
        errorLog: [],
        settings: childSettings,
      } as any);

      childJobs.push({ id: childJob.id, blueprintId: blueprintIds[i], index: i + 1, status: "running" });

      try {
        await runBulkBackgroundJob(childJob.id);
      } catch (error: any) {
        childJobs[childJobs.length - 1] = { ...childJobs[childJobs.length - 1], status: "failed", error: error?.message || "Child job failed" };
        throw error;
      }

      const finishedChild = await storage.getGenerationJob(childJob.id);
      const childProcessed = Number((finishedChild as any)?.processedPages || childTotalPages || 0);
      const childPassed = Number((finishedChild as any)?.passedPages || 0);
      const childFailed = Number((finishedChild as any)?.failedPages || 0);
      processedPages += childProcessed;
      passedPages += childPassed;
      failedPages += childFailed;
      childJobs[childJobs.length - 1] = { ...childJobs[childJobs.length - 1], status: (finishedChild as any)?.status || "completed" };

      await storage.updateGenerationJob(parentJobId, {
        processedPages,
        passedPages,
        failedPages,
        settings: {
          ...(((await storage.getGenerationJob(parentJobId)) as any)?.settings || {}),
          currentBlueprintIndex: i + 1,
          completedBlueprints: i + 1,
          childJobs,
        } as any,
      } as any);
    }

    await storage.updateGenerationJob(parentJobId, {
      status: JOB_STATUS.COMPLETED as any,
      completedAt: new Date(),
      processedPages,
      passedPages,
      failedPages,
      settings: {
        ...(((await storage.getGenerationJob(parentJobId)) as any)?.settings || {}),
        completedBlueprints: blueprintIds.length,
        childJobs,
      } as any,
    } as any);
  } catch (error: any) {
    console.error(`[bulk-campaign] Campaign ${parentJobId} failed`, error);
    const job = await storage.getGenerationJob(parentJobId).catch(() => null);
    await storage.updateGenerationJob(parentJobId, {
      status: JOB_STATUS.FAILED as any,
      completedAt: new Date(),
      settings: {
        ...((job as any)?.settings || {}),
        fatalError: error?.message || "Unknown bulk campaign failure",
        failedAt: new Date().toISOString(),
      } as any,
    } as any).catch(() => {});
  } finally {
    locallyActiveCampaigns.delete(parentJobId);
  }
}

function launchBulkCampaign(parentJobId: string) {
  setImmediate(() => runBulkCampaign(parentJobId));
}

async function findPendingBulkGenerationJobs(limit = PENDING_BULK_JOB_BATCH_LIMIT) {
  const result = await pool.query(
    `SELECT id
     FROM generation_jobs
     WHERE status = $1::job_status
       AND COALESCE(settings->>'jobType', '') = 'bulk-background'
     ORDER BY created_at ASC
     LIMIT $2`,
    [JOB_STATUS.PENDING, limit],
  );

  return result.rows.map((row: AnyJob) => String(row.id)).filter(Boolean);
}

function startPendingBulkJobPump() {
  if (pendingBulkJobPumpStarted || process.env.DISABLE_PENDING_BULK_JOB_PUMP === "true") return;
  pendingBulkJobPumpStarted = true;

  const run = async () => {
    if (pendingBulkJobPumpRunning) return;
    pendingBulkJobPumpRunning = true;
    try {
      const jobIds = await findPendingBulkGenerationJobs();
      for (const jobId of jobIds) launchBulkJob(jobId, "pump");
    } catch (error) {
      console.error("[bulk-generate-job-fast] Pending bulk job pump failed", error);
    } finally {
      pendingBulkJobPumpRunning = false;
    }
  };

  setTimeout(run, 2_000).unref?.();
  setInterval(run, PENDING_BULK_JOB_INTERVAL_MS).unref?.();
}

startDeadJobRecoveryLoop();
startPendingBulkJobPump();

router.post("/api/websites/:websiteId/bulk-campaign", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { websiteId } = req.params;
    const settings = normalizeSettings(req.body || {});

    if (!settings.services.length) {
      return res.status(400).json({ error: "Select at least one service before starting bulk campaign." });
    }

    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found." });

    const requestedBlueprintIds = Array.isArray((req.body || {}).blueprintIds)
      ? (req.body || {}).blueprintIds.map(String).filter(Boolean)
      : [];
    const blueprintIds = (req.body || {}).runAllBlueprints
      ? await getAccountBlueprintIds((website as any).accountId)
      : requestedBlueprintIds.length > 0
        ? requestedBlueprintIds
        : settings.blueprintId
          ? [settings.blueprintId]
          : [];

    if (blueprintIds.length === 0) {
      return res.status(400).json({ error: "No blueprints available for campaign." });
    }

    const targetCount = getTargetCount(settings);
    const { requestedClusterIds, effectiveQueryClusterIds, clusterCount } = getEffectiveClusters(settings);
    const totalPages = settings.services.length * targetCount * clusterCount * blueprintIds.length;
    const childBaseSettings = {
      ...(settings as any),
      queryClusterIds: effectiveQueryClusterIds,
      clusterCount,
      targetCount,
    } as any;

    const parentJob = await storage.createGenerationJob({
      accountId: (website as any).accountId,
      websiteId,
      blueprintId: null,
      name: `Bulk campaign — ${blueprintIds.length} blueprint(s) × ${settings.services.length} service(s)`,
      status: JOB_STATUS.PENDING,
      totalPages,
      processedPages: 0,
      passedPages: 0,
      failedPages: 0,
      errorLog: [],
      settings: {
        ...(settings as any),
        jobType: "bulk-campaign",
        blueprintIds,
        blueprintCount: blueprintIds.length,
        queryClusterIds: effectiveQueryClusterIds,
        requestedClusterIds,
        clusterCount,
        targetCount,
        childBaseSettings,
        childJobs: [],
      } as any,
    } as any);

    res.status(202).json({
      jobId: parentJob.id,
      status: JOB_STATUS.PENDING,
      totalPages,
      blueprintCount: blueprintIds.length,
      message: "Bulk campaign queued in backend.",
    });

    launchBulkCampaign(parentJob.id);
  } catch (error) {
    return next(error);
  }
});

router.post("/api/websites/:websiteId/bulk-generate-job", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { websiteId } = req.params;
    const settings = normalizeSettings(req.body || {});
    if (!settings.services.length) {
      return res.status(400).json({ error: "Select at least one service before starting bulk generation." });
    }
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found." });
    const targetCount = getTargetCount(settings);
    const { requestedClusterIds, effectiveQueryClusterIds, clusterCount } = getEffectiveClusters(settings);
    const estimatedTotal = settings.services.length * targetCount * clusterCount;
    const jobSettings = { ...(settings as any), queryClusterIds: effectiveQueryClusterIds, requestedClusterIds, clusterCount, targetCount, jobType: "bulk-background" } as any;
    const job = await storage.createGenerationJob({
      accountId: website.accountId,
      websiteId,
      blueprintId: settings.blueprintId || null,
      name: `Bulk generation — ${settings.services.length} service(s) × ${targetCount} target(s)`,
      status: JOB_STATUS.PENDING,
      totalPages: estimatedTotal,
      processedPages: 0,
      passedPages: 0,
      failedPages: 0,
      errorLog: [],
      settings: jobSettings,
    } as any);
    res.status(202).json({ jobId: job.id, status: JOB_STATUS.PENDING, message: "Bulk generation queued in background." });
    launchBulkJob(job.id, "route");
  } catch (error) {
    return next(error);
  }
});

export default router;
