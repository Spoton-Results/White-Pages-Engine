// Nexus Domain Proxy — Cloudflare Worker
// Routes client-domain requests to the Nexus origin (sospages.replit.app) and
// caches HTML page responses at the Cloudflare edge for 1 hour.
//
// Caching strategy:
//   Uses cf.cacheEverything + cf.cacheTtlByStatus on the subrequest so
//   Cloudflare's CDN caches the page at the edge automatically.
//   cf.cacheKey includes the original hostname so pages.client1.com and
//   pages.client2.com never share a cache entry even for the same path.
//
//   Replit injects Set-Cookie: GAESA on every response, which would
//   normally force Cache-Control: private. We strip it on the way out
//   so browsers and crawlers receive clean, cache-friendly responses.
//
// What gets cached:   GET /slug, /sitemap*.xml, /robots.txt  (1 hour)
// What never caches:  /api/*, /sites/*, POST/PUT/DELETE

export default {
  async fetch(request, env) {
    const origin = env.NEXUS_ORIGIN || "https://sospages.replit.app";
    const url = new URL(request.url);

    // Resolve the real client-facing hostname.
    const clientHost =
      request.headers.get("CF-Custom-Hostname") ||
      request.cf?.hostname ||
      request.headers.get("host") ||
      url.hostname;

    const isGet = request.method === "GET" || request.method === "HEAD";
    const isApi = url.pathname.startsWith("/api/");
    const isAdminSite = url.pathname.startsWith("/sites/");
    const shouldCache = isGet && !isApi && !isAdminSite;

    // Build forwarding headers
    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", clientHost);
    headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
    headers.set("X-Nexus-Host", clientHost);  // survives Replit ingress rewriting
    headers.set("host", new URL(origin).hostname);
    headers.delete("CF-Connecting-IP");

    const targetUrl = `${origin}${url.pathname}${url.search}`;

    // cf options: tell Cloudflare's CDN to cache this response at the edge.
    // cacheKey includes clientHost so different client domains never collide.
    const cfOptions = shouldCache
      ? {
          cacheEverything: true,
          cacheTtlByStatus: {
            "200-299": 3600,   // cache 200s for 1 hour
            "300-399": 60,     // cache redirects for 1 minute
            "400-499": 0,      // never cache 4xx
            "500-599": 0,      // never cache 5xx
          },
          cacheKey: `${clientHost}${url.pathname}${url.search}`,
        }
      : {};

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: isGet ? undefined : request.body,
      redirect: "manual",
      cf: cfOptions,
    });

    // Strip Replit's injected tracking cookie and restore public Cache-Control.
    // Replit adds Set-Cookie: GAESA which forces Cache-Control: private.
    // We remove it here so browsers and Google receive clean responses.
    const responseHeaders = new Headers(response.headers);
    if (shouldCache) {
      responseHeaders.delete("Set-Cookie");
      if (response.status === 200) {
        responseHeaders.set(
          "Cache-Control",
          "public, max-age=60, s-maxage=3600, stale-while-revalidate=60"
        );
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
