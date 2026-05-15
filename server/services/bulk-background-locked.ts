import pg from "pg";
import * as storage from "../storage";
import { runBulkBackgroundJob as runUnlockedBulkBackgroundJob } from "./bulk-background";

const lockPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL!,
  max: 3,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 30000,
});

const MAX_CONCURRENT_BULK_JOBS = Math.max(1, Number(process.env.MAX_CONCURRENT_BULK_JOBS || 2));
const MAX_CONCURRENT_BULK_JOBS_PER_WEBSITE = Math.max(1, Number(process.env.MAX_CONCURRENT_BULK_JOBS_PER_WEBSITE || 1));
const GLOBAL_SLOT_LOCK_START = 811_000;
const WEBSITE_SLOT_LOCK_START = 812_000;

async function tryAcquireOneOf(client: pg.PoolClient, namespace: string, start: number, count: number, key?: string): Promise<number | null> {
  for (let i = 0; i < count; i++) {
    const lockKey = key ? `${namespace}:${key}:${i}` : `${namespace}:${i}`;
    const result = await client.query(
      `SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked`,
      [start, lockKey],
    );
    if (result.rows[0]?.locked === true) return i;
  }
  return null;
}

async function releaseSlot(client: pg.PoolClient, namespace: string, start: number, slot: number | null, key?: string) {
  if (slot === null) return;
  const lockKey = key ? `${namespace}:${key}:${slot}` : `${namespace}:${slot}`;
  await client.query(`SELECT pg_advisory_unlock($1, hashtext($2))`, [start, lockKey]).catch((error) => {
    console.error(`[bulk-lock] Failed to release ${namespace} slot ${slot}`, error);
  });
}

async function markJobDeferred(jobId: string, reason: string) {
  const job = await storage.getGenerationJob(jobId).catch(() => null);
  await storage.updateGenerationJob(jobId, {
    status: "pending" as any,
    settings: {
      ...(job as any)?.settings,
      deferredReason: reason,
      deferredAt: new Date().toISOString(),
      maxConcurrentBulkJobs: MAX_CONCURRENT_BULK_JOBS,
      maxConcurrentBulkJobsPerWebsite: MAX_CONCURRENT_BULK_JOBS_PER_WEBSITE,
    } as any,
  } as any).catch(() => {});
}

/**
 * Runs a bulk background job under PostgreSQL advisory locks.
 *
 * Guardrails:
 * 1. Per-job lock prevents duplicate execution of the same job.
 * 2. Global slot lock limits total concurrent bulk jobs across all Railway instances.
 * 3. Per-website slot lock prevents one website from running multiple heavy jobs at once.
 */
export async function runBulkBackgroundJob(jobId: string): Promise<void> {
  const client = await lockPool.connect();
  let jobLocked = false;
  let globalSlot: number | null = null;
  let websiteSlot: number | null = null;
  let websiteId: string | null = null;

  try {
    const jobLockResult = await client.query(
      `SELECT pg_try_advisory_lock(hashtext('bulk-background-job'), hashtext($1)) AS locked`,
      [jobId],
    );

    jobLocked = jobLockResult.rows[0]?.locked === true;

    if (!jobLocked) {
      console.warn(`[bulk-lock] Job ${jobId} is already owned by another worker. Exiting duplicate runner.`);
      return;
    }

    const job = await storage.getGenerationJob(jobId);
    websiteId = (job as any)?.websiteId || (job as any)?.website_id || null;

    globalSlot = await tryAcquireOneOf(client, "bulk-global-slot", GLOBAL_SLOT_LOCK_START, MAX_CONCURRENT_BULK_JOBS);
    if (globalSlot === null) {
      const reason = `Bulk generation deferred: global concurrency limit reached (${MAX_CONCURRENT_BULK_JOBS}).`;
      console.warn(`[bulk-lock] ${reason} Job ${jobId}.`);
      await markJobDeferred(jobId, reason);
      return;
    }

    if (websiteId) {
      websiteSlot = await tryAcquireOneOf(client, "bulk-website-slot", WEBSITE_SLOT_LOCK_START, MAX_CONCURRENT_BULK_JOBS_PER_WEBSITE, websiteId);
      if (websiteSlot === null) {
        const reason = `Bulk generation deferred: website concurrency limit reached (${MAX_CONCURRENT_BULK_JOBS_PER_WEBSITE}).`;
        console.warn(`[bulk-lock] ${reason} Job ${jobId}.`);
        await markJobDeferred(jobId, reason);
        return;
      }
    }

    await storage.updateGenerationJob(jobId, {
      settings: {
        ...(job as any)?.settings,
        workerLockAcquiredAt: new Date().toISOString(),
        globalConcurrencySlot: globalSlot,
        websiteConcurrencySlot: websiteSlot,
        maxConcurrentBulkJobs: MAX_CONCURRENT_BULK_JOBS,
        maxConcurrentBulkJobsPerWebsite: MAX_CONCURRENT_BULK_JOBS_PER_WEBSITE,
      } as any,
    } as any).catch(() => {});

    await runUnlockedBulkBackgroundJob(jobId);
  } finally {
    await releaseSlot(client, "bulk-website-slot", WEBSITE_SLOT_LOCK_START, websiteSlot, websiteId || undefined);
    await releaseSlot(client, "bulk-global-slot", GLOBAL_SLOT_LOCK_START, globalSlot);

    if (jobLocked) {
      await client.query(
        `SELECT pg_advisory_unlock(hashtext('bulk-background-job'), hashtext($1))`,
        [jobId],
      ).catch((error) => {
        console.error(`[bulk-lock] Failed to release advisory lock for job ${jobId}`, error);
      });
    }
    client.release();
  }
}

export type { BulkJobSettings } from "./bulk-background";
