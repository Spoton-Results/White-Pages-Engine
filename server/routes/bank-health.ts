import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { pool } from "../db";
import { requireAuth, requireSuperAdmin } from "../auth";
import intentActionsRouter from "./intent-actions";
import onboardingLiveRouter from "./onboarding-live";
import agencyRoiDashboardRouter from "./agency-roi-dashboard";
import agencyMonthlyReportRouter from "./agency-monthly-report";
import { scheduleIntentJobWorker } from "../services/intent-job-worker";
import { fillMissingSectionsForService } from "../services/variation-writer";
import type { BrandContext } from "../services/variation-writer";

const router = Router();

async function ensureBankConflictTargets() {
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

    await pool.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY website_id, service
                 ORDER BY last_computed_at DESC NULLS LAST, id DESC
               ) AS rn
        FROM variation_bank_completeness
      )
      DELETE FROM variation_bank_completeness
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS variation_bank_completeness_site_service_unique
      ON variation_bank_completeness (website_id, service)
    `);
  } catch (err: any) {
    console.error("[bank-health] Failed to ensure bank conflict targets:", err?.message || err);
  }
}

const globalAny = globalThis as any;
if (!globalAny.__nexusBankConflictTargetsEnsured) {
  globalAny.__nexusBankConflictTargetsEnsured = true;
  ensureBankConflictTargets();
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

// FIX: read SEO expansion columns from the DB row instead of hardcoding false.
// The variation_bank_completeness table stores all 14 flags — we must read them.
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
    // SEO expansion — read from DB row (was incorrectly hardcoded to false)
    hasComparison: row.has_comparison ?? false,
    hasPricingFactors: row.has_pricing_factors ?? false,
    hasBestFit: row.has_best_fit ?? false,
    hasSoftwareIntegration: row.has_software_integration ?? false,
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

// ── Helper: build brand context for a website ─────────────────────────────────
// NOTE: brand_profiles does NOT have a website_id column — it has account_id.
// We join via websites.account_id → brand_profiles.account_id.
async function getBrandCtx(websiteId: string): Promise<{ ctx: BrandContext; accountId: string }> {
  const websiteResult = await pool.query(
    `SELECT id, account_id, name, domain FROM websites WHERE id = $1 LIMIT 1`,
    [websiteId],
  );
  const website = websiteResult.rows[0];
  if (!website) throw Object.assign(new Error("Website not found"), { status: 404 });

  const brandResult = await pool.query(
    `SELECT name, description, voice_and_tone
     FROM brand_profiles
     WHERE account_id = $1
     LIMIT 1`,
    [website.account_id],
  );
  const brand = brandResult.rows[0] ?? null;

  const ctx: BrandContext = {
    brandName:        brand?.name || website.name || website.domain,
    brandDescription: brand?.description || undefined,
    voiceAndTone:     brand?.voice_and_tone || undefined,
  };

  return { ctx, accountId: String(website.account_id) };
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

// FIX: recompute now writes all 14 section flags including SEO expansion (4).
// Previously only 10 columns were written — comparison/pricing_factors/best_fit/
// software_integration were omitted, so those 4 were always null/false after recompute.
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
          has_comparison, has_pricing_factors, has_best_fit, has_software_integration,
          total_variations, avg_variations_per_section, completeness_score,
          is_eligible_for_tier1, last_computed_at
        ) VALUES (
          $1, $2,
          $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12,
          $13, $14, $15, $16,
          $17, $18, $19,
          $20, NOW()
        )
        ON CONFLICT (website_id, service) DO UPDATE SET
          has_intro = EXCLUDED.has_intro,
          has_how_it_works = EXCLUDED.has_how_it_works,
          has_benefits = EXCLUDED.has_benefits,
          has_faq = EXCLUDED.has_faq,
          has_cta = EXCLUDED.has_cta,
          has_local_context = EXCLUDED.has_local_context,
          has_use_case = EXCLUDED.has_use_case,
          has_proof_trust = EXCLUDED.has_proof_trust,
          has_pain_point = EXCLUDED.has_pain_point,
          has_local_stat = EXCLUDED.has_local_stat,
          has_comparison = EXCLUDED.has_comparison,
          has_pricing_factors = EXCLUDED.has_pricing_factors,
          has_best_fit = EXCLUDED.has_best_fit,
          has_software_integration = EXCLUDED.has_software_integration,
          total_variations = EXCLUDED.total_variations,
          avg_variations_per_section = EXCLUDED.avg_variations_per_section,
          completeness_score = EXCLUDED.completeness_score,
          is_eligible_for_tier1 = EXCLUDED.is_eligible_for_tier1,
          last_computed_at = NOW()`,
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
          f.has_comparison,
          f.has_pricing_factors,
          f.has_best_fit,
          f.has_software_integration,
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

