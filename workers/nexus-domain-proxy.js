// Nexus Domain Proxy — Cloudflare Worker
// Routes client-domain requests to the Nexus origin (sospages.replit.app) and
// caches HTML page responses at the Cloudflare edge for 1 hour.
//
// Why Cache-Control is overridden here:
//   Replit's infrastructure injects a Set-Cookie tracking header (GAESA) on
//   every response. Any Set-Cookie forces Cache-Control to "private" by the
//   HTTP spec, making CDN caching impossible. The Worker strips that cookie
//   and resets the header to "public" so Cloudflare can cache the response.
//
// Caching rules:
//   GET /any-page-slug  → edge cached for 1 hour (s-maxage=3600)
//   GET /api/*          → never cached (live data)
//   GET /sites/*        → never cached (admin previews)
//   POST / non-GET      → never cached, proxied directly

export default {
  async fetch(request, env, ctx) {
    const origin = env.NEXUS_ORIGIN || "https://sospages.replit.app";
    const url = new URL(request.url);

    // Resolve the real client-facing hostname.
    const clientHost =
      request.headers.get("CF-Custom-Hostname") ||
      request.cf?.hostname ||
      request.headers.get("host") ||
      url.hostname;

    // Only cache GET/HEAD requests for non-API, non-admin paths.
    const isGet = request.method === "GET" || request.method === "HEAD";
    const isApi = url.pathname.startsWith("/api/");
    const isAdminSite = url.pathname.startsWith("/sites/");
    const shouldCache = isGet && !isApi && !isAdminSite;

    // ── Edge cache check ─────────────────────────────────────────────────────
    if (shouldCache) {
      const cached = await caches.default.match(request);
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

    // ── Proxy to Nexus origin ────────────────────────────────────────────────
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

    // ── Fix Replit-injected headers that break caching ───────────────────────
    // Replit injects Set-Cookie: GAESA (analytics) on every response.
    // That cookie forces Cache-Control: private, killing CDN caching.
    // For public SEO pages we strip the cookie and restore public caching.
    if (shouldCache && response.status === 200) {
      responseHeaders.delete("Set-Cookie");
      responseHeaders.set(
        "Cache-Control",
        "public, max-age=60, s-maxage=3600, stale-while-revalidate=60"
      );
      responseHeaders.set("X-Edge-Cache", "MISS");

      const toCache = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });

      // Store in edge cache without blocking the response to the user
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
