import { renderPublishedPagesBatchToR2 } from "../server/services/static-page-renderer";
import { pool } from "../server/db";

const DEFAULT_DOMAINS = [
  "pages.spotonnexus.com",
  "page.followupcontrol.com",
  "pages.subdraw.com",
  "pages.spotonresults.com",
  "pages.elitepages.io",
];

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function readNumberArg(name: string, fallback: number): number {
  const raw = readArg(name);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) throw new Error(`--${name} must be a positive number`);
  return value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWebsiteCoverage(domains: string[]) {
  const result = await pool.query(
    `SELECT
       w.id,
       w.name,
       w.domain,
       w.subdomain,
       COUNT(p.id)::int AS total,
       COUNT(p.id) FILTER (WHERE p.r2_key IS NOT NULL)::int AS has_r2,
       COUNT(p.id) FILTER (WHERE p.r2_key IS NULL)::int AS missing_r2,
       COUNT(p.id) FILTER (WHERE p.rendered_at IS NOT NULL)::int AS rendered
     FROM websites w
     LEFT JOIN pages p
       ON p.website_id::text = w.id::text
      AND p.status = 'published'
     WHERE w.domain = ANY($1::text[])
        OR w.subdomain = ANY($1::text[])
     GROUP BY w.id, w.name, w.domain, w.subdomain
     ORDER BY COALESCE(array_position($1::text[], w.subdomain), array_position($1::text[], w.domain))`,
    [domains],
  );

  return result.rows;
}

async function main() {
  const domains = (readArg("domains") || DEFAULT_DOMAINS.join(","))
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean);
  const batchSize = readNumberArg("batchSize", readNumberArg("limit", 100));
  const loops = readNumberArg("loops", 1);
  const pauseMs = readNumberArg("pauseMs", 5000);
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");

  if (process.env.R2_RENDERING_ENABLED !== "true") {
    throw new Error("R2_RENDERING_ENABLED must be true");
  }

  console.log("[backfill-live-websites-to-r2] Starting", {
    domains,
    batchSize,
    loops,
    pauseMs,
    dryRun,
    force,
    r2RenderingEnabled: process.env.R2_RENDERING_ENABLED === "true",
  });

  for (let loop = 1; loop <= loops; loop += 1) {
    console.log(`[backfill-live-websites-to-r2] Loop ${loop}/${loops}`);
    const websites = await getWebsiteCoverage(domains);
    console.table(websites.map((row: any) => ({
      domain: row.domain,
      subdomain: row.subdomain,
      name: row.name,
      total: Number(row.total || 0),
      has_r2: Number(row.has_r2 || 0),
      missing_r2: Number(row.missing_r2 || 0),
      rendered: Number(row.rendered || 0),
    })));

    for (const website of websites) {
      const missing = Number(website.missing_r2 || 0);
      if (missing <= 0) {
        console.log("[backfill-live-websites-to-r2] Skipping complete website", {
          websiteId: website.id,
          domain: website.domain,
          subdomain: website.subdomain,
        });
        continue;
      }

      const limit = Math.min(batchSize, missing);
      console.log("[backfill-live-websites-to-r2] Rendering batch", {
        websiteId: website.id,
        domain: website.domain,
        subdomain: website.subdomain,
        limit,
        missingBefore: missing,
      });

      const result = await renderPublishedPagesBatchToR2({
        websiteId: website.id,
        limit,
        dryRun,
        force,
      });

      console.log("[backfill-live-websites-to-r2] Batch finished", {
        websiteId: result.websiteId,
        domain: website.domain,
        subdomain: website.subdomain,
        attempted: result.attempted,
        rendered: result.rendered,
        skipped: result.skipped,
        failed: result.failed,
      });

      const failures = result.results.filter((item) => item.reason && item.reason.toLowerCase().includes("failure"));
      if (failures.length > 0) {
        console.log("[backfill-live-websites-to-r2] Failure samples", failures.slice(0, 20));
      }

      if (result.failed > 0) {
        throw new Error(`Stopping because ${website.domain} had ${result.failed} failed renders`);
      }

      if (pauseMs > 0) await sleep(pauseMs);
    }
  }

  const finalCoverage = await getWebsiteCoverage(domains);
  console.log("[backfill-live-websites-to-r2] Final coverage");
  console.table(finalCoverage.map((row: any) => ({
    domain: row.domain,
    subdomain: row.subdomain,
    name: row.name,
    total: Number(row.total || 0),
    has_r2: Number(row.has_r2 || 0),
    missing_r2: Number(row.missing_r2 || 0),
    rendered: Number(row.rendered || 0),
  })));
}

main()
  .catch((error) => {
    console.error("[backfill-live-websites-to-r2] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
