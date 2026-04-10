/**
 * bank-write-background.ts
 * Persistent bank-writing job — survives server restarts.
 * Job state is stored in the generationJobs table (settings.type = "bank_write").
 * On startup the server resumes any interrupted jobs automatically.
 */
import * as storage from "../storage";
import { writeVariationsForService } from "./variation-writer";
import type { BrandContext } from "./variation-writer";

export interface BankWriteSettings {
  type: "bank_write";
  ctx: BrandContext;
  progress: Array<{
    serviceId: string;
    serviceName: string;
    status: "pending" | "running" | "done" | "error";
  }>;
}

/** Create a job record and start processing in the background. Returns jobId immediately. */
export async function startBankWriteJob(
  websiteId: string,
  accountId: string,
  services: Array<{ id: string; name: string }>,
  ctx: BrandContext,
): Promise<string> {
  const settings: BankWriteSettings = {
    type: "bank_write",
    ctx,
    progress: services.map(s => ({ serviceId: s.id, serviceName: s.name, status: "pending" })),
  };

  const job = await storage.createGenerationJob({
    accountId,
    websiteId,
    name: `Write variation banks (${services.length} services)`,
    status: "pending",
    totalPages: services.length,
    processedPages: 0,
    passedPages: 0,
    failedPages: 0,
    settings: settings as any,
  });

  // Fire-and-forget — client polls the job record for progress
  setImmediate(() => {
    runBankWriteJob(job.id).catch(err => {
      console.error("[bank-write] Unexpected error in job", job.id, err);
      storage.updateGenerationJob(job.id, { status: "failed", completedAt: new Date() }).catch(() => {});
    });
  });

  return job.id;
}

/** Process (or resume) a bank-write job. Safe to call after a server restart. */
export async function runBankWriteJob(jobId: string): Promise<void> {
  const job = await storage.getGenerationJob(jobId);
  if (!job) { console.error("[bank-write] Job not found:", jobId); return; }

  const settings = job.settings as unknown as BankWriteSettings;
  if (settings?.type !== "bank_write") { console.error("[bank-write] Not a bank_write job:", jobId); return; }

  await storage.updateGenerationJob(jobId, { status: "running", startedAt: new Date() });
  console.log(`[bank-write] Starting job ${jobId} — ${settings.progress.length} services`);

  const { ctx, progress } = settings;
  let done = 0;
  let failed = 0;

  // Count already-finished entries from a previous run
  for (const entry of progress) {
    if (entry.status === "done") done++;
    else if (entry.status === "error") failed++;
  }

  // Process 3 services at a time (same as the previous non-persistent implementation)
  const CONCURRENCY = 3;
  const pending = progress
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => entry.status !== "done" && entry.status !== "error");

  for (let b = 0; b < pending.length; b += CONCURRENCY) {
    const batch = pending.slice(b, b + CONCURRENCY);

    // Mark batch as running
    for (const { i, entry } of batch) {
      progress[i] = { ...entry, status: "running" };
    }
    await storage.updateGenerationJob(jobId, { settings: { ...settings, progress } as any });

    await Promise.all(batch.map(async ({ i, entry }) => {
      try {
        await storage.deleteVariationBanks(job.websiteId, entry.serviceName);
        await writeVariationsForService(entry.serviceName, job.accountId, job.websiteId, ctx);
        progress[i] = { ...entry, status: "done" };
        done++;
      } catch (err: any) {
        console.error(`[bank-write] Failed for "${entry.serviceName}":`, err?.message ?? err);
        progress[i] = { ...entry, status: "error" };
        failed++;
      }
    }));

    await storage.updateGenerationJob(jobId, {
      settings: { ...settings, progress } as any,
      processedPages: done + failed,
      passedPages: done,
      failedPages: failed,
    });
  }

  await storage.updateGenerationJob(jobId, {
    status: "completed",
    completedAt: new Date(),
    processedPages: done + failed,
    passedPages: done,
    failedPages: failed,
    settings: { ...settings, progress } as any,
  });

  console.log(`[bank-write] Job ${jobId} complete — ${done} done, ${failed} failed`);

  // Auto 7: Flag thin banks after every bank write
  try {
    const { checkThinBanksAfterUpdate } = await import("./automation");
    await checkThinBanksAfterUpdate(job.websiteId);
  } catch (err) {
    console.error("[auto7] Thin bank check failed (non-fatal):", err);
  }
}
