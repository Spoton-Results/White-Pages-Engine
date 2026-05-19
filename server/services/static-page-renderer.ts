import { createHash } from "crypto";
import { pool } from "../db";
import { isR2Configured, savePageHtml } from "./r2";
import { buildEnhancedPublicPageHtml, getPublicInternalLinks } from "./public-page-enhancements";

export interface RenderPublishedPageToR2Options {
  pageId?: string;
  websiteId?: string;
  slug?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface RenderPublishedPageToR2Result {
  pageId: string;
  websiteId: string;
  slug: string;
  r2Key: string | null;
  contentHash: string;
  renderedAt: string | null;
  skipped: boolean;
  reason?: string;
}

export interface RenderPublishedPagesBatchOptions {
  websiteId: string;
  limit?: number;
  dryRun?: boolean;
  force?: boolean;
}

export interface RenderPublishedPagesBatchResult {
  websiteId: string;
  attempted: number;
  rendered: number;
  skipped: number;
  failed: number;
  results: RenderPublishedPageToR2Result[];
}

function isR2RenderingEnabled(): boolean {
  return process.env.R2_RENDERING_ENABLED === "true";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeSlug(slug: string): string {
  return slug.replace(/^\/+/, "").replace(/\/+$/, "");
}

function sanitizeStaticHtmlCopy(value: string): string {
  return String(value || "")
    .replace(
      /free equipment\s*&\s*fast setup for\s*\.\s*Get a free quote today\./gi,
      "free equipment & fast setup for local businesses. Get a free quote today.",
    )
    .replace(/\bfast setup for\s*\./gi, "fast setup for local businesses.")
    .replace(/\bsetup for\s*\./gi, "setup for local businesses.")
    .replace(/\bfor\s*\.\s*/gi, "for local businesses. ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ");
}

function buildCanonicalUrl(domain: string, slug: string, canonicalUrl?: string | null): string {
  if (canonicalUrl) return canonicalUrl;
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const cleanSlug = normalizeSlug(slug);
  return `https://${cleanDomain}/${cleanSlug}`;
}

function isFullHtmlDocument(contentHtml: string): boolean {
  const trimmed = contentHtml.trim().toLowerCase();
  return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
}

async function buildStaticHtml(row: any): Promise<string> {
  const contentHtml = sanitizeStaticHtmlCopy(row.content_html ?? "");
  const canonical = buildCanonicalUrl(row.domain, row.slug, row.canonical_url);

  if (isFullHtmlDocument(contentHtml) && contentHtml.includes("nexus-demo")) {
    return contentHtml;
  }

  const links = await getPublicInternalLinks(row.id, row.website_id);

  return buildEnhancedPublicPageHtml({
    page: row,
    website: {
      ...row,
      name: row.website_name,
      settings: row.settings || {},
    },
    contentHtml,
    canonicalUrl: canonical,
    links,
  });
}

async function getPublishedPage(options: RenderPublishedPageToR2Options): Promise<any | null> {
  const clauses = ["p.status = 'published'", "COALESCE(p.noindex, false) = false"];
  const values: any[] = [];

  if (options.pageId) {
    values.push(options.pageId);
    clauses.push(`p.id = $${values.length}`);
  }

  if (options.websiteId) {
    values.push(options.websiteId);
    clauses.push(`p.website_id = $${values.length}`);
  }

  if (options.slug) {
    values.push(normalizeSlug(options.slug));
    clauses.push(`p.slug = $${values.length}`);
  }

  if (!options.pageId && (!options.websiteId || !options.slug)) {
    throw new Error("Provide either pageId or websiteId + slug");
  }

  const sql = `
    SELECT
      p.id,
      p.website_id,
      p.slug,
      p.title,
      p.meta_description,
      p.h1,
      p.canonical_url,
      p.r2_key,
      p.content_hash,
      p.rendered_at,
      p.status,
      p.noindex,
      p.service_id,
      p.location_id,
      p.page_type,
      p.tier,
      p.quality_score,
      p.published_at,
      w.domain,
      w.name AS website_name,
      w.settings,
      pv.content_html
    FROM pages p
    JOIN websites w ON w.id = p.website_id
    JOIN page_versions pv ON pv.page_id = p.id AND pv.is_active = true
    WHERE ${clauses.join(" AND ")}
    LIMIT 1
  `;

  const result = await pool.query(sql, values);
  return result.rows[0] ?? null;
}

export async function renderPublishedPageToR2(
  options: RenderPublishedPageToR2Options,
): Promise<RenderPublishedPageToR2Result> {
  if (!isR2RenderingEnabled()) {
    return {
      pageId: options.pageId ?? "",
      websiteId: options.websiteId ?? "",
      slug: options.slug ?? "",
      r2Key: null,
      contentHash: "",
      renderedAt: null,
      skipped: true,
      reason: "R2_RENDERING_ENABLED is not true",
    };
  }

  if (!isR2Configured()) {
    return {
      pageId: options.pageId ?? "",
      websiteId: options.websiteId ?? "",
      slug: options.slug ?? "",
      r2Key: null,
      contentHash: "",
      renderedAt: null,
      skipped: true,
      reason: "R2 is not configured",
    };
  }

  const row = await getPublishedPage(options);
  if (!row) {
    return {
      pageId: options.pageId ?? "",
      websiteId: options.websiteId ?? "",
      slug: options.slug ?? "",
      r2Key: null,
      contentHash: "",
      renderedAt: null,
      skipped: true,
      reason: "Published page not found or page is noindex",
    };
  }

  const html = await buildStaticHtml(row);
  const contentHash = sha256(html);

  if (!options.force && row.r2_key && row.content_hash === contentHash) {
    return {
      pageId: row.id,
      websiteId: row.website_id,
      slug: row.slug,
      r2Key: row.r2_key,
      contentHash,
      renderedAt: row.rendered_at ? new Date(row.rendered_at).toISOString() : null,
      skipped: true,
      reason: "Existing R2 artifact already matches content hash",
    };
  }

  if (options.dryRun) {
    return {
      pageId: row.id,
      websiteId: row.website_id,
      slug: row.slug,
      r2Key: row.r2_key ?? null,
      contentHash,
      renderedAt: row.rendered_at ? new Date(row.rendered_at).toISOString() : null,
      skipped: true,
      reason: "Dry run: HTML rendered and hashed but not uploaded",
    };
  }

  const r2Key = await savePageHtml(row.website_id, normalizeSlug(row.slug), html);
  const renderedAt = new Date().toISOString();

  await pool.query(
    `UPDATE pages
     SET r2_key = $1,
         content_hash = $2,
         rendered_at = NOW(),
         updated_at = NOW()
     WHERE id = $3`,
    [r2Key, contentHash, row.id],
  );

  return {
    pageId: row.id,
    websiteId: row.website_id,
    slug: row.slug,
    r2Key,
    contentHash,
    renderedAt,
    skipped: false,
  };
}

export async function renderPublishedPagesBatchToR2(
  options: RenderPublishedPagesBatchOptions,
): Promise<RenderPublishedPagesBatchResult> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 500);

  const missingMetadataClause = options.force
    ? ""
    : `AND (r2_key IS NULL OR content_hash IS NULL OR rendered_at IS NULL)`;

  const result = await pool.query(
    `SELECT id
     FROM pages
     WHERE website_id = $1
       AND status = 'published'
       AND COALESCE(noindex, false) = false
       ${missingMetadataClause}
     ORDER BY created_at ASC, id ASC
     LIMIT $2`,
    [options.websiteId, limit],
  );

  const results: RenderPublishedPageToR2Result[] = [];
  let rendered = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of result.rows) {
    try {
      const renderResult = await renderPublishedPageToR2({
        pageId: row.id,
        dryRun: options.dryRun,
        force: options.force,
      });
      results.push(renderResult);
      if (renderResult.skipped) skipped += 1;
      else rendered += 1;
    } catch (error: any) {
      failed += 1;
      results.push({
        pageId: row.id,
        websiteId: options.websiteId,
        slug: "",
        r2Key: null,
        contentHash: "",
        renderedAt: null,
        skipped: true,
        reason: error?.message ?? "Unknown render failure",
      });
    }
  }

  return {
    websiteId: options.websiteId,
    attempted: result.rows.length,
    rendered,
    skipped,
    failed,
    results,
  };
}
