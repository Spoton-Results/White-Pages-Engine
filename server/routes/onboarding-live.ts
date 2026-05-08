import { Router } from "express";
import { randomBytes } from "crypto";
import { pool } from "../db";
import { requireAuth } from "../auth";
import { processOnboardingSubmission } from "../services/onboarding";
import { suggestServices } from "../services/claude";
import { STANDARD_CITIES } from "../data/standardCities";
import { logOperationalEvent } from "../services/observability";

const router = Router();

function slugify(value: string) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function cleanDomain(value: string) {
  return String(value || "").toLowerCase().trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
}

function fallbackServices(industry: string) {
  const key = String(industry || "").toLowerCase();
  if (key.includes("plumb")) return ["Drain Cleaning", "Water Heater Repair", "Leak Detection", "Emergency Plumbing", "Sewer Line Repair"];
  if (key.includes("hvac")) return ["AC Repair", "Furnace Repair", "Heat Pump Services", "HVAC Maintenance", "Emergency HVAC Repair"];
  if (key.includes("roof")) return ["Roof Repair", "Roof Replacement", "Storm Damage Repair", "Roof Inspection", "Gutter Installation"];
  if (key.includes("merchant")) return ["Credit Card Processing", "POS Systems", "Payment Processing", "Mobile Payments", "Payment Gateway"];
  return ["Local Service", "Emergency Service", "Commercial Service", "Residential Service", "Consultation"];
}

async function uniqueAccountSlug(base: string) {
  let slug = slugify(base) || `account-${randomBytes(3).toString("hex")}`;
  let finalSlug = slug;
  let i = 1;
  while (true) {
    const found = await pool.query(`SELECT id FROM accounts WHERE slug = $1 LIMIT 1`, [finalSlug]);
    if (found.rowCount === 0) return finalSlug;
    i += 1;
    finalSlug = `${slug}-${i}`;
  }
}

async function insertBlueprints(accountId: string, websiteId: string) {
  const blueprints = [
    {
      name: "Service City Pages",
      pageType: "service_city",
      titleTemplate: "{{service}} in {{city}}, {{state}} | {{brand}}",
      metaDescTemplate: "{{brand}} provides {{service}} in {{city}}, {{state}}. Contact us today.",
      h1Template: "{{service}} in {{city}}, {{state}}",
      slugTemplate: "{{service_slug}}-in-{{city_slug}}-{{state_slug}}",
    },
    {
      name: "State Hub Pages",
      pageType: "state_hub",
      titleTemplate: "{{service}} in {{state}} | {{brand}}",
      metaDescTemplate: "Find {{service}} across {{state}} with {{brand}}.",
      h1Template: "{{service}} in {{state}}",
      slugTemplate: "{{service_slug}}-in-{{state_slug}}",
    },
    {
      name: "Problem Intent Pages",
      pageType: "problem_intent",
      titleTemplate: "{{problem}} in {{city}}, {{state}} | {{brand}}",
      metaDescTemplate: "Need help with {{problem}} in {{city}}, {{state}}? Contact {{brand}}.",
      h1Template: "{{problem}} in {{city}}, {{state}}",
      slugTemplate: "{{problem_slug}}-{{city_slug}}-{{state_slug}}",
    },
  ];
  let created = 0;
  for (const bp of blueprints) {
    await pool.query(
      `INSERT INTO blueprints (
        account_id, website_id, name, page_type, title_template, meta_desc_template, h1_template, slug_template, sections, required_word_count, is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,700,true)`,
      [accountId, websiteId, bp.name, bp.pageType, bp.titleTemplate, bp.metaDescTemplate, bp.h1Template, bp.slugTemplate, JSON.stringify(["intro", "benefits", "process", "faq", "cta"])],
    );
    created += 1;
  }
  return created;
}

