import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile } from "fs/promises";

const allowlist = ["@google/generative-ai","axios","connect-pg-simple","cors","date-fns","drizzle-orm","drizzle-zod","express","express-rate-limit","express-session","jsonwebtoken","memorystore","multer","nanoid","nodemailer","openai","passport","passport-local","pg","stripe","uuid","ws","xlsx","zod","zod-validation-error"];

async function patchBulkGeneratorForMaxPages() {
  const file = "server/services/bulk-background.ts";
  let source = await readFile(file, "utf-8");
  if (!source.includes("function forceTargetSlugDimensions")) {
    source = source.replace("function namespaceSlugWithBlueprint(slug: string, blueprint: any, settings: any): string {", `function forceTargetSlugDimensions(slug: string, target: { locationName: string; locationType: string; stateAbbr: string; stateName: string }): string {
  let next = slugifySegment(slug);
  const location = slugifySegment(target.locationName);
  const state = slugifySegment(target.stateName);
  const abbr = slugifySegment(target.stateAbbr);
  if (target.locationType === "city") {
    const cityState = slugifySegment(\`${"${target.locationName}-${target.stateAbbr}"}\`);
    if (location && !next.includes(location)) next = \`${"${next}--${cityState}"}\`;
    else if (abbr && !next.includes(\`-${"${abbr}"}\`) && !next.endsWith(abbr)) next = \`${"${next}--${abbr}"}\`;
  } else if (target.locationType === "state") {
    if (state && !next.includes(state) && abbr && !next.includes(abbr)) next = \`${"${next}--${state}"}\`;
  }
  return next.replace(/-{3,}/g, "--").replace(/^-|-$/g, "");
}

function namespaceSlugWithBlueprint(slug: string, blueprint: any, settings: any): string {`);
  }
  source = source.replace(/\n  if \(blueprintTemplate\) \{\n    const slugUsesLocation = \/\\\{location\|\\\{city\/i\.test\(blueprintTemplate\.slugTemplate\);\n    const slugUsesState = \/\\\{state\/i\.test\(blueprintTemplate\.slugTemplate\);\n    const hasCityTargets = targets\.some\(t => t\.locationType === "city"\);\n    if \(slugUsesState && !slugUsesLocation && hasCityTargets\) \{\n      const seenStates = new Set<string>\(\);\n      targets = targets\.filter\(t => \{\n        if \(seenStates\.has\(t\.stateAbbr\.toUpperCase\(\)\)\) return false;\n        seenStates\.add\(t\.stateAbbr\.toUpperCase\(\)\);\n        return true;\n      \}\);\n      totalPages = services\.length \* clusterCount \* targets\.length;\n      console\.log\(`\[bulk-background\] State-level blueprint detected — deduplicated to \$\{targets\.length\} unique state targets \(\$\{totalPages\} total pages\)`\);\n    \}\n  \}/, "\n  // Max-pages rule: never reduce selected city targets. Missing city/state slug dimensions are appended below.");
  if (!source.includes("forceTargetSlugDimensions(finalSlug, t)")) {
    source = source.replace("finalSlug = namespaceSlugWithBlueprint(finalSlug, blueprint, settings as any);", "finalSlug = namespaceSlugWithBlueprint(finalSlug, blueprint, settings as any);\n          finalSlug = forceTargetSlugDimensions(finalSlug, t);");
  }
  await writeFile(file, source);
}

async function patchBulkGeneratorUiToBackendCampaign() {
  const file = "client/src/pages/bulk-generator/index.tsx";
  let source = await readFile(file, "utf-8");
  if (source.includes("backendCampaignLocked: true")) return;
  const pattern = /\n    const queue: QueueItem\[\] = \[\];[\s\S]*?\n    await submitJobForBlueprint\(queue\[0\]\);/;
  const replacement = `
    const queryClusterIds = selectedQueryClusterIds();
    const locationPayload = runBothLocations ? buildExpandedCityPayload() : buildLocationPayload();
    const payload: Record<string, any> = {
      services: Array.from(selectedServices),
      ...locationPayload,
      overwrite,
      runAllBlueprints: cycleBlueprints && blueprints.length > 1,
      blueprintIds: cycleBlueprints && blueprints.length > 1 ? blueprints.map((bp: any) => bp.id) : bpIds,
      backendCampaignLocked: true,
    };
    if (queryClusterIds.length > 0) payload.queryClusterIds = queryClusterIds;
    accumulatedRef.current = { created: 0, skipped: 0, errors: 0 };
    handledTerminalJobRef.current = "";
    const backendCampaignLabel = payload.runAllBlueprints ? "Backend campaign · " + bpIds.length + " blueprints" : "Backend campaign";
    setBpQueueDisplay({ idx: 0, total: 1, label: backendCampaignLabel });
    setLastResult(null);
    setLastFailure("");
    setIsRunningAll(true);
    setServiceProgress(Array.from(selectedServices).map((service) => ({ service, status: "pending", created: 0, updated: 0, skipped: 0, errors: 0 })));
    try {
      const data = await apiFetch<{ jobId: string }>(\`/api/websites/\${websiteId}/bulk-campaign\`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setActiveJobId(data.jobId);
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
    } catch (err: any) {
      setIsRunningAll(false);
      const message = err?.message || "Failed to start backend campaign";
      setLastFailure(message);
      toast({ title: "Failed to start backend campaign", description: message, variant: "destructive" });
    }`;
  source = source.replace(pattern, replacement);
  await writeFile(file, source);
}

async function patchBackendCampaignChunking() {
  const file = "server/routes/bulk-generate-job-fast.ts";
  let source = await readFile(file, "utf-8");
  if (source.includes("BULK_CAMPAIGN_CHILD_MAX_PAGES")) return;
  source = source.replace("const NO_CLUSTER_SENTINEL = \"__NO_CLUSTERS__\";", "const NO_CLUSTER_SENTINEL = \"__NO_CLUSTERS__\";\nconst BULK_CAMPAIGN_CHILD_MAX_PAGES = Math.max(1000, Number(process.env.BULK_CAMPAIGN_CHILD_MAX_PAGES || 75000));");
  source = source.replace("function getEffectiveClusters(settings: BulkJobSettings) {", `function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  const safeSize = Math.max(1, size);
  for (let i = 0; i < items.length; i += safeSize) chunks.push(items.slice(i, i + safeSize));
  return chunks;
}

function buildCampaignChunks(settings: AnyJob, blueprintIds: string[]) {
  const services = Array.isArray(settings.services) ? settings.services.map(String).filter(Boolean) : [];
  const clusterCount = Math.max(1, Number(settings.clusterCount || 1));
  const cities = Array.isArray(settings.childBaseSettings?.cities) ? settings.childBaseSettings.cities : Array.isArray(settings.cities) ? settings.cities : [];
  const states = Array.isArray(settings.childBaseSettings?.states) ? settings.childBaseSettings.states : Array.isArray(settings.states) ? settings.states : [];
  const mode = settings.childBaseSettings?.mode || settings.mode;
  const targetCount = Number(settings.targetCount || (mode === "specific_cities" ? cities.length : mode === "specific_states" ? states.length : 50));
  const targetsPerService = Math.max(1, targetCount * clusterCount);
  const maxPages = BULK_CAMPAIGN_CHILD_MAX_PAGES;
  const serviceChunkSize = Math.max(1, Math.floor(maxPages / targetsPerService));
  const chunks: AnyJob[] = [];
  for (const blueprintId of blueprintIds) {
    if (serviceChunkSize >= services.length) {
      const targetChunkSize = Math.max(1, Math.floor(maxPages / Math.max(1, services.length * clusterCount)));
      if (mode === "specific_cities" && cities.length > targetChunkSize) {
        for (const cityChunk of chunkArray(cities, targetChunkSize)) chunks.push({ blueprintId, services, cities: cityChunk, states: undefined, targetCount: cityChunk.length });
      } else if (mode === "specific_states" && states.length > targetChunkSize) {
        for (const stateChunk of chunkArray(states, targetChunkSize)) chunks.push({ blueprintId, services, cities: undefined, states: stateChunk, targetCount: stateChunk.length });
      } else {
        chunks.push({ blueprintId, services, targetCount });
      }
    } else {
      for (const serviceChunk of chunkArray(services, serviceChunkSize)) chunks.push({ blueprintId, services: serviceChunk, targetCount });
    }
  }
  return chunks.map((chunk, index) => ({ ...chunk, index: index + 1, total: chunks.length, totalPages: chunk.services.length * Number(chunk.targetCount || targetCount) * clusterCount }));
}

function getEffectiveClusters(settings: BulkJobSettings) {`);
  source = source.replace("const childTotalPages = services.length * targetCount * clusterCount;", "const campaignChunks = buildCampaignChunks(settings, blueprintIds);\n    const childTotalPages = services.length * targetCount * clusterCount;");
  source = source.replace("settings: { ...settings, currentBlueprintIndex: 0, childTotalPages } as any,", "settings: { ...settings, currentBlueprintIndex: 0, childTotalPages, childChunkMaxPages: BULK_CAMPAIGN_CHILD_MAX_PAGES, childChunkCount: campaignChunks.length } as any,");
  source = source.replace(/for \(let i = 0; i < blueprintIds\.length; i\+\+\) \{[\s\S]*?\n    \}\n\n    await storage\.updateGenerationJob\(parentJobId, \{\n      status: JOB_STATUS\.COMPLETED as any,/, `for (let i = 0; i < campaignChunks.length; i++) {
      const chunk = campaignChunks[i];
      const latestParent = await storage.getGenerationJob(parentJobId);
      if (!latestParent || (latestParent as any).status === JOB_STATUS.CANCELLED) {
        await storage.updateGenerationJob(parentJobId, { status: JOB_STATUS.CANCELLED as any, completedAt: new Date() } as any).catch(() => {});
        return;
      }
      await storage.updateGenerationJob(parentJobId, { settings: { ...(((latestParent as any).settings || {}) as AnyJob), currentBlueprintIndex: i, currentBlueprintId: chunk.blueprintId, currentChunkIndex: i + 1, childChunkCount: campaignChunks.length, childJobs } as any } as any);
      const childSettings = { ...settings.childBaseSettings, services: chunk.services, cities: chunk.cities ?? settings.childBaseSettings?.cities, states: chunk.states ?? settings.childBaseSettings?.states, blueprintId: chunk.blueprintId, progress: normalizeProgress(chunk.services), jobType: "bulk-background-child", parentJobId, campaignBlueprintIndex: i + 1, campaignBlueprintTotal: campaignChunks.length, multiBlueprintCampaign: blueprintIds.length > 1, namespaceBlueprintSlug: blueprintIds.length > 1, targetCount: chunk.targetCount, chunkIndex: i + 1, chunkTotal: campaignChunks.length } as any;
      const childJob = await storage.createGenerationJob({ accountId: (parentJob as any).accountId, websiteId: (parentJob as any).websiteId, blueprintId: chunk.blueprintId, name: \`Bulk campaign chunk \\${i + 1}/\\${campaignChunks.length}\`, status: JOB_STATUS.PENDING, totalPages: chunk.totalPages, processedPages: 0, passedPages: 0, failedPages: 0, errorLog: [], settings: childSettings } as any);
      childJobs.push({ id: childJob.id, blueprintId: chunk.blueprintId, index: i + 1, total: campaignChunks.length, totalPages: chunk.totalPages, status: "running" });
      try { await runBulkBackgroundJob(childJob.id); }
      catch (error: any) { childJobs[childJobs.length - 1] = { ...childJobs[childJobs.length - 1], status: "failed", error: error?.message || "Child chunk failed" }; throw error; }
      const finishedChild = await storage.getGenerationJob(childJob.id);
      const childProcessed = Number((finishedChild as any)?.processedPages || chunk.totalPages || 0);
      const childPassed = Number((finishedChild as any)?.passedPages || 0);
      const childFailed = Number((finishedChild as any)?.failedPages || 0);
      processedPages += childProcessed; passedPages += childPassed; failedPages += childFailed;
      childJobs[childJobs.length - 1] = { ...childJobs[childJobs.length - 1], status: (finishedChild as any)?.status || "completed" };
      await storage.updateGenerationJob(parentJobId, { processedPages, passedPages, failedPages, settings: { ...(((await storage.getGenerationJob(parentJobId)) as any)?.settings || {}), currentBlueprintIndex: i + 1, completedBlueprints: i + 1, completedChunks: i + 1, childJobs } as any } as any);
    }

    await storage.updateGenerationJob(parentJobId, {
      status: JOB_STATUS.COMPLETED as any,`);
  await writeFile(file, source);
}

async function buildAll() {
  await rm("dist", { recursive: true, force: true });
  await patchBulkGeneratorForMaxPages();
  await patchBulkGeneratorUiToBackendCampaign();
  await patchBackendCampaignChunking();
  console.log("building client...");
  await viteBuild();
  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));
  await esbuild({ entryPoints: ["server/index.ts"], platform: "node", bundle: true, format: "cjs", outfile: "dist/index.cjs", define: { "process.env.NODE_ENV": '"production"' }, minify: true, external: externals, logLevel: "info" });
}

buildAll().catch((err) => { console.error(err); process.exit(1); });
