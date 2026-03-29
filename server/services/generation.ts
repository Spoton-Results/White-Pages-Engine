import { generateFirstPass, reviewAndRewrite, type PageContext } from "./claude";
import { savePageArtifact, saveLog, isR2Configured } from "./r2";
import * as db from "../storage";
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

function buildPageContext(
  blueprint: Blueprint,
  website: Website,
  brand: BrandProfile | undefined,
  location?: Location,
  service?: Service,
  industry?: Industry,
): PageContext {
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
    brandDescription: brand?.description || undefined,
    brandPhone: brand?.phone || undefined,
    brandTagline: brand?.tagline || undefined,
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

    // Build task combinations
    const combinations: Array<{
      location?: Location;
      service?: Service;
      industry?: Industry;
    }> = [];

    if (locationsToProcess.length > 0 && servicesToProcess.length > 0) {
      for (const loc of locationsToProcess) {
        for (const svc of servicesToProcess) {
          combinations.push({ location: loc, service: svc });
        }
      }
    } else if (locationsToProcess.length > 0 && industriesToProcess.length > 0) {
      for (const loc of locationsToProcess) {
        for (const ind of industriesToProcess) {
          combinations.push({ location: loc, industry: ind });
        }
      }
    } else if (locationsToProcess.length > 0) {
      for (const loc of locationsToProcess) {
        combinations.push({ location: loc });
      }
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

    for (const combo of combinations) {
      try {
        const ctx = buildPageContext(blueprint, website, brand, combo.location, combo.service, combo.industry);

        log(`Generating: ${ctx.locationName || ""} x ${ctx.serviceName || ctx.industryName || "hub"}`);

        // First pass generation
        const generated = await generateFirstPass(ctx);

        // Rule-based QA
        const qaResult = runRuleQA(generated, blueprint);

        let finalHtml = generated.contentHtml;
        let reviewNotes = "";
        let finalScore = generated.publishScore;

        // Second pass review if first pass passed rules
        if (qaResult.passed) {
          try {
            const review = await reviewAndRewrite(generated.contentHtml, ctx);
            reviewNotes = review.notes;
            if (!review.passed && review.rewrittenHtml) {
              finalHtml = review.rewrittenHtml;
              finalScore = review.score;
              log(`Second pass rewrite applied for ${generated.slug}`);
            }
          } catch (reviewErr: any) {
            log(`Review pass failed (non-fatal): ${reviewErr.message}`);
          }
        }

        // Slug uniqueness check
        const existingPage = await db.getPageBySlug(task.websiteId, generated.slug);
        const finalSlug = existingPage ? `${generated.slug}-${Date.now()}` : generated.slug;

        // Auto-publish if QA passes, otherwise draft for manual review
        const pageStatus = qaResult.passed ? "published" : "draft";
        const publishedAt = qaResult.passed ? new Date() : undefined;

        // Create page record
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

        // Create page version
        const version = await db.createPageVersion({
          pageId: page.id,
          version: 1,
          contentHtml: finalHtml,
          promptTokens: generated.promptTokens,
          completionTokens: generated.completionTokens,
          reviewNotes,
          isActive: true,
        });

        // Save to R2 if configured
        if (isR2Configured()) {
          try {
            await savePageArtifact(task.websiteId, page.id, finalHtml);
          } catch (r2Err: any) {
            log(`R2 save failed (non-fatal): ${r2Err.message}`);
          }
        }

        passed++;
        processed++;
        await db.updateGenerationJob(job.id, {
          processedPages: processed,
          passedPages: passed,
          failedPages: failed,
        });

        log(`✓ Page created: ${finalSlug} (score: ${finalScore}, qa: ${qaResult.passed})`);

        // Delay between requests to stay within rate limits
        await new Promise((r) => setTimeout(r, 1200));
      } catch (err: any) {
        failed++;
        processed++;
        const errDetails = {
          location: combo.location?.name,
          service: combo.service?.name,
          error: err.message,
        };
        errors.push(errDetails);
        log(`✗ Failed [${combo.location?.name || ""}×${combo.service?.name || ""}]: ${err.message}`);

        await db.updateGenerationJob(job.id, {
          processedPages: processed,
          passedPages: passed,
          failedPages: failed,
          errorLog: errors,
        });
      }
    }

    log(`Job completed: ${passed} passed, ${failed} failed out of ${total} total`);

    // Sync published page count on the website record
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

    // Save log to R2 if configured
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
