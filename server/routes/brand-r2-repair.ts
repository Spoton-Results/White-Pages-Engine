import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db";
import { renderPublishedPagesBatchToR2 } from "../services/static-page-renderer";

const router = Router();

function norm(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

function rootHost(host: string) {
  return host.replace(/^(pages|page|seo|local)\./, "");
}

function first(...values: any[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function compact(value: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== ""),
  );
}

async function resolveWebsite(domain: string) {
  const h = norm(domain);
  const candidates = Array.from(new Set([h, rootHost(h)])).filter(Boolean);
  const result = await pool.query(
    `SELECT *
     FROM websites
     WHERE lower(domain) = ANY($1::text[])
        OR lower(settings->>'parentDomain') = ANY($1::text[])
        OR lower(settings->>'publicDomain') = ANY($1::text[])
        OR lower(settings->>'legacyParentDomain') = ANY($1::text[])
     ORDER BY CASE WHEN lower(domain) = $2 THEN 0 ELSE 1 END, updated_at DESC NULLS LAST
     LIMIT 1`,
    [candidates, h],
  );
  return result.rows[0] || null;
}

async function loadBrand(website: any) {
  const result = await pool.query(
    `SELECT *
     FROM brand_profiles
     WHERE account_id::text = $1::text
     ORDER BY CASE WHEN id::text = COALESCE($2::text, '') THEN 0 ELSE 1 END,
              updated_at DESC NULLS LAST,
              created_at DESC NULLS LAST
     LIMIT 1`,
    [website.account_id, website.brand_profile_id || ""],
  );
  return result.rows[0] || null;
}

function brandSettings(brand: any) {
  if (!brand) return {};
  return compact({
    ...(brand.custom_fields || {}),
    brandName: first(brand.name),
    siteName: first(brand.name),
    businessName: first(brand.name),
    websiteUrl: first(brand.website_url, brand.websiteUrl),
    mainWebsiteUrl: first(brand.website_url, brand.websiteUrl),
    brandWebsiteUrl: first(brand.website_url, brand.websiteUrl),
    phone: first(brand.phone_override, brand.phoneOverride, brand.phone),
    email: first(brand.email),
    ctaHeading: first(brand.cta_heading, brand.ctaHeading),
    ctaText: first(brand.cta_body, brand.ctaBody, brand.description),
    ctaButtonLabel: first(brand.cta_button_label, brand.ctaButtonLabel),
    demoBannerUrl: first(brand.demo_banner_url, brand.demoBannerUrl),
    demoBannerHeading: first(brand.demo_banner_heading, brand.demoBannerHeading),
    demoBannerSubtext: first(brand.demo_banner_subtext, brand.demoBannerSubtext),
    demoBannerButtonLabel: first(brand.demo_banner_button, brand.demoBannerButton),
    primaryColor: first(brand.primary_color, brand.primaryColor),
    secondaryColor: first(brand.secondary_color, brand.secondaryColor),
  });
}

router.all("/api/repair/brand-r2", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const domain = String(req.query.domain || req.body?.domain || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit || req.body?.limit || 500), 1), 5000);
    const render = String(req.query.render || req.body?.render || "false") === "true";
    if (!domain) return res.status(400).json({ ok: false, message: "domain is required" });

    const website = await resolveWebsite(domain);
    if (!website) return res.status(404).json({ ok: false, message: "website not found", domain });

    const brand = await loadBrand(website);
    if (!brand) return res.status(404).json({ ok: false, message: "brand profile not found", websiteId: website.id, accountId: website.account_id });

    const settingsPatch = brandSettings(brand);
    await pool.query(
      `UPDATE websites
       SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
           brand_profile_id = COALESCE(brand_profile_id, $3),
           updated_at = NOW()
       WHERE id::text = $1::text`,
      [website.id, JSON.stringify(settingsPatch), brand.id],
    );

    const invalidated = await pool.query(
      `UPDATE pages
       SET r2_key = NULL,
           content_hash = NULL,
           rendered_at = NULL,
           updated_at = NOW()
       WHERE website_id::text = $1::text
         AND status = 'published'
       RETURNING id, slug`,
      [website.id],
    );

    let renderResult: any = null;
    if (render) {
      renderResult = await renderPublishedPagesBatchToR2({ websiteId: website.id, limit, force: true });
    }

    return res.json({
      ok: true,
      domain,
      resolvedWebsite: { id: website.id, domain: website.domain, accountId: website.account_id },
      brand: { id: brand.id, name: brand.name },
      copiedSettingKeys: Object.keys(settingsPatch),
      invalidatedPages: invalidated.rowCount || 0,
      sampleInvalidated: invalidated.rows.slice(0, 10),
      renderRequested: render,
      renderResult,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
