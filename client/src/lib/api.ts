const SPOTON_ROOT_DOMAIN = "spotonresults.com";
const SPOTON_PAGES_DOMAIN = "pages.spotonresults.com";

function hostOnly(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

function isSpotonWebsite(value: any): boolean {
  const settings = value?.settings || {};
  const hosts = [value?.domain, settings.parentDomain, settings.publicDomain, settings.legacyParentDomain].map(hostOnly);
  return hosts.includes(SPOTON_ROOT_DOMAIN) || hosts.includes(SPOTON_PAGES_DOMAIN);
}

function normalizeSpotonWebsite(value: any) {
  if (!value || typeof value !== "object" || !isSpotonWebsite(value)) return value;
  return {
    ...value,
    domain: SPOTON_PAGES_DOMAIN,
    settings: {
      ...(value.settings || {}),
      parentDomain: SPOTON_PAGES_DOMAIN,
      publicDomain: SPOTON_PAGES_DOMAIN,
      proxyPath: "",
      publicBasePath: "",
      legacyParentDomain: SPOTON_ROOT_DOMAIN,
      legacyProxyPath: "pages",
    },
  };
}

function shouldNormalizeWebsiteResponse(url: string): boolean {
  if (url === "/api/websites") return true;
  if (url.startsWith("/api/websites?")) return true;
  if (!url.startsWith("/api/websites/")) return false;
  const rest = url.slice("/api/websites/".length);
  return rest.length > 0 && !rest.includes("/") && !rest.includes("?");
}

function normalizeResponse<T>(url: string, data: T): T {
  if (!shouldNormalizeWebsiteResponse(url)) return data;
  if (Array.isArray(data)) return data.map(normalizeSpotonWebsite) as T;
  return normalizeSpotonWebsite(data) as T;
}

async function request<T>(method: string, url: string, body?: any): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || err.error || res.statusText || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json();
  return normalizeResponse<T>(url, data);
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body: any) => request<T>("POST", url, body),
  patch: <T>(url: string, body: any) => request<T>("PATCH", url, body),
  put: <T>(url: string, body: any) => request<T>("PUT", url, body),
  delete: <T>(url: string) => request<T>("DELETE", url),
};
