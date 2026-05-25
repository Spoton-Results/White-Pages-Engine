import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { requireAuth } from "../auth";
import { pool } from "../db";
import * as storage from "../storage";
import { writeVariationsForService, type BrandContext } from "../services/variation-writer";

const router = Router();

type BankWriterJob = {
  jobId: string;
  websiteId: string;
  status: "running" | "done" | "error";
  total: number;
  done: number;
  errors: string[];
  startedAt: number;
};

const globalAny = globalThis as any;
const jobs: Map<string, BankWriterJob> = globalAny.__nexusVariationBankWriterJobs ?? new Map<string, BankWriterJob>();
globalAny.__nexusVariationBankWriterJobs = jobs;

async function getWebsiteContext(websiteId: string): Promise<{ website: any; accountId: string; ctx: BrandContext; brand: any | null; industry: any | null }> {
  const websiteRes = await pool.query(`SELECT * FROM websites WHERE id::text = $1::text LIMIT 1`, [websiteId]);
  const website = websiteRes.rows[0];
  if (!website) throw Object.assign(new Error("Website not found"), { status: 404 });

  const accountId = String(website.account_id);
  const brandRes = await pool.query(
    `SELECT * FROM brand_profiles WHERE account_id::text = $1::text ORDER BY created_at DESC LIMIT 1`,
    [accountId],
  );
  const brand = brandRes.rows[0] ?? null;

  const industryRes = await pool.query(
    `SELECT * FROM industries WHERE account_id::text = $1::text ORDER BY created_at DESC LIMIT 1`,
    [accountId],
  );
  const industry = industryRes.rows[0] ?? null;

  const ctx: BrandContext = {
    brandName: brand?.name || website.name || website.domain,
    brandDescription: brand?.description || undefined,
    voiceAndTone: brand?.voice_and_tone || undefined,
    industryName: website.primary_industry || industry?.name || undefined,
    industryDescription: industry?.description || undefined,
  };

  return { website, accountId, ctx, brand, industry };
}

async function getServicesForWebsite(websiteId: string): Promise<string[]> {
  const scoped = await pool.query(
    `SELECT s.name
     FROM services s
     JOIN websites w ON w.account_id::text = s.account_id::text
     WHERE w.id::text = $1::text
     ORDER BY s.name ASC`,
    [websiteId],
  );
  if (scoped.rows.length > 0) return scoped.rows.map((r: any) => String(r.name));

  const all = await pool.query(`SELECT name FROM services ORDER BY name ASC`);
  return all.rows.map((r: any) => String(r.name));
}

async function getBankedServiceNames(websiteId: string): Promise<string[]> {
  const res = await pool.query(
    `SELECT DISTINCT service
     FROM content_variation_banks
     WHERE website_id::text = $1::text
       AND variations IS NOT NULL
       AND jsonb_typeof(variations) = 'array'
       AND jsonb_array_length(variations) > 0
     ORDER BY service ASC`,
    [websiteId],
  );
  return res.rows.map((r: any) => String(r.service));
}

router.get("/api/websites/:websiteId/context", requireAuth, async (req: Request, res: Response) => {
  try {
    const { brand, industry } = await getWebsiteContext(req.params.websiteId);
    return res.json({
      brand: brand ? {
        id: brand.id,
        accountId: brand.account_id,
        name: brand.name,
        description: brand.description,
        voiceAndTone: brand.voice_and_tone,
      } : null,
      industry: industry ? {
        id: industry.id,
        accountId: industry.account_id,
        name: industry.name,
        description: industry.description,
      } : null,
    });
  } catch (err: any) {
    return res.status(err.status ?? 500).json({ message: err.message ?? "Failed to load website context" });
  }
});

router.get("/api/websites/:websiteId/bank-services", requireAuth, async (req: Request, res: Response) => {
  const names = await getBankedServiceNames(req.params.websiteId);
  return res.json(names);
});

router.get("/api/websites/:websiteId/bank-write-job", requireAuth, async (req: Request, res: Response) => {
  let latest: BankWriterJob | null = null;
  for (const job of jobs.values()) {
    if (job.websiteId === req.params.websiteId && job.status === "running") {
      if (!latest || job.startedAt > latest.startedAt) latest = job;
    }
  }

  // IMPORTANT: return real null when no job is running.
  // The frontend treats { jobId: null } as a running job, causing the stuck 0/N UI.
  if (!latest) return res.json(null);
  return res.json({ jobId: latest.jobId, status: latest.status, total: latest.total, done: latest.done });
});

router.post("/api/websites/:websiteId/variation-banks/write", requireAuth, async (req: Request, res: Response) => {
  try {
    const service = String(req.body?.service ?? "").trim();
    if (!service) return res.status(400).json({ message: "service is required" });

    const { accountId, ctx, brand, industry } = await getWebsiteContext(req.params.websiteId);
    const result = await writeVariationsForService(service, accountId, req.params.websiteId, ctx);
    await storage.recomputeBankCompleteness(req.params.websiteId, service).catch(() => {});

    return res.json({
      written: result.written,
      errors: result.errors,
      context: { brand: brand?.name ?? null, industry: industry?.name ?? null },
    });
  } catch (err: any) {
    console.error("[variation-bank-writer-fix/write]", err);
    return res.status(err.status ?? 500).json({ message: err.message ?? "Write failed" });
  }
});

router.post("/api/websites/:websiteId/variation-banks/write-all", requireAuth, async (req: Request, res: Response) => {
  try {
    const { websiteId } = req.params;
    const force = Boolean(req.body?.force);
    const { accountId, ctx } = await getWebsiteContext(websiteId);
    const allServices = await getServicesForWebsite(websiteId);

    if (allServices.length === 0) return res.json({ alreadyDone: true, total: 0 });

    const banked = new Set(await getBankedServiceNames(websiteId));
    const targetServices = force ? allServices : allServices.filter(service => !banked.has(service));

    if (targetServices.length === 0) return res.json({ alreadyDone: true, total: 0 });

    const jobId = `write-all-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const job: BankWriterJob = {
      jobId,
      websiteId,
      status: "running",
      total: targetServices.length,
      done: 0,
      errors: [],
      startedAt: Date.now(),
    };
    jobs.set(jobId, job);

    setImmediate(async () => {
      for (const service of targetServices) {
        try {
          await writeVariationsForService(service, accountId, websiteId, ctx);
          await storage.recomputeBankCompleteness(websiteId, service).catch(() => {});
        } catch (err: any) {
          const message = `${service}: ${err?.message ?? String(err)}`;
          console.error(`[variation-bank-writer-fix/write-all] ${message}`);
          job.errors.push(message);
        } finally {
          job.done++;
        }
      }
      job.status = job.errors.length > 0 && job.done === 0 ? "error" : "done";
      setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000);
    });

    return res.json({ started: true, jobId, total: targetServices.length });
  } catch (err: any) {
    console.error("[variation-bank-writer-fix/write-all]", err);
    return res.status(err.status ?? 500).json({ message: err.message ?? "Failed to start write-all job" });
  }
});

export default router;
