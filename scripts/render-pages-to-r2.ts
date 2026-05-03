import { renderPublishedPagesBatchToR2 } from "../server/services/static-page-renderer";
import { pool } from "../server/db";

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

async function main() {
  const websiteId = readArg("websiteId") || readArg("website-id");
  const limitArg = readArg("limit");
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");

  if (!websiteId) {
    throw new Error("Missing required --websiteId=<id> argument");
  }

  const limit = limitArg ? Number.parseInt(limitArg, 10) : 25;
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error("--limit must be a positive number");
  }

  console.log("[render-pages-to-r2] Starting batch", {
    websiteId,
    limit,
    dryRun,
    force,
    r2RenderingEnabled: process.env.R2_RENDERING_ENABLED === "true",
  });

  const result = await renderPublishedPagesBatchToR2({
    websiteId,
    limit,
    dryRun,
    force,
  });

  console.log("[render-pages-to-r2] Finished", {
    websiteId: result.websiteId,
    attempted: result.attempted,
    rendered: result.rendered,
    skipped: result.skipped,
    failed: result.failed,
  });

  const failures = result.results.filter((item) => item.reason && item.reason.toLowerCase().includes("failure"));
  if (failures.length > 0) {
    console.log("[render-pages-to-r2] Failures", failures.slice(0, 20));
  }

  if (result.failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("[render-pages-to-r2] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
