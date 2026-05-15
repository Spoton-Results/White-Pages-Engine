import { Router } from "express";
import { pool } from "../db";
import { requireAuth, requireSuperAdmin } from "../auth";
import intentActionsRouter from "./intent-actions";
import onboardingLiveRouter from "./onboarding-live";
import agencyRoiDashboardRouter from "./agency-roi-dashboard";
import agencyMonthlyReportRouter from "./agency-monthly-report";
import { scheduleIntentJobWorker } from "../services/intent-job-worker";

const router = Router();

async function ensureVariationBankConflictTarget() {
  try {
    await pool.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY website_id, service, section_name
                 ORDER BY created_at DESC NULLS LAST, id DESC
               ) AS rn
        FROM content_variation_banks
      )
      DELETE FROM content_variation_banks
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS content_variation_banks_site_service_section_unique
      ON content_variation_banks (website_id, service, section_name)
    `);
  } catch (err: any) {
    console.error("[bank-health] Failed to ensure variation bank conflict target:", err?.message || err);
  }
}

const globalAny = globalThis as any;
if (!globalAny.__nexusVariationBankConflictTargetEnsured) {
  globalAny.__nexusVariationBankConflictTargetEnsured = true;
  ensureVariationBankConflictTarget();
}

router.use((req, _res, next) => {
  if (req.path.startsWith("/api/auth")) return next("router");
  if (!req.path.startsWith("/api") && !req.path.startsWith("/r/")) return next("router");
  next();
});

router.use(intentActionsRouter);
router.use("/api/agencies/:agencyId/wizard", requireAuth, requireSuperAdmin);
router.use(onboardingLiveRouter);
router.use(agencyRoiDashboardRouter);
router.use(agencyMonthlyReportRouter);

if (!globalAny.__nexusIntentJobWorkerScheduled) {
  globalAny.__nexusIntentJobWorkerScheduled = true;
  scheduleIntentJobWorker();
}

const CORE_KEYS = ["has_intro", "has_how_it_works", "has_benefits", "has_faq", "has_cta"];
const EXTENDED_KEYS = ["has_local_context", "has_use_case", "has_proof_trust", "has_pain_point", "has_local_stat"];
const SEO_EXPANSION_KEYS = ["has_comparison", "has_pricing_factors", "has_best_fit", "has_software_integration"];
const ALL_KEYS = [...CORE_KEYS, ...EXTENDED_KEYS, ...SEO_EXPANSION_KEYS];

const SECTION_ALIASES: Record<string, string[]> = {
  has_intro: ["intro", "introduction", "introduction paragraph", "hero headline", "hero"],
  has_how_it_works: ["how it works", "process", "process how it works", "how_it_works"],
  has_benefits: ["benefits", "why choose us", "why_choose_us"],
  has_faq: ["faq", "faqs", "frequently asked questions"],
  has_cta: ["cta", "call to action", "call_to_action"],
  has_local_context: ["local context", "service area", "service_area", "local_context"],
  has_use_case: ["use case", "use_case", "service details", "service_details"],
  has_proof_trust: ["proof trust", "proof & trust", "proof_trust"],
  has_pain_point: ["pain point", "pain_point", "problem intent", "problem_intent"],
  has_local_stat: ["local stat", "local_stat"],
  has_comparison: ["comparison", "compare", "alternatives"],
  has_pricing_factors: ["pricing factors", "pricing_factors", "cost factors", "cost_factors", "pricing"],
  has_best_fit: ["best fit", "best_fit", "who it is for", "fit checklist"],
  has_software_integration: ["software integration", "software_integration", "integrations", "software compatibility"],
};

function normalizeSectionName(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[_-]+/g, " ").replace(/&/g, " ").replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
}

function isUsefulVariation(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some((v) => typeof v === "string" && v.trim().length > 0);
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

function baseMapBankRow(row: any) {
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
    hasComparison: false,
    hasPricingFactors: false,
    hasBestFit: false,
    hasSoftwareIntegration: false,
    totalVariations: row.total_variations,
    avgVariationsPerSection: row.avg_variations_per_section,
    completenessScore: row.completeness_score,
    isEligibleForTier1: row.is_eligible_for_tier1,
    lastComputedAt: row.last_computed_at,
  };
}

function buildFlagsFromBanks(banks: any[]) {
  const flags: Record<string, boolean> = Object.fromEntries(ALL_KEYS.map(k => [k, false]));
  let totalVariations = 0;
  for (const bank of banks) {
    const key = sectionKey(bank.section_name);
    const count = validVariationCount(bank.variations);
    if (key && count > 0) flags[key] = true;
    totalVariations += count;
  }
  const filledCount = ALL_KEYS.filter(k => flags[k]).length;
  const completenessScore = Math.round((filledCount / ALL_KEYS.length) * 100);
  const avgVariationsPerSection = Math.round(totalVariations / ALL_KEYS.length);
  const isEligibleForTier1 = CORE_KEYS.every(k => flags[k]) && avgVariationsPerSection >= 5;
  return { flags, totalVariations, avgVariationsPerSection, completenessScore, isEligibleForTier1 };
}

function camelExpansion(flags: Record<string, boolean>) {
  return {
    hasComparison: flags.has_comparison,
    hasPricingFactors: flags.has_pricing_factors,
    hasBestFit: flags.has_best_fit,
    hasSoftwareIntegration: flags.has_software_integration,
  };
}

router.get("/api/websites/:websiteId/bank-completeness", async (req, res, next) => {
  try {
    const [completenessResult, banksResult] = await Promise.all([
      pool.query(`SELECT * FROM variation_bank_completeness WHERE website_id = $1 ORDER BY service ASC`, [req.params.websiteId]),
      pool.query(`SELECT service, section_name, variations FROM content_variation_banks WHERE website_id = $1`, [req.params.websiteId]),
    ]);

    const banksByService = new Map<string, any[]>();
    for (const bank of banksResult.rows) {
      const serviceName = String(bank.service ?? "").trim();
      if (!serviceName) continue;
      const rows = banksByService.get(serviceName) ?? [];
      rows.push(bank);
      banksByService.set(serviceName, rows);
    }

    const rows = completenessResult.rows.map((row: any) => {
      const mapped = baseMapBankRow(row);
      const live = buildFlagsFromBanks(banksByService.get(mapped.service) ?? []);
      return {
        ...mapped,
        hasIntro: live.flags.has_intro,
        hasHowItWorks: live.flags.has_how_it_works,
        hasBenefits: live.flags.has_benefits,
        hasFaq: live.flags.has_faq,
        hasCta: live.flags.has_cta,
        hasLocalContext: live.flags.has_local_context,
        hasUseCase: live.flags.has_use_case,
        hasProofTrust: live.flags.has_proof_trust,
        hasPainPoint: live.flags.has_pain_point,
        hasLocalStat: live.flags.has_local_stat,
        ...camelExpansion(live.flags),
        totalVariations: live.totalVariations,
        avgVariationsPerSection: live.avgVariationsPerSection,
        completenessScore: live.completenessScore,
        isEligibleForTier1: live.isEligibleForTier1,
      };
    });

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/api/websites/:websiteId/bank-completeness/recompute", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { websiteId } = req.params;
    await client.query("BEGIN");

    const websiteResult = await client.query(`SELECT id, account_id FROM websites WHERE id = $1 LIMIT 1`, [websiteId]);
    const website = websiteResult.rows[0];
    if (!website) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Website not found" });
    }

    const servicesResult = await client.query(`SELECT id, name FROM services WHERE account_id = $1 ORDER BY name ASC`, [website.account_id]);
    const banksResult = await client.query(`SELECT service, section_name, variations FROM content_variation_banks WHERE website_id = $1`, [websiteId]);

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
      const live = buildFlagsFromBanks(banksByService.get(serviceName) ?? []);
      const f = live.flags;

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
          f.has_intro,
          f.has_how_it_works,
          f.has_benefits,
          f.has_faq,
          f.has_cta,
          f.has_local_context,
          f.has_use_case,
          f.has_proof_trust,
          f.has_pain_point,
          f.has_local_stat,
          live.totalVariations,
          live.avgVariationsPerSection,
          live.completenessScore,
          live.isEligibleForTier1,
        ],
      );
    }

    await client.query("COMMIT");
    res.json({ computed: servicesResult.rows.length, websiteId, services: servicesResult.rows.length, sectionCount: ALL_KEYS.length });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

export default router;