// ── POST /api/websites/:websiteId/variation-banks/fill-missing ────────────────
// Called by the per-service card "Fill Missing" button.
// Body: { service: string }
//
// Runs fillMissingSectionsForService in a setImmediate background task so the
// HTTP response returns immediately with a jobId. Client polls GET /api/jobs/:jobId.
router.post(
  "/api/websites/:websiteId/variation-banks/fill-missing",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { websiteId } = req.params;
      const serviceName = String(req.body?.service ?? "").trim();
      if (!serviceName) return res.status(400).json({ error: "service is required" });

      const { ctx, accountId } = await getBrandCtx(websiteId);

      const jobId = `fill-missing-${websiteId}-${Date.now()}`;

      // Persist job row into generation_jobs (schema-safe columns only: no type, no updated_at)
      try {
        await pool.query(
          `INSERT INTO generation_jobs (
             id, website_id, account_id, name, status,
             total_pages, processed_pages, created_at
           ) VALUES ($1, $2, $3, $4, 'running', 1, 0, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [jobId, websiteId, accountId, `fill_missing:${serviceName}`],
        );
      } catch (e: any) {
        console.warn("[bank-health] Could not insert generation_jobs row (non-fatal):", e?.message);
      }

      // Track active job for restore-on-refresh (best-effort; table may not exist)
      try {
        await pool.query(
          `INSERT INTO active_jobs (website_id, job_type, job_id, created_at)
           VALUES ($1, 'fill_missing', $2, NOW())
           ON CONFLICT (website_id, job_type)
           DO UPDATE SET job_id = EXCLUDED.job_id, created_at = EXCLUDED.created_at`,
          [websiteId, jobId],
        );
      } catch { /* non-fatal */ }

      // Run fill in background — HTTP response returns immediately
      setImmediate(async () => {
        try {
          await fillMissingSectionsForService(serviceName, accountId, websiteId, ctx);
          await pool.query(
            `UPDATE generation_jobs SET status = 'completed', processed_pages = 1 WHERE id = $1`,
            [jobId],
          ).catch(() => {});
        } catch (err: any) {
          console.error(`[bank-health] fill-missing failed for "${serviceName}":`, err?.message || err);
          await pool.query(
            `UPDATE generation_jobs SET status = 'failed' WHERE id = $1`,
            [jobId],
          ).catch(() => {});
        }
        // Clean up active job tracker
        await pool.query(
          `DELETE FROM active_jobs WHERE website_id = $1 AND job_type = 'fill_missing'`,
          [websiteId],
        ).catch(() => {});
      });

      return res.json({ started: true, jobId, service: serviceName });
    } catch (err: any) {
      if ((err as any).status === 404) return res.status(404).json({ error: (err as any).message });
      console.error("[bank-health] fill-missing error:", err?.message || err);
      next(err);
    }
  },
);

// ── POST /api/websites/:websiteId/variation-banks/fill-missing-all-job ────────
// Called by the "Fill Missing All" bulk button.
// Body: { services: string[] }
// Returns a jobId immediately; fills all services in the background.
router.post(
  "/api/websites/:websiteId/variation-banks/fill-missing-all-job",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { websiteId } = req.params;
      const services: string[] = Array.isArray(req.body?.services)
        ? req.body.services.map((s: any) => String(s ?? "").trim()).filter(Boolean)
        : [];

      if (services.length === 0) {
        return res.json({ started: false, message: "No services provided" });
      }

      const { ctx, accountId } = await getBrandCtx(websiteId);
      const jobId = `fill-missing-${websiteId}-${Date.now()}`;

      // Persist job row (schema-safe columns only: no type, no updated_at)
      try {
        await pool.query(
          `INSERT INTO generation_jobs (
             id, website_id, account_id, name, status,
             total_pages, processed_pages, created_at
           ) VALUES ($1, $2, $3, $4, 'running', $5, 0, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [jobId, websiteId, accountId, `fill_missing_all:${services.length}_services`, services.length],
        );
      } catch (e: any) {
        console.warn("[bank-health] Could not insert generation_jobs row (non-fatal):", e?.message);
      }

      // Track active job for restore-on-refresh (best-effort; table may not exist)
      try {
        await pool.query(
          `INSERT INTO active_jobs (website_id, job_type, job_id, created_at)
           VALUES ($1, 'fill_missing', $2, NOW())
           ON CONFLICT (website_id, job_type)
           DO UPDATE SET job_id = EXCLUDED.job_id, created_at = EXCLUDED.created_at`,
          [websiteId, jobId],
        );
      } catch { /* non-fatal */ }

      // Run fill in background — HTTP response returns immediately
      setImmediate(async () => {
        let processed = 0;
        for (const svc of services) {
          try {
            await fillMissingSectionsForService(svc, accountId, websiteId, ctx);
          } catch (err: any) {
            console.error(`[bank-health] fill-missing-all failed for "${svc}":`, err?.message || err);
          }
          processed++;
          try {
            await pool.query(
              `UPDATE generation_jobs SET processed_pages = $1 WHERE id = $2`,
              [processed, jobId],
            );
          } catch { /* non-fatal */ }
        }
        // Mark completed
        try {
          await pool.query(
            `UPDATE generation_jobs SET status = 'completed' WHERE id = $1`,
            [jobId],
          );
        } catch { /* non-fatal */ }
        // Clean up active job tracker
        try {
          await pool.query(
            `DELETE FROM active_jobs WHERE website_id = $1 AND job_type = 'fill_missing'`,
            [websiteId],
          );
        } catch { /* non-fatal */ }
      });

      return res.json({ started: true, jobId, total: services.length });
    } catch (err: any) {
      if ((err as any).status === 404) return res.status(404).json({ error: (err as any).message });
      console.error("[bank-health] fill-missing-all-job error:", err?.message || err);
      next(err);
    }
  },
);

