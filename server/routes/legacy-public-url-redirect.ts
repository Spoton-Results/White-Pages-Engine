import { Router, type Request, type Response, type NextFunction } from "express";

const router = Router();

function normalizePublicHost(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

function requestHost(req: Request) {
  return normalizePublicHost(
    req.headers["x-nexus-host"] ||
    req.headers["x-forwarded-host"] ||
    req.headers.host ||
    ""
  );
}

function extractQuery(req: Request) {
  const raw = req.originalUrl || req.url || "";
  const idx = raw.indexOf("?");
  return idx >= 0 ? raw.slice(idx) : "";
}

// Legacy preview shape:
//   https://admin.spotonnexus.com/sites/pages.clientdomain.com/some-slug
//
// Final public SEO shape:
//   https://pages.clientdomain.com/some-slug
//
// Important distinction:
// - On admin.spotonnexus.com, /sites/... is an INTERNAL PREVIEW route used by the eyeball icon.
// - On any public/customer host, /sites/... should never be indexable and should redirect cleanly.
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();

  const path = req.path || "/";
  if (!path.startsWith("/sites/")) return next();

  const currentHost = requestHost(req);
  if (currentHost === "admin.spotonnexus.com") {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "no-store");
    return next();
  }

  const remainder = path.replace(/^\/sites\//, "");
  const parts = remainder.split("/");
  const host = normalizePublicHost(decodeURIComponent(parts.shift() || ""));
  const slug = parts.join("/").replace(/^\/+/, "");

  if (!host || !host.includes(".") || !slug) return next();

  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
  return res.redirect(301, `https://${host}/${slug}${extractQuery(req)}`);
});

export default router;
