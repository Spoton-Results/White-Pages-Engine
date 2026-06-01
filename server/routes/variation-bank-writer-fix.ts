import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../auth";
import { pool } from "../db";
import { writeVariationsForService } from "../services/variation-writer";
import type { BrandContext } from "../services/variation-writer";

const router = Router();
const activeJobs = new Map<string, { jobId: string; total: number; done: number; status: "running" | "done" | "error" }>();

async function getContext(websiteId: string): Promise<{ accountId: string; ctx: BrandContext }> {
  const site = await pool.query(
    `SELECT id, account_id, name, domain, primary_industry FROM websites WHERE id::text = $1::text LIMIT 1`,
    [websiteId],
  );
  const website = site.rows[0];
  if (!website) throw Object.assign(new Error("Website not found"), { status: 404 });

  const brand = await pool.query(
    `SELECT name, description, voice_and_tone FROM brand_profiles WHERE account_id::text = $1::text LIMIT 1`,
    [website.account_id],
  ).catch(() => ({ rows: [] as any[] }));
  const profile = brand.rows[0] || null;

  return {
    accountId: String(website.account_id),
    ctx: {
      brandName: profile?.name || website.name || website.domain,
      brandDescription: profile?.description || undefined,
      voiceAndTone: profile?.voice_and_tone || undefined,
      industryName: website.primary_industry || undefined,
    },
  };
}

async function getServices(accountId: string, body: any): Promise<string[]> {
  const supplied = Array.isArray(body?.services)
    ? body.services.map((s: any) => String(s || "").trim()).filter(Boolean)
    : [];
  if (supplied.length) return Array.from(new Set(supplied));

  const result = await pool.query(`SELECT name FROM services WHERE account_id::text = $1::text ORDER BY name ASC`, [accountId]);
  return result.rows.map((r: any) => String(r.name || "").trim()).filter(Boolean);
}

async function getBankedServices(websiteId: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT service FROM content_variation_banks
     WHERE website_id::text = $1::text
       AND variations IS NOT NULL
       AND jsonb_array_length(variations) > 0
     ORDER BY service ASC`,
    [websiteId],
  );
  return result.rows.map((r: any) => String(r.service || "").trim()).filter(Boolean);
}

function startWriteJob(websiteId: string, accountId: string, ctx: BrandContext, services: string[]) {
  const jobId = `write-banks-${websiteId}-${Date.now()}`;
  activeJobs.set(websiteId, { jobId, total: services.length, done: 0, status: "running" });

  pool.query(
    `INSERT INTO generation_jobs (id, website_id, account_id, name, status, total_pages, processed_pages, created_at)
     VALUES ($1, $2, $3, $4, 'running', $5, 0, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [jobId, websiteId, accountId, `write_all_banks:${services.length}`, services.length],
  ).catch(() => {});

  setImmediate(async () => {
    let done = 0;
    let failed = false;
    for (const service of services) {
      try {
        await writeVariationsForService(service, accountId, websiteId, ctx);
      } catch (error: any) {
        failed = true;
        console.error(`[variation-bank-writer-fix] failed for ${service}:`, error?.message || error);
      }
      done++;
      activeJobs.set(websiteId, { jobId, total: services.length, done, status: "running" });
      await pool.query(`UPDATE generation_jobs SET processed_pages = $1 WHERE id = $2`, [done, jobId]).catch(() => {});
    }
    activeJobs.set(websiteId, { jobId, total: services.length, done, status: failed ? "error" : "done" });
    await pool.query(`UPDATE generation_jobs SET status = $1 WHERE id = $2`, [failed ? "failed" : "completed", jobId]).catch(() => {});
  });

  return jobId;
}

router.get("/api/websites/:websiteId/context", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ctx } = await getContext(req.params.websiteId);
    return res.json({
      brand: ctx.brandName ? {
        name: ctx.brandName,
        description: ctx.brandDescription || "",
        voiceAndTone: ctx.voiceAndTone || "",
      } : null,
      industry: ctx.industryName ? {
        name: ctx.industryName,
        description: "",
      } : null,
    });
  } catch (error: any) {
    if (error?.status === 404) return res.status(404).json({ message: error.message });
    next(error);
  }
});

router.get("/api/websites/:websiteId/bank-services", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json(await getBankedServices(req.params.websiteId));
  } catch (error) {
    next(error);
  }
});

router.get("/api/websites/:websiteId/bank-write-job", requireAuth, async (req: Request, res: Response) => {
  return res.json(activeJobs.get(req.params.websiteId) || { jobId: null, total: 0, done: 0, status: null });
});

router.post("/api/websites/:websiteId/variation-banks/write", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = String(req.body?.service || "").trim();
    if (!service) return res.status(400).json({ message: "service is required" });
    const { accountId, ctx } = await getContext(req.params.websiteId);
    await writeVariationsForService(service, accountId, req.params.websiteId, ctx);
    return res.json({ ok: true, service, context: { brand: ctx.brandName, industry: ctx.industryName } });
  } catch (error: any) {
    if (error?.status === 404) return res.status(404).json({ message: error.message });
    next(error);
  }
});

router.post("/api/websites/:websiteId/variation-banks/write-all", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { accountId, ctx } = await getContext(req.params.websiteId);
    const allServices = await getServices(accountId, req.body);
    const banked = new Set(await getBankedServices(req.params.websiteId));
    const todo = req.body?.force ? allServices : allServices.filter((service) => !banked.has(service));
    if (!todo.length) return res.json({ alreadyDone: true, total: 0 });
    const jobId = startWriteJob(req.params.websiteId, accountId, ctx, todo);
    return res.json({ started: true, jobId, total: todo.length });
  } catch (error: any) {
    if (error?.status === 404) return res.status(404).json({ message: error.message });
    next(error);
  }
});

export default router;
