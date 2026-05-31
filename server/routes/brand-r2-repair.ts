import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db";
import { renderPublishedPageToR2, renderPublishedPagesBatchToR2 } from "../services/static-page-renderer";

const router = Router();

const STATE_NAMES = [
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware","florida","georgia","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan","minnesota","mississippi","missouri","montana","nebraska","nevada","new-hampshire","new-jersey","new-mexico","new-york","north-carolina","north-dakota","ohio","oklahoma","oregon","pennsylvania","rhode-island","south-carolina","south-dakota","tennessee","texas","utah","vermont","virginia","washington","west-virginia","wisconsin","wyoming"
];

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

function titleCaseSlug(value: string) {
  return String(value || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function locationFromSlug(slug: string) {
  const clean = String(slug || "").toLowerCase().replace(/^\/+|\/+$/g, "");
  for (const state of STATE_NAMES) {
    const marker = `-${state}-`;
    const idx = clean.indexOf(marker);
    if (idx <= 0) continue;
    const before = clean.slice(0, idx);
    const inIdx = before.lastIndexOf("-in-");
    if (inIdx < 0) continue;
    const citySlug = before.slice(inIdx + 4);
    if (!citySlug) continue;
    return { city: titleCaseSlug(citySlug), state: titleCaseSlug(state), cityState: `${titleCaseSlug(citySlug)}, ${titleCaseSlug(state)}` };
  }
  return null;
}

function escapeRe(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function currentLocationFromPage(page: any, html: string) {
  const source = [page?.h1, page?.title, page?.meta_description, html].filter(Boolean).join("\n");
  const match = source.match(/\bin\s+([A-Z][A-Za-z .'-]{1,80}),\s*([A-Z][A-Za-z .'-]{1,40})\b/);
  if (!match) return null;
  return { city: match[1].trim(), state: match[2].trim(), cityState: `${match[1].trim()}, ${match[2].trim()}` };
}

function repairLocationText(value: any, from: any, to: any) {
  let out = String(value || "");
  if (!out || !from || !to) return out;
  out = out.replace(new RegExp(escapeRe(from.cityState), "g"), to.cityState);
  out = out.replace(new RegExp(`\\bin\\s+${escapeRe(from.city)}\\b`, "g"), `in ${to.city}`);
  out = out.replace(new RegExp(`\\b${escapeRe(from.city)}\\s+demands\\b`, "g"), `${to.city} demands`);
  out = out.replace(new RegExp(`\\bof\\s+${escapeRe(from.city)}\\b`, "g"), `of ${to.city}`);
  return out;
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

async function repairSlugLocation(websiteId: string, slug: string) {
  const target = locationFromSlug(slug);
  if (!target) return { repaired: false, reason: "Could not parse location from slug" };

  const pageResult = await pool.query(
    `SELECT * FROM pages WHERE website_id::text = $1::text AND slug = $2 AND status = 'published' LIMIT 1`,
    [websiteId, slug],
  );
  const page = pageResult.rows[0];
  if (!page) return { repaired: false, reason: "Published page not found for slug", target };

  const versionResult = await pool.query(
    `SELECT * FROM page_versions WHERE page_id::text = $1::text ORDER BY is_active DESC NULLS LAST, version DESC NULLS LAST, created_at DESC NULLS LAST LIMIT 1`,
    [page.id],
  );
  const version = versionResult.rows[0] || {};
  const current = currentLocationFromPage(page, version.content_html || "");
  if (!current) return { repaired: false, reason: "Could not detect current location in page content", target };

  const patchedTitle = repairLocationText(page.title, current, target);
  const patchedH1 = repairLocationText(page.h1, current, target);
  const patchedMeta = repairLocationText(page.meta_description, current, target);
  const patchedHtml = repairLocationText(version.content_html || "", current, target);

  await pool.query(
    `UPDATE pages
     SET title = $2,
         h1 = $3,
         meta_description = $4,
         r2_key = NULL,
         content_hash = NULL,
         rendered_at = NULL,
         updated_at = NOW()
     WHERE id::text = $1::text`,
    [page.id, patchedTitle, patchedH1, patchedMeta],
  );

  if (version.id) {
    await pool.query(
      `UPDATE page_versions SET content_html = $2, created_at = created_at WHERE id::text = $1::text`,
      [version.id, patchedHtml],
    ).catch(async () => {
      await pool.query(
        `UPDATE page_versions SET content_html = $2 WHERE page_id::text = $1::text AND is_active = true`,
        [page.id, patchedHtml],
      );
    });
  }

  return { repaired: true, pageId: page.id, from: current, to: target };
}

router.all("/api/repair/brand-r2", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const domain = String(req.query.domain || req.body?.domain || "").trim();
    const slug = String(req.query.slug || req.body?.slug || "").replace(/^\/+/, "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit || req.body?.limit || 500), 1), 5000);
    const render = String(req.query.render || req.body?.render || "false") === "true";
    const fixLocation = String(req.query.fixLocation || req.body?.fixLocation || "false") === "true";
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

    const locationRepair = fixLocation && slug ? await repairSlugLocation(website.id, slug) : null;

    const invalidated = await pool.query(
      `UPDATE pages
       SET r2_key = NULL,
           content_hash = NULL,
           rendered_at = NULL,
           updated_at = NOW()
       WHERE website_id::text = $1::text
         AND status = 'published'
         AND ($2::text = '' OR slug = $2)
       RETURNING id, slug`,
      [website.id, slug],
    );

    let renderResult: any = null;
    if (render && slug) {
      renderResult = await renderPublishedPageToR2({ websiteId: website.id, slug, force: true });
    } else if (render) {
      renderResult = await renderPublishedPagesBatchToR2({ websiteId: website.id, limit, force: true });
    }

    return res.json({
      ok: true,
      domain,
      slug: slug || null,
      resolvedWebsite: { id: website.id, domain: website.domain, accountId: website.account_id },
      brand: { id: brand.id, name: brand.name },
      copiedSettingKeys: Object.keys(settingsPatch),
      locationRepair,
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
