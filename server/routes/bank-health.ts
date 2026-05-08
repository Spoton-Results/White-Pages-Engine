import { Router } from "express";
import { pool } from "../db";

const router = Router();

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
      [req.params.websiteId]
    );
    res.json(result.rows.map(mapBankRow));
  } catch (err) {
    next(err);
  }
});

export default router;
