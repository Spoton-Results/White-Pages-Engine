import { db } from "../server/db";
import {
  blueprintSections,
  sectionRegistry,
  variationGenerations,
  variationVersions,
} from "@shared/content-architecture-schema";
import { sql } from "drizzle-orm";

async function main() {
  console.log("\n=== CONTENT ARCHITECTURE AUDIT ===\n");

  const sectionCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sectionRegistry);

  const blueprintSectionCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(blueprintSections);

  const generationCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(variationGenerations);

  const versionCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(variationVersions);

  const approvedCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(variationVersions)
    .where(sql`${variationVersions.reviewStatus} = 'approved'`);

  const rejectedCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(variationVersions)
    .where(sql`${variationVersions.reviewStatus} = 'rejected'`);

  const pendingCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(variationGenerations)
    .where(sql`${variationGenerations.status} = 'pending'`);

  const failedCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(variationGenerations)
    .where(sql`${variationGenerations.status} = 'failed'`);

  console.log(`Sections Registered: ${sectionCount[0]?.count ?? 0}`);
  console.log(`Blueprint Section Links: ${blueprintSectionCount[0]?.count ?? 0}`);
  console.log(`Generation Jobs: ${generationCount[0]?.count ?? 0}`);
  console.log(`Variation Versions: ${versionCount[0]?.count ?? 0}`);
  console.log(`Approved Variations: ${approvedCount[0]?.count ?? 0}`);
  console.log(`Rejected Variations: ${rejectedCount[0]?.count ?? 0}`);
  console.log(`Pending Generations: ${pendingCount[0]?.count ?? 0}`);
  console.log(`Failed Generations: ${failedCount[0]?.count ?? 0}`);

  console.log("\n=== END AUDIT ===\n");
}

main().catch((err) => {
  console.error("[content-architecture-audit] Fatal:", err);
  process.exitCode = 1;
});
