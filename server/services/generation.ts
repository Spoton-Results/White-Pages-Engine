import { generateFirstPass, type PageContext } from "./claude";
import { savePageArtifact, saveLog, isR2Configured } from "./r2";
import * as db from "../storage";
import { logApiUsage } from "./usage-logger";
import type { Blueprint, Location, Service, Industry, Website, BrandProfile, GenerationJob } from "@shared/schema";

export interface GenerationTask {
  websiteId: string;
  blueprintId: string;
  locationIds?: string[];
  serviceIds?: string[];
  industryIds?: string[];
  jobName: string;
  accountId: string;
}

function sanitizePageSlug(value: string): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/--+(service-)?page-templates?-(city|state|service|industry|location|hub)$/i, "")
    .replace(/--+.*$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildPageContext(
  blueprint: Blueprint,
  website: Website,
  brand: BrandProfile | undefined,
  location?: Location,
  service?: Service,
  industry?: Industry,
  bankSnippets?: Array<{ section: string; snippet: string }>,
): PageContext {
  const cf = (brand?.customFields as any) ?? {};
  const sm = (service?.metadata as any) ?? {};
  return {
    blueprintName: blueprint.name,
    pageType: blueprint.pageType,
    titleTemplate: blueprint.titleTemplate,
    metaDescTemplate: blueprint.metaDescTemplate,
    h1Template: blueprint.h1Template,
    slugTemplate: blueprint.slugTemplate,
    sections: (blueprint.sections as any[]) || [],
    requiredWordCount: blueprint.requiredWordCount,
    promptFamily: blueprint.promptFamily,
    faqEnabled: blueprint.faqEnabled,
    locationName: location?.name,
    locationState: location?.stateName || location?.stateCode || undefined,
    locationSlug: location?.slug,
    serviceName: service?.name,
    serviceSlug: service?.slug,
    industryName: industry?.name,
    brandName: brand?.name || website.name,
    brandLegalName: cf.legalBusinessName || undefined,
    brandDescription: brand?.description || undefined,
    brandPhone: brand?.phone || undefined,
    brandTagline: brand?.tagline || undefined,
    brandVoiceAndTone: brand?.voiceAndTone || undefined,
    brandYearsInBusiness: cf.yearsInBusiness || undefined,
    brandLicenses: Array.isArray(cf.licensesCerts) && cf.licensesCerts.length ? cf.licensesCerts : undefined,
    brandReviewSummary: cf.reviewSummary || undefined,
    serviceDescription: service?.description || undefined,
    serviceProcessSteps: Array.isArray(sm.processSteps) && sm.processSteps.length ? sm.processSteps : undefined,
    serviceTimeline: sm.typicalTimeline || undefined,
    bankSnippets: bankSnippets?.length ? bankSnippets : undefined,
    primaryKeyword: service?.keywords?.[0] || service?.name,
    secondaryKeywords: service?.keywords?.slice(1) || [],
  };
}

function runRuleQA(
  generated: Awaited<ReturnType<typeof generateFirstPass>>,
  blueprint: Blueprint,
): { passed: boolean; report: any } {
  const issues: string[] = [];

  if (generated.wordCount < blueprint.requiredWordCount) {
    issues.push(`Word count ${generated.wordCount} below minimum ${blueprint.requiredWordCount}`);
  }

  if (!generated.title || generated.title.length < 10) {
    issues.push("Title too short or missing");
  }

  if (!generated.h1 || generated.h1.length < 5) {
    issues.push("H1 too short or missing");
  }

  if (!generated.metaDescription || generated.metaDescription.length < 50) {
    issues.push("Meta description too short or missing");
  }

  if (generated.publishScore < parseFloat(blueprint.minPublishScore as string)) {
    issues.push(`Publish score ${generated.publishScore} below threshold ${blueprint.minPublishScore}`);
  }

  if (generated.localSignalScore < parseFloat(blueprint.minLocalSignal as string)) {
    issues.push(`Local signal score ${generated.localSignalScore} below threshold ${blueprint.minLocalSignal}`);
  }

  return {
    passed: issues.length === 0,
    report: { issues, checked: new Date().toISOString() },
  };
}

export async function runGenerationJob(
  job: GenerationJob,
  task: GenerationTask,
): Promise<void> {
  const logs: string[] = [];
  const log = (msg: string) => {
    logs.push(`[${new Date().toISOString()}] ${msg}`);
  };

  try {
    log(`Starting generation job: ${job.id}`);

    await db.updateGenerationJob(job.id, {
      status: "running",
      startedAt: new Date(),
    });

    const blueprint = await db.getBlueprint(task.blueprintId);
    if (!blueprint) throw new Error(`Blueprint ${task.blueprintId} not found`);

    const website = await db.getWebsite(task.websiteId);
    if (!website) throw new Error(`Website ${task.websiteId} not found`);

    let brand: BrandProfile | undefined;
    if (website.brandProfileId) {
      brand = await db.getBrandProfile(website.brandProfileId);
    }

    const locationsToProcess: Location[] = [];
    if (task.locationIds && task.locationIds.length > 0) {
      for (const lid of task.locationIds) {
        const loc = await db.getLocation(lid);
        if (loc) locationsToProcess.push(loc);
      }
    }

    const servicesToProcess: Service[] = [];
    if (task.serviceIds && task.serviceIds.length > 0) {
      for (const sid of task.serviceIds) {
        const svc = await db.getService(sid);
        if (svc) servicesToProcess.push(svc);
      }
    }

    const industriesToProcess: Industry[] = [];
    if (task.industryIds && task.industryIds.length > 0) {
      for (const iid of task.industryIds) {
        const ind = await db.getIndustry(iid);
        if (ind) industriesToProcess.push(ind);
      }
    }

    const combinations: Array<{
      location?: Location;
      service?: Service;
      industry?: Industry;
    }> = [];

    if (locationsToProcess.length > 0 && servicesToProcess.length > 0) {
      for (const loc of locationsToProcess) {
        for (const svc of servicesToProcess) combinations.push({ location: loc, service: svc });
      }
    } else if (locationsToProcess.length > 0 && industriesToProcess.length > 0) {
      for (const loc of locationsToProcess) {
        for (const ind of industriesToProcess) combinations.push({ location: loc, industry: ind });
      }
    } else if (locationsToProcess.length > 0) {
      for (const loc of locationsToProcess) combinations.push({ location: loc });
    } else {
      combinations.push({});
    }

    const total = combinations.length;
    await db.updateGenerationJob(job.id, { totalPages: total });

    log(`Processing ${total} page combinations`);

    let processed = 0;
    let passed = 0;
    let failed = 0;
    const errors: any[] = [];

    const processCombo = async (combo: typeof combinations[number]): Promise<void> => {
      try {
        let bankSnippets: Array<{ section: string; snippet: string }> | undefined;
        if (combo.service) {
          try {
            const banks = await db.getVariationBanks(task.websiteId, combo.service.name);
            if (banks.length > 0) {
              bankSnippets = banks
                .filter(b => Array.isArray(b.variations) && (b.variations as string[]).length > 0)
                .map(b => {
                  const vars = b.variations as string[];
                  const snippet = vars[Math.floor(Math.random() * vars.length)];
                  return { section: b.sectionName, snippet };
                })
                .slice(0, 6);
            }
          } catch { /* bank load failure is non-fatal */ }
        }

        const ctx = buildPageContext(blueprint, website, brand, combo.location, combo.service, combo.industry, bankSnippets);
        log(`Generating: ${ctx.locationName || ""} x ${ctx.serviceName || ctx.industryName || "hub"}`);

        const generated = await generateFirstPass(ctx);

        try {
          await logApiUsage({
            accountId: task.accountId,
            websiteId: task.websiteId,
            generationType: "page_generation",
            modelUsed: "claude-haiku-4-5-20251001",
            inputTokens: generated.promptTokens,
            outputTokens: generated.completionTokens,
          });
        } catch (logErr: any) {
          console.warn("[usage-logger] page_generation log failed (non-fatal):", logErr?.message);
        }

        const qaResult = runRuleQA(generated, blueprint);
        const finalHtml = generated.contentHtml;
        const reviewNotes = "";
        const finalScore = generated.publishScore;
        const finalSlug = sanitizePageSlug(generated.slug);

        if (!finalSlug) {
          throw new Error(`Generated slug was empty after cleanup. Original slug: ${generated.slug}`);
        }

        const existingPage = await db.getPageBySlug(task.websiteId, finalSlug);
        if (existingPage) {
          console.warn(`Skipping duplicate slug: ${finalSlug}`);
          processed++;
          return;
        }

        const pageStatus = qaResult.passed ? "published" : "draft";
        const publishedAt = qaResult.passed ? new Date() : undefined;

        const page = await db.createPage({
          websiteId: task.websiteId,
          blueprintId: task.blueprintId,
          locationId: combo.location?.id,
          serviceId: combo.service?.id,
          industryId: combo.industry?.id,
          pageType: blueprint.pageType,
          slug: finalSlug,
          title: generated.title,
          metaDescription: generated.metaDescription,
          h1: generated.h1,
          canonicalUrl: `https://${website.domain}/${finalSlug}`,
          status: pageStatus,
          publishedAt,
          publishScore: String(finalScore),
          localSignalScore: String(generated.localSignalScore),
          wordCount: generated.wordCount,
          passedQa: qaResult.passed,
          qaReport: qaResult.report,
        });

        await db.createPageVersion({
          pageId: page.id,
          version: 1,
          contentHtml: finalHtml,
          promptTokens: generated.promptTokens,
          completionTokens: generated.completionTokens,
          reviewNotes,
          isActive: true,
        });

        if (isR2Configured()) {
          try {
            await savePageArtifact(task.websiteId, page.id, finalHtml);
          } catch (r2Err: any) {
            log(`R2 save failed (non-fatal): ${r2Err.message}`);
          }
        }

        passed++;
        processed++;
        log(`✓ Page created: ${finalSlug} (score: ${finalScore}, qa: ${qaResult.passed})`);
      } catch (err: any) {
        failed++;
        processed++;
        errors.push({ location: combo.location?.name, service: combo.service?.name, error: err.message });
        log(`✗ Failed [${combo.location?.name || ""}×${combo.service?.name || ""}]: ${err.message}`);
      }
    };

    const BATCH_SIZE = 5;
    for (let i = 0; i < combinations.length; i += BATCH_SIZE) {
      const batch = combinations.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(processCombo));

      await db.updateGenerationJob(job.id, {
        processedPages: processed,
        passedPages: passed,
        failedPages: failed,
        errorLog: errors,
      });

      if (i + BATCH_SIZE < combinations.length) await new Promise((r) => setTimeout(r, 1000));
    }

    log(`Job completed: ${passed} passed, ${failed} failed out of ${total} total`);

    if (passed > 0) {
      const freshWebsite = await db.getWebsite(task.websiteId);
      if (freshWebsite) {
        await db.updateWebsite(task.websiteId, {
          publishedPages: (freshWebsite.publishedPages || 0) + passed,
        } as any);
      }
    }

    await db.updateGenerationJob(job.id, {
      status: "completed",
      completedAt: new Date(),
      errorLog: errors,
    });

    if (isR2Configured()) {
      try {
        await saveLog(task.websiteId, job.id, logs.join("\n"));
      } catch {}
    }
  } catch (err: any) {
    log(`Fatal job error: ${err.message}`);
    await db.updateGenerationJob(job.id, {
      status: "failed",
      completedAt: new Date(),
      errorLog: [{ error: err.message }],
    });
  }
}
