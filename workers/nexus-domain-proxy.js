// Nexus Domain Proxy — Cloudflare Worker
//
// Purpose:
//   Let SpotOn Nexus serve SEO white-page URLs on customer-owned subdomains
//   without adding every customer domain to Railway.
//
// Final request flow:
//   pages.clientdomain.com/some-slug
//      -> Cloudflare Custom Hostname / Worker
//      -> Railway origin
//      -> Nexus resolves by X-Nexus-Host + pathname slug
//
// Required Worker variable:
//   NEXUS_ORIGIN = https://white-pages-engine-production.up.railway.app
//   Optional safer origin later: https://origin.spotonresults.com
//
// What gets cached:
//   GET/HEAD SEO pages, sitemap XML, robots.txt
//
// What never caches:
//   /api/*, /sites/*, admin/static app paths, and non-GET requests

function resolveClientHost(request, url) {
  return (
    request.headers.get("CF-Custom-Hostname") ||
    request.headers.get("X-Forwarded-Host") ||
    request.headers.get("X-Original-Host") ||
    request.headers.get("host") ||
    url.hostname
  ).toLowerCase();
}

function shouldCacheRequest(request, url) {
  const isRead = request.method === "GET" || request.method === "HEAD";
  if (!isRead) return false;

  const path = url.pathname;
  if (path.startsWith("/api/")) return false;
  if (path.startsWith("/sites/")) return false;
  if (path.startsWith("/assets/")) return false;
  if (path.startsWith("/@vite") || path.startsWith("/src/")) return false;
  if (path === "/favicon.ico") return true;

  return true;
}

function buildForwardHeaders(request, originUrl, clientHost, url) {
  const headers = new Headers(request.headers);

  // These are the critical headers Nexus uses to map hostname -> website/client domain.
  headers.set("X-Nexus-Host", clientHost);
  headers.set("X-Forwarded-Host", clientHost);
  headers.set("X-Original-Host", clientHost);
  headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
  headers.set("X-Nexus-Edge", "cloudflare-worker");

  // Railway origin must receive the Railway/origin host, not the customer hostname.
  headers.set("host", originUrl.hostname);

  // Avoid forwarding Cloudflare-only client IP header into the origin request.
  headers.delete("CF-Connecting-IP");

  return headers;
}

export default {
  async fetch(request, env) {
    const origin = env.NEXUS_ORIGIN || "https://white-pages-engine-production.up.railway.app";
    const originUrl = new URL(origin);
    const url = new URL(request.url);
    const clientHost = resolveClientHost(request, url);
    const shouldCache = shouldCacheRequest(request, url);

    const targetUrl = new URL(originUrl.toString());
    targetUrl.pathname = url.pathname;
    targetUrl.search = url.search;

    const cfOptions = shouldCache
      ? {
          cacheEverything: true,
          cacheTtlByStatus: {
            "200-299": 3600,
            "300-399": 60,
            "400-499": 0,
            "500-599": 0,
          },
          cacheKey: `${clientHost}${url.pathname}${url.search}`,
        }
      : {};

    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: buildForwardHeaders(request, originUrl, clientHost, url),
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
      cf: cfOptions,
    });

    const responseHeaders = new Headers(response.headers);

    if (shouldCache) {
      // Never allow cookies from the origin to poison public SEO cache.
      responseHeaders.delete("Set-Cookie");

      if (response.status >= 200 && response.status < 300) {
        responseHeaders.set(
          "Cache-Control",
          "public, max-age=60, s-maxage=3600, stale-while-revalidate=60"
        );
      }
    } else {
      responseHeaders.set("Cache-Control", "no-store");
    }

    responseHeaders.set("X-Nexus-Proxied-Host", clientHost);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
