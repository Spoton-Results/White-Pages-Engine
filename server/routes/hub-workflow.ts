import { Router, type Request, type Response, type NextFunction } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { requireAuth } from "../auth";
import { pool } from "../db";
import { generateFirstPass } from "../services/claude";
import { renderHubPageHtml, scoreHubPage, type HubType } from "../services/hub-pages";

const router = Router();
type HubJob = { websiteId: string; status: "running" | "done" | "error"; done: number; total: number; created: number; failed: number; error?: string };
const jobs = new Map<string, HubJob>();
const activeWebsites = new Set<string>();

async function authorizedWebsite(req: Request, res: Response) {
  const result = await pool.query("SELECT * FROM websites WHERE id::text = $1::text", [req.params.websiteId]);
  const website = result.rows[0];
  if (!website) { res.status(404).json({ error: "Website not found" }); return null; }
  if (req.session.isSuperAdmin !== true && req.session.accountId !== website.account_id) {
    res.status(403).json({ error: "Forbidden: No access to this website" }); return null;
  }
  return website;
}

async function loadContext(client: any, website: any, hub: any) {
  const children = await client.query(
    `SELECT p.title, p.slug, p.quality_score AS "qualityScore", COALESCE(p.tier, 2) AS tier
     FROM pages p
     LEFT JOIN services s ON s.id = p.service_id AND s.account_id = $2
     LEFT JOIN locations l ON l.id = p.location_id AND l.account_id = $2
     WHERE p.website_id = $1 AND p.status = 'published' AND COALESCE(p.noindex, false) = false AND p.slug <> $3
       AND (($4 = 'service' AND (lower(s.name) = lower($5) OR s.slug = $3))
         OR ($4 = 'state' AND (lower(l.state_name) = lower($5) OR (l.type = 'state' AND (lower(l.name) = lower($5) OR l.slug = $3))))
         OR ($4 = 'city' AND l.type = 'city' AND (lower(l.name) = lower($5) OR l.slug = $3)))
     ORDER BY p.quality_score DESC NULLS LAST, COALESCE(p.tier, 2), p.updated_at DESC, p.id LIMIT $6`,
    [website.id, website.account_id, hub.slug, hub.hub_type, hub.name, Math.max(1, Math.min(hub.max_child_links || 30, 500))],
  );
  const brands = await client.query(
    `SELECT * FROM brand_profiles WHERE account_id = $1
     ORDER BY CASE WHEN id::text = COALESCE($2::text, '') THEN 0 ELSE 1 END, updated_at DESC NULLS LAST, id LIMIT 1`,
    [website.account_id, website.brand_profile_id || null],
  );
  const b = brands.rows[0];
  const brand = { name: b?.name || website.name, primaryColor: b?.primary_color || undefined,
    phone: b?.phone_override || b?.phone || website.settings?.phone || undefined,
    description: b?.description || undefined, tagline: b?.tagline || undefined, voiceAndTone: b?.voice_and_tone || undefined,
    customFields: { ...(b?.custom_fields || {}), websiteUrl: b?.website_url || website.settings?.mainWebsiteUrl || "" } };
  return { childLinks: children.rows, brand };
}

async function ensureHub(website: any, hubType: HubType, name: string, slug: string, maxChildLinks: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`hub-create:${website.id}:${slug}`]);
    const owner = await client.query("SELECT id FROM websites WHERE id = $1 AND account_id = $2 FOR SHARE", [website.id, website.account_id]);
    if (!owner.rows.length) throw new Error("Website ownership changed");
    const existing = await client.query(
      `SELECT * FROM hub_pages WHERE website_id = $1 AND slug = $2
       ORDER BY (NULLIF(btrim(content), '') IS NOT NULL) DESC, updated_at DESC, id ASC LIMIT 1`, [website.id, slug],
    );
    let hub = existing.rows[0];
    if (hub && (hub.account_id !== website.account_id || hub.hub_type !== hubType)) throw new Error("Hub slug conflicts with another account or hub type");
    if (!hub) {
      const inserted = await client.query(
        `INSERT INTO hub_pages (website_id, account_id, hub_type, name, slug, max_child_links, status, content)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft', NULL) RETURNING *`,
        [website.id, website.account_id, hubType, name, slug, maxChildLinks],
      );
      hub = inserted.rows[0];
    }
    await client.query("COMMIT");
    return hub;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {}); throw error;
  } finally { client.release(); }
}

