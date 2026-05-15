import {
  auditPageCannibalizationRisk,
  auditVariationSemanticRisk,
} from "../server/services/semantic-content-intelligence";

async function main() {
  const limit = Number(
    process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 100,
  );

  const dryRun = process.argv.includes("--dryRun=true");

  console.log("\n=== SEMANTIC CONTENT AUDIT ===\n");

  const variationAudit = await auditVariationSemanticRisk({
    limit,
    dryRun,
  });

  console.log("Variation Semantic Risk:");
  console.log({
    audited: variationAudit.audited,
    highRisk: variationAudit.highRisk,
    mediumRisk: variationAudit.mediumRisk,
    lowRisk: variationAudit.lowRisk,
  });

  const pageAudit = await auditPageCannibalizationRisk({
    limit,
    dryRun,
  });

  console.log("\nPage Cannibalization Risk:");
  console.log({
    audited: pageAudit.audited,
    highRisk: pageAudit.highRisk,
    mediumRisk: pageAudit.mediumRisk,
    lowRisk: pageAudit.lowRisk,
  });

  console.log("\n=== AUDIT COMPLETE ===\n");
}

main().catch((err) => {
  console.error("[semantic-content-audit] Fatal:", err);
  process.exitCode = 1;
});