// ── GET /api/jobs/:jobId ──────────────────────────────────────────────────────
// Polls progress of a fill-missing background job.
// NOTE: generation_jobs has no updated_at column — use created_at + completed_at instead.
router.get(
  "/api/jobs/:jobId",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await pool.query(
        `SELECT id, status, total_pages, processed_pages, completed_at, created_at
         FROM generation_jobs
         WHERE id = $1
         LIMIT 1`,
        [req.params.jobId],
      );
      if (!result.rows.length) return res.status(404).json({ error: "Job not found" });
      const row = result.rows[0];
      return res.json({
        jobId: row.id,
        status: row.status,
        totalPages: row.total_pages,
        processedPages: row.processed_pages,
        updatedAt: row.completed_at ?? row.created_at,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/websites/:websiteId/fill-missing-job ─────────────────────────────
// Restores the active fill-missing job ID after a page refresh.
router.get(
  "/api/websites/:websiteId/fill-missing-job",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await pool.query(
        `SELECT job_id FROM active_jobs
         WHERE website_id = $1 AND job_type = 'fill_missing'
         LIMIT 1`,
        [req.params.websiteId],
      );
      if (!result.rows.length) return res.json({ jobId: null });
      return res.json({ jobId: result.rows[0].job_id });
    } catch {
      // active_jobs table may not exist in all envs — safe fallback
      return res.json({ jobId: null });
    }
  },
);

export default router;
