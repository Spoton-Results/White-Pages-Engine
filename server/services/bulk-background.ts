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
import { submitUrlsToGoogle } from "./gsc-indexing";
import { scorePageContent, computeBankCompleteness } from "./scoring";
import { pool } from "../db";

const INSERT_BATCH_SIZE = 25;  // pages per bulk INSERT — keep batches small to avoid long connection holds
const PAGE_BATCH_SIZE = 300;  // flush job counters to DB every N pages
const OVERWRITE_BATCH_SIZE = 25; // overwrite updates per batch SQL
const YIELD_EVERY = 50;       // yield event loop every N pages so pending I/O (DB releases, HTTP) can run

const yieldEventLoop = () => new Promise<void>(r => setImmediate(r));

export interface BulkJobSettings {
  services: string[];
  blueprintId?: string;
  queryClusterIds?: string[];
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
  vars: { service: string; location: string; state: string; stateAbbr: string; brand: string; cluster?: string },
) {
  if (!blueprint) return null;
  const slugifyStr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const interp = (t: string) =>
    t.replace(/\{service[^}]*\}/gi, vars.service)
      .replace(/\{location[^}]*\}/gi, vars.location)
      .replace(/\{city[^}]*\}/gi, vars.location)
      // state_abbr / state-abbr must come before the generic {state…} catch-alls
      .replace(/\{state[-_]abbr[^}]*\}/gi, vars.stateAbbr)
      .replace(/\{abbr[^}]*\}/gi, vars.stateAbbr)
      // {state-slug}, {state_slug}, {state|slugify}, {state|lowercase|hyphenate} → slugified state name
      .replace(/\{state[-_]slug[^}]*\}/gi, slugifyStr(vars.state))
      .replace(/\{state\|[^}]*\}/gi, slugifyStr(vars.state))
      // bare {state} → raw state name (e.g. "New York")
      .replace(/\{state\}/gi, vars.state)
      .replace(/\{brand[^}]*\}/gi, vars.brand)
      .replace(/\{keyword[^}]*\}/gi, vars.service)
      .replace(/\{cluster[^}]*\}/gi, vars.cluster ?? "")
      .replace(/\{industry[^}]*\}/gi, "")
      .replace(/-{2,}/g, "-").replace(/\s{2,}/g, " ").trim();
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let rawSlug = slugify(interp(blueprint.slugTemplate));
  const stateLower = vars.state.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (stateLower && rawSlug.endsWith(`-${stateLower}-${stateLower}`)) {
    rawSlug = rawSlug.slice(0, rawSlug.length - stateLower.length - 1);
  }
  // If a cluster was provided but the blueprint template has no {cluster} placeholder,
  // append the cluster slug so each (service, cluster, location) combination is unique.
  if (vars.cluster && !/\{cluster/i.test(blueprint.slugTemplate)) {
    const cs = vars.cluster.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (cs) rawSlug = `${rawSlug}--${cs}`;
  }
  return {
    title: interp(blueprint.titleTemplate),
    h1: interp(blueprint.h1Template),
    metaDescription: interp(blueprint.metaDescTemplate),
    slug: rawSlug,
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
  const { services, blueprintId, queryClusterIds, mode, states, cities, overwrite } = settings;

  await storage.updateGenerationJob(jobId, { status: "running", startedAt: new Date() });

  const website = await storage.getWebsite(job.websiteId);
  if (!website) {
    await storage.updateGenerationJob(jobId, { status: "failed", completedAt: new Date() });
    return;
  }

  const brand = await storage.getBrandProfile(website.brandProfileId as string);
  const brandName = brand?.name || website.name || website.domain;

  const effectiveBlueprintId = blueprintId || (website.settings as any)?.defaultBlueprintId || null;
  const blueprint = effectiveBlueprintId ? await storage.getBlueprint(effectiveBlueprintId) : null;

  // ── Pre-load clusters once — keyed by service name (lowercase) ────────────────
  const [accountServices, accountClusters] = await Promise.all([
    storage.getServices(website.accountId!),
    storage.getQueryClusters(website.accountId!),
  ]);
  // If the job specified particular cluster IDs, restrict to only those clusters
  const eligibleClusters = queryClusterIds && queryClusterIds.length > 0
    ? accountClusters.filter((c: any) => queryClusterIds.includes(c.id))
    : accountClusters;
  // serviceId → cluster
  const clusterByServiceId = new Map<string, ClusterContext>(
    eligibleClusters
      .filter((c: any) => c.serviceId)
      .map((c: any) => [c.serviceId, { id: c.id, primaryKeyword: c.primaryKeyword, secondaryKeywords: c.secondaryKeywords ?? [], intentType: c.intentType }])
  );
  // service name (lowercase) → serviceId
  const serviceIdByName = new Map<string, string>(
    accountServices.map((s: any) => [s.name.toLowerCase(), s.id])
  );

  // ── Pre-load all state data once ─────────────────────────────────────────────
  const stateDataMap = await storage.getAllStateData();
  let targets = await buildTargets(mode, stateDataMap, states, cities);

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

  // ── Build related-services list for cross-service mesh links ─────────────
  // Pre-compute once: every service name + its slug, passed to every page so
  // city pages can link sideways to sibling services in the same city.
  const allRelatedServices = services.map(s => ({
    name: s,
    slug: s.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-"),
  }));

  // ── Collect new page URLs for Google Indexing API submission ─────────────
  const newPageUrls: string[] = [];

  let totalCreated = 0, totalUpdated = 0, totalFailed = 0, totalSkipped = 0;

  // ── Resume-aware: skip services that already completed before a restart ───
  const completedServiceSet = new Set<number>();
  let resumePassedPages = 0, resumeProcessedPages = 0;

  if (Array.isArray(settings.progress)) {
    settings.progress.forEach((p: any, i: number) => {
      if (p.status === "done" || p.status === "no-bank") {
        completedServiceSet.add(i);
        const svcPassed = (p.created ?? 0) + (p.updated ?? 0);
        const svcProcessed = svcPassed + (p.skipped ?? 0) + (p.errors ?? 0);
        resumePassedPages += svcPassed;
        resumeProcessedPages += svcProcessed;
      } else if (p.status === "running") {
        settings.progress[i] = { ...p, status: "pending", created: 0, updated: 0, skipped: 0, errors: 0 };
      }
    });
  }

  const basePassedPages = resumePassedPages;
  const baseProcessedPages = resumeProcessedPages;

  const clusterCount = eligibleClusters.length > 0 ? eligibleClusters.length : 1;
  const totalPages = services.length * clusterCount * targets.length;
  await storage.updateGenerationJob(jobId, { totalPages });

  if (completedServiceSet.size > 0) {
    console.log(`[bulk-background] Resuming job ${jobId} — ${completedServiceSet.size}/${services.length} services already done, skipping them`);
  }

  const blueprintTemplate = blueprint ? {
    titleTemplate: blueprint.titleTemplate,
    h1Template: blueprint.h1Template,
    metaDescTemplate: blueprint.metaDescTemplate,
    slugTemplate: blueprint.slugTemplate,
  } : null;

  // ── Auto-deduplicate: state-level blueprint used with city targets ────────────
  // If the blueprint slug template references {state} but NOT {location}/{city},
  // every city in the same state generates the same slug. Collapse targets to one
  // representative per state so the job creates unique pages without false skips.
  if (blueprintTemplate) {
    const slugUsesLocation = /\{location|\{city/i.test(blueprintTemplate.slugTemplate);
    const slugUsesState   = /\{state/i.test(blueprintTemplate.slugTemplate);
    const hasCityTargets  = targets.some(t => t.locationType === "city");
    if (slugUsesState && !slugUsesLocation && hasCityTargets) {
      const seenStates = new Set<string>();
      targets = targets.filter(t => {
        if (seenStates.has(t.stateAbbr.toUpperCase())) return false;
        seenStates.add(t.stateAbbr.toUpperCase());
        return true;
      });
      const dedupedTotal = services.length * targets.length;
      await storage.updateGenerationJob(jobId, { totalPages: dedupedTotal });
      console.log(`[bulk-background] State-level blueprint detected — deduplicated to ${targets.length} unique state targets (${dedupedTotal} total pages)`);
    }
  }

  // ── Load slug set ONCE for the entire job (not once per service) ─────────────
  const existingSlugSet = await storage.getPageSlugSet(job.websiteId);

  // ── Process each service sequentially ────────────────────────────────────────
  for (let si = 0; si < services.length; si++) {
    if (completedServiceSet.has(si)) continue;

    // Check for cancellation before starting each service so Cancel actually stops the job.
    // Without this check the worker runs through all services even after the user cancels.
    const liveJob = await storage.getGenerationJob(jobId);
    if (!liveJob || liveJob.status === "cancelled") {
      console.log(`[bulk-background] Job ${jobId} was cancelled — stopping at service ${si}/${services.length}`);
      await storage.syncWebsitePublishedCount(job.websiteId);
      return;
    }

    const svc = services[si];

    const svcId = serviceIdByName.get(svc.toLowerCase());

    const banks = await storage.getVariationBanks(job.websiteId, svc);
    if (banks.length === 0) {
      settings.progress[si] = { service: svc, status: "no-bank", created: 0, updated: 0, skipped: 0, errors: 0 };
      await storage.updateGenerationJob(jobId, { settings: settings as any });
      continue;
    }

    // Compute and persist bank completeness once per service
    try {
      const completeness = computeBankCompleteness(banks);
      await storage.upsertBankCompleteness({
        websiteId: job.websiteId,
        service: svc,
        hasIntro: completeness.hasIntro,
        hasHowItWorks: completeness.hasHowItWorks,
        hasBenefits: completeness.hasBenefits,
        hasFaq: completeness.hasFaq,
        hasCta: completeness.hasCta,
        hasLocalContext: completeness.hasLocalContext,
        hasUseCase: completeness.hasUseCase,
        hasProofTrust: completeness.hasProofTrust,
        hasPainPoint: completeness.hasPainPoint,
        hasLocalStat: completeness.hasLocalStat,
        totalVariations: completeness.totalVariations,
        avgVariationsPerSection: completeness.avgVariationsPerSection,
        completenessScore: completeness.completenessScore,
        isEligibleForTier1: completeness.isEligibleForTier1,
      } as any);
    } catch { /* non-critical — completeness tracking is best-effort */ }

    // Determine the min score for Tier 1 from the blueprint (default 80)
    const minScoreForTier1 = (blueprint as any)?.minScoreForTier1 ?? 80;

    settings.progress[si] = { service: svc, status: "running", created: 0, updated: 0, skipped: 0, errors: 0 };
    await storage.updateGenerationJob(jobId, { settings: settings as any });

    const serviceSlug = svc.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
    let svcCreated = 0, svcUpdated = 0, svcSkipped = 0, svcErrors = 0;

    // Pending batch for bulk inserts (new pages only)
    const pendingPageData: Parameters<typeof storage.createPage>[0][] = [];
    const pendingContent: string[] = [];

    // Pending batch for overwrites
    const pendingOverwrites: Array<{
      slug: string; title: string; h1: string; meta: string;
      wordCount: number; blueprintId: string | null; contentHtml: string;
    }> = [];

    const flushOverwriteBatch = async () => {
      if (pendingOverwrites.length === 0) return;
      const batch = pendingOverwrites.splice(0);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const item of batch) {
          const pgRes = await client.query(
            `UPDATE pages SET title=$1, h1=$2, meta_description=$3, word_count=$4, blueprint_id=$5, updated_at=NOW()
             WHERE website_id=$6 AND slug=$7 RETURNING id`,
            [item.title, item.h1, item.meta, item.wordCount, item.blueprintId, job.websiteId, item.slug]
          );
          if (pgRes.rows.length > 0) {
            const pageId = pgRes.rows[0].id;
            const verRes = await client.query(
              `SELECT COALESCE(MAX(version), 0) + 1 AS next_ver FROM page_versions WHERE page_id=$1`,
              [pageId]
            );
            const nextVer = verRes.rows[0].next_ver;
            await client.query(
              `UPDATE page_versions SET is_active=false WHERE page_id=$1`,
              [pageId]
            );
            await client.query(
              `INSERT INTO page_versions(id, page_id, version, content_html, is_active)
               VALUES(gen_random_uuid(), $1, $2, $3, true)`,
              [pageId, nextVer, item.contentHtml]
            );
          }
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      svcUpdated += batch.length;
      totalUpdated += batch.length;
    };

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
        // Collect URLs for Google Indexing API submission at job end
        for (const p of created) {
          newPageUrls.push(`https://${website.domain}/${p.slug}`);
        }
        svcCreated += created.length;
        totalCreated += created.length;
      }
    };

    const clustersToIterate: Array<(typeof eligibleClusters)[0] | null> =
      eligibleClusters.length > 0 ? eligibleClusters : [null];

    for (const cl of clustersToIterate) {
      const svcCluster: ClusterContext | null = cl
        ? { id: cl.id, primaryKeyword: cl.primaryKeyword, secondaryKeywords: (cl as any).secondaryKeywords ?? [], intentType: cl.intentType }
        : null;

    for (const t of targets) {
      try {
        const sd = stateDataMap.get(t.stateAbbr.toUpperCase());
        const citiesInState = t.locationType === "state"
          ? (citiesByState.get(t.stateAbbr.toUpperCase()) ?? []).map(name => ({ name }))
          : undefined;
        const result = buildVariationPage(
          svc, serviceSlug, t.locationName, t.locationType, t.stateName, t.stateAbbr,
          brandName, banks, sd, svcCluster,
          citiesInState,
          allRelatedServices,
          website.domain,
          blueprintTemplate?.slugTemplate,
          (() => { const rp = ((website.settings as any)?.proxyPath || "") as string; return rp.startsWith("/sites/") ? "" : rp; })(),
        );

        const bpOverride = applyBlueprintTemplates(blueprintTemplate, {
          service: svc,
          location: t.locationName,
          state: t.stateName,
          stateAbbr: t.stateAbbr,
          brand: brandName,
          cluster: svcCluster?.primaryKeyword ?? "",
        });

        const finalSlug = bpOverride?.slug || result.slug;
        const finalTitle = bpOverride?.title || result.title;
        const finalH1 = bpOverride?.h1 || result.h1;
        const finalMeta = bpOverride?.metaDescription || result.metaDescription;

        // Score this page at generation time
        const pageScore = scorePageContent(
          result.contentHtml, finalMeta, finalTitle, result.wordCount, banks, minScoreForTier1,
        );
        const pageTier = pageScore.recommendedTier;

        if (existingSlugSet.has(finalSlug)) {
          if (!overwrite) {
            svcSkipped++;
            totalSkipped++;
          } else {
            pendingOverwrites.push({
              slug: finalSlug, title: finalTitle, h1: finalH1, meta: finalMeta,
              wordCount: result.wordCount, blueprintId: effectiveBlueprintId || null,
              contentHtml: result.contentHtml,
            });
            if (pendingOverwrites.length >= OVERWRITE_BATCH_SIZE) {
              await flushInsertBatch();
              await flushOverwriteBatch();
            }
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
            tier: pageTier,
            qualityScore: pageScore.total,
            scoreBreakdown: pageScore as any,
            indexStatus: "queued",
            lastEvaluatedAt: new Date(),
          } as any);
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

      // Yield the event loop every YIELD_EVERY pages so pending I/O
      // (DB connection releases, HTTP request handlers) can run and prevent
      // connection-pool exhaustion on large 100K+ page jobs.
      pagesSinceLastFlush++;
      if (pagesSinceLastFlush % YIELD_EVERY === 0) await yieldEventLoop();

      // Flush progress counters to DB every PAGE_BATCH_SIZE pages.
      // Always flush the insert batch first so totalCreated is accurate
      // even when most pages are skips (batch may not have reached INSERT_BATCH_SIZE yet).
      if (pagesSinceLastFlush >= PAGE_BATCH_SIZE) {
        pagesSinceLastFlush = 0;
        await flushInsertBatch();
        await flushOverwriteBatch();
        // Check cancellation every PAGE_BATCH_SIZE pages — reuses the same DB
        // round-trip window so we don't add extra overhead per page.
        const liveJob = await storage.getGenerationJob(jobId);
        if (!liveJob || liveJob.status === "cancelled") {
          console.log(`[bulk-background] Job ${jobId} cancelled mid-service — stopping`);
          await storage.syncWebsitePublishedCount(job.websiteId);
          return;
        }
        const rawProcessed = baseProcessedPages + totalCreated + totalUpdated + totalFailed + totalSkipped;
        const rawPassed = basePassedPages + totalCreated + totalUpdated;
        await storage.updateGenerationJob(jobId, {
          processedPages: Math.min(rawProcessed, totalPages),
          passedPages: Math.min(rawPassed, totalPages),
          failedPages: totalFailed,
        });
      }
    } // end for (const t of targets)
    } // end for (const cl of clustersToIterate)

    // Flush remaining pages in batch before marking service done
    await flushInsertBatch();
    await flushOverwriteBatch();

    settings.progress[si] = { service: svc, status: "done", created: svcCreated, updated: svcUpdated, skipped: svcSkipped, errors: svcErrors };
    const rawProcessed2 = baseProcessedPages + totalCreated + totalUpdated + totalFailed + totalSkipped;
    const rawPassed2 = basePassedPages + totalCreated + totalUpdated;
    await storage.updateGenerationJob(jobId, {
      settings: settings as any,
      processedPages: Math.min(rawProcessed2, totalPages),
      passedPages: Math.min(rawPassed2, totalPages),
      failedPages: totalFailed,
    });
  }

  // Final sync and sitemap
  await storage.syncWebsitePublishedCount(job.websiteId);
  const rawFinal = baseProcessedPages + totalCreated + totalUpdated + totalFailed + totalSkipped;
  const rawPassedFinal = basePassedPages + totalCreated + totalUpdated;
  await storage.updateGenerationJob(jobId, {
    status: "completed",
    completedAt: new Date(),
    processedPages: Math.min(rawFinal, totalPages),
    passedPages: Math.min(rawPassedFinal, totalPages),
    failedPages: totalFailed,
  });

  try {
    const { generateSitemapsForWebsite } = await import("./sitemap");
    const pDomain = (website.settings as any)?.parentDomain;
    const pPathRaw = ((website.settings as any)?.proxyPath || "") as string;
    const pPath = pPathRaw.startsWith("/sites/") ? "" : pPathRaw;
    const canonBase = pDomain ? `https://${pDomain}${pPath}` : undefined;
    await generateSitemapsForWebsite(job.websiteId, website.domain, canonBase);
  } catch { /* non-critical */ }

  // Ping Google to re-crawl the sitemap immediately after job completion
  try {
    const sitemapUrl = `https://${website.domain}/sitemap.xml`;
    await fetch(`https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`);
    console.log(`[bulk-background] Pinged Google sitemap for ${website.domain}`);
  } catch { /* non-critical — Google ping is best-effort */ }

  // Submit new page URLs directly to Google Indexing API for rapid indexing
  try {
    await submitUrlsToGoogle(newPageUrls);
  } catch { /* non-critical — GSC indexing is best-effort */ }

  // Auto 1 + 2 + 3 + 4: Create a separate scoring job visible in the Jobs dashboard
  try {
    const { runAutoScoringJob } = await import("./automation");
    const scoringJob = await storage.createGenerationJob({
      accountId: website.accountId!,
      websiteId: job.websiteId,
      name: `Auto-Score: ${website.domain}`,
      status: "pending",
      totalPages: 0,
      processedPages: 0,
      passedPages: 0,
      failedPages: 0,
      settings: { type: "auto_scoring" },
    });
    setImmediate(() => runAutoScoringJob(scoringJob.id, website).catch(err => {
      console.error("[auto1] Scoring background job failed:", err);
      storage.updateGenerationJob(scoringJob.id, { status: "failed", completedAt: new Date() }).catch(() => {});
    }));
    console.log(`[auto1] Scoring job ${scoringJob.id} queued for ${website.domain}`);
  } catch (err) {
    console.error("[auto1] Failed to create scoring job (non-fatal):", err);
  }
}
