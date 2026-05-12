export const SPOTON_ROOT_DOMAIN = "spotonresults.com";
export const SPOTON_PAGES_DOMAIN = "pages.spotonresults.com";

export function hostOnly(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

export function normalizePublicWebsite(website: any) {
  if (!website) return website;
  const settings = website.settings || {};
  const hosts = [
    website.domain,
    settings.parentDomain,
    settings.publicDomain,
    settings.legacyParentDomain,
  ].map(hostOnly);

  if (hosts.includes(SPOTON_ROOT_DOMAIN) || hosts.includes(SPOTON_PAGES_DOMAIN)) {
    return {
      ...website,
      domain: SPOTON_PAGES_DOMAIN,
      settings: {
        ...settings,
        parentDomain: SPOTON_PAGES_DOMAIN,
        publicDomain: SPOTON_PAGES_DOMAIN,
        proxyPath: "",
        publicBasePath: "",
        legacyParentDomain: SPOTON_ROOT_DOMAIN,
        legacyProxyPath: "pages",
      },
    };
  }

  return website;
}

export function buildPublicPageUrl(website: any, slug: string): string | null {
  if (!website || !slug) return null;
  const normalized = normalizePublicWebsite(website);
  const settings = normalized.settings || {};
  const domain = hostOnly(settings.publicDomain || settings.parentDomain || normalized.domain);
  const proxyPath = String(settings.proxyPath || "").trim().replace(/^\/+|\/+$/g, "");
  const cleanSlug = String(slug || "").replace(/^\/+/, "");
  return proxyPath ? `https://${domain}/${proxyPath}/${cleanSlug}` : `https://${domain}/${cleanSlug}`;
}
