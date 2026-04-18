// ═══════════════════════════════════════════════════════════════════════════
// PHASE 9 — Gap Report Generator (customer-friendly)
// ═══════════════════════════════════════════════════════════════════════════
// Combines readiness_result + brand_input_result + governor_results into a
// single, customer-safe report. NEVER mentions AI, banks, scoring formulas,
// tier internals, draft_reason codes, or governor names.
// ═══════════════════════════════════════════════════════════════════════════

import { db } from "../db";
import { eq } from "drizzle-orm";
import { onboardingSubmissions } from "@shared/schema";

export interface GapReport {
  generated_at: string;
  overall_readiness: number;
  brand_input_quality: number | null;
  summary: string;
  critical_gaps: Array<{ area: string; issue: string; action: string; priority: "high" | "medium" | "low" }>;
  recommendations: Array<{ area: string; issue: string; action: string; priority: "high" | "medium" | "low" }>;
  strengths: Array<{ area: string; message: string }>;
}

const FIELD_TO_AREA: Record<string, string> = {
  domain: "Domain",
  business_name: "Brand Profile",
  phone: "Brand Profile",
  email: "Brand Profile",
  tagline: "Brand Profile",
  description: "Brand Profile",
  services: "Services",
  service: "Services",
  locations: "Coverage",
  location: "Coverage",
  state: "Coverage",
  city: "Coverage",
  industry: "Brand Profile",
  brand_color: "Brand Profile",
};

function areaFor(field: string): string {
  const f = (field || "").toLowerCase();
  for (const k of Object.keys(FIELD_TO_AREA)) {
    if (f.includes(k)) return FIELD_TO_AREA[k];
  }
  return "Account";
}

// Strip internal jargon from a free-text message.
function sanitize(msg: string): string {
  if (!msg) return msg;
  return msg
    .replace(/\bAI\b/g, "content engine")
    .replace(/\bClaude\b/gi, "content engine")
    .replace(/\bAnthropic\b/gi, "content engine")
    .replace(/\bvariation bank(?:s)?\b/gi, "content quality")
    .replace(/\bbank completeness\b/gi, "content quality")
    .replace(/\bbank incomplete\b/gi, "content quality is being strengthened")
    .replace(/\bquality_score\b/gi, "page quality")
    .replace(/\bdraft_reason\b/gi, "")
    .replace(/\btier 1 cutoff\b/gi, "promotion threshold")
    .replace(/\bGoogle Indexing API\b/gi, "search engine review")
    .replace(/\bIndexing API\b/gi, "search engine review")
    .replace(/\blaunch_cap\b/gi, "page limit")
    .replace(/\bwarmup_mode\b/gi, "staged rollout")
    .replace(/\bprotection_mode\b/gi, "quality protection")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function generateGapReport(submissionId: string): Promise<GapReport | null> {
  const [sub] = await db
    .select()
    .from(onboardingSubmissions)
    .where(eq(onboardingSubmissions.id, submissionId))
    .limit(1);
  if (!sub) return null;

  const readiness = (sub.readinessResult as any) || {};
  const brand = (sub.brandInputResult as any) || null;
  const gov = (sub.governorResults as any) || {};

  const critical: GapReport["critical_gaps"] = [];
  const recs: GapReport["recommendations"] = [];
  const strengths: GapReport["strengths"] = [];

  // From readiness gaps/strengths
  const gaps: any[] = Array.isArray(readiness.gaps) ? readiness.gaps : [];
  for (const g of gaps) {
    const item = {
      area: areaFor(g.field || ""),
      issue: sanitize(g.message || "Item needs attention."),
      action: g.priority === "high"
        ? "This needs to be fixed before pages can be published."
        : "Improving this will increase the quality of every page on your site.",
      priority: (g.priority === "high" ? "high" : g.priority === "medium" ? "medium" : "low") as "high" | "medium" | "low",
    };
    if (g.priority === "high") critical.push(item); else recs.push(item);
  }
  const strs: any[] = Array.isArray(readiness.strengths) ? readiness.strengths : [];
  for (const s of strs) {
    strengths.push({ area: areaFor(s.field || ""), message: sanitize(s.message || "") });
  }

  // From brand input result (only show items that scored zero)
  if (brand && Array.isArray(brand.zero_items)) {
    for (const item of brand.zero_items) {
      recs.push({
        area: "Brand Profile",
        issue: `${item} is missing.`,
        action: `Adding your ${item.toLowerCase()} will improve the quality of every page on your site.`,
        priority: "low",
      });
    }
  }

  // From Phase 7 governors — blocked services
  const g1 = gov.governor_1_service_gate;
  if (g1 && Array.isArray(g1.blocked_services)) {
    for (const b of g1.blocked_services) {
      critical.push({
        area: "Services",
        issue: `${b.name} content quality is below the promotion threshold.`,
        action: "We will automatically strengthen this content. No action needed from you.",
        priority: "medium",
      });
    }
  }

  // From Rail 1 — duplicates
  const r1 = gov.rail_1_duplicate_detection;
  if (r1 && r1.pages_flagged > 0) {
    recs.push({
      area: "Pages",
      issue: `${r1.pages_flagged} near-duplicate page(s) were detected and held back.`,
      action: "These will not be published. Your strongest version of each page will go live instead.",
      priority: "low",
    });
  }

  // Summary message
  const overall = sub.readinessScore || 0;
  let summary = "Your account is being prepared.";
  if (sub.status === "published_live") summary = "Your site is live and content is being monitored.";
  else if (overall >= 70) summary = critical.length === 0
    ? "Your account is ready. Pages are being prepared for launch."
    : `Your account is mostly ready. ${critical.length} item(s) need attention before all services can go live.`;
  else if (overall >= 50) summary = `Your account is making progress. ${critical.length} important item(s) need attention.`;
  else summary = "Your account needs more information before we can prepare your pages.";

  const report: GapReport = {
    generated_at: new Date().toISOString(),
    overall_readiness: overall,
    brand_input_quality: typeof sub.brandInputScore === "number" ? sub.brandInputScore : null,
    summary,
    critical_gaps: critical,
    recommendations: recs,
    strengths,
  };

  await db
    .update(onboardingSubmissions)
    .set({ gapReport: report as any })
    .where(eq(onboardingSubmissions.id, submissionId));

  return report;
}