async function insertLocations(accountId: string, selectedStates: string[], cityTiers: number[], primaryCity?: string, primaryState?: string) {
  const states = selectedStates.length ? selectedStates : primaryState ? [primaryState] : [];
  const stateSet = new Set(states.map(s => String(s).toUpperCase()));
  const tierSet = new Set(cityTiers.length ? cityTiers : [1, 2]);
  const cities = STANDARD_CITIES.filter(c => stateSet.has(c.stateAbbreviation) && tierSet.has(c.population >= 500000 ? 1 : c.population >= 100000 ? 2 : 3)).slice(0, 5000);
  let inserted = 0;

  for (const stateCode of stateSet) {
    const city = STANDARD_CITIES.find(c => c.stateAbbreviation === stateCode);
    const stateName = city?.stateName || stateCode;
    await pool.query(
      `INSERT INTO locations (account_id, type, name, slug, state_code, state_name, city_tier)
       SELECT $1, 'state', $2, $3, $4, $2, NULL
       WHERE NOT EXISTS (SELECT 1 FROM locations WHERE account_id = $1 AND slug = $3)`,
      [accountId, stateName, slugify(stateName), stateCode],
    );
    inserted += 1;
  }

  for (const c of cities) {
    const result = await pool.query(
      `INSERT INTO locations (account_id, type, name, slug, state_code, state_name, population, city_tier)
       SELECT $1, 'city', $2, $3, $4, $5, $6, $7
       WHERE NOT EXISTS (SELECT 1 FROM locations WHERE account_id = $1 AND slug = $3)
       RETURNING id`,
      [accountId, c.name, `${slugify(c.name)}-${c.stateAbbreviation.toLowerCase()}`, c.stateAbbreviation, c.stateName, c.population, c.population >= 500000 ? 1 : c.population >= 100000 ? 2 : 3],
    );
    inserted += result.rowCount ?? 0;
  }

  if (primaryCity && primaryState) {
    const result = await pool.query(
      `INSERT INTO locations (account_id, type, name, slug, state_code, state_name, city_tier)
       SELECT $1, 'city', $2, $3, $4, $4, 3
       WHERE NOT EXISTS (SELECT 1 FROM locations WHERE account_id = $1 AND slug = $3)
       RETURNING id`,
      [accountId, primaryCity, `${slugify(primaryCity)}-${String(primaryState).toLowerCase()}`, String(primaryState).toUpperCase()],
    );
    inserted += result.rowCount ?? 0;
  }

  return inserted;
}

router.get("/api/onboard/lookup/:token", async (req, res, next) => {
  try {
    const token = String(req.params.token || "");
    const result = await pool.query(
      `SELECT token, status, plan_type FROM onboarding_submissions WHERE token = $1 LIMIT 1`,
      [token],
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ message: "Invalid onboarding token" });
    res.json({ token: row.token, status: row.status || "pending", plan_type: row.plan_type || "custom" });
  } catch (err) {
    next(err);
  }
});

router.post("/api/onboard/submit", async (req, res, next) => {
  try {
    const { token, business, services, coverage } = req.body || {};
    if (!token) return res.status(400).json({ success: false, error: "Missing token" });
    if (!business?.legal_name || !business?.domain || !business?.email) return res.status(400).json({ success: false, error: "Missing required business fields" });

    const found = await pool.query(`SELECT id, status FROM onboarding_submissions WHERE token = $1 LIMIT 1`, [token]);
    const submission = found.rows[0];
    if (!submission) return res.status(404).json({ success: false, error: "Invalid onboarding token" });
    if (submission.status !== "pending") return res.status(409).json({ success: false, error: `Onboarding is already ${submission.status}` });

    const formData = { business: { ...business, domain: cleanDomain(business.domain) }, services: Array.isArray(services) ? services : [], coverage: coverage || {} };
    await pool.query(
      `UPDATE onboarding_submissions SET status = 'submitted', form_data = $2::jsonb, submitted_at = NOW() WHERE id = $1`,
      [submission.id, JSON.stringify(formData)],
    );

    const result = await processOnboardingSubmission(submission.id);
    await logOperationalEvent({
      level: result.success ? "info" : "error",
      source: "public-onboarding",
      message: result.success ? "Public onboarding submitted and processed" : "Public onboarding processing failed",
      websiteId: result.websiteId || null,
      accountId: result.accountId || null,
      metadata: { submissionId: submission.id, error: result.error || null },
    });

    res.json({ success: result.success, ...result });
  } catch (err) {
    next(err);
  }
});

