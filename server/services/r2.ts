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
