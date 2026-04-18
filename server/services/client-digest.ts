// ═══════════════════════════════════════════════════════════════════════════
// PHASE 9 — Client Weekly Digest
// ═══════════════════════════════════════════════════════════════════════════
// Generates a customer-friendly weekly email and stores it in
// client_weekly_digests. Sends if SMTP is configured (reuses Auto 8 plumbing
// for sending), otherwise leaves status='pending' for admin review.
// SEPARATE from Auto 8's admin digest.
// ═══════════════════════════════════════════════════════════════════════════

import { db } from "../db";
import { sql } from "drizzle-orm";
import * as storage from "../storage";
import { getLatestHealthScore } from "./launch-health";
import { getWarmupPageLimit, getProtectionModeThresholds } from "./safety-rails";

export interface DigestData {
  brandName: string;
  domain: string;
  newPagesThisWeek: number;
  qualifiedThisWeek: number;
  promotedThisWeek: number;
  totalLive: number;
  healthScore: number | null;
  healthMessage: string;
  avgQuality: number;
  tier1Count: number;
  tier2Count: number;
  warmupActive: boolean;
  warmupDay: number;
  warmupLimit: number;
  warmupNextIncreaseDay: number | null;
  protectionActive: boolean;
  protectionExpiresInDays: number | null;
  blockedServices: string[];
  nextWaveDate: string | null;
}

