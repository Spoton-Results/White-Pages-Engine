import { and, eq, ilike } from "drizzle-orm";
import { db } from "../db";
import { pageMetrics, pages, websites } from "@shared/schema";

export interface ExternalSearchMetricRow {
  websiteId: string;
  url?: string;
  slug?: string;
  date: string;
  impressions: number;
  clicks: number;
  avgPosition?: number | null;
  ctr?: number | null;
  query?: string;
  source?: string;
}

export interface ExternalSearchIngestionResult {
  received: number;
  matched: number;
  inserted: number;
  skipped: number;
  unmatched: ExternalSearchMetricRow[];
}

function slugFromUrl(url?: string) {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
    return path || "/";
  } catch {
    return url.replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+|\/+$/g, "") || "/";
  }
}

async function findPageForMetric(row: ExternalSearchMetricRow) {
  const slug = row.slug ?? slugFromUrl(row.url);

  if (!slug) return null;

  const exactRows = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.websiteId, row.websiteId), eq(pages.slug, slug)))
    .limit(1);

  if (exactRows[0]?.id) return exactRows[0].id;

  const fuzzyRows = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.websiteId, row.websiteId), ilike(pages.slug, `%${slug.split("/").pop() ?? slug}%`)))
    .limit(1);

  return fuzzyRows[0]?.id ?? null;
}

export async function ingestExternalSearchMetrics(
  rows: ExternalSearchMetricRow[],
): Promise<ExternalSearchIngestionResult> {
  const result: ExternalSearchIngestionResult = {
    received: rows.length,
    matched: 0,
    inserted: 0,
    skipped: 0,
    unmatched: [],
  };

  for (const row of rows) {
    const pageId = await findPageForMetric(row);

    if (!pageId) {
      result.unmatched.push(row);
      result.skipped++;
      continue;
    }

    result.matched++;

    const ctr = row.ctr ?? (row.impressions > 0 ? row.clicks / row.impressions : null);

    await db.insert(pageMetrics).values({
      pageId,
      websiteId: row.websiteId,
      date: row.date,
      impressions: row.impressions,
      clicks: row.clicks,
      avgPosition: row.avgPosition === undefined || row.avgPosition === null ? null : String(row.avgPosition),
      ctr: ctr === null ? null : String(ctr),
    });

    result.inserted++;
  }

  return result;
}

export async function getWebsiteByDomain(domain: string) {
  const normalized = domain.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();

  const rows = await db
    .select({ id: websites.id, domain: websites.domain })
    .from(websites)
    .where(ilike(websites.domain, `%${normalized}%`))
    .limit(1);

  return rows[0] ?? null;
}

export function normalizeSearchConsoleExport(params: {
  websiteId: string;
  rows: Array<Record<string, unknown>>;
}): ExternalSearchMetricRow[] {
  return params.rows
    .map((row) => {
      const url = String(row.page ?? row.url ?? row.landingPage ?? "");
      const date = String(row.date ?? row.day ?? new Date().toISOString().slice(0, 10));
      const impressions = Number(row.impressions ?? 0);
      const clicks = Number(row.clicks ?? 0);
      const avgPosition = row.position ?? row.avgPosition ?? row.averagePosition;
      const query = row.query ? String(row.query) : undefined;

      return {
        websiteId: params.websiteId,
        url,
        date,
        impressions,
        clicks,
        avgPosition: avgPosition === undefined || avgPosition === null ? null : Number(avgPosition),
        query,
        source: "search_console_export",
      };
    })
    .filter((row) => row.url && row.date);
}
