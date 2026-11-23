/**
 * Submits eligible job posting and livestream notifications using a service account.
 * GOOGLE_INDEXING_SA_JSON contains the service account JSON credentials.
 * Accepted notifications are not a guarantee of crawling or indexing.
 */
import { createSign } from "crypto";
import { validateIndexingEligibility } from "./indexing-eligibility";

const INDEXING_ENDPOINT = "https://indexing.googleapis.com/v3/urlNotifications:publish";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/indexing";

// Cache access token for up to 55 minutes to avoid hammering the token endpoint
let cachedToken: { value: string; expiresAt: number } | null = null;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function getAccessToken(saJson: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value;

  const header = base64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64url(
    Buffer.from(
      JSON.stringify({
        iss: saJson.client_email,
        scope: SCOPE,
        aud: TOKEN_ENDPOINT,
        iat: now,
        exp: now + 3600,
      }),
    ),
  );

  const sigInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(sigInput);
  const sig = base64url(signer.sign(saJson.private_key));
  const jwt = `${sigInput}.${sig}`;

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`GSC token error: ${res.status}`);
  const data = await res.json();
  if (typeof data.access_token !== "string" || !data.access_token) throw new Error("Invalid token response");
  const lifetime = Number(data.expires_in);
  if (!Number.isFinite(lifetime) || lifetime <= 0) throw new Error("Invalid token lifetime");
  cachedToken = { value: data.access_token, expiresAt: now + Math.min(lifetime, 3300) };
  return data.access_token;
}

export interface IndexingOutcome {
  url: string;
  pageId?: string;
  status: "accepted" | "skipped" | "failed" | "deferred";
  reason?: string;
  validationReasons?: string[];
  httpStatus?: number;
}

interface IndexingWebsite { domain: string; settings?: any }
interface IndexingPage { id: string; websiteId: string; status: string; noindex?: boolean | null; isDraft?: boolean | null; tier?: number | null }
export interface IndexingDependencies {
  getWebsite(id: string): Promise<IndexingWebsite | undefined>;
  getPageBySlug(websiteId: string, slug: string): Promise<IndexingPage | undefined>;
  getActivePageVersion(pageId: string): Promise<{ contentHtml?: string | null } | undefined>;
  getToken(): Promise<string>;
  notify(url: string, token: string): Promise<{ ok: boolean; status: number }>;
  pause(): Promise<void>;
}

async function defaultDependencies(): Promise<IndexingDependencies> {
  const storage = await import("../storage");
  return {
    getWebsite: storage.getWebsite,
    getPageBySlug: storage.getPageBySlug,
    getActivePageVersion: storage.getActivePageVersion,
    getToken: async () => {
      const raw = process.env.GOOGLE_INDEXING_SA_JSON;
      if (!raw) throw new Error("Missing indexing credentials");
      const sa = JSON.parse(raw);
      if (typeof sa?.client_email !== "string" || !sa.client_email || typeof sa?.private_key !== "string" || !sa.private_key) throw new Error("Invalid indexing credentials");
      return getAccessToken(sa);
    },
    notify: (url, token) => fetch(INDEXING_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url, type: "URL_UPDATED" }),
      signal: AbortSignal.timeout(15000),
    }),
    pause: () => new Promise(resolve => setTimeout(resolve, 500)),
  };
}

// Missing tenant context throws so legacy callers cannot record a silent success.
export async function submitUrlsToGoogle(urls: string[], websiteId?: string, dependencies?: IndexingDependencies): Promise<IndexingOutcome[]> {
  if (!urls.length) return [];
  if (!websiteId) throw new Error("Indexing submission requires websiteId");
  const deps = dependencies || await defaultDependencies();
  const website = await deps.getWebsite(websiteId);
  if (!website) throw new Error("Indexing website not found");
  const parent = website.settings?.parentDomain;
  const path = website.settings?.proxyPath || "";
  const base = new URL(parent ? `https://${parent}${path}` : `https://${website.domain}`);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Invalid indexing canonical base");
  const prefix = base.pathname.replace(/\/+$/, "") + "/";
  const outcomes: IndexingOutcome[] = [];
  const eligible: IndexingOutcome[] = [];
  const seen = new Set<string>();
  for (const input of urls) {
    const outcome: IndexingOutcome = { url: input, status: "failed" };
    outcomes.push(outcome);
    try {
      const url = new URL(input);
      if (url.origin !== base.origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix)) {
        outcome.reason = "url_outside_website_canonical_scope"; continue;
      }
      const slug = decodeURIComponent(url.pathname.slice(prefix.length));
      if (!slug || /[\/\\?#]/.test(slug)) { outcome.reason = "invalid_page_slug"; continue; }
      if (seen.has(slug)) { outcome.status = "skipped"; outcome.reason = "duplicate_url"; continue; }
      seen.add(slug);
      const page = await deps.getPageBySlug(websiteId, slug);
      if (!page || page.websiteId !== websiteId) { outcome.reason = "page_not_found_for_website"; continue; }
      outcome.pageId = page.id;
      if (page.status !== "published" || page.isDraft || page.noindex !== false || page.tier === 3) {
        outcome.status = "skipped"; outcome.reason = "page_not_publicly_indexable"; continue;
      }
      const version = await deps.getActivePageVersion(page.id);
      if (!version?.contentHtml) { outcome.reason = "missing_active_page_html"; continue; }
      const validation = validateIndexingEligibility(version.contentHtml);
      if (!validation.eligible) {
        outcome.status = "skipped";
        outcome.reason = "ineligible_for_indexing_api";
        outcome.validationReasons = validation.reasons;
        continue;
      }
      if (eligible.length >= 200) { outcome.status = "deferred"; outcome.reason = "per_run_submission_cap"; continue; }
      eligible.push(outcome);
    } catch { outcome.reason = "page_verification_failed"; }
  }
  if (!eligible.length) return outcomes;
  let token: string;
  try {
    token = await deps.getToken();
    if (!token) throw new Error("Empty indexing token");
  } catch {
    for (const outcome of eligible) outcome.reason = "indexing_credentials_or_token_failed";
    return outcomes;
  }
  for (let i = 0; i < eligible.length; i += 10) {
    await Promise.all(eligible.slice(i, i + 10).map(async outcome => {
      try {
        const response = await deps.notify(outcome.url, token);
        outcome.httpStatus = response.status;
        if (response.ok) outcome.status = "accepted";
        else outcome.reason = "indexing_api_rejected";
      } catch { outcome.reason = "indexing_api_request_failed"; }
    }));
    if (i + 10 < eligible.length) await deps.pause();
  }
  return outcomes;
}
