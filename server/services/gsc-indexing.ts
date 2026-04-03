/**
 * gsc-indexing.ts
 * Submits newly published URLs to Google's Indexing API using a service account.
 *
 * Setup (one-time):
 *   1. Create a Google Cloud service account.
 *   2. Grant it "Owner" access to your Search Console property.
 *   3. Download the JSON key file and set GOOGLE_INDEXING_SA_JSON env var to its contents.
 *
 * The Indexing API guarantees crawl within hours for submitted URLs.
 * It is officially designed for JobPosting / BroadcastEvent schemas but Google
 * has confirmed it works for any page type as a fast-index signal.
 */
import { createSign } from "crypto";

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
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GSC token error: ${res.status} ${text}`);
  }

  const data = await res.json();
  cachedToken = { value: data.access_token, expiresAt: now + 3600 };
  return data.access_token;
}

/**
 * Submit up to 200 URLs to the Google Indexing API.
 * Silently skips if GOOGLE_INDEXING_SA_JSON is not configured.
 * Batches 10 at a time to stay within API rate limits (600 req/day per property).
 */
export async function submitUrlsToGoogle(urls: string[]): Promise<void> {
  const saRaw = process.env.GOOGLE_INDEXING_SA_JSON;
  if (!saRaw || !urls.length) return;

  let saJson: { client_email: string; private_key: string };
  try {
    saJson = JSON.parse(saRaw);
  } catch {
    console.warn("[gsc-indexing] GOOGLE_INDEXING_SA_JSON is not valid JSON — skipping");
    return;
  }

  let token: string;
  try {
    token = await getAccessToken(saJson);
  } catch (err) {
    console.warn("[gsc-indexing] Could not get access token:", err);
    return;
  }

  // Cap at 200 URLs per job to respect the 600 req/day quota (across all jobs)
  const batch = urls.slice(0, 200);
  const CHUNK = 10;
  let submitted = 0;

  for (let i = 0; i < batch.length; i += CHUNK) {
    const chunk = batch.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(url =>
        fetch(INDEXING_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ url, type: "URL_UPDATED" }),
        }).catch(err => console.warn("[gsc-indexing] submit error for", url, err)),
      ),
    );
    submitted += chunk.length;
    // Small pause between chunks to avoid burst rate limits
    if (i + CHUNK < batch.length) await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[gsc-indexing] Submitted ${submitted} URLs to Google Indexing API`);
}