async function generateHub(website: any, hubId: string) {
  const client = await pool.connect();
  let lockKey: string | undefined;
  try {
    const found = await client.query(
      `SELECT h.*, h.xmin::text AS revision FROM hub_pages h JOIN websites w ON w.id = h.website_id AND w.account_id = h.account_id
       WHERE h.id::text = $1::text AND w.id = $2 AND w.account_id = $3`, [hubId, website.id, website.account_id],
    );
    const hub = found.rows[0];
    if (!hub) throw new Error("Hub not found in this website");
    if (!["service", "state", "city"].includes(hub.hub_type)) throw new Error("Invalid hub type");
    const key = `hub-generate:${website.id}:${hub.slug}`;
    const locked = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [key]);
    if (!locked.rows[0]?.acquired) throw new Error("This hub is already generating; wait before retrying");
    lockKey = key;
    const collision = await client.query("SELECT id FROM pages WHERE website_id = $1 AND slug = $2 AND status = 'published' LIMIT 1", [website.id, hub.slug]);
    if (collision.rows.length) throw new Error("A regular published page already uses this slug; choose a different hub slug");
    const { childLinks, brand } = await loadContext(client, website, hub);
    const generated = await generateFirstPass({
      blueprintName: `${hub.name} Hub`, pageType: `${hub.hub_type}_hub`, promptFamily: "hub",
      titleTemplate: `${hub.name} | {brand}`, metaDescTemplate: `${hub.name}: information and related pages from {brand}.`,
      h1Template: hub.name, slugTemplate: hub.slug, requiredWordCount: 750, faqEnabled: true,
      serviceName: hub.hub_type === "service" ? hub.name : undefined,
      locationName: hub.hub_type === "city" ? hub.name : undefined,
      locationState: hub.hub_type === "state" ? hub.name : undefined,
      industryName: website.primary_industry || undefined,
      brandName: brand.name, brandDescription: brand.description, brandPhone: brand.phone,
      brandTagline: brand.tagline, brandVoiceAndTone: brand.voiceAndTone,
      primaryKeyword: hub.name, secondaryKeywords: childLinks.slice(0, 5).map((child: any) => child.title),
      sections: [
        { name: "Overview", description: `Explain ${hub.name} for readers exploring their options. Use only supplied business facts; do not invent company claims or local coverage.` },
        { name: "What to consider", description: "Explain relevant process, limitations, and practical selection criteria without fabricated pricing or credentials." },
        { name: "Related pages", description: `There are ${childLinks.length} matching published child pages. Do not claim additional locations or services. If there are none, do not invent any.` },
        { name: "FAQ", description: "Answer four useful questions relevant to this hub." },
        { name: "Next steps", description: "Guide readers using the supplied business details and related pages only." },
      ],
    });
    if (!generated.contentHtml?.replace(/<[^>]*>/g, " ").trim()) throw new Error("AI returned empty content");
    if (/<\s*(?:script|iframe|object|embed|form)\b|\son[a-z]+\s*=|javascript\s*:/i.test(generated.contentHtml)) throw new Error("AI returned unsafe markup; existing content was preserved");
    const faqItems = Array.isArray(generated.faqItems) ? generated.faqItems.filter(item => item && typeof item.question === "string" && typeof item.answer === "string") : [];
    const html = renderHubPageHtml({ hubType: hub.hub_type, name: hub.name, slug: hub.slug, parentSlug: hub.parent_slug,
      metaDescription: generated.metaDescription || hub.meta_description, childLinks,
      website: { domain: website.domain, settings: website.settings || {} }, brand, aiContentHtml: generated.contentHtml, faqItems });
    const score = scoreHubPage(generated, childLinks);
    const saved = await client.query(
      `UPDATE hub_pages h SET content = $1, meta_description = $2, quality_score = $3, tier = $4, status = 'published', updated_at = NOW()
       WHERE h.id::text = $5::text AND h.website_id = $6 AND h.account_id = $7 AND h.xmin::text = $8
         AND EXISTS (SELECT 1 FROM websites w WHERE w.id = h.website_id AND w.account_id = h.account_id)
         AND NOT EXISTS (SELECT 1 FROM pages p WHERE p.website_id = h.website_id AND p.slug = h.slug AND p.status = 'published') RETURNING h.id`,
      [html, generated.metaDescription || hub.meta_description, score.qualityScore, score.tier, hubId, website.id, website.account_id, hub.revision],
    );
    if (saved.rows.length !== 1) throw new Error("Hub was deleted or changed during generation, or its slug now conflicts; no content was overwritten");
    return { contentSaved: true, published: true, childCount: childLinks.length, id: hubId };
  } finally {
    if (lockKey) {
      try { await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey]); }
      catch (error) { client.release(true); throw error; }
    }
    client.release();
  }
}

