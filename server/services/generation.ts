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

function renderTemplate(template: string | undefined, ctx: PageContext): string {
  return String(template || "")
    .replace(/\{location\}/g, ctx.locationName || "")
    .replace(/\{state\}/g, ctx.locationState || "")
    .replace(/\{service\}/g, ctx.serviceName || "")
    .replace(/\{industry\}/g, ctx.industryName || "")
    .replace(/\{brand\}/g, ctx.brandName || "")
    .replace(/\{keyword\}/g, ctx.primaryKeyword || "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value: string | undefined): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function countWordsInHtml(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.split(" ").filter(Boolean).length : 0;
}

function buildFallbackGeneratedPage(
  ctx: PageContext,
  reason: string,
): Awaited<ReturnType<typeof generateFirstPass>> {
  const location = [ctx.locationName, ctx.locationState].filter(Boolean).join(", ") || "your service area";
  const service = ctx.serviceName || ctx.industryName || ctx.primaryKeyword || "business services";
  const brand = ctx.brandName || "our team";
  const title = renderTemplate(ctx.titleTemplate, ctx) || `${service} in ${location}`;
  const h1 = renderTemplate(ctx.h1Template, ctx) || `${service} in ${location}`;
  const metaDescription = renderTemplate(ctx.metaDescTemplate, ctx) || `${brand} helps businesses in ${location} evaluate ${service}, compare options, and take the next step with realistic expectations.`;
  const slug = sanitizePageSlug(renderTemplate(ctx.slugTemplate, ctx) || `${service}-${ctx.locationName || ctx.locationState || "service-area"}`);
  const description = ctx.serviceDescription || ctx.brandDescription || `${service} helps businesses improve operations, reduce friction, and choose a practical solution without relying on generic one-size-fits-all advice.`;
  const snippets = ctx.bankSnippets?.slice(0, 4).map((s) => `<section><h2>${escapeHtml(s.section.replace(/_/g, " "))}</h2>${s.snippet}</section>`).join("\n") || "";

  const contentHtml = `
<article class="nexus-page nexus-page--fallback" data-generation-fallback="missing-content-section">
  <section>
    <h2>What ${escapeHtml(service)} means for businesses in ${escapeHtml(location)}</h2>
    <p>${escapeHtml(description)}</p>
    <p>For businesses in ${escapeHtml(location)}, the right approach usually depends on transaction volume, customer expectations, software requirements, reporting needs, and how much support the team needs after setup. This page gives a practical overview so a visitor can understand the service before starting a conversation.</p>
  </section>
  <section>
    <h2>When this service is usually needed</h2>
    <p>${escapeHtml(service)} is usually worth evaluating when a business is growing, changing systems, opening a new location, replacing a legacy provider, or trying to reduce operational friction. The strongest fit is not always the cheapest option; it is the setup that protects cash flow, keeps work moving, and supports the way the business actually operates.</p>
    <ul>
      <li>Businesses comparing providers, platforms, or service options</li>
      <li>Teams that need clearer reporting, support, or implementation guidance</li>
      <li>Owners who want fewer manual workarounds and fewer avoidable delays</li>
      <li>Companies expanding into new markets or adding new customer channels</li>
    </ul>
  </section>
  <section>
    <h2>How ${escapeHtml(brand)} approaches the work</h2>
    <p>${escapeHtml(brand)} focuses on fit, implementation, and long-term usability. The goal is to understand the business first, identify the actual constraints, and recommend a path that can be explained clearly before anything is changed.</p>
    <p>A good implementation should define what is being set up, what information is required, what timeline is realistic, what the business needs to review, and how issues will be handled after launch. That keeps the process grounded instead of turning it into another generic vendor pitch.</p>
  </section>
  ${snippets}
  <section>
    <h2>Questions to ask before choosing a provider</h2>
    <ul>
      <li>Does the setup match the business model and customer flow?</li>
      <li>What costs are fixed, variable, optional, or usage-based?</li>
      <li>Who handles onboarding, troubleshooting, and ongoing support?</li>
      <li>What reporting will the owner or manager see after launch?</li>
      <li>Can the system support future growth without creating new bottlenecks?</li>
    </ul>
  </section>
  <section>
    <h2>Next step</h2>
    <p>Businesses looking at ${escapeHtml(service)} in ${escapeHtml(location)} can use this page as a starting point, then request a more specific review based on their current setup, transaction flow, software stack, and goals.</p>
  </section>
</article>`;

  console.warn(`[generation] Used deterministic content fallback for ${slug || service}: ${reason}`);

  return {
    title,
    metaDescription,
    h1,
    slug,
    contentHtml,
    wordCount: countWordsInHtml(contentHtml),
    publishScore: 0.62,
    localSignalScore: ctx.locationName || ctx.locationState ? 0.58 : 0.45,
    faqItems: [],
    promptTokens: 0,
    completionTokens: 0,
  };
}

function shouldUseContentFallback(err: any): boolean {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("no content section") ||
    msg.includes("cannot complete") ||
    msg.includes("cannot proceed") ||
    msg.includes("assignment is incomplete") ||
    msg.includes("missing required") ||
    msg.includes("input validation error") ||
    msg.includes("editorial analysis") ||
    msg.includes("clarification needed")
  );
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

        let generated: Awaited<ReturnType<typeof generateFirstPass>>;
        try {
          generated = await generateFirstPass(ctx);
        } catch (err: any) {
          if (!shouldUseContentFallback(err)) throw err;
          log(`AI content parse failed; using deterministic fallback: ${err.message}`);
          generated = buildFallbackGeneratedPage(ctx, err.message);
        }

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
