import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();
router.use(requireAuth);

function normalizeHostname(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
}

function dnsTarget() {
  return process.env.CLIENT_DOMAIN_CNAME_TARGET || process.env.NEXUS_CNAME_TARGET || "cname.spotonnexus.com";
}

async function ensureClientDomainsTable(client: any = pool) {
  await client.query(`CREATE TABLE IF NOT EXISTS client_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    website_id TEXT NOT NULL,
    account_id TEXT,
    hostname TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending_dns',
    cloudflare_hostname_id TEXT,
    ownership_txt_name TEXT,
    ownership_txt_value TEXT,
    ssl_status TEXT,
    error TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    verified_at TIMESTAMP
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_client_domains_website ON client_domains(website_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_client_domains_hostname ON client_domains(hostname)`);
}

async function assertWebsiteAccess(req: Request, res: Response, websiteId: string) {
  const website = (await pool.query(`SELECT id, account_id, domain, name FROM websites WHERE id::text = $1::text LIMIT 1`, [websiteId])).rows[0];
  if (!website) { res.status(404).json({ message: "Website not found" }); return null; }
  if (!req.session.isSuperAdmin && String(req.session.accountId) !== String(website.account_id)) {
    res.status(403).json({ message: "Forbidden: No access to this website" }); return null;
  }
  return website;
}

async function cfRequest(path: string, init: RequestInit = {}) {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!zoneId || !apiToken) throw new Error("Cloudflare credentials missing. Add CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN in Railway.");
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    const msg = json.errors?.[0]?.message || `Cloudflare request failed: ${res.status}`;
    const err: any = new Error(msg);
    err.cloudflare = json;
    throw err;
  }
  return json.result;
}

function extractValidation(result: any) {
  const ownership = result?.ownership_verification || result?.ownership_verification_http || {};
  const ssl = result?.ssl || {};
  const sslTxt = ssl?.validation_records?.[0] || {};
  return {
    ownershipTxtName: ownership?.name || sslTxt?.txt_name || null,
    ownershipTxtValue: ownership?.value || sslTxt?.txt_value || null,
    sslStatus: ssl?.status || null,
  };
}

async function createCloudflareHostname(hostname: string) {
  try {
    return await cfRequest(`/custom_hostnames`, {
      method: "POST",
      body: JSON.stringify({ hostname, ssl: { method: "http", type: "dv", settings: { http2: "on", min_tls_version: "1.2", tls_1_3: "on" } } }),
    });
  } catch (err: any) {
    const code = err.cloudflare?.errors?.[0]?.code;
    if (code === 1406) {
      const list = await cfRequest(`/custom_hostnames?hostname=${encodeURIComponent(hostname)}`);
      return Array.isArray(list) ? list[0] : list?.[0];
    }
    throw err;
  }
}

router.get("/api/websites/:websiteId/client-domains", async (req, res, next) => {
  try {
    await ensureClientDomainsTable();
    const website = await assertWebsiteAccess(req, res, req.params.websiteId); if (!website) return;
    const rows = (await pool.query(`SELECT * FROM client_domains WHERE website_id::text = $1::text ORDER BY created_at DESC`, [req.params.websiteId])).rows;
    res.json({ dnsTarget: dnsTarget(), domains: rows });
  } catch (err) { next(err); }
});

router.post("/api/websites/:websiteId/client-domains", async (req, res, next) => {
  try {
    await ensureClientDomainsTable();
    const website = await assertWebsiteAccess(req, res, req.params.websiteId); if (!website) return;
    const hostname = normalizeHostname(req.body?.hostname);
    if (!hostname || !hostname.includes(".")) return res.status(400).json({ message: "Enter a valid hostname like pages.client.com" });
    if (hostname === normalizeHostname(website.domain)) return res.status(400).json({ message: "Use a client subdomain, not the website origin domain." });

    let cfResult: any = null;
    let cfError: string | null = null;
    try { cfResult = await createCloudflareHostname(hostname); } catch (e: any) { cfError = e.message || "Cloudflare registration failed"; }
    const validation = extractValidation(cfResult);
    const status = cfResult?.status === "active" ? "active" : cfError ? "cloudflare_error" : "pending_dns";

    const row = (await pool.query(
      `INSERT INTO client_domains (website_id, account_id, hostname, status, cloudflare_hostname_id, ownership_txt_name, ownership_txt_value, ssl_status, error, verified_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (hostname) DO UPDATE SET website_id = EXCLUDED.website_id, account_id = EXCLUDED.account_id, status = EXCLUDED.status, cloudflare_hostname_id = EXCLUDED.cloudflare_hostname_id, ownership_txt_name = EXCLUDED.ownership_txt_name, ownership_txt_value = EXCLUDED.ownership_txt_value, ssl_status = EXCLUDED.ssl_status, error = EXCLUDED.error, verified_at = EXCLUDED.verified_at, updated_at = NOW()
       RETURNING *`,
      [website.id, website.account_id, hostname, status, cfResult?.id || null, validation.ownershipTxtName, validation.ownershipTxtValue, validation.sslStatus, cfError, status === "active" ? new Date() : null],
    )).rows[0];

    res.json({ ok: true, dnsTarget: dnsTarget(), domain: row, cloudflare: cfResult ? { id: cfResult.id, status: cfResult.status, sslStatus: cfResult.ssl?.status } : null });
  } catch (err) { next(err); }
});

router.post("/api/client-domains/:id/check", async (req, res, next) => {
  try {
    await ensureClientDomainsTable();
    const row = (await pool.query(`SELECT * FROM client_domains WHERE id::text = $1::text LIMIT 1`, [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ message: "Client domain not found" });
    const website = await assertWebsiteAccess(req, res, row.website_id); if (!website) return;

    let result: any = null;
    let error: string | null = null;
    try {
      result = row.cloudflare_hostname_id ? await cfRequest(`/custom_hostnames/${row.cloudflare_hostname_id}`) : await createCloudflareHostname(row.hostname);
    } catch (e: any) { error = e.message || "Cloudflare check failed"; }
    const validation = extractValidation(result);
    const status = result?.status === "active" ? "active" : error ? "cloudflare_error" : "pending_dns";
    const updated = (await pool.query(
      `UPDATE client_domains SET status=$2, cloudflare_hostname_id=COALESCE($3, cloudflare_hostname_id), ownership_txt_name=COALESCE($4, ownership_txt_name), ownership_txt_value=COALESCE($5, ownership_txt_value), ssl_status=COALESCE($6, ssl_status), error=$7, verified_at=CASE WHEN $2='active' THEN NOW() ELSE verified_at END, updated_at=NOW() WHERE id::text=$1::text RETURNING *`,
      [row.id, status, result?.id || null, validation.ownershipTxtName, validation.ownershipTxtValue, validation.sslStatus, error],
    )).rows[0];
    res.json({ ok: true, dnsTarget: dnsTarget(), domain: updated });
  } catch (err) { next(err); }
});

router.delete("/api/client-domains/:id", async (req, res, next) => {
  try {
    await ensureClientDomainsTable();
    const row = (await pool.query(`SELECT * FROM client_domains WHERE id::text = $1::text LIMIT 1`, [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ message: "Client domain not found" });
    const website = await assertWebsiteAccess(req, res, row.website_id); if (!website) return;
    if (row.cloudflare_hostname_id) await cfRequest(`/custom_hostnames/${row.cloudflare_hostname_id}`, { method: "DELETE" }).catch(() => null);
    await pool.query(`DELETE FROM client_domains WHERE id::text = $1::text`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
