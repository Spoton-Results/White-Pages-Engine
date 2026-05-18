import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error("R2 credentials not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)");
    }

    client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return client;
}

function getBucket(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2_BUCKET_NAME not configured");
  return bucket;
}

export function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}

function sanitizePageHtmlCopy(value: string): string {
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

export async function putObject(key: string, body: string, contentType = "application/json"): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function getObject(key: string): Promise<string> {
  const response = await getClient().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key })
  );
  return await streamToString(response.Body as any);
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key })
  );
}

export async function listObjects(prefix: string): Promise<string[]> {
  const response = await getClient().send(
    new ListObjectsV2Command({ Bucket: getBucket(), Prefix: prefix })
  );
  return (response.Contents || []).map((obj) => obj.Key || "").filter(Boolean);
}

async function streamToString(stream: any): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export async function savePageArtifact(websiteId: string, pageId: string, html: string): Promise<string> {
  const key = `artifacts/${websiteId}/pages/${pageId}.html`;
  await putObject(key, html, "text/html");
  return key;
}

export async function saveJsonBackup(prefix: string, name: string, data: any): Promise<string> {
  const key = `backups/${prefix}/${name}.json`;
  await putObject(key, JSON.stringify(data, null, 2));
  return key;
}

export async function saveSitemap(websiteId: string, sitemapSlug: string, xml: string): Promise<string> {
  const key = `sitemaps/${websiteId}/${sitemapSlug}.xml`;
  await putObject(key, xml, "application/xml");
  return key;
}

export async function saveLog(prefix: string, jobId: string, log: string): Promise<string> {
  const key = `logs/${prefix}/${jobId}.log`;
  await putObject(key, log, "text/plain");
  return key;
}

export function getPublicUrl(key: string): string {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (!base) return key;
  return `${base.replace(/\/$/, "")}/${key}`;
}

// ── Page HTML offload ─────────────────────────────────────────────────────────
// Stores the fully-rendered page HTML in R2 and returns the storage key.
// The key is persisted on pages.r2_key so the serve path can skip re-rendering.

export async function savePageHtml(websiteId: string, slug: string, html: string): Promise<string> {
  const key = `pages/${websiteId}/${slug}.html`;
  await putObject(key, html, "text/html; charset=utf-8");
  return key;
}

// Fetches rendered HTML for a page from R2.
// Returns null if the object does not exist (404) so callers can fall back to DB.
export async function getPageHtml(r2Key: string): Promise<string | null> {
  try {
    const html = await getObject(r2Key);
    return sanitizePageHtmlCopy(html);
  } catch (err: any) {
    // NoSuchKey = object never written or already deleted — treat as cache miss
    if (
      err?.name === "NoSuchKey" ||
      err?.Code === "NoSuchKey" ||
      err?.$metadata?.httpStatusCode === 404
    ) {
      return null;
    }
    throw err;
  }
}

// Deletes all page HTML objects for a website (e.g. when a website is torn down).
export async function deletePageHtmlForWebsite(websiteId: string): Promise<void> {
  const keys = await listObjects(`pages/${websiteId}/`);
  await Promise.all(keys.map((k) => deleteObject(k)));
}
