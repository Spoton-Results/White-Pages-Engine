export default async function middleware(request) {
  const clientHost = request.headers.get("host") || "";
  const url = new URL(request.url);
  const targetUrl = `https://sospages.replit.app${url.pathname}${url.search}`;

  const headers = new Headers(request.headers);
  headers.set("host", "sospages.replit.app");
  headers.set("x-forwarded-host", clientHost);
  headers.set("x-forwarded-proto", "https");

  return fetch(targetUrl, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? null : request.body,
    redirect: "manual",
  });
}

export const config = {
  matcher: ["/((?!_next).*)"],
};
