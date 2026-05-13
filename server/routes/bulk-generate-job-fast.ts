import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../auth";
import * as storage from "../storage";
import { runBulkBackgroundJob, type BulkJobSettings } from "../services/bulk-background";

const router = Router();

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

    const targetCount = settings.mode === "specific_states"
      ? settings.states?.length || 0
      : settings.mode === "specific_cities"
        ? settings.cities?.length || 0
        : 50;

    const clusterCount = settings.queryClusterIds?.length || 1;
    const estimatedTotal = settings.services.length * targetCount * clusterCount;

    const job = await storage.createGenerationJob({
      websiteId,
      blueprintId: settings.blueprintId || null,
      status: "queued",
      totalPages: estimatedTotal,
      completedPages: 0,
      failedPages: 0,
      settings: settings as any,
    } as any);

    res.status(202).json({
      jobId: job.id,
      status: "queued",
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
