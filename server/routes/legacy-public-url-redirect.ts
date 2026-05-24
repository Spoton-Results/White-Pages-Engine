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

function extractQuery(req: Request) {
  const raw = req.originalUrl || req.url || "";
  const idx = raw.indexOf("?");
  return idx >= 0 ? raw.slice(idx) : "";
}

// Final Nexus public URL rule:
//   https://pages.clientdomain.com/slug
//
// Legacy/internal shape is no longer allowed as a final destination:
//   /sites/pages.clientdomain.com/slug
//
// This router makes the old shape self-heal everywhere, including admin UI buttons.
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();

  const path = req.path || "/";
  if (!path.startsWith("/sites/")) return next();

  // ✅ CHANGED: Admin preview requests (eyeball icon) originate from admin.* or localhost.
  // These must reach the page-serving Express route — NOT be redirected to the live domain.
  // 🔒 UNTOUCHED: all redirect logic below is identical for non-admin hosts.
  const requestHost = normalizePublicHost(req.headers.host || "");
  if (requestHost.startsWith("admin.") || requestHost.includes("localhost") || requestHost.includes("127.0.0.1")) {
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
