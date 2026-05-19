/**
 * bulk-background.ts
 * Runs a bulk-generation job entirely server-side so the browser can be closed.
 * Progress is written to the generationJobs.settings JSONB field and polled by the UI.
 *
 * Performance design:
 *   - State data loaded ONCE into a Map at job start (not per-page)
 *   - Existing page slug/status loaded ONCE into a Map (not per-page lookup)
 *   - DB job progress updated every PAGE_BATCH_SIZE pages, not every page
 */
import * as storage from "../storage";
import { buildVariationPage, ClusterContext } from "./variation-engine";
import { submitUrlsToGoogle } from "./gsc-indexing";
import { scorePageContent, computeBankCompleteness } from "./scoring";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and } from "drizzle-orm";
import pg from "pg";
import * as schema from "@shared/schema";

const bulkPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL!,
  max: Number(process.env.BULK_DB_POOL_MAX || 8),
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 30000,
});
const bulkDb = drizzle(bulkPool, { schema });

async function insertPagesBulk(data: schema.InsertPage[]): Promise<schema.Page[]> {
  if (data.length === 0) return [];
  return bulkDb.insert(schema.pages).values(data).onConflictDoNothing().returning() as Promise<schema.Page[]>;
}
async function insertVersionsBulk(data: schema.InsertPageVersion[]): Promise<void> {
  if (data.length === 0) return;
  await bulkDb.insert(schema.pageVersions).values(data);
}

const INSERT_BATCH_SIZE = Number(process.env.BULK_INSERT_BATCH_SIZE || 100);
const PAGE_BATCH_SIZE = Number(process.env.BULK_PROGRESS_BATCH_SIZE || 500);
const OVERWRITE_BATCH_SIZE = Number(process.env.BULK_OVERWRITE_BATCH_SIZE || 75);
const YIELD_EVERY = Number(process.env.BULK_YIELD_EVERY || 25);

const yieldEventLoop = () => new Promise<void>(r => setImmediate(r));

const slugifySegment = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function shouldNamespaceBlueprintSlug(settings: any): boolean {
  return (
    Number(settings?.campaignBlueprintTotal || 0) > 1 ||
    Boolean(settings?.parentJobId) ||
    Boolean(settings?.multiBlueprintCampaign) ||
    Boolean(settings?.namespaceBlueprintSlug)
  );
}

function namespaceSlugWithBlueprint(slug: string, blueprint: any, settings: any): string {
  if (!slug || !blueprint || !shouldNamespaceBlueprintSlug(settings)) return slug;

  const blueprintNamespace = slugifySegment(blueprint.slug || blueprint.name || blueprint.id || "");
  if (!blueprintNamespace) return slug;

  if (slug === blueprintNamespace || slug.startsWith(`${blueprintNamespace}--`)) return slug;
  return `${blueprintNamespace}--${slug}`;
}

