export type BulkService = { id: string; name: string };
export type BulkBlueprint = { id: string; name: string; pageType: string; titleTemplate?: string; h1Template?: string; metadata?: unknown };
export type BulkCluster = { id: string; serviceId?: string | null; primaryKeyword: string };
export type BulkPair = { blueprintId: string; serviceId: string; serviceName: string; clusterId: string | null };
export const NO_BULK_CLUSTERS = "__NO_CLUSTERS__";

export function normalizeBulkText(value: string): string {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

export function blueprintServices(blueprint: BulkBlueprint, services: BulkService[]): BulkService[] {
  const name = normalizeBulkText(blueprint.name);
  const named = services.filter(service => {
    const prefix = normalizeBulkText(service.name);
    return service.id && prefix && (name === prefix || name.startsWith(prefix + " "));
  });
  const longest = Math.max(0, ...named.map(service => normalizeBulkText(service.name).length));
  const owners = named.filter(service => normalizeBulkText(service.name).length === longest);
  const metadata = blueprint.metadata && typeof blueprint.metadata === "object" ? blueprint.metadata as Record<string, unknown> : {};
  if (typeof metadata.serviceId === "string") {
    const explicit = services.filter(service => service.id === metadata.serviceId);
    if (explicit.length !== 1 || owners.length > 1 || (owners.length === 1 && owners[0].id !== explicit[0].id)) return [];
    return explicit;
  }
  if (owners.length === 1) return owners;
  if (owners.length > 1) return [];
  if (metadata.reusable === true && /\{service\}/i.test(blueprint.titleTemplate || "") && /\{service\}/i.test(blueprint.h1Template || "")) {
    return services.filter(service => service.id);
  }
  return [];
}

export function blueprintSupportsLocation(pageType: string, kind: "state" | "city"): boolean {
  if (["state_hub", "state_service", "industry_state"].includes(pageType)) return kind === "state";
  if (["city_hub", "service_city", "industry_city", "city_service_problem"].includes(pageType)) return kind === "city";
  return ["problem_intent", "service_problem", "comparison"].includes(pageType);
}

export function buildBulkPlan(input: {
  blueprints: BulkBlueprint[]; services: BulkService[]; selectedServices: string[];
  clusters: BulkCluster[]; clusterIds: string[] | null; locationType: "state" | "city";
}): { pairs: BulkPair[]; skipped: string[] } {
  const pairs: BulkPair[] = [];
  const skipped: string[] = [];
  const selected = new Set(input.selectedServices.map(normalizeBulkText));
  const ids = input.clusterIds === null ? null : new Set(input.clusterIds.filter(id => id !== NO_BULK_CLUSTERS));
  const seen = new Set<string>();
  const warn = (text: string) => { if (skipped.length < 50 && !skipped.includes(text)) skipped.push(text); };
  if (ids) {
    for (const id of ids) {
      const cluster = input.clusters.find(row => row.id === id);
      if (!cluster) warn(`Cluster ${id} does not belong to this account.`);
      else if (!cluster.serviceId) warn(`Cluster "${cluster.primaryKeyword}" needs a service assignment.`);
    }
  }
  for (const blueprint of input.blueprints) {
    if (!blueprintSupportsLocation(blueprint.pageType, input.locationType)) {
      warn(`Skipped ${blueprint.name}: incompatible ${input.locationType} target.`); continue;
    }
    const owners = blueprintServices(blueprint, input.services);
    if (!owners.length) { warn(`Skipped ${blueprint.name}: service assignment is missing or ambiguous.`); continue; }
    for (const service of owners.filter(row => selected.has(normalizeBulkText(row.name)))) {
      const clusters: Array<BulkCluster | null> = ids === null ? [null] : input.clusters.filter(row => ids.has(row.id) && row.serviceId === service.id && normalizeBulkText(row.primaryKeyword));
      if (!clusters.length) warn(`Skipped ${blueprint.name}: no selected clusters belong to ${service.name}.`);
      for (const cluster of clusters) {
        const key = [blueprint.id, service.id, cluster ? normalizeBulkText(cluster.primaryKeyword) : "base"].join("|");
        if (seen.has(key)) { warn(`Skipped duplicate cluster keyword for ${service.name}.`); continue; }
        seen.add(key);
        pairs.push({ blueprintId: blueprint.id, serviceId: service.id, serviceName: service.name, clusterId: cluster?.id || null });
      }
    }
  }
  return { pairs, skipped };
}