router.post("/api/websites/:websiteId/hub-pages/bulk-generate", requireAuth, async (req: Request, res: Response) => {
  try {
    const website = await authorizedWebsite(req, res); if (!website) return;
    const namesSchema = z.array(z.string().trim().min(1).max(500)).max(5000).default([]);
    const parsed = z.object({ hubType: z.enum(["service", "state", "city"]), services: namesSchema, states: namesSchema, cities: namesSchema,
      maxChildLinks: z.number().int().min(1).max(500).default(30), generateAI: z.boolean().default(false) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const input = parsed.data;
    const names = new Map<string, string>();
    for (const name of input.hubType === "service" ? input.services : input.hubType === "state" ? input.states : input.cities) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      if (!slug || (names.has(slug) && names.get(slug) !== name)) return res.status(400).json({ error: "Selected names contain an empty or ambiguous slug" });
      names.set(slug, name);
    }
    if (!names.size) return res.status(400).json({ error: "No hub names selected" });
    if (activeWebsites.has(website.id)) return res.status(409).json({ error: "Hub generation is already running for this website" });
    if (jobs.size >= 100) return res.status(503).json({ error: "Hub job history is full; retry after older jobs expire" });
    const jobId = randomBytes(8).toString("hex");
    const job: HubJob = { websiteId: website.id, status: "running", done: 0, total: names.size, created: 0, failed: 0 };
    jobs.set(jobId, job); activeWebsites.add(website.id);
    setImmediate(async () => {
      try {
        for (const [slug, name] of names) {
          try {
            const hub = await ensureHub(website, input.hubType, name, slug, input.maxChildLinks);
            if (input.generateAI) await generateHub(website, hub.id);
            job.created++;
          } catch (error: any) {
            job.failed++; job.error ||= error?.message || "Hub generation failed";
            console.error("[hub-workflow] item failed:", { websiteId: website.id, slug, error });
          } finally { job.done++; }
        }
      } catch (error: any) {
        job.failed += job.total - job.done; job.done = job.total; job.error ||= error?.message || "Hub job interrupted";
        console.error("[hub-workflow] job failed:", error);
      } finally {
        job.status = job.failed ? "error" : "done"; activeWebsites.delete(website.id);
        setTimeout(() => jobs.delete(jobId), 60 * 60 * 1000).unref();
      }
    });
    return res.status(202).json({ jobId });
  } catch (error: any) { console.error("[hub-workflow] start failed:", error); return res.status(500).json({ error: "Failed to start hub generation" }); }
});

router.get("/api/websites/:websiteId/hub-pages/bulk-job/:jobId", requireAuth, async (req: Request, res: Response) => {
  try {
    const website = await authorizedWebsite(req, res); if (!website) return;
    const job = jobs.get(req.params.jobId);
    if (!job || job.websiteId !== website.id) return res.status(404).json({ status: "error", done: 0, total: 0, created: 0, failed: 0,
      error: "Hub job not found for this website. The server may have restarted; check saved hubs before retrying." });
    return res.json(job);
  } catch (error) { console.error("[hub-workflow] status failed:", error); return res.status(500).json({ error: "Failed to load hub job" }); }
});

router.post("/api/websites/:websiteId/hub-pages/:hubId/generate", requireAuth, async (req: Request, res: Response) => {
  try {
    const website = await authorizedWebsite(req, res); if (!website) return;
    if (activeWebsites.has(website.id)) return res.status(409).json({ message: "Hub generation is already running for this website" });
    activeWebsites.add(website.id);
    try { return res.json(await generateHub(website, req.params.hubId)); }
    finally { activeWebsites.delete(website.id); }
  } catch (error: any) { console.error("[hub-workflow] generation failed:", error); return res.status(500).json({ message: error?.message || "Hub generation failed" }); }
});

async function serveHub(domain: string, slug: string, res: Response) {
  const candidates = [...new Set([domain, domain.replace(/^(pages|page|seo|local)\./, "")])];
  const sites = await pool.query(
    `SELECT * FROM websites WHERE lower(domain) = ANY($1::text[]) OR lower(settings->>'parentDomain') = ANY($1::text[])
       OR lower(settings->>'publicDomain') = ANY($1::text[]) OR lower(settings->>'legacyParentDomain') = ANY($1::text[])
     ORDER BY CASE WHEN lower(domain) = $2 THEN 0 ELSE 1 END, updated_at DESC NULLS LAST, id LIMIT 1`, [candidates, domain],
  );
  const website = sites.rows[0]; if (!website) return false;
  const pages = await pool.query("SELECT id FROM pages WHERE website_id = $1 AND slug = $2 AND status = 'published' LIMIT 1", [website.id, slug]);
  if (pages.rows.length) return false;
  const hubs = await pool.query(
    `SELECT h.* FROM hub_pages h WHERE h.website_id = $1 AND h.account_id = $2 AND h.slug = $3
       AND h.status = 'published' AND NULLIF(btrim(h.content), '') IS NOT NULL ORDER BY h.updated_at DESC, h.id ASC LIMIT 1`,
    [website.id, website.account_id, slug],
  );
  const hub = hubs.rows[0]; if (!hub) return false;
  let html = hub.content;
  if (!/^\s*<!doctype html|^\s*<html[\s>]/i.test(html)) {
    if (!["service", "state", "city"].includes(hub.hub_type)) return false;
    const client = await pool.connect();
    try {
      const { childLinks, brand } = await loadContext(client, website, hub);
      html = renderHubPageHtml({ hubType: hub.hub_type, name: hub.name, slug: hub.slug, parentSlug: hub.parent_slug,
        metaDescription: hub.meta_description, childLinks, website: { domain: website.domain, settings: website.settings || {} }, brand, aiContentHtml: html });
    } finally { client.release(); }
  }
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("X-Nexus-Public-Renderer", "hub-workflow-v1");
  res.type("html").send(html); return true;
}

router.get("/sites/:domain/:slug", async (req: Request, res: Response, next: NextFunction) => {
  try { if (!await serveHub(String(req.params.domain).toLowerCase(), String(req.params.slug), res)) return next(); }
  catch (error) { return next(error); }
});

router.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const domain = String(req.headers["x-nexus-host"] || req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");
    if (!/^(pages|page|seo|local)\./.test(domain)) return next();
    const path = req.path || "/";
    if (/^\/(?:api|assets|sites)(?:\/|$)/.test(path) || path === "/" || path === "/robots.txt" || path.endsWith(".xml") || path === "/favicon.ico") return next();
    if (!await serveHub(domain, decodeURIComponent(path.replace(/^\/+/, "")), res)) return next();
  } catch (error) { return next(error); }
});

export default router;
