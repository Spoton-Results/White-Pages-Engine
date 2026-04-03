/**
 * bulk-background.ts
 * Runs a bulk-generation job entirely server-side so the browser can be closed.
 * Progress is written to the generationJobs.settings JSONB field and polled by the UI.
 *
 * Performance design:
 *   - State data loaded ONCE into a Map at job start (not per-page)
 *   - All existing page slugs loaded ONCE per service into a Set (not per-page lookup)
 *   - DB job progress updated every PAGE_BATCH_SIZE pages, not every page
 */
import * as storage from "../storage";
import { buildVariationPage, ClusterContext } from "./variation-engine";

const INSERT_BATCH_SIZE = 100; // pages per bulk INSERT statement
const PAGE_BATCH_SIZE = 200;  // flush job counters to DB every N pages

export interface BulkJobSettings {
  services: string[];
  blueprintId?: string;
  mode: "all_states" | "specific_states" | "specific_cities";
  states?: string[];
  cities?: Array<{ name: string; stateAbbr: string }>;
  overwrite?: boolean;
  progress: Array<{
    service: string;
    status: "pending" | "running" | "done" | "error" | "no-bank";
    created: number;
    updated: number;
    skipped: number;
    errors: number;
  }>;
}

function applyBlueprintTemplates(
  blueprint: { titleTemplate: string; h1Template: string; metaDescTemplate: string; slugTemplate: string } | null,
  vars: { service: string; location: string; state: string; stateAbbr: string; brand: string },
) {
  if (!blueprint) return null;
  const interp = (t: string) =>
    t.replace(/\{service[^}]*\}/gi, vars.service)
      .replace(/\{location[^}]*\}/gi, vars.location)
      .replace(/\{city[^}]*\}/gi, vars.location)
      .replace(/\{state[^}]*\}/gi, vars.state)
      .replace(/\{brand[^}]*\}/gi, vars.brand)
      .replace(/\{keyword[^}]*\}/gi, vars.service)
      .replace(/\{state_abbr[^}]*\}/gi, vars.stateAbbr)
      .replace(/\{abbr[^}]*\}/gi, vars.stateAbbr)
      .replace(/-{2,}/g, "-").trim();
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    title: interp(blueprint.titleTemplate),
    h1: interp(blueprint.h1Template),
    metaDescription: interp(blueprint.metaDescTemplate),
    slug: slugify(interp(blueprint.slugTemplate)),
  };
}

