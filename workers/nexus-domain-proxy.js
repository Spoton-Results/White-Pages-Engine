export default {
  async fetch(request, env) {
    const origin = env.NEXUS_ORIGIN || "https://sospages.replit.app";
    const url = new URL(request.url);

    // For Cloudflare for SaaS custom hostnames, CF sets the CF-Custom-Hostname header
    // to the real client hostname (e.g. pages.subdraw.com).
    // request.cf.hostname is also set but may reflect the fallback origin hostname.
    // Priority: CF-Custom-Hostname > request.cf.hostname > Host header > URL hostname
    const clientHost =
      request.headers.get("CF-Custom-Hostname") ||
      request.cf?.hostname ||
      request.headers.get("host") ||
      url.hostname;

    const targetUrl = `${origin}${url.pathname}${url.search}`;

    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", clientHost);
    headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
    // X-Nexus-Host survives Replit's ingress rewriting of X-Forwarded-Host
    headers.set("X-Nexus-Host", clientHost);
    headers.set("host", new URL(origin).hostname);
    headers.delete("CF-Connecting-IP");

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  },
};