async function bulkGetJob(id: string) {
  const [row] = await bulkDb.select().from(schema.generationJobs).where(eq(schema.generationJobs.id, id));
  return row ?? null;
}
async function bulkUpdateJob(id: string, data: Record<string, unknown>) {
  await bulkDb.update(schema.generationJobs).set(data as any).where(eq(schema.generationJobs.id, id));
}
async function bulkGetWebsite(id: string) {
  const [row] = await bulkDb.select().from(schema.websites).where(eq(schema.websites.id, id));
  return row ?? null;
}
async function bulkGetBrandProfile(id: string) {
  const [row] = await bulkDb.select().from(schema.brandProfiles).where(eq(schema.brandProfiles.id, id));
  return row ?? null;
}
async function bulkGetBlueprint(id: string) {
  const [row] = await bulkDb.select().from(schema.blueprints).where(eq(schema.blueprints.id, id));
  return row ?? null;
}
async function bulkGetServices(accountId: string) {
  return bulkDb.select().from(schema.services).where(eq(schema.services.accountId, accountId));
}
async function bulkGetQueryClusters(accountId: string) {
  return bulkDb.select().from(schema.queryClusters).where(eq(schema.queryClusters.accountId, accountId));
}
async function bulkGetAllStateData() {
  const rows = await bulkDb.select().from(schema.stateData);
  return new Map(rows.map(r => [r.stateAbbr.toUpperCase(), r]));
}
async function bulkGetPageSlugStatusMap(websiteId: string): Promise<Map<string, string>> {
  const rows = await bulkDb
    .select({ slug: schema.pages.slug, status: schema.pages.status })
    .from(schema.pages)
    .where(eq(schema.pages.websiteId, websiteId));
  return new Map(rows.map(r => [r.slug, String(r.status || "unknown").toLowerCase()]));
}
async function bulkGetVariationBanks(websiteId: string, service: string) {
  return bulkDb.select().from(schema.contentVariationBanks).where(
    and(eq(schema.contentVariationBanks.websiteId, websiteId), eq(schema.contentVariationBanks.service, service))
  );
}
async function bulkUpsertBankCompleteness(data: any) {
  const client = await bulkPool.connect();
  try {
    await client.query(
      `INSERT INTO variation_bank_completeness
        (id, website_id, service,
         has_intro, has_how_it_works, has_benefits, has_faq, has_cta,
         has_local_context, has_use_case, has_proof_trust, has_pain_point, has_local_stat,
         total_variations, avg_variations_per_section, completeness_score, is_eligible_for_tier1, last_computed_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
       ON CONFLICT (website_id, service) DO UPDATE SET
         has_intro = EXCLUDED.has_intro, has_how_it_works = EXCLUDED.has_how_it_works,
         has_benefits = EXCLUDED.has_benefits, has_faq = EXCLUDED.has_faq, has_cta = EXCLUDED.has_cta,
         has_local_context = EXCLUDED.has_local_context, has_use_case = EXCLUDED.has_use_case,
         has_proof_trust = EXCLUDED.has_proof_trust, has_pain_point = EXCLUDED.has_pain_point,
         has_local_stat = EXCLUDED.has_local_stat, total_variations = EXCLUDED.total_variations,
         avg_variations_per_section = EXCLUDED.avg_variations_per_section,
         completeness_score = EXCLUDED.completeness_score,
         is_eligible_for_tier1 = EXCLUDED.is_eligible_for_tier1, last_computed_at = NOW()`,
      [
        data.websiteId, data.service,
        data.hasIntro, data.hasHowItWorks, data.hasBenefits, data.hasFaq, data.hasCta,
        data.hasLocalContext ?? false, data.hasUseCase ?? false,
        data.hasProofTrust ?? false, data.hasPainPoint ?? false, data.hasLocalStat ?? false,
        data.totalVariations, data.avgVariationsPerSection, data.completenessScore, data.isEligibleForTier1,
      ]
    );
  } finally {
    client.release();
  }
}
async function bulkSyncPublishedCount(websiteId: string) {
  const client = await bulkPool.connect();
  try {
    const res = await client.query(`SELECT COUNT(*) AS n FROM pages WHERE website_id=$1 AND status='published'`, [websiteId]);
    const n = parseInt(res.rows[0].n, 10);
    await client.query(`UPDATE websites SET published_pages=$1, updated_at=NOW() WHERE id=$2`, [n, websiteId]);
  } finally {
    client.release();
  }
}
async function bulkCreateJob(data: typeof schema.generationJobs.$inferInsert) {
  const [row] = await bulkDb.insert(schema.generationJobs).values(data).returning();
  return row;
}

