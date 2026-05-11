export default {
  async fetch(request) {
    const incomingUrl = new URL(request.url);
    const originalHost = incomingUrl.hostname;

    if (
      originalHost === "spotonresults.com" ||
      originalHost === "www.spotonresults.com"
    ) {
      return fetch(request);
    }

    const originUrl = new URL(request.url);
    originUrl.hostname = "origin.spotonresults.com";

    const headers = new Headers(request.headers);
    headers.set("x-nexus-host", originalHost);
    headers.set("x-forwarded-host", originalHost);
    headers.set("host", "origin.spotonresults.com");

    return fetch(originUrl.toString(), {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    });
  },
};
