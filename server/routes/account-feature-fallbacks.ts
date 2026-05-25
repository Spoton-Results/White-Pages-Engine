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

export default router;
