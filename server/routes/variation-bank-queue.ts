import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { requireAuth } from "../auth";
import * as storage from "../storage";
import { writeVariationsForService, type BrandContext } from "../services/variation-writer";

const router = Router();

type BankJob = {
  jobId: string;
  websiteId: string;
  status: "running" | "done" | "error";
  total: number;
  done: number;
  errors: string[];
  startedAt: number;
};

const g = globalThis as any;
const jobs: Map<string, BankJob> = g.__nexusQueuedVariationBankJobs ?? new Map<string, BankJob>();
g.__nexusQueuedVariationBankJobs = jobs;

async function getContext(websiteId: string): Promise<{ website: any; accountId: string; ctx: BrandContext }> {
  const website = await storage.getWebsite(websiteId);
  if (!website) throw Object.assign(new Error("Website not found"), { status: 404 });

  const accountId = website.accountId ?? websiteId;
  let brand = await storage.getBrandProfile(websiteId).catch(() => null);

  if (!brand && accountId) {
    const profiles = await storage.getBrandProfiles(accountId).catch(() => []);
    brand = profiles?.[0] ?? null;
  }

  const industry = brand?.industryId ? await storage.getIndustry(brand.industryId).catch(() => null) : null;

  return {
    website,
    accountId,
    ctx: {
      brandName: brand?.name || website.name || website.domain,
      brandDescription: brand?.description ?? undefined,
      voiceAndTone: brand?.voiceAndTone ?? undefined,
      industryName: industry?.name ?? undefined,
      industryDescription: industry?.description ?? undefined,
    },
  };
}

async function writeOne(job: BankJob, service: string, accountId: string, websiteId: string, ctx: BrandContext) {
  try {
    await writeVariationsForService(service, accountId, websiteId, ctx);
    await storage.recomputeBankCompleteness(websiteId, service).catch(() => {});
  } catch (err: any) {
    job.errors.push(`${service}: ${err?.message ?? String(err)}`);
  } finally {
    job.done++;
  }
}

function latestRunningJob(websiteId: string): BankJob | null {
  let latest: BankJob | null = null;
  for (const job of jobs.values()) {
    if (job.websiteId === websiteId && job.status === "running") {
      if (!latest || job.startedAt > latest.startedAt) latest = job;
    }
  }
  return latest;
}

function finishJobLater(jobId: string) {
  setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000);
}

router.get("/api/websites/:websiteId/context", requireAuth, async (req: Request, res: Response) => {
  try {
    const { website, accountId } = await getContext(req.params.websiteId);
    const brand = await storage.getBrandProfile(req.params.websiteId).catch(() => null);
    return res.json({
      brand: brand ? { id: brand.id, name: brand.name, accountId, voiceAndTone: brand.voiceAndTone } : null,
      industry: null,
      website: { id: website.id, name: website.name, domain: website.domain },
    });
  } catch (err: any) {
    console.warn("[variation-bank-queue/context] soft-fail:", err?.message ?? String(err));
    return res.json({ brand: null, industry: null });
  }
});

router.get("/api/websites/:websiteId/bank-services", requireAuth, async (req: Request, res: Response) => {
  try {
    const services = await storage.getVariationBankServices(req.params.websiteId);
    return res.json(services);
  } catch (err: any) {
    console.warn("[variation-bank-queue/bank-services] soft-fail:", err?.message ?? String(err));
    return res.json([]);
  }
});

router.get("/api/websites/:websiteId/bank-write-job", requireAuth, async (req: Request, res: Response) => {
  const job = latestRunningJob(req.params.websiteId);
  if (!job) return res.json(null);
  return res.json({ jobId: job.jobId, status: job.status, total: job.total, done: job.done, errors: job.errors });
});

router.post("/api/websites/:websiteId/variation-banks/write", requireAuth, async (req: Request, res: Response) => {
  const service = String(req.body?.service ?? "").trim();
  if (!service) return res.status(400).json({ message: "service is required" });

  const { websiteId } = req.params;
  const jobId = `bank-one-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const job: BankJob = { jobId, websiteId, status: "running", total: 1, done: 0, errors: [], startedAt: Date.now() };
  jobs.set(jobId, job);

  // Return before ANY database or Claude work. This prevents Railway/browser
  // request timeouts when Postgres or Claude is slow.
  res.status(202).json({ started: true, jobId, total: 1 });

  setImmediate(async () => {
    try {
      const { accountId, ctx } = await getContext(websiteId);
      await writeOne(job, service, accountId, websiteId, ctx);
      job.status = job.errors.length ? "error" : "done";
    } catch (err: any) {
      job.errors.push(`${service}: ${err?.message ?? String(err)}`);
      job.done = Math.max(job.done, 1);
      job.status = "error";
    } finally {
      finishJobLater(jobId);
    }
  });
});

router.post("/api/websites/:websiteId/variation-banks/write-all", requireAuth, async (req: Request, res: Response) => {
  const { websiteId } = req.params;
  const force = Boolean(req.body?.force);
  const jobId = `bank-all-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const job: BankJob = { jobId, websiteId, status: "running", total: 0, done: 0, errors: [], startedAt: Date.now() };
  jobs.set(jobId, job);

  // Return before resolving services/context from DB. The background worker will
  // update total once services are loaded.
  res.status(202).json({ started: true, jobId, total: 0 });

  setImmediate(async () => {
    try {
      const { website, accountId, ctx } = await getContext(websiteId);
      const services = await storage.getServices(website.accountId ?? accountId);
      const serviceNames = services.map((s: any) => String(s.name)).filter(Boolean);

      const banked = new Set(await storage.getVariationBankServices(websiteId).catch(() => []));
      const targetServices = force ? serviceNames : serviceNames.filter((name: string) => !banked.has(name));
      job.total = targetServices.length;

      if (!targetServices.length) {
        job.status = "done";
        return;
      }

      for (const service of targetServices) {
        await writeOne(job, service, accountId, websiteId, ctx);
      }
      job.status = job.errors.length && job.done === 0 ? "error" : "done";
    } catch (err: any) {
      job.errors.push(err?.message ?? String(err));
      job.status = "error";
    } finally {
      finishJobLater(jobId);
    }
  });
});

export default router;
