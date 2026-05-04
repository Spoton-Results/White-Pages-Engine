import { renderPublishedPagesBatchToR2 } from "../server/services/static-page-renderer";
import { pool } from "../server/db";

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function readNumberArg(name: string, fallback: number): number {
  const value = readArg(name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getCounts(websiteId: string) {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE status = 'published' AND COALESCE(noindex, false) = false
       )::int AS published_indexable,
       COUNT(*) FILTER (
         WHERE status = 'published'
           AND COALESCE(noindex, false) = false
           AND r2_key IS NOT NULL
           AND content_hash IS NOT NULL
           AND rendered_at IS NOT NULL
       )::int AS rendered,
       COUNT(*) FILTER (
         WHERE status = 'published'
           AND COALESCE(noindex, false) = false
           AND (r2_key IS NULL OR content_hash IS NULL OR rendered_at IS NULL)
       )::int AS missing
     FROM pages
     WHERE website_id = $1`,
    [websiteId],
  );

  return result.rows[0] as {
    published_indexable: number;
    rendered: number;
    missing: number;
  };
}

async function main() {
  const websiteId = readArg("websiteId") || readArg("website-id");
  const batchSize = Math.min(readNumberArg("batch", 500), 500);
  const maxBatches = readNumberArg("maxBatches", 9999);
  const pauseMs = readNumberArg("pauseMs", 500);
  const dryRun = process.argv.includes("--dry-run");

  if (!websiteId) {
    throw new Error("Missing required --websiteId=<id> argument");
  }

  if (process.env.R2_RENDERING_ENABLED !== "true") {
    throw new Error("R2_RENDERING_ENABLED must be true");
  }

  const before = await getCounts(websiteId);
  console.log("[r2-backfill] Starting", {
    websiteId,
    batchSize,
    maxBatches,
    pauseMs,
    dryRun,
    before,
  });

  let totalAttempted = 0;
  let totalRendered = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (let batch = 1; batch <= maxBatches; batch++) {
    const counts = await getCounts(websiteId);
    if (counts.missing <= 0) {
      console.log("[r2-backfill] Complete", { batch, counts });
      break;
    }

    console.log("[r2-backfill] Batch starting", {
      batch,
      missingBeforeBatch: counts.missing,
      renderedBeforeBatch: counts.rendered,
    });

    const result = await renderPublishedPagesBatchToR2({
      websiteId,
      limit: batchSize,
      dryRun,
      force: false,
    });

    totalAttempted += result.attempted;
    totalRendered += result.rendered;
    totalSkipped += result.skipped;
    totalFailed += result.failed;

    const afterBatch = await getCounts(websiteId);
    console.log("[r2-backfill] Batch finished", {
      batch,
      attempted: result.attempted,
      rendered: result.rendered,
      skipped: result.skipped,
      failed: result.failed,
      renderedTotal: afterBatch.rendered,
      missingRemaining: afterBatch.missing,
    });

    if (result.failed > 0) {
      console.error("[r2-backfill] Stopping because this batch had failures.");
      process.exitCode = 1;
      break;
    }

    if (result.attempted === 0 || (!dryRun && result.rendered === 0 && result.skipped === 0)) {
      console.log("[r2-backfill] No more eligible pages selected. Stopping.");
      break;
    }

    if (dryRun) {
      console.log("[r2-backfill] Dry run completed one batch. Stopping before loop.");
      break;
    }

    if (pauseMs > 0) {
      await sleep(pauseMs);
    }
  }

  const after = await getCounts(websiteId);
  console.log("[r2-backfill] Finished", {
    websiteId,
    totalAttempted,
    totalRendered,
    totalSkipped,
    totalFailed,
    before,
    after,
  });
}

main()
  .catch((error) => {
    console.error("[r2-backfill] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
