// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8 — RAIL 2: Brand-Input Completeness Gate
// ═══════════════════════════════════════════════════════════════════════════
// Scores quality of brand info on an onboarding submission.
// Pass: >=20/30. Warn: 10-19. Block: <10.
// Runs during Phase 5 readiness scoring (additional, separate gate).
// ═══════════════════════════════════════════════════════════════════════════

import { db } from "../db";
import { eq } from "drizzle-orm";
import { onboardingSubmissions } from "@shared/schema";
import * as storage from "../storage";

const GENERIC_NAMES = new Set([
  "test","my business","company","business","example","untitled",
  "llc","inc","corp","agency","services",
]);

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com","guerrillamail.com","tempmail.com","throwaway.email",
  "yopmail.com","sharklasers.com","guerrillamailblock.com","grr.la",
  "dispostable.com","trashmail.com","fakeinbox.com","tempail.com",
  "maildrop.cc","harakirimail.com","getairmail.com",
]);

interface SubScore { score: number; max: number; notes: string }

export interface BrandInputResult {
  score: number;
  max: number;
  decision: "pass" | "warn" | "block";
  details: {
    business_name_quality: SubScore;
    phone_quality: SubScore;
    email_quality: SubScore;
    tagline_quality: SubScore;
    differentiator_quality: SubScore;
  };
  zero_items: string[];
}

function digitsOnly(s: string): string { return (s || "").replace(/[^0-9]/g, ""); }

export async function checkBrandInputQuality(submissionId: string): Promise<BrandInputResult> {
  const [sub] = await db
    .select()
    .from(onboardingSubmissions)
    .where(eq(onboardingSubmissions.id, submissionId))
    .limit(1);

  const formData: any = (sub?.formData as any) || {};
  const business = formData.business || {};

  // Try brand profile first if it exists, else fall back to formData
  let brand: any = null;
  if (sub?.accountId) {
    const profiles = await storage.getBrandProfiles(sub.accountId);
    brand = profiles[0] || null;
  }

  const businessName = String(brand?.name || business.name || "").trim();
  const phone = String(brand?.phone || business.phone || "").trim();
  const email = String(brand?.email || business.email || "").trim();
  const tagline = String(brand?.tagline || business.tagline || "").trim();
  const primaryCity = String(formData.coverage?.primaryCity || business.city || "").trim();
  const primaryState = String(formData.coverage?.primaryState || business.state || (Array.isArray(formData.coverage?.states) ? formData.coverage.states[0] : "")).trim();
  const industry = String(formData.industry || business.industry || "").trim();
  const brandColor = String(brand?.primaryColor || business.brandColor || "").trim();
  const isDefaultColor = !brandColor || brandColor === "#000000" || brandColor === "#ffffff" || brandColor === "#FFFFFF";

  const zero: string[] = [];

  // business_name_quality (8)
  const bn: SubScore = { score: 0, max: 8, notes: "" };
  if (businessName.length > 2) bn.score += 3; else zero.push("Business name");
  if (businessName && !GENERIC_NAMES.has(businessName.toLowerCase())) bn.score += 3;
  else if (businessName) bn.notes = "Business name appears generic";
  if (businessName.split(/\s+/).filter(Boolean).length >= 2) bn.score += 2;
  if (bn.score === 0) bn.notes = "Business name missing or invalid";

  // phone_quality (5)
  const ph: SubScore = { score: 0, max: 5, notes: "" };
  if (phone) ph.score += 2; else zero.push("Phone number");
  const phDigits = digitsOnly(phone);
  if (phDigits.length >= 10) ph.score += 2;
  if (phone && !phDigits.startsWith("555") && !phDigits.startsWith("1555")) ph.score += 1;
  else if (phone) ph.notes = "Phone appears to be a fake (555) number";

  // email_quality (5)
  const em: SubScore = { score: 0, max: 5, notes: "" };
  if (email) em.score += 2; else zero.push("Email address");
  const emDomain = email.split("@")[1]?.toLowerCase() || "";
  if (email && emDomain && !DISPOSABLE_DOMAINS.has(emDomain)) em.score += 3;
  else if (email && DISPOSABLE_DOMAINS.has(emDomain)) em.notes = "Email is from a disposable domain";

  // tagline_quality (5)
  const tg: SubScore = { score: 0, max: 5, notes: "" };
  if (tagline) tg.score += 2; else zero.push("Tagline");
  if (tagline.length > 20) tg.score += 2;
  if (tagline.split(/\s+/).filter(Boolean).length >= 4) tg.score += 1;

  // differentiator_quality (7)
  const df: SubScore = { score: 0, max: 7, notes: "" };
  if (primaryCity) df.score += 2; else zero.push("Primary city");
  if (primaryState) df.score += 2; else zero.push("Primary state");
  if (industry && industry.toLowerCase() !== "other") df.score += 2;
  else if (!industry) zero.push("Industry");
  if (!isDefaultColor) df.score += 1;

  const total = bn.score + ph.score + em.score + tg.score + df.score;
  let decision: "pass" | "warn" | "block";
  if (total >= 20) decision = "pass";
  else if (total >= 10) decision = "warn";
  else decision = "block";

  const result: BrandInputResult = {
    score: total,
    max: 30,
    decision,
    details: {
      business_name_quality: bn,
      phone_quality: ph,
      email_quality: em,
      tagline_quality: tg,
      differentiator_quality: df,
    },
    zero_items: zero,
  };

  // Persist on the submission
  await db
    .update(onboardingSubmissions)
    .set({ brandInputScore: total, brandInputResult: result as any })
    .where(eq(onboardingSubmissions.id, submissionId));

  console.log(`[Brand Input Gate] Submission ${submissionId} score: ${total}/30 — decision: ${decision.toUpperCase()}`);
  return result;
}
