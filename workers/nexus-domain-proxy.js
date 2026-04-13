/**
 * Nexus Domain Proxy — Cloudflare Worker
 *
 * Deploy this once on Cloudflare. Each client then CNAMEs their domain to
 * the Worker's custom domain (e.g. proxy.spotonnexus.com). The Worker
 * captures the original hostname and forwards it to the Nexus platform
 * as X-Forwarded-Host, which the Nexus domain middleware reads to serve
 * the correct client's pages.
 *
 * Client DNS setup (one-time, no Replit configuration needed):
 *   subdraw.com  CNAME  proxy.spotonnexus.com
 *   OR point to the Worker's *.workers.dev URL for testing
 *
 * Env vars (set in Cloudflare Worker settings):
 *   NEXUS_ORIGIN  — the platform's deployment URL, e.g. https://sospages.replit.app
 */

const NEXUS_ORIGIN = typeof NEXUS_ORIGIN_ENV !== "undefined"
  ? NEXUS_ORIGIN_ENV
  : "https://sospages.replit.app";

export default {
  async fetch(request, env) {
    const origin = env.NEXUS_ORIGIN || NEXUS_ORIGIN;
    const url = new URL(request.url);

    // The original client-facing hostname (e.g. subdraw.com)
    const clientHost = url.hostname;

    // Build the forwarded URL — same path/query, different host
    const targetUrl = `${origin}${url.pathname}${url.search}`;

    // Copy all incoming headers, then set the host-forwarding headers
    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", clientHost);
    headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
    headers.delete("CF-Connecting-IP"); // strip Cloudflare internal header

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    });

    // Pass response through, adding CORS permissiveness if needed
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  },
};