function fmtDate(d: Date | null): string {
  if (!d) return "soon";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

async function gather(websiteId: string): Promise<{ data: DigestData; recipientEmail: string; accountId: string } | null> {
  const website = await storage.getWebsite(websiteId);
  if (!website) return null;
  const accountId = website.accountId!;
  const profiles = await storage.getBrandProfiles(accountId);
  const brand = profiles[0];
  const recipientEmail = brand?.email || "";

  const [counts] = (await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS new_week,
      COUNT(*) FILTER (WHERE quality_score IS NOT NULL AND updated_at >= NOW() - INTERVAL '7 days')::int AS qualified_week,
      COUNT(*) FILTER (WHERE is_draft = false AND updated_at >= NOW() - INTERVAL '7 days' AND publish_wave > 0)::int AS promoted_week,
      COUNT(*) FILTER (WHERE is_draft = false)::int AS total_live,
      COALESCE(AVG(quality_score) FILTER (WHERE is_draft = false), 0)::int AS avg_q,
      COUNT(*) FILTER (WHERE is_draft = false AND tier = 1)::int AS t1,
      COUNT(*) FILTER (WHERE is_draft = false AND tier = 2)::int AS t2
    FROM pages WHERE website_id = ${websiteId}
  `).then((r: any) => (r.rows ? r.rows : r))) as any;

  const health = await getLatestHealthScore(websiteId);
  const warm = await getWarmupPageLimit(websiteId);
  const prot = await getProtectionModeThresholds(websiteId);

  // Blocked services from latest governor results
  let blockedServices: string[] = [];
  try {
    const [subRow] = (await db.execute(sql`
      SELECT governor_results FROM onboarding_submissions
      WHERE website_id = ${websiteId} ORDER BY created_at DESC LIMIT 1
    `).then((r: any) => (r.rows ? r.rows : r))) as any;
    const g = (subRow?.governor_results as any)?.governor_1_service_gate;
    if (g && Array.isArray(g.blocked_services)) {
      blockedServices = g.blocked_services.map((b: any) => b.name);
    }
  } catch { /* non-fatal */ }

  // Next wave date estimate (14 days from first_publish, multiples)
  let nextWaveDate: string | null = null;
  const fp = (website as any).firstPublishAt as Date | null;
  if (fp) {
    const days = Math.floor((Date.now() - new Date(fp).getTime()) / (24 * 3600 * 1000));
    const nextWaveIn = 14 - (days % 14);
    nextWaveDate = fmtDate(new Date(Date.now() + nextWaveIn * 24 * 3600 * 1000));
  }

  return {
    accountId,
    recipientEmail,
    data: {
      brandName: brand?.name || website.name || website.domain,
      domain: website.domain,
      newPagesThisWeek: counts?.new_week || 0,
      qualifiedThisWeek: counts?.qualified_week || 0,
      promotedThisWeek: counts?.promoted_week || 0,
      totalLive: counts?.total_live || 0,
      healthScore: health?.score ?? null,
      healthMessage: health?.breakdown?.message || "",
      avgQuality: counts?.avg_q || 0,
      tier1Count: counts?.t1 || 0,
      tier2Count: counts?.t2 || 0,
      warmupActive: warm.warmup_active,
      warmupDay: warm.warmup_day,
      warmupLimit: warm.current_limit === Number.MAX_SAFE_INTEGER ? 0 : warm.current_limit,
      warmupNextIncreaseDay: warm.next_tier_day,
      protectionActive: prot.protection_mode,
      protectionExpiresInDays: prot.protection_expires_in_days ?? null,
      blockedServices,
      nextWaveDate,
    },
  };
}

function buildPlain(d: DigestData): string {
  const lines: string[] = [];
  lines.push(`Hi ${d.brandName} team,`, "");
  lines.push("Here is what happened on your Nexus account this week.", "");
  lines.push("— PAGES —", "");
  lines.push(`${d.newPagesThisWeek} new pages generated this week`);
  lines.push(`${d.qualifiedThisWeek} pages scored and qualified`);
  lines.push(`${d.promotedThisWeek} pages promoted to live this week`);
  lines.push(`${d.totalLive} total pages now live on ${d.domain}`, "");
  lines.push("— QUALITY —", "");
  if (d.healthScore !== null) {
    lines.push(`Launch health score: ${d.healthScore}/100`);
    lines.push(d.healthMessage, "");
  }
  lines.push(`Average page quality: ${d.avgQuality}/100`);
  lines.push(`Tier 1 pages: ${d.tier1Count}`);
  lines.push(`Tier 2 pages: ${d.tier2Count}`, "");
  lines.push("— STATUS —", "");
  const statusLines: string[] = [];
  if (d.warmupActive) {
    statusLines.push(`Your site is in staged rollout — day ${d.warmupDay} of 30. We are gradually increasing your page count to build trust with search engines. Current limit: ${d.warmupLimit} pages.${d.warmupNextIncreaseDay ? ` Next increase on day ${d.warmupNextIncreaseDay}.` : ""}`);
  }
  if (d.protectionActive) {
    statusLines.push(`Your site is in first-30-day quality protection. We are using stricter quality thresholds to ensure only your strongest pages reach search engines.${d.protectionExpiresInDays !== null ? ` Quality protection ends in ${d.protectionExpiresInDays} day(s).` : ""}`);
  }
  if (d.blockedServices.length) {
    statusLines.push(`Some services need stronger content before their pages can go live: ${d.blockedServices.join(", ")}. We will automatically check again when content quality improves.`);
  }
  if (statusLines.length === 0) {
    statusLines.push("Your site is running smoothly. Pages are being monitored and promoted automatically.");
  }
  for (const l of statusLines) lines.push(l, "");
  lines.push("— NEXT STEPS —", "");
  if (d.nextWaveDate) lines.push(`• Your next wave of pages is estimated to publish on ${d.nextWaveDate}.`);
  if (d.blockedServices.length) lines.push(`• ${d.blockedServices.length} service(s) are being strengthened and will unlock more pages soon.`);
  if (!d.nextWaveDate && !d.blockedServices.length) lines.push("• Everything is on track. No action needed from you.");
  lines.push("", "—", "Questions? Call (435) 999-5348", "", "SpotOn Nexus", d.domain);
  return lines.join("\n");
}

function buildHtml(d: DigestData): string {
  const text = buildPlain(d).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#18181b;background:#fafafa;padding:24px"><div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;padding:32px"><pre style="white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.6;margin:0">${text}</pre></div></body></html>`;
}

export async function generateClientWeeklyDigest(websiteId: string): Promise<{ id: string | null; sent: boolean; recipientEmail: string }> {
  const g = await gather(websiteId);
  if (!g) return { id: null, sent: false, recipientEmail: "" };
  if (!g.recipientEmail) {
    console.warn(`[Client Digest] No recipient email for website ${websiteId}. Skipping.`);
    return { id: null, sent: false, recipientEmail: "" };
  }

  const subject = `Your Nexus Weekly Update — ${g.data.brandName}`;
  const bodyText = buildPlain(g.data);
  const bodyHtml = buildHtml(g.data);

  const [ins] = (await db.execute(sql`
    INSERT INTO client_weekly_digests (website_id, account_id, recipient_email, subject, body_html, body_text, status, created_at)
    VALUES (${websiteId}, ${g.accountId}, ${g.recipientEmail}, ${subject}, ${bodyHtml}, ${bodyText}, 'pending', NOW())
    RETURNING id
  `).then((r: any) => (r.rows ? r.rows : r))) as any;

  const id = ins?.id || null;

  // Try to send if SMTP is configured (reuses Auto 8 plumbing)
  const sent = await trySendDigest(id, g.recipientEmail, subject, bodyText, bodyHtml);
  return { id, sent, recipientEmail: g.recipientEmail };
}

async function trySendDigest(id: string | null, to: string, subject: string, text: string, html: string): Promise<boolean> {
  const smtpUrl = process.env.SMTP_URL || process.env.EMAIL_SMTP_URL;
  if (!smtpUrl) {
    console.log(`[Client Digest] Email generated for ${to} but email sending is not configured. Digest saved.`);
    return false;
  }
  try {
    const nodemailer: any = await import("nodemailer");
    const transporter = nodemailer.default.createTransport(smtpUrl);
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM_ADDRESS || "noreply@spotonnexus.com",
      to,
      subject,
      text,
      html,
    });
    if (id) {
      await db.execute(sql`UPDATE client_weekly_digests SET status = 'sent', sent_at = NOW() WHERE id = ${id}`);
    }
    console.log(`[Client Digest] Sent to ${to}`);
    return true;
  } catch (err: any) {
    console.error(`[Client Digest] Send failed for ${to}:`, err?.message);
    if (id) {
      await db.execute(sql`UPDATE client_weekly_digests SET status = 'failed' WHERE id = ${id}`);
    }
    return false;
  }
}

export async function sendDigestById(id: string): Promise<boolean> {
  const [row] = (await db.execute(sql`
    SELECT id, recipient_email, subject, body_text, body_html FROM client_weekly_digests WHERE id = ${id}
  `).then((r: any) => (r.rows ? r.rows : r))) as any;
  if (!row) return false;
  return trySendDigest(row.id, row.recipient_email, row.subject, row.body_text, row.body_html);
}

export async function runWeeklyClientDigests(): Promise<void> {
  console.log("[Client Digest] Weekly run starting...");
  try {
    const rows = (await db.execute(sql`
      SELECT id, domain FROM websites
      WHERE onboarding_status IN ('published_live','generated_draft_only')
        AND status NOT IN ('paused','cancelled')
    `).then((r: any) => (r.rows ? r.rows : r))) as any[];
    for (const row of rows) {
      try { await generateClientWeeklyDigest(row.id); }
      catch (err: any) { console.error(`[Client Digest] ${row.domain} failed:`, err?.message); }
    }
    console.log(`[Client Digest] Weekly run complete. ${rows.length} sites processed.`);
  } catch (err: any) {
    console.error("[Client Digest] Weekly run failed:", err?.message);
  }
}
