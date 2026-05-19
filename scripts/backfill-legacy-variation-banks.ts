import crypto from "crypto";
import { db, pool } from "../server/db";
import { contentVariationBanks } from "@shared/schema";
import {
  sectionRegistry,
  variationVersions,
} from "@shared/content-architecture-schema";
import { eq } from "drizzle-orm";

function normalizeSectionKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeVariation(value: unknown): string | null {
  if (typeof value === "string") return value.trim();

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    for (const key of ["content", "text", "body", "html", "value"]) {
      if (typeof record[key] === "string") {
        return String(record[key]).trim();
      }
    }
  }

  return null;
}

async function resolveSectionId(sectionName: string): Promise<string | null> {
  const normalized = normalizeSectionKey(sectionName);

  const rows = await db
    .select({ id: sectionRegistry.id })
    .from(sectionRegistry)
    .where(eq(sectionRegistry.key, normalized))
    .limit(1);

  return rows[0]?.id ?? null;
}

async function main() {
  console.log("[variation-backfill] Starting legacy migration...");

  const legacyRows = await db.select().from(contentVariationBanks);

  let imported = 0;
  let skipped = 0;

  for (const row of legacyRows) {
    const sectionId = await resolveSectionId(row.sectionName);

    if (!sectionId) {
      console.log(`[variation-backfill] skipping unknown section ${row.sectionName}`);
      skipped++;
      continue;
    }

    if (!Array.isArray(row.variations)) {
      skipped++;
      continue;
    }

    for (const variation of row.variations) {
      const content = normalizeVariation(variation);

      if (!content || content.length < 20) {
        skipped++;
        continue;
      }

      const hash = crypto
        .createHash("sha256")
        .update(content)
        .digest("hex");

      try {
        await db.insert(variationVersions).values({
          accountId: row.accountId,
          websiteId: row.websiteId,
          serviceId: row.serviceId,
          sectionId,
          content,
          contentHash: hash,
          active: true,
          versionNumber: 1,
          reviewStatus: "approved",
          sourceType: "legacy_import",
          seoScore: 50,
          freshnessScore: 50,
          uniquenessScore: 50,
          scoreVersion: "legacy-seed-v1",
          wordCount: content.split(/\s+/).length,
          metadata: {
            importedFrom: "content_variation_banks",
            originalSectionName: row.sectionName,
            legacyVariationBankId: row.id,
          },
        });

        imported++;
      } catch (error) {
        skipped++;
      }
    }
  }

  console.log(`[variation-backfill] imported=${imported} skipped=${skipped}`);
}

main()
  .catch((err) => {
    console.error("[variation-backfill] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