async function buildTargets(
  mode: BulkJobSettings["mode"],
  stateDataMap: Map<string, any>,
  states?: string[],
  cities?: Array<{ name: string; stateAbbr: string }>,
): Promise<Array<{ locationName: string; locationType: string; stateAbbr: string; stateName: string }>> {
  const allStateAbbrs = [
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA",
    "ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK",
    "OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  ];
  const targets: Array<{ locationName: string; locationType: string; stateAbbr: string; stateName: string }> = [];

  if (mode === "all_states") {
    for (const abbr of allStateAbbrs) {
      const sd = stateDataMap.get(abbr);
      if (sd) targets.push({ locationName: sd.stateName, locationType: "state", stateAbbr: abbr, stateName: sd.stateName });
    }
  } else if (mode === "specific_states" && states) {
    for (const abbr of states) {
      const sd = stateDataMap.get(abbr.toUpperCase());
      if (sd) targets.push({ locationName: sd.stateName, locationType: "state", stateAbbr: abbr, stateName: sd.stateName });
    }
  } else if (mode === "specific_cities" && cities) {
    for (const c of cities) {
      const sd = stateDataMap.get(c.stateAbbr.toUpperCase());
      targets.push({ locationName: c.name, locationType: "city", stateAbbr: c.stateAbbr, stateName: sd?.stateName ?? c.stateAbbr });
    }
  }

  return targets;
}

export async function runBulkBackgroundJob(jobId: string): Promise<void> {
  const job = await storage.getGenerationJob(jobId);
  if (!job) return;

  const settings = job.settings as unknown as BulkJobSettings;
  const { services, blueprintId, mode, states, cities, overwrite } = settings;

  await storage.updateGenerationJob(jobId, { status: "running", startedAt: new Date() });

  const website = await storage.getWebsite(job.websiteId);
  if (!website) {
    await storage.updateGenerationJob(jobId, { status: "error", completedAt: new Date() });
    return;
  }

  const brand = await storage.getBrandProfile(website.brandProfileId as string);
  const brandName = brand?.name ?? website.domain;

  const effectiveBlueprintId = blueprintId || (website.settings as any)?.defaultBlueprintId || null;
  const blueprint = effectiveBlueprintId ? await storage.getBlueprint(effectiveBlueprintId) : null;

  // ── Pre-load clusters once — keyed by service name (lowercase) ────────────────
  const [accountServices, accountClusters] = await Promise.all([
    storage.getServices(website.accountId!),
    storage.getQueryClusters(website.accountId!),
  ]);
  // serviceId → cluster
  const clusterByServiceId = new Map<string, ClusterContext>(
    accountClusters
      .filter((c: any) => c.serviceId)
      .map((c: any) => [c.serviceId, { id: c.id, primaryKeyword: c.primaryKeyword, secondaryKeywords: c.secondaryKeywords ?? [], intentType: c.intentType }])
  );
  // service name (lowercase) → serviceId
  const serviceIdByName = new Map<string, string>(
    accountServices.map((s: any) => [s.name.toLowerCase(), s.id])
  );

  // ── Pre-load all state data once ─────────────────────────────────────────────
  const stateDataMap = await storage.getAllStateData();
  const targets = await buildTargets(mode, stateDataMap, states, cities);

  // ── Build city-by-state index for internal linking on state hub pages ─────────
  // Maps stateAbbr (uppercase) → list of city names being generated in this job
  const citiesByState = new Map<string, string[]>();
  for (const t of targets) {
    if (t.locationType === "city") {
      const list = citiesByState.get(t.stateAbbr.toUpperCase()) ?? [];
      list.push(t.locationName);
      citiesByState.set(t.stateAbbr.toUpperCase(), list);
    }
  }

  let totalCreated = 0, totalUpdated = 0, totalFailed = 0, totalSkipped = 0;

  // Carry forward counters from any previous interrupted run so a server restart
  // does not reset "passed" back to 0 on the next flush.
  const basePassedPages = job.passedPages ?? 0;
  const baseProcessedPages = job.processedPages ?? 0;

  const totalPages = services.length * targets.length;
  await storage.updateGenerationJob(jobId, { totalPages });

  const blueprintTemplate = blueprint ? {
    titleTemplate: blueprint.titleTemplate,
    h1Template: blueprint.h1Template,
    metaDescTemplate: blueprint.metaDescTemplate,
    slugTemplate: blueprint.slugTemplate,
  } : null;

  // ── Load slug set ONCE for the entire job (not once per service) ─────────────
  const existingSlugSet = await storage.getPageSlugSet(job.websiteId);

  // ── Process each service sequentially ────────────────────────────────────────
  for (let si = 0; si < services.length; si++) {
    // Check for cancellation before starting each service so Cancel actually stops the job.
    // Without this check the worker runs through all services even after the user cancels.
    const liveJob = await storage.getGenerationJob(jobId);
    if (!liveJob || liveJob.status === "cancelled") {
      console.log(`[bulk-background] Job ${jobId} was cancelled — stopping at service ${si}/${services.length}`);
      await storage.syncWebsitePublishedCount(job.websiteId);
      return;
    }

    const svc = services[si];

    // Resolve cluster: 1) by serviceId link, 2) keyword fallback for unlinked clusters
    const svcId = serviceIdByName.get(svc.toLowerCase());
    let svcCluster = svcId ? (clusterByServiceId.get(svcId) ?? null) : null;
    if (!svcCluster) {
      const svcLower = svc.toLowerCase();
      const svcWords = svcLower.split(/\s+/).filter(w => w.length > 3);
      const fallback = accountClusters.find((c: any) =>
        !c.serviceId && (
          c.primaryKeyword?.toLowerCase().includes(svcLower) ||
          c.name?.toLowerCase().includes(svcLower) ||
          svcWords.some((w: string) => c.primaryKeyword?.toLowerCase().includes(w) || c.name?.toLowerCase().includes(w))
        )
      );
      if (fallback) svcCluster = { id: fallback.id, primaryKeyword: fallback.primaryKeyword, secondaryKeywords: fallback.secondaryKeywords ?? [], intentType: fallback.intentType };
    }

    const banks = await storage.getVariationBanks(job.websiteId, svc);
    if (banks.length === 0) {
      settings.progress[si] = { service: svc, status: "no-bank", created: 0, updated: 0, skipped: 0, errors: 0 };
      await storage.updateGenerationJob(jobId, { settings: settings as any });
      continue;
    }

    settings.progress[si] = { service: svc, status: "running", created: 0, updated: 0, skipped: 0, errors: 0 };
    await storage.updateGenerationJob(jobId, { settings: settings as any });

    const serviceSlug = svc.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    let svcCreated = 0, svcUpdated = 0, svcSkipped = 0, svcErrors = 0;

    // Pending batch for bulk inserts (new pages only)
    const pendingPageData: Parameters<typeof storage.createPage>[0][] = [];
    const pendingContent: string[] = [];

    let pagesSinceLastFlush = 0;

    const flushInsertBatch = async () => {
      if (pendingPageData.length === 0) return;
      // Snapshot and clear the batch BEFORE the insert so a failure never
      // leaves stale data that causes infinite retry loops.
      const batchData = pendingPageData.splice(0);
      const batchContent = pendingContent.splice(0);
      const slugToContent = new Map<string, string>();
      batchData.forEach((d, i) => slugToContent.set(d.slug, batchContent[i]));
      const created = await storage.createPagesBatch(batchData); // onConflictDoNothing
      if (created.length > 0) {
        await storage.createPageVersionsBatch(
          created.map(p => ({ pageId: p.id, version: 1, contentHtml: slugToContent.get(p.slug) ?? "", isActive: true }))
        );
        svcCreated += created.length;
        totalCreated += created.length;
      }
    };

    for (const t of targets) {
      try {
        const sd = stateDataMap.get(t.stateAbbr.toUpperCase());
        const citiesInState = t.locationType === "state"
          ? (citiesByState.get(t.stateAbbr.toUpperCase()) ?? []).map(name => ({ name }))
          : undefined;
        const result = buildVariationPage(svc, serviceSlug, t.locationName, t.locationType, t.stateName, t.stateAbbr, brandName, banks, sd, svcCluster, citiesInState);

        const bpOverride = applyBlueprintTemplates(blueprintTemplate, {
          service: svc,
          location: t.locationName,
          state: t.stateName,
          stateAbbr: t.stateAbbr,
          brand: brandName,
        });

        const finalSlug = bpOverride?.slug || result.slug;
        const finalTitle = bpOverride?.title || result.title;
        const finalH1 = bpOverride?.h1 || result.h1;
        const finalMeta = bpOverride?.metaDescription || result.metaDescription;

        if (existingSlugSet.has(finalSlug)) {
          if (!overwrite) {
            svcSkipped++;
            totalSkipped++;
          } else {
            // Flush pending batch before overwrite ops (need consistent state)
            await flushInsertBatch();
            const existingPage = await storage.getPageBySlug(job.websiteId, finalSlug);
            if (existingPage) {
              await storage.updatePage(existingPage.id, {
                title: finalTitle, h1: finalH1, metaDescription: finalMeta,
                wordCount: result.wordCount, blueprintId: effectiveBlueprintId || null,
              });
              const existingVersions = await storage.getPageVersions(existingPage.id);
              const nextVersion = (existingVersions.length > 0 ? Math.max(...existingVersions.map((v: any) => v.version)) : 0) + 1;
              const pv = await storage.createPageVersion({ pageId: existingPage.id, version: nextVersion, contentHtml: result.contentHtml, isActive: true });
              await storage.setActivePageVersion(existingPage.id, pv.id);
            }
            svcUpdated++;
            totalUpdated++;
          }
        } else {
          // Mark slug used immediately so within-batch duplicates are caught
          existingSlugSet.add(finalSlug);
          pendingPageData.push({
            websiteId: job.websiteId, blueprintId: effectiveBlueprintId || null,
            serviceId: svcId || null, locationId: null, queryClusterId: svcCluster?.id || null,
            slug: finalSlug, title: finalTitle, h1: finalH1, metaDescription: finalMeta,
            status: "published", pageType: t.locationType === "state" ? "state_hub" : "service_city",
            wordCount: result.wordCount,
          });
          pendingContent.push(result.contentHtml);

          if (pendingPageData.length >= INSERT_BATCH_SIZE) {
            await flushInsertBatch();
          }
        }
      } catch (err) {
        svcErrors++;
        totalFailed++;
        console.error("[bulk-background] error", svc, t.locationName, err);
      }

      // Flush progress counters to DB every PAGE_BATCH_SIZE pages.
      // Always flush the insert batch first so totalCreated is accurate
      // even when most pages are skips (batch may not have reached INSERT_BATCH_SIZE yet).
      pagesSinceLastFlush++;
      if (pagesSinceLastFlush >= PAGE_BATCH_SIZE) {
        pagesSinceLastFlush = 0;
        await flushInsertBatch();
        // Check cancellation every PAGE_BATCH_SIZE pages — reuses the same DB
        // round-trip window so we don't add extra overhead per page.
        const liveJob = await storage.getGenerationJob(jobId);
        if (!liveJob || liveJob.status === "cancelled") {
          console.log(`[bulk-background] Job ${jobId} cancelled mid-service — stopping`);
          await storage.syncWebsitePublishedCount(job.websiteId);
          return;
        }
        await storage.updateGenerationJob(jobId, {
          processedPages: baseProcessedPages + totalCreated + totalUpdated + totalFailed + totalSkipped,
          passedPages: basePassedPages + totalCreated + totalUpdated,
          failedPages: totalFailed,
        });
      }
    }

    // Flush remaining pages in batch before marking service done
    await flushInsertBatch();

    settings.progress[si] = { service: svc, status: "done", created: svcCreated, updated: svcUpdated, skipped: svcSkipped, errors: svcErrors };
    await storage.updateGenerationJob(jobId, {
      settings: settings as any,
      processedPages: baseProcessedPages + totalCreated + totalUpdated + totalFailed + totalSkipped,
      passedPages: basePassedPages + totalCreated + totalUpdated,
      failedPages: totalFailed,
    });
  }

  // Final sync and sitemap
  await storage.syncWebsitePublishedCount(job.websiteId);
  await storage.updateGenerationJob(jobId, {
    status: "completed",
    completedAt: new Date(),
    processedPages: baseProcessedPages + totalCreated + totalUpdated + totalFailed + totalSkipped,
    passedPages: basePassedPages + totalCreated + totalUpdated,
    failedPages: totalFailed,
  });

  try {
    const { generateSitemapsForWebsite } = await import("./sitemap");
    await generateSitemapsForWebsite(job.websiteId, website.domain);
  } catch { /* non-critical */ }

  // Ping Google to re-crawl the sitemap immediately after job completion
  try {
    const sitemapUrl = `https://${website.domain}/sitemap.xml`;
    await fetch(`https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`);
    console.log(`[bulk-background] Pinged Google sitemap for ${website.domain}`);
  } catch { /* non-critical — Google ping is best-effort */ }
}
