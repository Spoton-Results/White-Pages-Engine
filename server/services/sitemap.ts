import { db } from "../db";
import { pages, sitemaps } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import * as storage from "../storage";
import { saveSitemap, isR2Configured } from "./r2";

export const URLS_PER_SITEMAP = 10000;

function buildSitemapXml(urls: Array<{ loc: string; lastmod?: string; priority?: string }>): string {
  const items = urls.map(({ loc, lastmod, priority }) =>
    `  <url>
    <loc>${escapeXml(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}${priority ? `\n    <changefreq>weekly</changefreq>\n    <priority>${priority}</priority>` : ""}
  </url>`
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</urlset>`;
}

function buildSitemapIndexXml(sitemapUrls: Array<{ loc: string; lastmod?: string }>): string {
  const items = sitemapUrls.map(({ loc, lastmod }) =>
    `  <sitemap>
    <loc>${escapeXml(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}
  </sitemap>`
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</sitemapindex>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Stream published pages for a given tier (1, 2, or null=all non-tier3) in chunks
async function streamPagesByTier(
  websiteId: string,
  tier: 1 | 2 | "all-visible",
  chunkSize: number,
  callback: (chunk: Array<{ slug: string; updatedAt: Date; publishedAt: Date | null; pageType: string }>) => Promise<void>,
): Promise<number> {
  let offset = 0;
  let total = 0;

  while (true) {
    let rows: any[];

    if (tier === "all-visible") {
      // Tier 1 + Tier 2 (anything not tier 3)
      rows = await db
        .select({ slug: pages.slug, updatedAt: pages.updatedAt, publishedAt: pages.publishedAt, pageType: pages.pageType })
        .from(pages)
        .where(
          and(
            eq(pages.websiteId, websiteId),
            eq(pages.status, "published"),
            sql`(pages.tier IS NULL OR pages.tier != 3)`,
          )
        )
        .orderBy(pages.slug)
        .limit(chunkSize)
        .offset(offset);
    } else {
      rows = await db
        .select({ slug: pages.slug, updatedAt: pages.updatedAt, publishedAt: pages.publishedAt, pageType: pages.pageType })
        .from(pages)
        .where(
          and(
            eq(pages.websiteId, websiteId),
            eq(pages.status, "published"),
            sql`pages.tier = ${tier}`,
          )
        )
        .orderBy(pages.slug)
        .limit(chunkSize)
        .offset(offset);
    }

    if (rows.length === 0) break;
    await callback(rows);
    total += rows.length;
    if (rows.length < chunkSize) break;
    offset += chunkSize;
  }

  return total;
}

export async function generateSitemapsForWebsite(websiteId: string, domain: string, canonicalBaseOverride?: string): Promise<string[]> {
  const baseUrl = canonicalBaseOverride || `https://${domain}`;
  const today = new Date().toISOString().split("T")[0];
  const sitemapKeys: string[] = [];

  // Track which sitemap slugs we generate so we can clean up stale ones
  const generatedSlugs = new Set<string>();

  // ── Tier 1 pages → primary sitemaps (sitemap-1, sitemap-2...) ──────────────
  let t1ChunkIndex = 0;
  let t1Total = 0;
  await streamPagesByTier(websiteId, 1, URLS_PER_SITEMAP, async (chunk) => {
    const slug = `sitemap-${t1ChunkIndex + 1}`;
    generatedSlugs.add(slug);
    const urls = chunk.map((p) => ({
      loc: `${baseUrl}/${p.slug}`,
      lastmod: (p.publishedAt || p.updatedAt).toISOString().split("T")[0],
      priority: p.pageType === "state_hub" ? "0.9" : p.pageType === "city_hub" ? "0.8" : "0.7",
    }));
    const xml = buildSitemapXml(urls);
    const key = `sitemaps/${websiteId}/${slug}.xml`;

    if (isR2Configured()) {
      try { await saveSitemap(websiteId, slug, xml); sitemapKeys.push(key); } catch { sitemapKeys.push(key); }
    }
    await storage.upsertSitemap({
      websiteId, name: `Tier 1 Sitemap ${t1ChunkIndex + 1}`, slug, urlCount: urls.length,
      r2Key: key, xmlContent: xml, lastGenerated: new Date(),
    });
    t1ChunkIndex++;
    t1Total += chunk.length;
  });

  // If no Tier 1 pages exist yet, fall back to all non-Tier-3 pages for primary sitemap
  if (t1Total === 0) {
    let fallbackChunkIndex = 0;
    await streamPagesByTier(websiteId, "all-visible", URLS_PER_SITEMAP, async (chunk) => {
      const slug = `sitemap-${fallbackChunkIndex + 1}`;
      generatedSlugs.add(slug);
      const urls = chunk.map((p) => ({
        loc: `${baseUrl}/${p.slug}`,
        lastmod: (p.publishedAt || p.updatedAt).toISOString().split("T")[0],
        priority: p.pageType === "state_hub" ? "0.9" : p.pageType === "city_hub" ? "0.8" : "0.7",
      }));
      const xml = buildSitemapXml(urls);
      const key = `sitemaps/${websiteId}/${slug}.xml`;
      if (isR2Configured()) {
        try { await saveSitemap(websiteId, slug, xml); sitemapKeys.push(key); } catch { sitemapKeys.push(key); }
      }
      await storage.upsertSitemap({
        websiteId, name: `Sitemap ${fallbackChunkIndex + 1}`, slug, urlCount: urls.length,
        r2Key: key, xmlContent: xml, lastGenerated: new Date(),
      });
      fallbackChunkIndex++;
    });
  }

  // ── Tier 2 pages → secondary sitemaps (sitemap-t2-1, sitemap-t2-2...) ──────
  let t2ChunkIndex = 0;
  await streamPagesByTier(websiteId, 2, URLS_PER_SITEMAP, async (chunk) => {
    const slug = `sitemap-t2-${t2ChunkIndex + 1}`;
    generatedSlugs.add(slug);
    const urls = chunk.map((p) => ({
      loc: `${baseUrl}/${p.slug}`,
      lastmod: (p.publishedAt || p.updatedAt).toISOString().split("T")[0],
      priority: "0.5",
    }));
    const xml = buildSitemapXml(urls);
    const key = `sitemaps/${websiteId}/${slug}.xml`;
    if (isR2Configured()) {
      try { await saveSitemap(websiteId, slug, xml); sitemapKeys.push(key); } catch { sitemapKeys.push(key); }
    }
    await storage.upsertSitemap({
      websiteId, name: `Tier 2 Sitemap ${t2ChunkIndex + 1}`, slug, urlCount: urls.length,
      r2Key: key, xmlContent: xml, lastGenerated: new Date(),
    });
    t2ChunkIndex++;
  });

  // ── Build sitemap index (all sitemaps) ─────────────────────────────────────
  const allSitemaps = await storage.getSitemaps(websiteId);
  const indexXml = buildSitemapIndexXml(
    allSitemaps.map((sm) => ({
      loc: `${baseUrl}/${sm.slug}.xml`,
      lastmod: today,
    }))
  );

  if (isR2Configured()) {
    try { await saveSitemap(websiteId, "sitemap-index", indexXml); } catch {}
  }

  return sitemapKeys;
}

export function generateRobotsTxt(domain: string, sitemapUrl?: string): string {
  return `User-agent: *
Allow: /

Sitemap: ${sitemapUrl || `https://${domain}/sitemap.xml`}
`;
}

export { buildSitemapXml, buildSitemapIndexXml };
