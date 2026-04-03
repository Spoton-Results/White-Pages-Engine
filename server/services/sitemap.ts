import { db } from "../db";
import { pages, sitemaps } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import * as storage from "../storage";
import { saveSitemap, isR2Configured } from "./r2";

const URLS_PER_SITEMAP = 50000;

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

export async function generateSitemapsForWebsite(websiteId: string, domain: string): Promise<string[]> {
  const baseUrl = `https://${domain}`;
  const sitemapKeys: string[] = [];
  const today = new Date().toISOString().split("T")[0];

  // Stream pages in URLS_PER_SITEMAP-sized chunks to avoid loading 200K+ rows at once
  let chunkIndex = 0;
  let offset = 0;

  while (true) {
    const chunk = await storage.getPages(websiteId, { status: "published", limit: URLS_PER_SITEMAP, offset });
    if (chunk.length === 0) break;

    const slug = `sitemap-${chunkIndex + 1}`;
    const urls = chunk.map((p) => ({
      loc: `${baseUrl}/${p.slug}`,
      lastmod: (p.publishedAt || p.updatedAt).toISOString().split("T")[0],
      priority: p.pageType === "state_hub" ? "0.9" : p.pageType === "city_hub" ? "0.8" : "0.7",
    }));

    const xml = buildSitemapXml(urls);
    const key = `sitemaps/${websiteId}/${slug}.xml`;

    if (isR2Configured()) {
      try {
        await saveSitemap(websiteId, slug, xml);
        sitemapKeys.push(key);
      } catch (err) {
        console.error(`[sitemap] R2 upload failed for ${slug}:`, err);
        sitemapKeys.push(key);
      }
    }

    await storage.upsertSitemap({
      websiteId,
      name: `Sitemap ${chunkIndex + 1}`,
      slug,
      urlCount: urls.length,
      r2Key: key,
      xmlContent: xml,
      lastGenerated: new Date(),
    });

    if (chunk.length < URLS_PER_SITEMAP) break;
    offset += URLS_PER_SITEMAP;
    chunkIndex++;
  }

  // Build sitemap index
  const allSitemaps = await storage.getSitemaps(websiteId);
  const indexXml = buildSitemapIndexXml(
    allSitemaps.map((sm) => ({
      loc: `${baseUrl}/${sm.slug}.xml`,
      lastmod: today,
    }))
  );

  if (isR2Configured()) {
    try {
      await saveSitemap(websiteId, "sitemap-index", indexXml);
    } catch {}
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
