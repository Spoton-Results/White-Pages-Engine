import {
  getContentArchitectureQueueHealth,
  runContentArchitectureQueue,
} from "../server/services/content-architecture-queue";

async function main() {
  const generationLimit = Number(
    process.argv.find((arg) => arg.startsWith("--generationLimit="))?.split("=")[1] ?? 5,
  );

  const reviewLimit = Number(
    process.argv.find((arg) => arg.startsWith("--reviewLimit="))?.split("=")[1] ?? 50,
  );

  const maxRunningGenerations = Number(
    process.argv.find((arg) => arg.startsWith("--maxRunning="))?.split("=")[1] ?? 3,
  );

  const dryRun = process.argv.includes("--dryRun=true");

  console.log("\n=== CONTENT ARCHITECTURE QUEUE ===\n");

  const before = await getContentArchitectureQueueHealth();

  console.log("Before:");
  console.log(before);

  const result = await runContentArchitectureQueue({
    generationLimit,
    reviewLimit,
    maxRunningGenerations,
    dryRun,
  });

  console.log("\nResult:");
  console.log(result);

  const after = await getContentArchitectureQueueHealth();

  console.log("\nAfter:");
  console.log(after);

  console.log("\n=== QUEUE COMPLETE ===\n");
}

main().catch((err) => {
  console.error("[content-architecture-queue] Fatal:", err);
  process.exitCode = 1;
});
