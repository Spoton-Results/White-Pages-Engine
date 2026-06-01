import { Router, type Request, type Response } from "express";
import { requireAuth } from "../auth";
import { pool } from "../db";

const router = Router();

function mapLocation(r: any) {
  return {
    ...r,
    accountId: r.account_id,
    stateCode: r.state_code,
    stateName: r.state_name,
    cityTier: r.city_tier,
    parentId: r.parent_id,
    createdAt: r.created_at,
  };
}

function slugify(value: any) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeLocationType(value: any) {
  const type = String(value || "city").toLowerCase();
  return ["state", "city", "county", "neighborhood"].includes(type) ? type : "city";
}

function cityTier(type: string, population: number | null) {
  if (type !== "city") return null;
  const pop = Number(population || 0);
  if (pop >= 500000) return 1;
  if (pop >= 100000) return 2;
  return 3;
}

function normalizeLocationInput(item: any) {
  const type = safeLocationType(item?.type);
  const name = String(item?.name || "").trim();
  const stateCode = String(item?.stateCode || item?.state_code || "").trim().toUpperCase();
  const stateName = String(item?.stateName || item?.state_name || "").trim();
  const population = Number.isFinite(Number(item?.population)) ? Number(item.population) : null;
  const slug = String(item?.slug || (type === "city" && stateCode ? `${slugify(name)}-${stateCode.toLowerCase()}` : slugify(name))).trim();
  return {
    type,
    name,
    slug,
    stateCode,
    stateName,
    population,
    cityTier: item?.cityTier ?? item?.city_tier ?? cityTier(type, population),
    metadata: item?.metadata || {},
  };
}

router.get("/api/accounts/:accountId/locations", requireAuth, async (req: Request, res: Response) => {
  const where: string[] = ["account_id::text = $1::text"];
  const values: any[] = [req.params.accountId];

  if (typeof req.query.search === "string" && req.query.search.trim()) {
    const search = `%${req.query.search.trim()}%`;
    values.push(search, search, search, search);
    where.push(`(name ILIKE $${values.length - 3} OR slug ILIKE $${values.length - 2} OR state_code ILIKE $${values.length - 1} OR state_name ILIKE $${values.length})`);
  }
  if (typeof req.query.type === "string" && req.query.type.trim()) {
    values.push(req.query.type.trim());
    where.push(`type::text = $${values.length}`);
  }
  if (typeof req.query.cityTier === "string" && req.query.cityTier.trim()) {
    values.push(req.query.cityTier.trim());
    where.push(`city_tier = $${values.length}::int`);
  }

  const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 5000);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const orderBy = req.query.orderBy === "population" ? "population DESC NULLS LAST, name ASC" : "type ASC, state_code ASC NULLS LAST, name ASC";
  const result = await pool.query(
    `SELECT * FROM locations WHERE ${where.join(" AND ")} ORDER BY ${orderBy} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  );
  return res.json(result.rows.map(mapLocation));
});

router.get("/api/accounts/:accountId/locations/count", requireAuth, async (req: Request, res: Response) => {
  const where: string[] = ["account_id::text = $1::text"];
  const values: any[] = [req.params.accountId];

  if (typeof req.query.search === "string" && req.query.search.trim()) {
    const search = `%${req.query.search.trim()}%`;
    values.push(search, search, search, search);
    where.push(`(name ILIKE $${values.length - 3} OR slug ILIKE $${values.length - 2} OR state_code ILIKE $${values.length - 1} OR state_name ILIKE $${values.length})`);
  }
  if (typeof req.query.type === "string" && req.query.type.trim()) {
    values.push(req.query.type.trim());
    where.push(`type::text = $${values.length}`);
  }
  if (typeof req.query.cityTier === "string" && req.query.cityTier.trim()) {
    values.push(req.query.cityTier.trim());
    where.push(`city_tier = $${values.length}::int`);
  }

  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM locations WHERE ${where.join(" AND ")}`, values);
  return res.json({ count: result.rows[0]?.count || 0 });
});

router.post("/api/accounts/:accountId/locations", requireAuth, async (req: Request, res: Response) => {
  const item = normalizeLocationInput(req.body || {});
  if (!item.name || !item.slug) return res.status(400).json({ message: "Location name and slug are required." });

  const duplicate = await pool.query(`SELECT * FROM locations WHERE account_id::text = $1::text AND slug = $2 LIMIT 1`, [req.params.accountId, item.slug]);
  if (duplicate.rows[0]) return res.status(409).json({ message: "Location already exists.", location: mapLocation(duplicate.rows[0]) });

  const result = await pool.query(
    `INSERT INTO locations (account_id, type, name, slug, state_code, state_name, population, city_tier, metadata)
     VALUES ($1, $2::location_type, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING *`,
    [req.params.accountId, item.type, item.name, item.slug, item.stateCode || null, item.stateName || null, item.population, item.cityTier, JSON.stringify(item.metadata)],
  );
  return res.status(201).json(mapLocation(result.rows[0]));
});

router.post("/api/accounts/:accountId/locations/bulk", requireAuth, async (req: Request, res: Response) => {
  const rawLocations = Array.isArray(req.body?.locations) ? req.body.locations : [];
  if (rawLocations.length === 0) return res.status(400).json({ message: "No locations provided.", inserted: 0, skipped: 0, received: 0, valid: 0 });

  const normalized = rawLocations.map(normalizeLocationInput).filter((item: any) => item.name && item.slug);
  const seen = new Set<string>();
  const unique = normalized.filter((item: any) => {
    const key = item.slug.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length === 0) return res.status(400).json({ message: "No valid locations provided.", inserted: 0, skipped: rawLocations.length, received: rawLocations.length, valid: 0 });

  const existing = await pool.query(
    `SELECT slug FROM locations WHERE account_id::text = $1::text AND slug = ANY($2::text[])`,
    [req.params.accountId, unique.map((item: any) => item.slug)],
  );
  const existingSlugs = new Set(existing.rows.map((row: any) => String(row.slug).toLowerCase()));
  const toInsert = unique.filter((item: any) => !existingSlugs.has(item.slug.toLowerCase()));

  let inserted = 0;
  for (let start = 0; start < toInsert.length; start += 500) {
    const chunk = toInsert.slice(start, start + 500);
    const values: any[] = [];
    const placeholders = chunk.map((item: any, index: number) => {
      const base = index * 9;
      values.push(req.params.accountId, item.type, item.name, item.slug, item.stateCode || null, item.stateName || null, item.population, item.cityTier, JSON.stringify(item.metadata));
      return `($${base + 1}, $${base + 2}::location_type, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}::jsonb)`;
    });
    const result = await pool.query(
      `INSERT INTO locations (account_id, type, name, slug, state_code, state_name, population, city_tier, metadata)
       VALUES ${placeholders.join(", ")}
       RETURNING id`,
      values,
    );
    inserted += result.rowCount || 0;
  }

  return res.json({ inserted, skipped: rawLocations.length - inserted, received: rawLocations.length, valid: unique.length });
});

router.post("/api/accounts/:accountId/locations/load-standard", requireAuth, async (_req: Request, res: Response) => {
  return res.status(400).json({ message: "Use Bulk Import to load the standard city list.", inserted: 0, skipped: 0 });
});

router.delete("/api/locations/:id", requireAuth, async (req: Request, res: Response) => {
  const result = await pool.query(`DELETE FROM locations WHERE id::text = $1::text RETURNING *`, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ message: "Location not found." });
  return res.json({ message: "Location deleted", location: mapLocation(result.rows[0]) });
});

export default router;
