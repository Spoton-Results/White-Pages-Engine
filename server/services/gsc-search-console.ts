/**
 * gsc-search-console.ts
 * Queries real impressions, clicks, and position data from the Google Search Console
 * Search Analytics API using the same service account as gsc-indexing.ts.
 *
 * The service account (GOOGLE_INDEXING_SA_JSON) must be added as a user to each
 * Search Console property before this will return data.
 *
 * Add-user steps:
 *   1. Go to Google Search Console → Settings → Users and permissions
 *   2. Add the service account email with "Full" permission
 *   3. Enter the property URL in the Connect dialog in the agency dashboard
 */

import { createSign } from "crypto";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GSC_SCOPE      = "https://www.googleapis.com/auth/webmasters.readonly";

// Separate token cache from the Indexing API (different scope, independent expiry)
let gscToken: { value: string; expiresAt: number } | null = null;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function getGscToken(): Promise<string> {
  const saRaw = process.env.GOOGLE_INDEXING_SA_JSON;
  if (!saRaw) throw new Error("GOOGLE_INDEXING_SA_JSON is not set");

  let sa: { client_email: string; private_key: string };
  try { sa = JSON.parse(saRaw); } catch { throw new Error("GOOGLE_INDEXING_SA_JSON is not valid JSON"); }

  const now = Math.floor(Date.now() / 1000);
  if (gscToken && gscToken.expiresAt > now + 60) return gscToken.value;

  const header  = base64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64url(Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: GSC_SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  })));

  const sigInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(sigInput);
  const sig = base64url(signer.sign(sa.private_key));
  const jwt = `${sigInput}.${sig}`;

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GSC token request failed: ${res.status} ${text.slice(0, 300)}`);
  }

  const data = await res.json() as any;
  gscToken = { value: data.access_token, expiresAt: now + 3600 };
  return gscToken.value;
}

// ── Data types ────────────────────────────────────────────────────────────────

export interface GscTopPage {
  page: string;
  impressions: number;
  clicks: number;
  position: number;
}

export interface GscSummary {
  impressions: number;
  clicks: number;
  ctr: number;
  avgPosition: number;
  topPages: GscTopPage[];
}

// ── In-memory result cache (1 hour per site+date-range) ───────────────────────

const _cache = new Map<string, { data: GscSummary; exp: number }>();

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns the service account email (or null if not configured). */
export function getServiceAccountEmail(): string | null {
  const saRaw = process.env.GOOGLE_INDEXING_SA_JSON;
  if (!saRaw) return null;
  try { return JSON.parse(saRaw).client_email ?? null; } catch { return null; }
}

/**
 * Query Search Analytics for a single GSC property.
 * Returns null on auth failure, permission error, or missing data — caller falls back to estimates.
 */
export async function querySiteAnalytics(
  siteUrl: string,
  startDate: Date | string,
  endDate: Date | string,
): Promise<GscSummary | null> {
  const start = typeof startDate === "string" ? startDate : toIsoDate(startDate);
  const end   = typeof endDate   === "string" ? endDate   : toIsoDate(endDate);

  const cacheKey = `${siteUrl}|${start}|${end}`;
  const cached = _cache.get(cacheKey);
  if (cached && cached.exp > Date.now()) return cached.data;

  let token: string;
  try { token = await getGscToken(); } catch (err) {
    console.warn("[gsc-sc] Auth failed:", (err as Error).message);
    return null;
  }

  const encoded = encodeURIComponent(siteUrl);
  const apiBase = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encoded}/searchAnalytics/query`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Site-level totals (no dimensions)
  const totalRes = await fetch(apiBase, {
    method: "POST", headers,
    body: JSON.stringify({ startDate: start, endDate: end, rowLimit: 1 }),
  });
  if (!totalRes.ok) {
    const t = await totalRes.text();
    console.warn(`[gsc-sc] Search Analytics query failed for "${siteUrl}": ${totalRes.status} — ${t.slice(0, 300)}`);
    return null;
  }
  const totalData = await totalRes.json() as any;
  const row = totalData.rows?.[0];

  // 200 with no rows = site is connected but has no GSC data yet (new site / no indexed pages).
  // Still treat as a successful connection — return all-zeros summary so the UI can show
  // "Connected — awaiting data" rather than an error.
  if (!row) {
    console.log(`[gsc-sc] Connected to "${siteUrl}" but no data yet (${start} → ${end}) — site may be new or not yet indexed`);
    const empty: GscSummary = { impressions: 0, clicks: 0, ctr: 0, avgPosition: 0, topPages: [] };
    _cache.set(cacheKey, { data: empty, exp: Date.now() + 3_600_000 });
    return empty;
  }

  // Per-page breakdown (top 10)
  const pagesRes = await fetch(apiBase, {
    method: "POST", headers,
    body: JSON.stringify({ startDate: start, endDate: end, dimensions: ["page"], rowLimit: 10 }),
  });
  const pagesData = pagesRes.ok ? await pagesRes.json() as any : { rows: [] };

  const summary: GscSummary = {
    impressions: Math.round(row.impressions),
    clicks:      Math.round(row.clicks),
    ctr:         row.ctr,
    avgPosition: Math.round(row.position * 10) / 10,
    topPages:    (pagesData.rows ?? []).map((r: any) => ({
      page:        r.keys[0] as string,
      impressions: Math.round(r.impressions),
      clicks:      Math.round(r.clicks),
      position:    Math.round(r.position * 10) / 10,
    })),
  };

  _cache.set(cacheKey, { data: summary, exp: Date.now() + 3_600_000 });
  console.log(`[gsc-sc] Fetched ${summary.impressions} impressions / ${summary.clicks} clicks for "${siteUrl}" (${start} → ${end})`);
  return summary;
}

/** Force-fresh query used when testing a new connection. */
export async function testAndConnect(
  siteUrl: string,
  startDate: Date,
  endDate: Date,
): Promise<GscSummary | null> {
  const start = toIsoDate(startDate);
  const end   = toIsoDate(endDate);
  _cache.delete(`${siteUrl}|${start}|${end}`);
  return querySiteAnalytics(siteUrl, start, end);
}