export interface BulkJobSettings {
  services: string[];
  blueprintId?: string;
  queryClusterIds?: string[];
  mode: "all_states" | "specific_states" | "specific_cities";
  states?: string[];
  cities?: Array<{ name: string; stateAbbr: string }>;
  overwrite?: boolean;
  isDraft?: boolean;
  draftReason?: string;
  parentJobId?: string;
  campaignBlueprintTotal?: number;
  multiBlueprintCampaign?: boolean;
  namespaceBlueprintSlug?: boolean;
  progress: Array<{
    service: string;
    status: "pending" | "running" | "done" | "error" | "no-bank";
    created: number;
    updated: number;
    skipped: number;
    errors: number;
    skippedPublished?: number;
    revivedUnpublished?: number;
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
      .replace(/\{state[-_]abbr[^}]*\}/gi, vars.stateAbbr)
      .replace(/\{abbr[^}]*\}/gi, vars.stateAbbr)
      .replace(/\{state[-_]slug[^}]*\}/gi, slugifyStr(vars.state))
      .replace(/\{state\|[^}]*\}/gi, slugifyStr(vars.state))
      .replace(/\{state\}/gi, vars.state)
      .replace(/\{brand[^}]*\}/gi, vars.brand)
      .replace(/\{keyword[^}]*\}/gi, vars.service)
      .replace(/\{cluster[^}]*\}/gi, vars.cluster ?? "")
      .replace(/\{industry[^}]*\}/gi, "")
      .replace(/-{2,}/g, "-").replace(/\s{2,}/g, " ").trim();
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let rawSlug = slugify(interp(blueprint.slugTemplate));
  const stateLower = vars.state.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (stateLower && rawSlug.endsWith(`-${stateLower}-${stateLower}`)) rawSlug = rawSlug.slice(0, rawSlug.length - stateLower.length - 1);
  if (vars.cluster && !/\{cluster/i.test(blueprint.slugTemplate)) {
    const cs = slugify(vars.cluster);
    if (cs) rawSlug = `${rawSlug}--${cs}`;
  }
  if (vars.service && !/\{service/i.test(blueprint.slugTemplate)) {
    const ss = slugify(vars.service);
    const templateLower = slugify(blueprint.slugTemplate);
    if (ss && !templateLower.includes(ss)) rawSlug = `${rawSlug}--${ss}`;
  }
  const dedupState = (text: string): string => {
    if (vars.location.toLowerCase() !== vars.state.toLowerCase()) return text;
    const escaped = vars.state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.replace(new RegExp(`\\b${escaped}\\s*,\\s*${escaped}\\b`, "gi"), vars.state);
  };
  return { title: dedupState(interp(blueprint.titleTemplate)), h1: dedupState(interp(blueprint.h1Template)), metaDescription: dedupState(interp(blueprint.metaDescTemplate)), slug: rawSlug };
}

async function buildTargets(
  mode: BulkJobSettings["mode"],
  stateDataMap: Map<string, any>,
  states?: string[],
  cities?: Array<{ name: string; stateAbbr: string }>,
): Promise<Array<{ locationName: string; locationType: string; stateAbbr: string; stateName: string }>> {
  const allStateAbbrs = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
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
  const job = await bulkGetJob(jobId);
  if (!job) return;
  const settings = job.settings as unknown as BulkJobSettings;
  const { services, blueprintId, queryClusterIds, mode, states, cities, overwrite } = settings;
  await bulkUpdateJob(jobId, { status: "running", startedAt: new Date() });
  const website = await bulkGetWebsite(job.websiteId);
  if (!website) {
    await bulkUpdateJob(jobId, { status: "failed", completedAt: new Date() });
    return;
  }

  const brand = await bulkGetBrandProfile(website.brandProfileId as string);
  const brandName = brand?.name || website.name || website.domain;
  const effectiveBlueprintId = blueprintId || (website.settings as any)?.defaultBlueprintId || null;
  const blueprint = effectiveBlueprintId ? await bulkGetBlueprint(effectiveBlueprintId) : null;
  const [accountServices, accountClusters] = await Promise.all([bulkGetServices(website.accountId!), bulkGetQueryClusters(website.accountId!)]);
  const eligibleClusters = queryClusterIds && queryClusterIds.length > 0 ? accountClusters.filter((c: any) => queryClusterIds.includes(c.id)) : accountClusters;
  const serviceIdByName = new Map<string, string>(accountServices.map((s: any) => [s.name.toLowerCase(), s.id]));
  const stateDataMap = await bulkGetAllStateData();
  let targets = await buildTargets(mode, stateDataMap, states, cities);

  const citiesByState = new Map<string, string[]>();
  for (const t of targets) if (t.locationType === "city") {
    const list = citiesByState.get(t.stateAbbr.toUpperCase()) ?? [];
    list.push(t.locationName);
    citiesByState.set(t.stateAbbr.toUpperCase(), list);
  }
  const allRelatedServices = services.map(s => ({ name: s, slug: s.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-") }));
  const newPageUrls: string[] = [];
  let totalCreated = 0, totalUpdated = 0, totalFailed = 0, totalSkipped = 0;
  let totalRevivedUnpublished = 0;

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
  let totalPages = services.length * clusterCount * targets.length;

  const blueprintTemplate = blueprint ? { titleTemplate: blueprint.titleTemplate, h1Template: blueprint.h1Template, metaDescTemplate: blueprint.metaDescTemplate, slugTemplate: blueprint.slugTemplate } : null;
  if (blueprintTemplate) {
    const slugUsesLocation = /\{location|\{city/i.test(blueprintTemplate.slugTemplate);
    const slugUsesState = /\{state/i.test(blueprintTemplate.slugTemplate);
    const hasCityTargets = targets.some(t => t.locationType === "city");
    if (slugUsesState && !slugUsesLocation && hasCityTargets) {
      const seenStates = new Set<string>();
      targets = targets.filter(t => {
        if (seenStates.has(t.stateAbbr.toUpperCase())) return false;
        seenStates.add(t.stateAbbr.toUpperCase());
        return true;
      });
      totalPages = services.length * clusterCount * targets.length;
      console.log(`[bulk-background] State-level blueprint detected — deduplicated to ${targets.length} unique state targets (${totalPages} total pages)`);
    }
  }
  await bulkUpdateJob(jobId, { totalPages });
  const existingSlugStatusMap = await bulkGetPageSlugStatusMap(job.websiteId);

  for (let si = 0; si < services.length; si++) {
    if (completedServiceSet.has(si)) continue;
    const liveJob = await bulkGetJob(jobId);
    if (!liveJob || liveJob.status === "cancelled") {
      console.log(`[bulk-background] Job ${jobId} was cancelled — stopping at service ${si}/${services.length}`);
      await bulkSyncPublishedCount(job.websiteId);
      return;
    }
    const svc = services[si];
    const svcId = serviceIdByName.get(svc.toLowerCase());
    const banks = await bulkGetVariationBanks(job.websiteId, svc);
    if (banks.length === 0) {
      settings.progress[si] = { service: svc, status: "no-bank", created: 0, updated: 0, skipped: 0, errors: 0 };
      await bulkUpdateJob(jobId, { settings: settings as any });
      continue;
    }

    try {
      const completeness = computeBankCompleteness(banks);
      await bulkUpsertBankCompleteness({ websiteId: job.websiteId, service: svc, hasIntro: completeness.hasIntro, hasHowItWorks: completeness.hasHowItWorks, hasBenefits: completeness.hasBenefits, hasFaq: completeness.hasFaq, hasCta: completeness.hasCta, hasLocalContext: completeness.hasLocalContext, hasUseCase: completeness.hasUseCase, hasProofTrust: completeness.hasProofTrust, hasPainPoint: completeness.hasPainPoint, hasLocalStat: completeness.hasLocalStat, totalVariations: completeness.totalVariations, avgVariationsPerSection: completeness.avgVariationsPerSection, completenessScore: completeness.completenessScore, isEligibleForTier1: completeness.isEligibleForTier1 } as any);
    } catch { /* best effort */ }

    const minScoreForTier1 = (blueprint as any)?.minScoreForTier1 ?? 80;
    settings.progress[si] = { service: svc, status: "running", created: 0, updated: 0, skipped: 0, errors: 0, skippedPublished: 0, revivedUnpublished: 0 };
    await bulkUpdateJob(jobId, { settings: settings as any });

    const serviceSlug = svc.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
    let svcCreated = 0, svcUpdated = 0, svcSkipped = 0, svcErrors = 0, svcSkippedPublished = 0, svcRevivedUnpublished = 0;
    const pendingPageData: schema.InsertPage[] = [];
    const pendingContent: string[] = [];
    const pendingOverwrites: Array<{ slug: string; title: string; h1: string; meta: string; wordCount: number; blueprintId: string | null; contentHtml: string; wasUnpublished?: boolean }> = [];

    const flushOverwriteBatch = async () => {
      if (pendingOverwrites.length === 0) return;
      const batch = pendingOverwrites.splice(0);
      const client = await bulkPool.connect();
      try {
        await client.query("BEGIN");
        for (const item of batch) {
          const pgRes = await client.query(
            `UPDATE pages
             SET title=$1, h1=$2, meta_description=$3, word_count=$4, blueprint_id=$5,
                 status='published', index_status='queued', noindex=false, updated_at=NOW(), published_at=COALESCE(published_at, NOW())
             WHERE website_id=$6 AND slug=$7 RETURNING id`,
            [item.title, item.h1, item.meta, item.wordCount, item.blueprintId, job.websiteId, item.slug]
          );
          if (pgRes.rows.length > 0) {
            const pageId = pgRes.rows[0].id;
            const verRes = await client.query(`SELECT COALESCE(MAX(version), 0) + 1 AS next_ver FROM page_versions WHERE page_id=$1`, [pageId]);
            const nextVer = verRes.rows[0].next_ver;
            await client.query(`UPDATE page_versions SET is_active=false WHERE page_id=$1`, [pageId]);
            await client.query(`INSERT INTO page_versions(id, page_id, version, content_html, is_active) VALUES(gen_random_uuid(), $1, $2, $3, true)`, [pageId, nextVer, item.contentHtml]);
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
      const revived = batch.filter(b => b.wasUnpublished).length;
      svcRevivedUnpublished += revived;
      totalRevivedUnpublished += revived;
    };

    let pagesSinceLastFlush = 0;
    const flushInsertBatch = async () => {
      if (pendingPageData.length === 0) return;
      const batchData = pendingPageData.splice(0);
      const batchContent = pendingContent.splice(0);
      const slugToContent = new Map<string, string>();
      batchData.forEach((d, i) => slugToContent.set(d.slug, batchContent[i]));
      const created = await insertPagesBulk(batchData as schema.InsertPage[]);
      if (created.length > 0) {
        await insertVersionsBulk(created.map(p => ({ pageId: p.id, version: 1, contentHtml: slugToContent.get(p.slug) ?? "", isActive: true })));
        for (const p of created) newPageUrls.push(`https://${website.domain}/${p.slug}`);
        svcCreated += created.length;
        totalCreated += created.length;
      }
    };

    const clustersToIterate: Array<(typeof eligibleClusters)[0] | null> = eligibleClusters.length > 0 ? eligibleClusters : [null];
    for (const cl of clustersToIterate) {
      const svcCluster: ClusterContext | null = cl ? { id: cl.id, primaryKeyword: cl.primaryKeyword, secondaryKeywords: (cl as any).secondaryKeywords ?? [], intentType: cl.intentType } : null;
      for (const t of targets) {
        try {
          const sd = stateDataMap.get(t.stateAbbr.toUpperCase());
          const citiesInState = t.locationType === "state" ? (citiesByState.get(t.stateAbbr.toUpperCase()) ?? []).map(name => ({ name })) : undefined;
          const result = buildVariationPage(svc, serviceSlug, t.locationName, t.locationType, t.stateName, t.stateAbbr, brandName, banks, sd, svcCluster, citiesInState, allRelatedServices, website.domain, blueprintTemplate?.slugTemplate, (() => { const rp = ((website.settings as any)?.proxyPath || "") as string; return rp.startsWith("/sites/") ? "" : rp; })());
          const bpOverride = applyBlueprintTemplates(blueprintTemplate, { service: svc, location: t.locationName, state: t.stateName, stateAbbr: t.stateAbbr, brand: brandName, cluster: svcCluster?.primaryKeyword ?? "" });
          let finalSlug = bpOverride?.slug || result.slug;
          finalSlug = namespaceSlugWithBlueprint(finalSlug, blueprint, settings as any);
          const finalTitle = bpOverride?.title || result.title;
          const finalH1 = bpOverride?.h1 || result.h1;
          const finalMeta = bpOverride?.metaDescription || result.metaDescription;
          const pageScore = scorePageContent(result.contentHtml, finalMeta, finalTitle, result.wordCount, banks, minScoreForTier1);
          const pageTier = pageScore.recommendedTier;
          const existingStatus = existingSlugStatusMap.get(finalSlug);

          if (existingStatus) {
            if (!overwrite && existingStatus === "published") {
              svcSkipped++;
              svcSkippedPublished++;
              totalSkipped++;
            } else {
              pendingOverwrites.push({ slug: finalSlug, title: finalTitle, h1: finalH1, meta: finalMeta, wordCount: result.wordCount, blueprintId: effectiveBlueprintId || null, contentHtml: result.contentHtml, wasUnpublished: existingStatus !== "published" });
              existingSlugStatusMap.set(finalSlug, "published");
              if (pendingOverwrites.length >= OVERWRITE_BATCH_SIZE) {
                await flushInsertBatch();
                await flushOverwriteBatch();
              }
            }
          } else {
            existingSlugStatusMap.set(finalSlug, settings.isDraft ? "draft" : "published");
            const draftFields = settings.isDraft ? { isDraft: true, draftReason: settings.draftReason || "onboarding_initial", publishWave: 0, status: "draft" as const } : {};
            pendingPageData.push({ websiteId: job.websiteId, blueprintId: effectiveBlueprintId || null, serviceId: svcId || null, locationId: null, queryClusterId: svcCluster?.id || null, slug: finalSlug, title: finalTitle, h1: finalH1, metaDescription: finalMeta, status: "published", pageType: t.locationType === "state" ? "state_hub" : "service_city", wordCount: result.wordCount, tier: pageTier, qualityScore: pageScore.total, scoreBreakdown: pageScore as any, indexStatus: "queued", lastEvaluatedAt: new Date(), ...draftFields } as any);
            pendingContent.push(result.contentHtml);
            if (pendingPageData.length >= INSERT_BATCH_SIZE) await flushInsertBatch();
          }
        } catch (err) {
          svcErrors++;
          totalFailed++;
          console.error("[bulk-background] error", svc, t.locationName, err);
        }

        pagesSinceLastFlush++;
        if (pagesSinceLastFlush % YIELD_EVERY === 0) await yieldEventLoop();
        if (pagesSinceLastFlush >= PAGE_BATCH_SIZE) {
          pagesSinceLastFlush = 0;
          try {
            await flushInsertBatch();
            await flushOverwriteBatch();
            const midJob = await bulkGetJob(jobId);
            if (!midJob || midJob.status === "cancelled") {
              console.log(`[bulk-background] Job ${jobId} cancelled mid-service — stopping`);
              await bulkSyncPublishedCount(job.websiteId);
              return;
            }
            const rawProcessed = baseProcessedPages + totalCreated + totalUpdated + totalFailed + totalSkipped;
            const rawPassed = basePassedPages + totalCreated + totalUpdated;
            await bulkUpdateJob(jobId, { processedPages: Math.min(rawProcessed, totalPages), passedPages: Math.min(rawPassed, totalPages), failedPages: totalFailed, settings: { ...(settings as any), publishedMaxMode: true, revivedUnpublished: totalRevivedUnpublished } as any });
          } catch (chkErr) {
            console.error("[bulk-background] checkpoint flush error (continuing):", chkErr);
          }
        }
      }
    }

    await flushInsertBatch();
    await flushOverwriteBatch();
    settings.progress[si] = { service: svc, status: "done", created: svcCreated, updated: svcUpdated, skipped: svcSkipped, errors: svcErrors, skippedPublished: svcSkippedPublished, revivedUnpublished: svcRevivedUnpublished };
    const rawProcessed2 = baseProcessedPages + totalCreated + totalUpdated + totalFailed + totalSkipped;
    const rawPassed2 = basePassedPages + totalCreated + totalUpdated;
    await bulkUpdateJob(jobId, { settings: { ...(settings as any), publishedMaxMode: true, revivedUnpublished: totalRevivedUnpublished } as any, processedPages: Math.min(rawProcessed2, totalPages), passedPages: Math.min(rawPassed2, totalPages), failedPages: totalFailed });
  }

  await bulkSyncPublishedCount(job.websiteId);
  const rawFinal = baseProcessedPages + totalCreated + totalUpdated + totalFailed + totalSkipped;
  const rawPassedFinal = basePassedPages + totalCreated + totalUpdated;
  await bulkUpdateJob(jobId, { status: "completed", completedAt: new Date(), processedPages: Math.min(rawFinal, totalPages), passedPages: Math.min(rawPassedFinal, totalPages), failedPages: totalFailed, settings: { ...(settings as any), publishedMaxMode: true, revivedUnpublished: totalRevivedUnpublished } as any });

  if (!settings.isDraft) {
    try {
      const { generateSitemapsForWebsite } = await import("./sitemap");
      const pDomain = (website.settings as any)?.parentDomain;
      const pPathRaw = ((website.settings as any)?.proxyPath || "") as string;
      const pPath = pPathRaw.startsWith("/sites/") ? "" : pPathRaw;
      const canonBase = pDomain ? `https://${pDomain}${pPath}` : undefined;
      await generateSitemapsForWebsite(job.websiteId, website.domain, canonBase);
    } catch { /* non-critical */ }
    try {
      const sitemapUrl = `https://${website.domain}/sitemap.xml`;
      await fetch(`https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`);
      console.log(`[bulk-background] Pinged Google sitemap for ${website.domain}`);
    } catch { /* non-critical */ }
    try { await submitUrlsToGoogle(newPageUrls); } catch { /* non-critical */ }
  } else {
    console.log(`[bulk-background] Draft mode — skipped sitemap regen, Google ping, GSC indexing for ${website.domain}`);
  }

  try {
    const { runAutoScoringJob } = await import("./automation");
    const scoringJob = await bulkCreateJob({ accountId: website.accountId!, websiteId: job.websiteId, name: `Auto-Score: ${website.domain}`, status: "pending", totalPages: 0, processedPages: 0, passedPages: 0, failedPages: 0, settings: { type: "auto_scoring" } });
    const scoringOpts = settings.isDraft ? { skipPublishingHooks: true } : undefined;
    setImmediate(() => runAutoScoringJob(scoringJob.id, website, scoringOpts).catch(err => {
      console.error("[auto1] Scoring background job failed:", err);
      storage.updateGenerationJob(scoringJob.id, { status: "failed", completedAt: new Date() }).catch(() => {});
    }));
    console.log(`[auto1] Scoring job ${scoringJob.id} queued for ${website.domain}${settings.isDraft ? " (draft mode — Auto 3/4 suppressed)" : ""}`);
  } catch (err) {
    console.error("[auto1] Failed to create scoring job (non-fatal):", err);
  }
}
