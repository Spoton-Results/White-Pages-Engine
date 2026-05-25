import { Router, type Request, type Response } from "express";
import { requireAuth } from "../auth";
import { pool } from "../db";

const router = Router();

function mapIndustry(r: any) {
  return {
    ...r,
    accountId: r.account_id,
    naicsCode: r.naics_code,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapBrandProfile(r: any) {
  return {
    ...r,
    accountId: r.account_id,
    logoUrl: r.logo_url,
    primaryColor: r.primary_color,
    secondaryColor: r.secondary_color,
    socialLinks: r.social_links,
    voiceAndTone: r.voice_and_tone,
    customFields: r.custom_fields,
    websiteUrl: r.website_url,
    phoneOverride: r.phone_override,
    ctaHeading: r.cta_heading,
    ctaBody: r.cta_body,
    ctaButtonLabel: r.cta_button_label,
    demoBannerUrl: r.demo_banner_url,
    demoBannerHeading: r.demo_banner_heading,
    demoBannerSubtext: r.demo_banner_subtext,
    demoBannerButton: r.demo_banner_button,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapService(r: any) {
  return {
    ...r,
    accountId: r.account_id,
    industryId: r.industry_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapBankCompleteness(r: any) {
  return {
    id: r.id,
    websiteId: r.website_id,
    service: r.service,
    hasIntro: r.has_intro,
    hasHowItWorks: r.has_how_it_works,
    hasBenefits: r.has_benefits,
    hasFaq: r.has_faq,
    hasCta: r.has_cta,
    hasLocalContext: r.has_local_context,
    hasUseCase: r.has_use_case,
    hasProofTrust: r.has_proof_trust,
    hasPainPoint: r.has_pain_point,
    hasLocalStat: r.has_local_stat,
    hasComparison: r.has_comparison ?? false,
    hasPricingFactors: r.has_pricing_factors ?? false,
    hasBestFit: r.has_best_fit ?? false,
    hasSoftwareIntegration: r.has_software_integration ?? false,
    totalVariations: r.total_variations,
    avgVariationsPerSection: r.avg_variations_per_section,
    completenessScore: r.completeness_score,
    isEligibleForTier1: r.is_eligible_for_tier1,
    lastComputedAt: r.last_computed_at,
  };
}

router.get("/api/accounts/:accountId/industries", requireAuth, async (req: Request, res: Response) => {
  const scoped = await pool.query(
    `SELECT * FROM industries WHERE account_id::text = $1::text ORDER BY name ASC`,
    [req.params.accountId],
  );
  if (scoped.rows.length > 0) return res.json(scoped.rows.map(mapIndustry));

  const all = await pool.query(`SELECT * FROM industries ORDER BY name ASC`);
  return res.json(all.rows.map(mapIndustry));
});

router.get("/api/accounts/:accountId/brand-profiles", requireAuth, async (req: Request, res: Response) => {
  const scoped = await pool.query(
    `SELECT * FROM brand_profiles WHERE account_id::text = $1::text ORDER BY created_at DESC`,
    [req.params.accountId],
  );
  if (scoped.rows.length > 0) return res.json(scoped.rows.map(mapBrandProfile));

  const all = await pool.query(`SELECT * FROM brand_profiles ORDER BY created_at DESC`);
  return res.json(all.rows.map(mapBrandProfile));
});

router.get("/api/accounts/:accountId/services", requireAuth, async (req: Request, res: Response) => {
  const scoped = await pool.query(
    `SELECT * FROM services WHERE account_id::text = $1::text ORDER BY name ASC`,
    [req.params.accountId],
  );
  if (scoped.rows.length > 0) return res.json(scoped.rows.map(mapService));

  const all = await pool.query(`SELECT * FROM services ORDER BY name ASC`);
  return res.json(all.rows.map(mapService));
});

router.get("/api/websites/:websiteId/services", requireAuth, async (req: Request, res: Response) => {
  const scoped = await pool.query(
    `SELECT s.*
     FROM services s
     JOIN websites w ON w.account_id::text = s.account_id::text
     WHERE w.id::text = $1::text
     ORDER BY s.name ASC`,
    [req.params.websiteId],
  );
  if (scoped.rows.length > 0) return res.json(scoped.rows.map(mapService));

  const all = await pool.query(`SELECT * FROM services ORDER BY name ASC`);
  return res.json(all.rows.map(mapService));
});

router.get("/api/websites/:websiteId/bank-completeness", requireAuth, async (req: Request, res: Response) => {
  const scoped = await pool.query(
    `SELECT * FROM variation_bank_completeness WHERE website_id::text = $1::text ORDER BY service ASC`,
    [req.params.websiteId],
  );
  if (scoped.rows.length > 0) return res.json(scoped.rows.map(mapBankCompleteness));

  const account = await pool.query(
    `SELECT account_id FROM websites WHERE id::text = $1::text LIMIT 1`,
    [req.params.websiteId],
  );
  const accountId = account.rows[0]?.account_id;

  if (accountId) {
    const accountBanks = await pool.query(
      `SELECT vbc.*
       FROM variation_bank_completeness vbc
       JOIN websites w ON w.id::text = vbc.website_id::text
       WHERE w.account_id::text = $1::text
       ORDER BY vbc.service ASC`,
      [accountId],
    );
    if (accountBanks.rows.length > 0) return res.json(accountBanks.rows.map(mapBankCompleteness));
  }

  const all = await pool.query(`SELECT * FROM variation_bank_completeness ORDER BY service ASC`);
  return res.json(all.rows.map(mapBankCompleteness));
});

export default router;
