import { randomUUID } from "crypto";
import * as storage from "../storage";

type BuildStatusValue = "idle" | "running" | "complete" | "failed";
type OwnerStrength = "Strong" | "Medium" | "Weak";
type OwnerRisk = "Low" | "Medium" | "High";

export interface IntentBuildStatus {
  jobId: string | null;
  status: BuildStatusValue;
  progress: number;
  currentStep: string;
  completedCount: number;
  totalCount: number;
  lastRunTime: string | null;
  pagesAnalyzed: number;
  error?: string;
}

export interface TopCanonicalOwner {
  canonicalOwner: string;
  intentCluster: string;
  pagesOwned: number;
  strength: OwnerStrength;
  risk: OwnerRisk;
  recommendedAction: string;
}

export interface IntentBuildReport {
  totalPagesAnalyzed: number;
  canonicalOwnersFound: number;
  orphanIntentGroups: number;
  duplicateOverlapRisks: number;
  weakOwnerClusters: number;
  promotionCandidates: number;
  coveragePercentage: number;
  strongOwners: number;
  mediumOwners: number;
  weakOwners: number;
  missingCanonicalOwners: number;
  topCanonicalOwners: TopCanonicalOwner[];
}

interface BuildState {
  status: IntentBuildStatus;
  report: IntentBuildReport | null;
}

const buildStates = new Map<string, BuildState>();

const steps = [
  "Scanning published pages",
  "Grouping pages by search intent",
  "Finding canonical owners",
  "Checking overlap and cannibalization",
  "Scoring owner strength",
  "Preparing final recommendations",
];

const emptyReport: IntentBuildReport = {
  totalPagesAnalyzed: 0,
  canonicalOwnersFound: 0,
  orphanIntentGroups: 0,
  duplicateOverlapRisks: 0,
  weakOwnerClusters: 0,
  promotionCandidates: 0,
  coveragePercentage: 0,
  strongOwners: 0,
  mediumOwners: 0,
  weakOwners: 0,
  missingCanonicalOwners: 0,
  topCanonicalOwners: [],
};

function defaultStatus(): IntentBuildStatus {
  return {
    jobId: null,
    status: "idle",
    progress: 0,
    currentStep: "Waiting to run",
    completedCount: 0,
    totalCount: steps.length,
    lastRunTime: null,
    pagesAnalyzed: 0,
  };
}

