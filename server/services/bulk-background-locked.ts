import pg from "pg";
import * as storage from "../storage";
import { runBulkBackgroundJob as runUnlockedBulkBackgroundJob } from "./bulk-background";

const lockPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL!,
  max: 2,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 30000,
});

/**
 * Runs a bulk background job under a PostgreSQL advisory lock.
 *
 * This prevents duplicate or overlapping execution of the same job during:
 * - Railway restarts
 * - redeploy windows
 * - double-clicks / duplicate requests
 * - retry collisions
 *
 * Lock scope is session-level and held for the full duration of the worker.
 */
export async function runBulkBackgroundJob(jobId: string): Promise<void> {
  const client = await lockPool.connect();
  let locked = false;

  try {
    const result = await client.query(
      `SELECT pg_try_advisory_lock(hashtext('bulk-background-job'), hashtext($1)) AS locked`,
      [jobId],
    );

    locked = result.rows[0]?.locked === true;

    if (!locked) {
      console.warn(`[bulk-lock] Job ${jobId} is already owned by another worker. Exiting duplicate runner.`);
      return;
    }

    await storage.updateGenerationJob(jobId, {
      settings: {
        ...(await storage.getGenerationJob(jobId))?.settings,
        workerLockAcquiredAt: new Date().toISOString(),
      } as any,
    } as any).catch(() => {});

    await runUnlockedBulkBackgroundJob(jobId);
  } finally {
    if (locked) {
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
