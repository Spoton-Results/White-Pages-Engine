import { Router } from "express";
import { pool } from "../db";
import { requireAuth, requireSuperAdmin } from "../auth";
import intentActionsRouter from "./intent-actions";
import onboardingLiveRouter from "./onboarding-live";
import { scheduleIntentJobWorker } from "../services/intent-job-worker";

const router = Router();
router.use(intentActionsRouter);
router.use("/api/agencies/:agencyId/wizard", requireAuth, requireSuperAdmin);
router.use(onboardingLiveRouter);

const globalAny = globalThis as any;
if (!globalAny.__nexusIntentJobWorkerScheduled) {
  globalAny.__nexusIntentJobWorkerScheduled = true;
  scheduleIntentJobWorker();
}

const SECTION_ALIASES: Record<string, string[]> = {
  has_intro: ["intro", "introduction", "introduction paragraph", "hero headline", "hero"],
  has_how_it_works: ["how it works", "process", "process how it works", "how_it_works"],
  has_benefits: ["benefits", "why choose us", "why_choose_us"],
  has_faq: ["faq", "faqs", "frequently asked questions"],
  has_cta: ["cta", "call to action", "call_to_action"],
  has_local_context: ["local context", "service area", "service_area"],
  has_use_case: ["use case", "use_case", "service details", "service_details"],
  has_proof_trust: ["proof trust", "proof & trust", "proof_trust"],
  has_pain_point: ["pain point", "pain_point", "problem intent", "problem_intent"],
  has_local_stat: ["local stat", "local_stat"],
};

function normalizeSectionName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulVariation(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some((v) =>
    typeof v === "string" && v.trim().length > 0,
  );
}

function validVariationCount(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  return raw.filter(isUsefulVariation).length;
}

function sectionKey(sectionName: unknown): string | null {
  const normalized = normalizeSectionName(sectionName);
  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    if (aliases.map(normalizeSectionName).includes(normalized)) return key;
  }
  return null;
}

function mapBankRow(row: any) {
  return {
    id: row.id,
    websiteId: row.website_id,
    service: row.service,
    hasIntro: row.has_intro,
    hasHowItWorks: row.has_how_it_works,
    hasBenefits: row.has_benefits,
    hasFaq: row.has_faq,
    hasCta: row.has_cta,
    hasLocalContext: row.has_local_context,
    hasUseCase: row.has_use_case,
    hasProofTrust: row.has_proof_trust,
    hasPainPoint: row.has_pain_point,
    hasLocalStat: row.has_local_stat,
    totalVariations: row.total_variations,
    avgVariationsPerSection: row.avg_variations_per_section,
    completenessScore: row.completeness_score,
    isEligibleForTier1: row.is_eligible_for_tier1,
    lastComputedAt: row.last_computed_at,
  };
}

router.get("/api/websites/:websiteId/bank-completeness", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM variation_bank_completeness WHERE website_id = $1 ORDER BY service ASC`,
      [req.params.websiteId],
    );
    res.json(result.rows.map(mapBankRow));
  } catch (err) {
    next(err);
  }
});

router.post("/api/websites/:websiteId/bank-completeness/recompute", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { websiteId } = req.params;
    await client.query("BEGIN");

    const websiteResult = await client.query(
      `SELECT id, account_id FROM websites WHERE id = $1 LIMIT 1`,
      [websiteId],
    );
    const website = websiteResult.rows[0];
    if (!website) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Website not found" });
    }

    const servicesResult = await client.query(
      `SELECT id, name FROM services WHERE account_id = $1 ORDER BY name ASC`,
      [website.account_id],
    );
    const banksResult = await client.query(
      `SELECT service, section_name, variations FROM content_variation_banks WHERE website_id = $1`,
      [websiteId],
    );

    const banksByService = new Map<string, any[]>();
    for (const bank of banksResult.rows) {
      const serviceName = String(bank.service ?? "").trim();
      if (!serviceName) continue;
      const rows = banksByService.get(serviceName) ?? [];
      rows.push(bank);
      banksByService.set(serviceName, rows);
    }

    await client.query(`DELETE FROM variation_bank_completeness WHERE website_id = $1`, [websiteId]);

    for (const service of servicesResult.rows) {
      const serviceName = String(service.name ?? "").trim();
      const sectionFlags: Record<string, boolean> = {
        has_intro: false,
        has_how_it_works: false,
        has_benefits: false,
        has_faq: false,
        has_cta: false,
        has_local_context: false,
        has_use_case: false,
        has_proof_trust: false,
        has_pain_point: false,
        has_local_stat: false,
      };
      let totalVariations = 0;

      for (const bank of banksByService.get(serviceName) ?? []) {
        const key = sectionKey(bank.section_name);
        const count = validVariationCount(bank.variations);
        if (key && count > 0) sectionFlags[key] = true;
        totalVariations += count;
      }

      const filledCount = Object.values(sectionFlags).filter(Boolean).length;
      const completenessScore = Math.round((filledCount / 10) * 100);
      const avgVariationsPerSection = Math.round(totalVariations / 10);
      const isEligibleForTier1 = Boolean(
        sectionFlags.has_intro &&
        sectionFlags.has_how_it_works &&
        sectionFlags.has_benefits &&
        sectionFlags.has_faq &&
        sectionFlags.has_cta &&
        completenessScore >= 70,
      );

      await client.query(
        `INSERT INTO variation_bank_completeness (
          website_id, service,
          has_intro, has_how_it_works, has_benefits, has_faq, has_cta,
          has_local_context, has_use_case, has_proof_trust, has_pain_point, has_local_stat,
          total_variations, avg_variations_per_section, completeness_score,
          is_eligible_for_tier1, last_computed_at
        ) VALUES (
          $1, $2,
          $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12,
          $13, $14, $15,
          $16, NOW()
        )`,
        [
          websiteId,
          serviceName,
          sectionFlags.has_intro,
          sectionFlags.has_how_it_works,
          sectionFlags.has_benefits,
          sectionFlags.has_faq,
          sectionFlags.has_cta,
          sectionFlags.has_local_context,
          sectionFlags.has_use_case,
          sectionFlags.has_proof_trust,
          sectionFlags.has_pain_point,
          sectionFlags.has_local_stat,
          totalVariations,
          avgVariationsPerSection,
          completenessScore,
          isEligibleForTier1,
        ],
      );
    }

    await client.query("COMMIT");
    res.json({ computed: servicesResult.rows.length, websiteId, services: servicesResult.rows.length });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

export default router;