function normalizeSlug(slug: string | null | undefined): string {
  return (slug || "")
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function inferIntentCluster(page: any): string {
  const pageType = page.pageType || page.page_type || "unknown";
  const serviceId = page.serviceId || page.service_id || "no-service";
  const locationId = page.locationId || page.location_id || "no-location";
  const queryClusterId = page.queryClusterId || page.query_cluster_id || "";

  if (queryClusterId) return `${pageType}:query:${queryClusterId}`;

  if (serviceId !== "no-service" || locationId !== "no-location") {
    return `${pageType}:service:${serviceId}:location:${locationId}`;
  }

  const slug = normalizeSlug(page.slug);

  if (slug.includes("-in-")) {
    const [servicePart, locationPart] = slug.split("-in-");
    return `${pageType}:slug:${servicePart}:location:${locationPart}`;
  }

  const parts = slug.split("-").filter(Boolean);
  if (parts.length >= 4) {
    const locationPart = parts.slice(-2).join("-");
    const servicePart = parts.slice(0, -2).join("-");
    return `${pageType}:slug:${servicePart}:location:${locationPart}`;
  }

  return `${pageType}:slug:${slug || "unknown"}`;
}

function getPageScore(page: any): number {
  const tier = Number(page.tier ?? 3);
  const qualityScore = Number(page.qualityScore ?? page.quality_score ?? 0);
  const updatedAt = new Date(page.updatedAt ?? page.updated_at ?? 0).getTime() || 0;

  const tierScore = tier === 1 ? 300 : tier === 2 ? 200 : 100;
  return tierScore + qualityScore + updatedAt / 1_000_000_000_000;
}

function getStrength(page: any, pagesOwned: number): OwnerStrength {
  const tier = Number(page.tier ?? 3);
  const qualityScore = Number(page.qualityScore ?? page.quality_score ?? 0);

  if (tier === 1 || qualityScore >= 80) return "Strong";
  if (qualityScore >= 60 || pagesOwned >= 3) return "Medium";
  return "Weak";
}

function getRisk(pagesOwned: number, strength: OwnerStrength): OwnerRisk {
  if (pagesOwned >= 4 || strength === "Weak") return "High";
  if (pagesOwned >= 2 || strength === "Medium") return "Medium";
  return "Low";
}

function getRecommendedAction(strength: OwnerStrength, risk: OwnerRisk, pagesOwned: number): string {
  if (risk === "High" && pagesOwned >= 2) {
    return "Review cannibalization and consolidate duplicate pages";
  }

  if (strength === "Strong") {
    return "Promote as canonical owner and increase internal links";
  }

  if (strength === "Medium") {
    return "Strengthen with hub links, content expansion, and clearer anchors";
  }

  return "Improve quality score or assign a stronger canonical owner";
}

function patchStatus(websiteId: string, patch: Partial<IntentBuildStatus>) {
  const current = buildStates.get(websiteId) ?? {
    status: defaultStatus(),
    report: null,
  };

  buildStates.set(websiteId, {
    ...current,
    status: {
      ...current.status,
      ...patch,
    },
  });
}

async function computeIntentReport(websiteId: string): Promise<IntentBuildReport> {
  const publishedPages = await storage.getPages(websiteId, {
    status: "published",
    limit: 5000,
    offset: 0,
  });

  const groups = new Map<string, any[]>();

  for (const page of publishedPages) {
    const cluster = inferIntentCluster(page);
    const current = groups.get(cluster) ?? [];
    current.push(page);
    groups.set(cluster, current);
  }

  const topCanonicalOwners: TopCanonicalOwner[] = [];
  let strongOwners = 0;
  let mediumOwners = 0;
  let weakOwners = 0;
  let duplicateOverlapRisks = 0;
  let promotionCandidates = 0;
  let missingCanonicalOwners = 0;

  for (const [cluster, clusterPages] of groups.entries()) {
    const sorted = [...clusterPages].sort((a, b) => getPageScore(b) - getPageScore(a));
    const owner = sorted[0];

    if (!owner) {
      missingCanonicalOwners += 1;
      continue;
    }

    const strength = getStrength(owner, clusterPages.length);
    const risk = getRisk(clusterPages.length, strength);

    if (strength === "Strong") strongOwners += 1;
    if (strength === "Medium") mediumOwners += 1;
    if (strength === "Weak") weakOwners += 1;

    if (clusterPages.length > 1) duplicateOverlapRisks += 1;

    const ownerTier = Number(owner.tier ?? 3);
    const ownerQuality = Number(owner.qualityScore ?? owner.quality_score ?? 0);

    if ((strength === "Strong" || ownerQuality >= 75) && ownerTier !== 1) {
      promotionCandidates += 1;
    }

    topCanonicalOwners.push({
      canonicalOwner: owner.slug ? `/${owner.slug}` : owner.title || owner.id || "Unknown owner",
      intentCluster: cluster,
      pagesOwned: clusterPages.length,
      strength,
      risk,
      recommendedAction: getRecommendedAction(strength, risk, clusterPages.length),
    });
  }

  const canonicalOwnersFound = topCanonicalOwners.length;
  const orphanIntentGroups = missingCanonicalOwners;
  const weakOwnerClusters = weakOwners;
  const coveragePercentage =
    canonicalOwnersFound > 0
      ? Math.round(((canonicalOwnersFound - missingCanonicalOwners) / canonicalOwnersFound) * 100)
      : 0;

  topCanonicalOwners.sort((a, b) => {
    const riskScore = { High: 3, Medium: 2, Low: 1 };
    const strengthScore = { Strong: 3, Medium: 2, Weak: 1 };

    return (
      b.pagesOwned - a.pagesOwned ||
      riskScore[b.risk] - riskScore[a.risk] ||
      strengthScore[b.strength] - strengthScore[a.strength]
    );
  });

  return {
    totalPagesAnalyzed: publishedPages.length,
    canonicalOwnersFound,
    orphanIntentGroups,
    duplicateOverlapRisks,
    weakOwnerClusters,
    promotionCandidates,
    coveragePercentage,
    strongOwners,
    mediumOwners,
    weakOwners,
    missingCanonicalOwners,
    topCanonicalOwners: topCanonicalOwners.slice(0, 25),
  };
}

export async function runIntentBuild(
  websiteId: string,
): Promise<{ jobId: string; status: BuildStatusValue }> {
  const jobId = randomUUID();

  buildStates.set(websiteId, {
    status: {
      ...defaultStatus(),
      jobId,
      status: "running",
      progress: 5,
      currentStep: steps[0],
      completedCount: 1,
      totalCount: steps.length,
      lastRunTime: null,
      pagesAnalyzed: 0,
    },
    report: null,
  });

  setImmediate(async () => {
    try {
      for (let i = 0; i < steps.length - 1; i++) {
        patchStatus(websiteId, {
          status: "running",
          currentStep: steps[i],
          completedCount: i + 1,
          progress: Math.round(((i + 1) / steps.length) * 75),
        });

        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const report = await computeIntentReport(websiteId);

      buildStates.set(websiteId, {
        status: {
          jobId,
          status: "complete",
          progress: 100,
          currentStep: steps[steps.length - 1],
          completedCount: steps.length,
          totalCount: steps.length,
          lastRunTime: new Date().toISOString(),
          pagesAnalyzed: report.totalPagesAnalyzed,
        },
        report,
      });
    } catch (err: any) {
      patchStatus(websiteId, {
        status: "failed",
        progress: 100,
        currentStep: "Build failed",
        error: err?.message || "Unknown intent build error",
      });
    }
  });

  return { jobId, status: "running" };
}

export function getIntentBuildStatus(websiteId: string): IntentBuildStatus {
  return buildStates.get(websiteId)?.status ?? defaultStatus();
}

export function getIntentBuildReport(websiteId: string): IntentBuildReport {
  return buildStates.get(websiteId)?.report ?? emptyReport;
}