import { Router } from "express";
import { randomBytes } from "crypto";
import Stripe from "stripe";
import { pool } from "../db";

const router = Router();

const priceEnvByPlan: Record<string, string> = {
  local_launch: "STRIPE_NEXUS_LOCAL_LAUNCH_PRICE_ID",
  founding_agency: "STRIPE_NEXUS_FOUNDING_AGENCY_PRICE_ID",
  growth_bundle: "STRIPE_NEXUS_GROWTH_BUNDLE_PRICE_ID",
  growth_bundle_annual: "STRIPE_NEXUS_GROWTH_BUNDLE_ANNUAL_PRICE_ID",
  addon_site: "STRIPE_NEXUS_ADDON_SITE_PRICE_ID",
};

function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function appUrl(req: any) {
  return (process.env.NEXUS_APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

function landingUrl() {
  return (process.env.NEXUS_LANDING_URL || "https://spotonnexus.com").replace(/\/$/, "");
}

function plan(raw: unknown) {
  const value = String(raw || "local_launch").trim();
  return priceEnvByPlan[value] ? value : "local_launch";
}

async function ensureColumns() {
  await pool.query(`ALTER TABLE onboarding_submissions ADD COLUMN IF NOT EXISTS stripe_session_id VARCHAR(255)`);
  await pool.query(`ALTER TABLE onboarding_submissions ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255)`);
  await pool.query(`ALTER TABLE onboarding_submissions ADD COLUMN IF NOT EXISTS plan_type VARCHAR(50)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_submissions_stripe_session ON onboarding_submissions(stripe_session_id) WHERE stripe_session_id IS NOT NULL`);
}

async function newToken() {
  while (true) {
    const token = randomBytes(24).toString("hex");
    const found = await pool.query(`SELECT id FROM onboarding_submissions WHERE token = $1 LIMIT 1`, [token]);
    if (found.rowCount === 0) return token;
  }
}

async function createOrGetOnboarding(session: Stripe.Checkout.Session) {
  await ensureColumns();
  const existing = await pool.query(`SELECT id, token FROM onboarding_submissions WHERE stripe_session_id = $1 LIMIT 1`, [session.id]);
  if (existing.rows[0]) return existing.rows[0];

  const token = await newToken();
  const selectedPlan = plan(session.metadata?.planType);
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id || null;
  const email = session.customer_details?.email || session.customer_email || null;

  const created = await pool.query(
    `INSERT INTO onboarding_submissions
      (token, stripe_session_id, stripe_customer_id, plan_type, status, form_data, onboarding_notes, created_at)
     VALUES ($1, $2, $3, $4, 'pending', $5::jsonb, $6, NOW())
     RETURNING id, token`,
    [
      token,
      session.id,
      customerId,
      selectedPlan,
      JSON.stringify({
        source: "stripe",
        customer_email: email,
        checkout_session_id: session.id,
        amount_total: session.amount_total,
        currency: session.currency,
        payment_status: session.payment_status,
      }),
      `Stripe payment completed${email ? ` by ${email}` : ""}`,
    ],
  );

  return created.rows[0];
}

async function startCheckout(req: any, res: any, next: any) {
  try {
    const selectedPlan = plan(req.query.plan || req.body?.plan);
    const priceId = process.env[priceEnvByPlan[selectedPlan]];
    if (!priceId) return res.status(500).json({ message: `${priceEnvByPlan[selectedPlan]} is not configured` });

    const stripe = stripeClient();
    const email = String(req.query.email || req.body?.email || "").trim() || undefined;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      allow_promotion_codes: true,
      success_url: `${appUrl(req)}/api/nexus/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${landingUrl()}/#pricing`,
      metadata: { product: "spoton_nexus", planType: selectedPlan },
      subscription_data: { metadata: { product: "spoton_nexus", planType: selectedPlan } },
    });

    if (req.method === "GET") return res.redirect(303, session.url || landingUrl());
    return res.json({ ok: true, url: session.url, sessionId: session.id });
  } catch (err) {
    next(err);
  }
}

router.get("/api/nexus/checkout", startCheckout);
router.post("/api/nexus/checkout", startCheckout);

router.get("/api/nexus/checkout/success", async (req, res, next) => {
  try {
    const sessionId = String(req.query.session_id || "");
    if (!sessionId) return res.redirect(303, `${landingUrl()}/?payment=missing_session`);
    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["customer"] });
    if (session.status !== "complete" && session.payment_status !== "paid") {
      return res.redirect(303, `${landingUrl()}/?payment=pending`);
    }
    const onboarding = await createOrGetOnboarding(session);
    return res.redirect(303, `${appUrl(req)}/onboard/${onboarding.token}`);
  } catch (err) {
    next(err);
  }
});

router.post("/api/nexus/stripe/webhook", async (req, res, next) => {
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ message: "STRIPE_WEBHOOK_SECRET is not configured" });
    const signature = req.headers["stripe-signature"];
    if (!signature) return res.status(400).json({ message: "Missing Stripe signature" });

    const stripe = stripeClient();
    const event = stripe.webhooks.constructEvent((req as any).rawBody, signature, secret);
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.product === "spoton_nexus") await createOrGetOnboarding(session);
    }
    return res.json({ received: true });
  } catch (err) {
    next(err);
  }
});

export default router;
