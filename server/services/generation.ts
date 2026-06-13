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

type BankSnippet = { section: string; snippet: string };

type DeterministicPage = {
  title: string;
  metaDescription: string;
  h1: string;
  slug: string;
  contentHtml: string;
  wordCount: number;
  publishScore: number;
  localSignalScore: number;
  promptTokens: number;
  completionTokens: number;
  generationMode: "deterministic_bank_assembly";
};

type AssemblyContext = {
  blueprint: Blueprint;
  website: Website;
  brand?: BrandProfile;
  location?: Location;
  service?: Service;
  industry?: Industry;
  bankSnippets?: BankSnippet[];
};

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

function escapeHtml(value: string | undefined | null): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripHtml(html: string): string {
  return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function countWordsInHtml(html: string): number {
  const text = stripHtml(html);
  return text ? text.split(" ").filter(Boolean).length : 0;
}

function locationLabel(location?: Location): string {
  if (!location) return "the service area";
  const stateName = location.stateName || location.stateCode || "";
  const type = String((location as any).type || "").toLowerCase();
  if (type === "state") return location.name;
  if (stateName && location.name.toLowerCase() !== stateName.toLowerCase()) {
    return `${location.name}, ${stateName}`;
  }
  return location.name;
}

function replaceTemplateVars(value: string | undefined | null, ctx: AssemblyContext): string {
  const brandName = ctx.brand?.name || ctx.website.name || "this business";
  const serviceName = ctx.service?.name || ctx.industry?.name || "business services";
  const industryName = ctx.industry?.name || ctx.website.primaryIndustry || serviceName;
  const locName = ctx.location?.name || "";
  const stateName = ctx.location?.stateName || ctx.location?.stateCode || "";
  const stateAbbr = ctx.location?.stateCode || stateName;
  const population = typeof ctx.location?.population === "number" ? ctx.location.population : undefined;
  const businessCount = population ? Math.max(25, Math.round(population / 80)).toLocaleString() : "local";
  const culture = stateName ? `${stateName} business environment` : "local business environment";

  // ✅ CHANGED: derive comparison variables for comparison blueprints.
  // 🔒 UNTOUCHED: existing service/location/state/brand replacements.
  const blueprintName = String(ctx.blueprint?.name || "");
  const comparisonMatch = blueprintName.match(/^(.+?)\s+vs\s+(.+?)(?:\s+Comparison|\s+—|$)/i);
  const comparisonX = comparisonMatch?.[1]?.trim() || brandName;
  const comparisonY = comparisonMatch?.[2]?.trim() || serviceName;
  const audience = industryName && industryName !== serviceName ? industryName : "local businesses";

  return String(value || "")
    .replace(/\{comparison[-_]x\}/gi, comparisonX)
    .replace(/\{comparison[-_]y\}/gi, comparisonY)
    .replace(/\{audience\}/gi, audience)
    .replace(/\{location\}/g, locName)
    .replace(/\{state\}/g, stateName)
    .replace(/\{service\}/g, serviceName)
    .replace(/\{industry\}/g, industryName)
    .replace(/\{brand\}/g, brandName)
    .replace(/\{keyword\}/g, ctx.service?.keywords?.[0] || serviceName)
    .replace(/{{\s*service\s*}}/g, serviceName)
    .replace(/{{\s*city\s*}}/g, locName)
    .replace(/{{\s*state\s*}}/g, stateName)
    .replace(/{{\s*state_abbr\s*}}/g, stateAbbr)
    .replace(/{{\s*brand\s*}}/g, brandName)
    .replace(/{{\s*landmark\s*}}/g, locName || stateName || "the local market")
    .replace(/{{\s*business_culture\s*}}/g, culture)
    .replace(/{{\s*business_count\s*}}/g, businessCount)
    .replace(/{{\s*payment_regulations\s*}}/g, stateName ? `${stateName} payment and business requirements` : "applicable payment and business requirements")
    .replace(/\s+/g, " ")
    .trim();
}

function renderSnippet(snippet: BankSnippet, ctx: AssemblyContext): string {
  return replaceTemplateVars(snippet.snippet, ctx)
    .replace(/{{\s*[\w.-]+\s*}}/g, "")
    .trim();
}

function sectionTitle(section: string): string {
  const clean = section.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function defaultTitle(ctx: AssemblyContext): string {
  const service = ctx.service?.name || ctx.industry?.name || "Business Services";
  const loc = locationLabel(ctx.location);
  return `${service} in ${loc}`;
}

function defaultMeta(ctx: AssemblyContext): string {
  const brand = ctx.brand?.name || ctx.website.name;
  const service = ctx.service?.name || ctx.industry?.name || "business services";
  const loc = locationLabel(ctx.location);
  return `${brand} helps businesses in ${loc} compare ${service}, understand setup options, and choose a practical next step.`;
}

function buildDeterministicPage(ctx: AssemblyContext): DeterministicPage {
  const brandName = ctx.brand?.name || ctx.website.name || "this business";
  const serviceName = ctx.service?.name || ctx.industry?.name || "business services";
  const loc = locationLabel(ctx.location);
  const serviceDescription = ctx.service?.description || ctx.brand?.description || `${serviceName} support for businesses that need a practical, reliable setup.`;
  const title = replaceTemplateVars(ctx.blueprint.titleTemplate, ctx) || defaultTitle(ctx);
  const h1 = replaceTemplateVars(ctx.blueprint.h1Template, ctx) || title;
  const metaDescription = replaceTemplateVars(ctx.blueprint.metaDescTemplate, ctx) || defaultMeta(ctx);
  const slugSource = replaceTemplateVars(ctx.blueprint.slugTemplate, ctx) || `${serviceName}-${ctx.location?.slug || ctx.location?.name || ctx.location?.stateCode || "service-area"}`;
  const slug = sanitizePageSlug(slugSource);

  // ✅ CHANGED: read brand/CTA/demoBanner overrides from website.settings and brand profile
  const settings = (ctx.website as any).settings || {};
  const websiteUrl = settings.websiteUrl || ctx.brand?.website || `https://${ctx.website.domain}`;
  const phoneNumber = settings.phoneOverride || ctx.brand?.phone || "";
  const ctaHeading = settings.ctaHeading || "Ready to Get Started?";
  const ctaBody = settings.ctaBody || `Businesses comparing ${escapeHtml(serviceName)} in ${escapeHtml(loc)} can use this page as a starting point, then request a more specific review based on their current setup, goals, software stack, and customer flow.`;
  const ctaButtonLabel = settings.ctaButtonLabel || "Get a Free Quote";
  const demoBannerUrl = settings.demoBannerUrl || "";
  const demoBannerHeading = settings.demoBannerHeading || "";
  const demoBannerSubtext = settings.demoBannerSubtext || "";
  const demoBannerButton = settings.demoBannerButton || "Learn More";

  // ✅ CHANGED: demo banner block — renders only when demoBannerUrl is set (empty string = hidden)
  const demoBannerHtml = demoBannerUrl
    ? `<div class="nexus-demo-banner" role="banner">
    <div class="nexus-demo-banner__inner">
      ${demoBannerHeading ? `<p class="nexus-demo-banner__heading">${escapeHtml(demoBannerHeading)}</p>` : ""}
      ${demoBannerSubtext ? `<span class="nexus-demo-banner__subtext">${escapeHtml(demoBannerSubtext)}</span>` : ""}
      <a class="nexus-demo-banner__btn" href="${escapeHtml(demoBannerUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(demoBannerButton)}</a>
    </div>
  </div>`
    : "";
  // 🔒 UNTOUCHED: all snippet, processHtml, scoring logic below is unchanged

  const renderedSnippets = (ctx.bankSnippets || [])
    .map(snippet => ({ ...snippet, html: renderSnippet(snippet, ctx) }))
    .filter(snippet => stripHtml(snippet.html).length > 40);

  const snippetSections = renderedSnippets.map(snippet => `
  <section class="nexus-section nexus-section--${sanitizePageSlug(snippet.section)}">
    <h2>${escapeHtml(sectionTitle(snippet.section))}</h2>
    ${snippet.html}
  </section>`).join("\n");

  const hasBankContent = renderedSnippets.length >= 4;
  const keywordList = Array.isArray(ctx.service?.keywords) && ctx.service!.keywords.length
    ? ctx.service!.keywords.slice(0, 5)
    : [serviceName];

  const processSteps = Array.isArray((ctx.service?.metadata as any)?.processSteps)
    ? ((ctx.service?.metadata as any).processSteps as string[]).filter(Boolean)
    : [];
  const processHtml = processSteps.length
    ? `<ul>${processSteps.map(step => `<li>${escapeHtml(step)}</li>`).join("")}</ul>`
    : `<ul>
        <li>Review the current business setup and goals.</li>
        <li>Identify service requirements, constraints, and support needs.</li>
        <li>Compare practical options before making changes.</li>
        <li>Confirm the next step, timeline, and owner responsibilities.</li>
      </ul>`;

  const contentHtml = `
${demoBannerHtml}
<article class="nexus-page nexus-page--deterministic" data-generation-mode="deterministic_bank_assembly">
  <header class="nexus-hero">
    <h1>${escapeHtml(h1)}</h1>
    <p>${escapeHtml(serviceDescription)}</p>
    ${phoneNumber ? `<p class="nexus-hero__phone"><a href="tel:${escapeHtml(phoneNumber)}">${escapeHtml(phoneNumber)}</a></p>` : ""}
  </header>

  <section class="nexus-section nexus-section--overview">
    <h2>What ${escapeHtml(serviceName)} means in ${escapeHtml(loc)}</h2>
    <p>${escapeHtml(brandName)} helps businesses evaluate ${escapeHtml(serviceName)} with a focus on fit, implementation, reporting, and long-term usability. The right solution should support how the business already operates instead of forcing owners and staff into unnecessary workarounds.</p>
    <p>For businesses in ${escapeHtml(loc)}, the decision usually depends on service scope, customer expectations, software requirements, support needs, and the amount of operational friction the current setup creates. This page is designed to give search visitors a useful local overview before they request a more specific review.</p>
  </section>

  ${snippetSections}

  <section class="nexus-section nexus-section--process">
    <h2>How the process usually works</h2>
    <p>A strong ${escapeHtml(serviceName)} rollout should be clear before anything changes. The business should know what information is required, what the expected timeline looks like, what decisions need to be made, and how support will work after launch.</p>
    ${processHtml}
  </section>

  <section class="nexus-section nexus-section--local-fit">
    <h2>Local fit and service considerations</h2>
    <p>Businesses in ${escapeHtml(loc)} may have different needs based on size, customer mix, transaction flow, seasonal demand, staffing, and growth plans. A setup that works for one company may be too limited, too complex, or too expensive for another.</p>
    <p>Important keywords and related search terms for this service include ${escapeHtml(keywordList.join(", "))}. These terms are included naturally so the page can match real search intent without turning into keyword-stuffed copy.</p>
  </section>

  <section class="nexus-section nexus-section--faq">
    <h2>Common questions about ${escapeHtml(serviceName)} in ${escapeHtml(loc)}</h2>
    <h3>How do I know if this service is the right fit?</h3>
    <p>The best fit depends on the business model, current tools, customer flow, budget, and support expectations. A short review usually identifies whether the business needs a simple setup, a more advanced workflow, or a replacement for an existing provider.</p>
    <h3>What should a business review before moving forward?</h3>
    <p>Owners should review cost structure, setup timeline, reporting access, contract terms, support responsibilities, and any integrations required to keep daily operations running smoothly.</p>
    <h3>Can this support future growth?</h3>
    <p>That depends on whether the setup can handle additional locations, higher volume, new users, more reporting requirements, and changes in how customers interact with the business.</p>
  </section>

  <section class="nexus-section nexus-section--cta">
    <h2>${escapeHtml(ctaHeading)}</h2>
    <p>${ctaBody}</p>
    <a class="nexus-cta__btn" href="${escapeHtml(websiteUrl)}">${escapeHtml(ctaButtonLabel)}</a>
  </section>
</article>`;

  const wordCount = countWordsInHtml(contentHtml);
  const bankCoverageScore = Math.min(1, renderedSnippets.length / 8);
  const publishScore = hasBankContent ? Math.min(0.92, 0.68 + bankCoverageScore * 0.22) : 0.55;
  const localSignalScore = ctx.location ? Math.min(0.9, 0.62 + (ctx.location.population ? 0.08 : 0) + (hasBankContent ? 0.08 : 0)) : 0.45;

  return {
    title,
    metaDescription,
    h1,
    slug,
    contentHtml,
    wordCount,
    publishScore,
    localSignalScore,
    promptTokens: 0,
    completionTokens: 0,
    generationMode: "deterministic_bank_assembly",
  };
}

function runRuleQA(
  generated: DeterministicPage,
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
    report: {
      issues,
      checked: new Date().toISOString(),
      generationMode: generated.generationMode,
      aiCallsUsed: 0,
    },
  };
}

async function pickBankSnippets(websiteId: string, serviceName?: string): Promise<BankSnippet[] | undefined> {
  if (!serviceName) return undefined;
  const banks = await db.getVariationBanks(websiteId, serviceName);
  if (!banks.length) return undefined;

  const preferredOrder = [
    "intro",
    "local_context",
    "pain_point",
    "how_it_works",
    "benefits",
    "use_case",
    "proof_trust",
    "local_stat",
    "faq",
    "cta",
  ];

  const bySection = new Map<string, any>();
  for (const bank of banks) bySection.set(bank.sectionName, bank);

  return preferredOrder
    .map(section => bySection.get(section))
    .filter(Boolean)
    .filter(bank => Array.isArray(bank.variations) && (bank.variations as string[]).length > 0)
    .map(bank => {
      const vars = bank.variations as string[];
      const snippet = vars[Math.floor(Math.random() * vars.length)];
      return { section: bank.sectionName, snippet };
    });
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
    log(`Starting deterministic generation job: ${job.id}`);
    log("Bulk generation mode: deterministic_bank_assembly; AI calls disabled for page generation");

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

    log(`Processing ${total} page combinations with 0 page-level AI calls`);

    let processed = 0;
    let passed = 0;
    let failed = 0;
    const errors: any[] = [];

    const processCombo = async (combo: typeof combinations[number]): Promise<void> => {
      try {
        const bankSnippets = await pickBankSnippets(task.websiteId, combo.service?.name);
        const generated = buildDeterministicPage({
          blueprint,
          website,
          brand,
          location: combo.location,
          service: combo.service,
          industry: combo.industry,
          bankSnippets,
        });

        log(`Assembled: ${combo.location?.name || ""} x ${combo.service?.name || combo.industry?.name || "hub"}`);

        const qaResult = runRuleQA(generated, blueprint);
        const finalHtml = generated.contentHtml;
        const reviewNotes = "Generated by deterministic bank assembly; page-level AI calls disabled.";
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
          promptTokens: 0,
          completionTokens: 0,
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
        log(`✓ Page created: ${finalSlug} (score: ${finalScore}, qa: ${qaResult.passed}, aiCalls: 0)`);
      } catch (err: any) {
        failed++;
        processed++;
        errors.push({ location: combo.location?.name, service: combo.service?.name, error: err.message });
        log(`✗ Failed [${combo.location?.name || ""}×${combo.service?.name || ""}]: ${err.message}`);
      }
    };

    const BATCH_SIZE = 10;
    for (let i = 0; i < combinations.length; i += BATCH_SIZE) {
      const batch = combinations.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(processCombo));

      await db.updateGenerationJob(job.id, {
        processedPages: processed,
        passedPages: passed,
        failedPages: failed,
        errorLog: errors,
      });

      if (i + BATCH_SIZE < combinations.length) await new Promise((r) => setTimeout(r, 250));
    }

    log(`Job completed: ${passed} passed, ${failed} failed out of ${total} total. Page-level AI calls used: 0`);

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
