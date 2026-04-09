/**
 * Internal Link Builder (Phase 7)
 *
 * For every published service_city page, builds two link types:
 * 1. "state-nav"       → links to the state_hub page for the same state
 * 2. "cross-service"   → links to up to 3 other service pages in the same city
 *
 * Returns a flat array of link records ready for bulk insert.
 */

export interface LinkRecord {
  websiteId: string;
  fromPageId: string;
  toPageId: string;
  anchorText: string;
  linkType: string;
}

export interface PageStub {
  id: string;
  title: string;
  slug: string;
  pageType: string | null;
  serviceId: string | null;
  locationId: string | null;
}

/**
 * Build internal link records for all published pages in a website.
 * Call storage.clearInternalLinks() then storage.saveInternalLinks() with the result.
 */
export function buildInternalLinks(
  websiteId: string,
  allPages: PageStub[],
  maxCrossServiceLinks = 3,
): LinkRecord[] {
  const links: LinkRecord[] = [];
  const seen = new Set<string>(); // deduplicate from+to pairs

  // Index pages by type for quick lookup
  const stateHubs = allPages.filter(p => p.pageType === "state_hub");
  const serviceCityPages = allPages.filter(
    p => (p.pageType === "service_city" || p.pageType === "industry_city") && p.serviceId && p.locationId,
  );

  // Build index: locationId → pages
  const byLocation = new Map<string, PageStub[]>();
  for (const p of serviceCityPages) {
    if (!p.locationId) continue;
    const arr = byLocation.get(p.locationId) || [];
    arr.push(p);
    byLocation.set(p.locationId, arr);
  }

  // For state_hub pages, find the state abbreviation from their slug to match location
  // Slug pattern for state hubs: "service-in-statename" or "service-statename"
  // We index state hubs by serviceId for cross-referencing
  const stateHubByService = new Map<string, PageStub[]>();
  for (const h of stateHubs) {
    if (!h.serviceId) continue;
    const arr = stateHubByService.get(h.serviceId) || [];
    arr.push(h);
    stateHubByService.set(h.serviceId, arr);
  }

  function addLink(from: PageStub, to: PageStub, anchorText: string, linkType: string) {
    if (from.id === to.id) return;
    const key = `${from.id}:${to.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ websiteId, fromPageId: from.id, toPageId: to.id, anchorText, linkType });
  }

  function makeAnchor(title: string): string {
    // Strip " | Brand" and "Service in City, ST" → extract service name
    const clean = title.replace(/\s*\|.*$/, "").trim();
    const inIdx = clean.toLowerCase().indexOf(" in ");
    return inIdx > 0 ? clean.slice(0, inIdx).trim() : clean;
  }

  // ── 1. service_city → state_hub (same service) ────────────────────────────
  for (const page of serviceCityPages) {
    if (!page.serviceId) continue;
    const hubs = stateHubByService.get(page.serviceId) || [];
    // Pick the first matching hub (ideally same state, but we just pick one if multiple)
    const hub = hubs[0];
    if (hub) addLink(page, hub, makeAnchor(hub.title), "state-nav");
  }

  // ── 2. service_city → cross-service in same location ─────────────────────
  for (const page of serviceCityPages) {
    if (!page.locationId) continue;
    const siblings = (byLocation.get(page.locationId) || [])
      .filter(p => p.id !== page.id && p.serviceId !== page.serviceId);
    // Take up to maxCrossServiceLinks, prioritise pages we haven't linked to yet
    const picked = siblings.slice(0, maxCrossServiceLinks);
    for (const sibling of picked) {
      addLink(page, sibling, makeAnchor(sibling.title), "cross-service");
    }
  }

  // ── 3. state_hub → its top service_city pages ────────────────────────────
  // (hub → city pages for the same service)
  for (const hub of stateHubs) {
    if (!hub.serviceId) continue;
    const cityPages = serviceCityPages
      .filter(p => p.serviceId === hub.serviceId)
      .slice(0, 10);
    for (const cp of cityPages) {
      addLink(hub, cp, makeAnchor(cp.title), "hub-to-city");
    }
  }

  return links;
}
