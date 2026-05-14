import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../auth";
import * as storage from "../storage";
import { runBulkBackgroundJob, type BulkJobSettings } from "../services/bulk-background";

const router = Router();

type AnyJob = Record<string, any>;

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
    queryClusterIds: Array.isArray(body?.queryClusterIds) ? body.queryClusterIds.map(String) : undefined,
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

router.get("/api/jobs", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const websiteId = typeof req.query.websiteId === "string" ? req.query.websiteId : undefined;
    const jobs = await storage.getGenerationJobs(websiteId);
    return res.json(jobs.map((job: AnyJob) => mapJobForDashboard(job)));
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
    const job = await storage.updateGenerationJob(req.params.jobId, { status: "cancelled" as any, completedAt: new Date() } as any);
    if (!job) return res.status(404).json({ error: "Generation job not found." });
    return res.json(mapJobForDashboard(job as AnyJob));
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

    if (settings.mode === "specific_states" && (!settings.states || settings.states.length === 0)) {
      return res.status(400).json({ error: "Select at least one state." });
    }

    if (settings.mode === "specific_cities" && (!settings.cities || settings.cities.length === 0)) {
      return res.status(400).json({ error: "Select at least one city." });
    }

    const website = await storage.getWebsite(websiteId);
    if (!website) {
      return res.status(404).json({ error: "Website not found." });
    }
    if (!website.accountId) {
      return res.status(400).json({ error: "Website is missing an accountId; cannot create generation job." });
    }

    const targetCount = settings.mode === "specific_states"
      ? settings.states?.length || 0
      : settings.mode === "specific_cities"
        ? settings.cities?.length || 0
        : 50;

    const clusterCount = settings.queryClusterIds?.length || 1;
    const estimatedTotal = settings.services.length * targetCount * clusterCount;
    const jobName = `Bulk generation — ${settings.services.length} service(s) × ${targetCount} target(s)`;

    const job = await storage.createGenerationJob({
      accountId: website.accountId,
      websiteId,
      blueprintId: settings.blueprintId || null,
      name: jobName,
      status: "pending",
      totalPages: estimatedTotal,
      processedPages: 0,
      passedPages: 0,
      failedPages: 0,
      errorLog: [],
      settings: {
        ...(settings as any),
        clusterCount,
        targetCount,
        jobType: "bulk-background",
      } as any,
    } as any);

    res.status(202).json({
      jobId: job.id,
      status: "pending",
      message: "Bulk generation started in background.",
    });

    setImmediate(async () => {
      try {
        await runBulkBackgroundJob(job.id);
      } catch (error: any) {
        console.error(`[bulk-generate-job-fast] Job ${job.id} failed`, error);
        await storage.updateGenerationJob(job.id, {
          status: "failed" as any,
          completedAt: new Date(),
          settings: {
            ...(settings as any),
            clusterCount,
            targetCount,
            jobType: "bulk-background",
            fatalError: error?.message || "Unknown bulk generation failure",
          } as any,
        } as any).catch(() => {});
      }
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
