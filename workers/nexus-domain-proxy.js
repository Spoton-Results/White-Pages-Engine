// Nexus Domain Proxy — Cloudflare Worker
// Routes client-domain requests to the Nexus origin (sospages.replit.app) and
// caches HTML page responses at the Cloudflare edge for 1 hour.
//
// Caching logic:
//   GET /any-page-slug        → checked in CF edge cache → served or fetched + cached
//   GET /api/*                → never cached (dynamic data)
//   GET /sitemap*.xml         → cached (1 hour, same as pages)
//   GET /robots.txt           → cached
//   POST / non-GET            → never cached, proxied directly

export default {
  async fetch(request, env, ctx) {
    const origin = env.NEXUS_ORIGIN || "https://sospages.replit.app";
    const url = new URL(request.url);

    // Resolve the real client-facing hostname.
    // CF-Custom-Hostname is set by Cloudflare for SaaS when a custom domain hits the fallback origin.
    const clientHost =
      request.headers.get("CF-Custom-Hostname") ||
      request.cf?.hostname ||
      request.headers.get("host") ||
      url.hostname;

    // Decide whether this request is eligible for edge caching.
    // Only cache GET requests for non-API, non-admin paths.
    const isGet = request.method === "GET" || request.method === "HEAD";
    const isApi = url.pathname.startsWith("/api/");
    const isAdminSite = url.pathname.startsWith("/sites/");
    const isStaticAsset = /\.(js|css|woff2?|png|ico|webmanifest)(\?|$)/.test(url.pathname);
    const shouldCache = isGet && !isApi && !isAdminSite && !isStaticAsset;

    // ── Edge cache check ────────────────────────────────────────────────────
    if (shouldCache) {
      const cache = caches.default;
      const cached = await cache.match(request);
      if (cached) {
        const h = new Headers(cached.headers);
        h.set("X-Edge-Cache", "HIT");
        return new Response(cached.body, {
          status: cached.status,
          statusText: cached.statusText,
          headers: h,
        });
      }
    }

    // ── Proxy to Nexus origin ───────────────────────────────────────────────
    const targetUrl = `${origin}${url.pathname}${url.search}`;
    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", clientHost);
    headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
    headers.set("X-Nexus-Host", clientHost);  // survives Replit ingress rewriting
    headers.set("host", new URL(origin).hostname);
    headers.delete("CF-Connecting-IP");

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: isGet ? undefined : request.body,
      redirect: "manual",
    });

    const responseHeaders = new Headers(response.headers);

    // ── Store in edge cache ─────────────────────────────────────────────────
    // Cache only 200 OK HTML responses (not 301/302/404/500).
    // Cloudflare honours the Cache-Control: s-maxage=3600 header Nexus sends,
    // meaning the edge entry lives for 1 hour before Cloudflare revalidates.
    if (shouldCache && response.status === 200) {
      responseHeaders.set("X-Edge-Cache", "MISS");
      const toCache = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
      // waitUntil: store in cache without blocking the response to the user
      ctx.waitUntil(caches.default.put(request, toCache.clone()));
      return toCache;
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
