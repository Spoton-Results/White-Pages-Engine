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

function esc(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function render(page: any, content: string) {
  const title = page.title || page.h1 || page.slug;
  const desc = page.meta_description || page.metaDescription || "";
  const canonical = `https://${PAGES}/${page.slug}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(title)}</title><meta name="description" content="${esc(desc)}"/><link rel="canonical" href="${canonical}"/><style>body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;background:#f8fafc;color:#0f172a;line-height:1.65}.hero{background:linear-gradient(135deg,#2563eb,#0f172a);color:white;padding:56px 20px}.wrap{max-width:1100px;margin:0 auto}.hero h1{font-size:clamp(34px,5vw,58px);line-height:1.05;margin:0 0 16px}.hero p{font-size:20px;max-width:760px;opacity:.92}.content{max-width:1100px;margin:42px auto;padding:clamp(24px,4vw,48px);background:white;border:1px solid #e2e8f0;border-radius:24px;box-shadow:0 18px 45px rgba(15,23,42,.08)}h2{font-size:30px;line-height:1.2;margin:34px 0 12px}h3{font-size:22px;margin:28px 0 10px}a{color:#2563eb}</style></head><body><section class="hero"><div class="wrap"><h1>${esc(page.h1 || title)}</h1>${desc ? `<p>${esc(desc)}</p>` : ""}</div></section><main class="content">${content || `<p>${esc(desc || title)}</p>`}</main></body></html>`;
}

function isSkippablePath(path: string) {
  return path.startsWith("/api")
    || path.startsWith("/assets")
    || path.startsWith("/@vite")
    || path.startsWith("/src/")
    || path === "/favicon.ico";
}

async function getPublishedPage(slug: string) {
  const pageResult = await pool.query(
    `WITH spoton_websites AS (
       SELECT id, domain, settings, updated_at
       FROM websites
       WHERE lower(domain) IN ($1, $2)
          OR lower(settings->>'parentDomain') IN ($1, $2)
          OR lower(settings->>'publicDomain') IN ($1, $2)
          OR lower(settings->>'legacyParentDomain') = $2
     )
     SELECT p.*
     FROM pages p
     JOIN spoton_websites w ON p.website_id::text = w.id::text
     WHERE p.slug = $3
       AND p.status = 'published'
     ORDER BY
       CASE WHEN lower(w.domain) = $1 THEN 0 ELSE 1 END,
       p.published_at DESC NULLS LAST,
       p.updated_at DESC NULLS LAST,
       w.updated_at DESC NULLS LAST
     LIMIT 1`,
    [PAGES, ROOT, slug]
  );
  return pageResult.rows[0] || null;
}

router.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const h = requestHost(req);
    if (h !== PAGES && h !== ROOT) return next();

    const path = req.path || "/";
    if (isSkippablePath(path)) return next();

    const slug = decodeURIComponent(path.replace(/^\/+/, "").replace(/^pages\//, ""));
    if (!slug || slug === "robots.txt" || slug.endsWith(".xml")) return next();

    const page = await getPublishedPage(slug);
    if (!page) return next();

    if (h === ROOT) {
      return res.redirect(301, `https://${PAGES}/${slug}`);
    }

    const versionResult = await pool.query(
      `SELECT * FROM page_versions WHERE page_id::text = $1::text ORDER BY is_active DESC NULLS LAST, version DESC NULLS LAST, created_at DESC NULLS LAST LIMIT 1`,
      [page.id]
    );
    const version = versionResult.rows[0] || {};
    const content = version.content_html || version.contentHtml || page.content_html || page.contentHtml || page.html || page.body || "";

    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=60");
    return res.type("html").send(render(page, content));
  } catch (err) {
    return next(err);
  }
});

export default router;