router.post("/api/agencies/:agencyId/wizard/suggest-services", requireAuth, async (req, res) => {
  const { businessName, industry } = req.body || {};
  try {
    const suggested = await suggestServices(industry || "Other", businessName || "Business");
    res.json((suggested || fallbackServices(industry)).slice(0, 20).map((s: any) => typeof s === "string" ? { name: s, slug: slugify(s), description: "", keywords: [] } : { ...s, slug: s.slug || slugify(s.name) }));
  } catch {
    res.json(fallbackServices(industry).map(name => ({ name, slug: slugify(name), description: "", keywords: [] })));
  }
});

router.post("/api/agencies/:agencyId/wizard/launch", requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const agencyId = req.params.agencyId;
    const body = req.body || {};
    const domain = cleanDomain(body.domain);
    const businessName = String(body.businessName || "").trim();
    if (!businessName || !domain) return res.status(400).json({ success: false, error: "Business name and domain are required", failedStep: 1 });

    await client.query("BEGIN");
    const existing = await client.query(`SELECT id FROM websites WHERE lower(domain) = lower($1) LIMIT 1`, [domain]);
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, error: `Website domain already exists: ${domain}`, failedStep: 2 });
    }

    const slug = await uniqueAccountSlug(businessName);
    const account = await client.query(
      `INSERT INTO accounts (agency_id, name, slug, plan, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'starter', 'active', NOW(), NOW()) RETURNING id`,
      [agencyId, businessName, slug],
    );
    const accountId = account.rows[0].id;

    const website = await client.query(
      `INSERT INTO websites (account_id, name, domain, primary_industry, status, settings, onboarding_status, launch_cap, warmup_mode, coverage_plan, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'paused',$5::jsonb,'wizard_created',100,true,'regional',NOW(),NOW()) RETURNING id`,
      [accountId, businessName, domain, body.industry || null, JSON.stringify({ parentDomain: domain, proxyPath: "", primaryCity: body.primaryCity || "", primaryState: body.primaryState || "", cityTiers: body.cityTiers || [1,2] })],
    );
    const websiteId = website.rows[0].id;

    const brand = await client.query(
      `INSERT INTO brand_profiles (account_id, name, primary_color, tagline, description, custom_fields, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW(),NOW()) RETURNING id`,
      [accountId, businessName, body.brandColor || "#3b82f6", body.tagline || "", `${businessName} — ${body.industry || "professional"} services.`, JSON.stringify({ primary_city: body.primaryCity || "", primary_state: body.primaryState || "", industry: body.industry || "" })],
    );
    const brandProfileId = brand.rows[0].id;
    await client.query(`UPDATE websites SET brand_profile_id = $1 WHERE id = $2`, [brandProfileId, websiteId]);

    let servicesCreated = 0;
    for (const svc of body.selectedServices || []) {
      const name = String(svc.name || svc || "").trim();
      if (!name) continue;
      await client.query(
        `INSERT INTO services (account_id, name, slug, description, keywords, created_at)
         VALUES ($1,$2,$3,$4,$5,NOW())`,
        [accountId, name, slugify(name), svc.description || "", svc.keywords || []],
      );
      servicesCreated += 1;
    }

    await client.query("COMMIT");

    const locationsLoaded = await insertLocations(accountId, body.selectedStates || [], body.cityTiers || [1,2], body.primaryCity, body.primaryState);
    const blueprintsCreated = await insertBlueprints(accountId, websiteId);

    await logOperationalEvent({
      level: "info",
      source: "agency-onboarding-wizard",
      message: "Agency wizard client launch completed",
      websiteId,
      accountId,
      metadata: { agencyId, servicesCreated, locationsLoaded, blueprintsCreated },
    });

    res.json({
      success: true,
      accountId,
      websiteId,
      brandProfileId,
      servicesCreated,
      locationsLoaded,
      blueprintsCreated,
      steps: [
        { step: 1, success: true, label: "Account created" },
        { step: 2, success: true, label: "Website created" },
        { step: 3, success: true, label: "Brand profile created" },
        { step: 4, success: true, label: "Services added" },
        { step: 5, success: true, label: "Locations loaded" },
        { step: 6, success: true, label: "Blueprints created" },
      ],
    });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    await logOperationalEvent({ level: "error", source: "agency-onboarding-wizard", message: "Agency wizard launch failed", metadata: { error: err?.message || String(err) } });
    next(err);
  } finally {
    client.release();
  }
});

export default router;
