import { runGenerationWorkerV2 } from "../server/services/generation-worker-v2";

async function main() {
  const limit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 10);
  const dryRun = process.argv.includes("--dryRun=true");

  console.log(`[generation-worker-v2] Starting worker limit=${limit} dryRun=${dryRun}`);

  const result = await runGenerationWorkerV2({
    limit,
    dryRun,
  });

  console.log(`[generation-worker-v2] processed=${result.processed}`);
  console.log(`[generation-worker-v2] completed=${result.completed}`);
  console.log(`[generation-worker-v2] failed=${result.failed}`);
  console.log(`[generation-worker-v2] variationVersions=${result.createdVariationVersionIds.length}`);
}

main().catch((err) => {
  console.error("[generation-worker-v2] Fatal:", err);
  process.exitCode = 1;
});
