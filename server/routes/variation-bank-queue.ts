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

  // Legacy/account fallback: some brand profile rows are account-scoped after the account picker migration.
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

router.get("/api/websites/:websiteId/bank-write-job", requireAuth, async (req: Request, res: Response) => {
  const job = latestRunningJob(req.params.websiteId);
  if (!job) return res.json(null);
  return res.json({ jobId: job.jobId, status: job.status, total: job.total, done: job.done, errors: job.errors });
});

router.post("/api/websites/:websiteId/variation-banks/write", requireAuth, async (req: Request, res: Response) => {
  try {
    const service = String(req.body?.service ?? "").trim();
    if (!service) return res.status(400).json({ message: "service is required" });

    const { websiteId } = req.params;
    const { accountId, ctx } = await getContext(websiteId);
    const jobId = `bank-one-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const job: BankJob = { jobId, websiteId, status: "running", total: 1, done: 0, errors: [], startedAt: Date.now() };
    jobs.set(jobId, job);

    setImmediate(async () => {
      await writeOne(job, service, accountId, websiteId, ctx);
      job.status = job.errors.length ? "error" : "done";
      setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000);
    });

    return res.status(202).json({ started: true, jobId, total: 1 });
  } catch (err: any) {
    console.error("[variation-bank-queue/write]", err);
    return res.status(err.status ?? 500).json({ message: err.message ?? "Failed to queue bank write" });
  }
});

router.post("/api/websites/:websiteId/variation-banks/write-all", requireAuth, async (req: Request, res: Response) => {
  try {
    const { websiteId } = req.params;
    const force = Boolean(req.body?.force);
    const { accountId, ctx } = await getContext(websiteId);
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ message: "Website not found" });

    const services = await storage.getServices(website.accountId ?? accountId);
    const serviceNames = services.map((s: any) => String(s.name)).filter(Boolean);
    if (!serviceNames.length) return res.json({ alreadyDone: true, total: 0 });

    const banked = new Set(await storage.getVariationBankServices(websiteId).catch(() => []));
    const targetServices = force ? serviceNames : serviceNames.filter((name: string) => !banked.has(name));
    if (!targetServices.length) return res.json({ alreadyDone: true, total: 0 });

    const jobId = `bank-all-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const job: BankJob = { jobId, websiteId, status: "running", total: targetServices.length, done: 0, errors: [], startedAt: Date.now() };
    jobs.set(jobId, job);

    setImmediate(async () => {
      for (const service of targetServices) {
        await writeOne(job, service, accountId, websiteId, ctx);
      }
      job.status = job.errors.length && job.done === 0 ? "error" : "done";
      setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000);
    });

    return res.status(202).json({ started: true, jobId, total: targetServices.length });
  } catch (err: any) {
    console.error("[variation-bank-queue/write-all]", err);
    return res.status(err.status ?? 500).json({ message: err.message ?? "Failed to queue bank writes" });
  }
});

export default router;
