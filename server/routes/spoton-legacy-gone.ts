import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db";

const router = Router();
const ROOT = "spotonresults.com";
const PAGES = "pages.spotonresults.com";

function requestHost(req: Request) {
  return String(req.headers["x-nexus-host"] || req.headers["x-forwarded-host"] || req.headers.host || "")
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

function extractSlug(path: string) {
  return decodeURIComponent(path.replace(/^\/+/, "").replace(/^pages\//, "")).trim();
}

function isLegacyMerchantServiceSlug(slug: string) {
  const inIdx = slug.lastIndexOf("-in-");
  if (inIdx < 1) return false;
  const serviceSlug = slug.slice(0, inIdx);
  return [
    "ach",
    "card-reader",
    "chargeback",
    "chip-card",
    "contactless",
    "emv",
    "merchant-account",
    "merchant-services",
    "mobile-payment",
    "nfc",
    "payment-processing",
    "payment-solutions",
    "point-of-sale",
    "pos-systems",
    "retail-point-of-sale",
  ].some((marker) => serviceSlug.includes(marker));
}

async function hasCurrentSpotOnPage(slug: string) {
  const pageResult = await pool.query(
    `WITH spoton_websites AS (
       SELECT id
       FROM websites
       WHERE lower(domain) IN ($1, $2)
          OR lower(settings->>'parentDomain') IN ($1, $2)
          OR lower(settings->>'publicDomain') IN ($1, $2)
          OR lower(settings->>'legacyParentDomain') = $2
     )
     SELECT p.id
     FROM pages p
     JOIN spoton_websites w ON p.website_id::text = w.id::text
     WHERE p.slug = $3
       AND p.status = 'published'
     LIMIT 1`,
    [PAGES, ROOT, slug]
  );
  return pageResult.rowCount > 0;
}

router.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const h = requestHost(req);
    if (h !== PAGES && h !== ROOT) return next();
    const path = req.path || "/";
    if (path.startsWith("/api/") || path.startsWith("/assets") || path === "/favicon.ico" || path === "/robots.txt" || path.endsWith(".xml")) return next();
    const slug = extractSlug(path);
    if (!slug || !isLegacyMerchantServiceSlug(slug)) return next();
    if (await hasCurrentSpotOnPage(slug)) return next();
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-SpotOn-Legacy-URL", "gone");
    return res.status(410).type("text/plain").send("Legacy SpotOn Results page removed");
  } catch (err) {
    return next(err);
  }
});

export default router;
