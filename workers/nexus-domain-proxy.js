export default {
  async fetch(request, env) {
    const origin = env.NEXUS_ORIGIN || "https://sospages.replit.app";
    const url = new URL(request.url);

    // Cloudflare for SaaS puts the real custom hostname here (e.g. pages.subdraw.com)
    const clientHost = request.cf?.hostname || request.headers.get("host") || url.hostname;

    const targetUrl = `${origin}${url.pathname}${url.search}`;

    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", clientHost);
    headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
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
