/**
 * automation.ts
 * All 8 Nexus automation hooks. Pure functions + side-effects; never blocks page rendering.
 *
 * Auto 1 — Score pages after generation
 * Auto 2 — Assign tier after scoring
 * Auto 3 — Debounced sitemap regen after tier changes
 * Auto 4 — Submit Tier 1 URLs to Google Indexing API after promotion
 * Auto 5 — Auto-queue fallback URLs that exceed the hit threshold
 * Auto 6 — Weekly auto-demote Tier 1 pages with zero impressions
 * Auto 7 — Flag thin banks after every bank update
 * Auto 8 — Weekly summary email per tenant
 */

import * as storage from "../storage";
import { submitUrlsToGoogle } from "./gsc-indexing";
import { generateSitemapsForWebsite } from "./sitemap";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AutomationSettings {
  autoScoreAfterGeneration: boolean;      // Auto 1
  autoAssignTiersAfterScoring: boolean;   // Auto 2
  tier1Threshold: number;                 // Auto 2 — default 80
  tier2Threshold: number;                 // Auto 2 — lower bound for T2 (default 55)
  applyTier3: boolean;                    // Auto 2 — demote below tier2Threshold to T3
  sitemapRegenDebounceMinutes: number;    // Auto 3 — default 5
  googleIndexingEnabled: boolean;         // Auto 4
  fallbackHitThreshold: number;           // Auto 5 — default 10
  fallbackHitWindowDays: number;          // Auto 5 — default 30
  autodemoteZeroImpressionDays: number;   // Auto 6 — default 60
  thinBankThreshold: number;              // Auto 7 — default 60 (%)
  weeklyEmailEnabled: boolean;            // Auto 8
  weeklyEmailRecipients: string[];        // Auto 8
}

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  autoScoreAfterGeneration: true,
  autoAssignTiersAfterScoring: true,
  tier1Threshold: 80,
  tier2Threshold: 55,
  applyTier3: false,
  sitemapRegenDebounceMinutes: 5,
  googleIndexingEnabled: true,
  fallbackHitThreshold: 10,
  fallbackHitWindowDays: 30,
  autodemoteZeroImpressionDays: 60,
  thinBankThreshold: 60,
  weeklyEmailEnabled: false,
  weeklyEmailRecipients: [],
};

export function getAutomationSettings(website: { settings?: any }): AutomationSettings {
  const raw = (website.settings as any)?.automation || {};
  return { ...DEFAULT_AUTOMATION_SETTINGS, ...raw };
}

// ─── Auto 3: Debounced sitemap regen ─────────────────────────────────────────

const sitemapRegenTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleSitemapRegen(websiteId: string, domain: string, canonBase?: string, debounceMs = 5 * 60 * 1000): void {
  const existing = sitemapRegenTimers.get(websiteId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(async () => {
    sitemapRegenTimers.delete(websiteId);
    try {
      await generateSitemapsForWebsite(websiteId, domain, canonBase);
      console.log(`[auto3] Sitemap regen complete for ${domain}`);
    } catch (err) {
      console.error(`[auto3] Sitemap regen failed for ${domain}:`, err);
    }
  }, debounceMs);
  sitemapRegenTimers.set(websiteId, timer);
  console.log(`[auto3] Sitemap regen queued for ${domain} (debounce ${debounceMs / 1000}s)`);
}

// ─── Auto 4: Submit Tier 1 URLs to Google after promotion ────────────────────

export async function submitTier1UrlsToGoogle(
  websiteId: string,
  promotedPageIds: string[],
  website: { domain: string; settings?: any },
): Promise<void> {
  if (!promotedPageIds.length) return;
  try {
    const pDomain = (website.settings as any)?.parentDomain;
    const pPath = (website.settings as any)?.proxyPath || "";
    const base = pDomain ? `https://${pDomain}${pPath}` : `https://${website.domain}`;
    const urls = promotedPageIds.map(id => `${base}/${id}`); // id here is slug
    await submitUrlsToGoogle(urls);
    console.log(`[auto4] Submitted ${urls.length} Tier 1 URL(s) to Google for ${website.domain}`);
  } catch (err) {
    console.error("[auto4] Google submit failed (non-fatal):", err);
  }
}

// ─── Auto 1 + 2: Score pages after generation, then assign tiers ─────────────

export async function triggerPostGenerationScoring(
  websiteId: string,
  website: { id: string; domain: string; settings?: any },
): Promise<void> {
  const settings = getAutomationSettings(website);
  if (!settings.autoScoreAfterGeneration) {
    console.log(`[auto1] autoScoreAfterGeneration disabled for ${website.domain} — skipping`);
    return;
  }

  console.log(`[auto1] Starting post-generation scoring for ${website.domain}`);
  try {
    const { scorePageContent } = await import("./scoring");
    const blueprint = (website.settings as any)?.defaultBlueprintId
      ? await storage.getBlueprint((website.settings as any).defaultBlueprintId)
      : null;
    const minScoreForTier1 = (blueprint as any)?.minScoreForTier1 ?? settings.tier1Threshold;

    // Score all unscored pages in batches
    let scored = 0;
    while (true) {
      const unscored = await storage.getUnscoredPages(websiteId, 500);
      if (unscored.length === 0) break;
      for (const p of unscored) {
        try {
          const version = await storage.getActivePageVersion(p.id);
          const banks = await storage.getVariationBanks(websiteId, p.title.split(" in ")[0] || "");
          const scoreResult = scorePageContent(
            version?.contentHtml || "", p.metaDescription || "", p.title, p.wordCount || 0, banks, minScoreForTier1,
          );
          await storage.updatePageScore(p.id, scoreResult.total, scoreResult as any, scoreResult.recommendedTier);
          scored++;
        } catch { /* skip — never block */ }
      }
      if (unscored.length < 500) break;
    }
    console.log(`[auto1] Scored ${scored} pages for ${website.domain}`);

    // Auto 2: Assign tiers based on thresholds
    if (settings.autoAssignTiersAfterScoring) {
      console.log(`[auto2] Assigning tiers for ${website.domain} (T1≥${settings.tier1Threshold}, T3<${settings.tier2Threshold})`);
      const { promoted, promotedSlugs } = await storage.bulkUpdatePageTiers(websiteId, settings.tier1Threshold);
      let demoted = 0;
      if (settings.applyTier3) {
        const r = await storage.bulkSetTier3(websiteId, settings.tier2Threshold);
        demoted = r.demoted;
      }
      console.log(`[auto2] Tiers assigned — promoted:${promoted} demoted:${demoted}`);

      // Auto 4: Submit newly-promoted T1 pages to Google (fire-and-forget)
      if (settings.googleIndexingEnabled && promotedSlugs.length > 0) {
        submitTier1UrlsToGoogle(websiteId, promotedSlugs, website).catch(() => {});
      }

      // Auto 3: Queue sitemap regen with debounce
      if (promoted > 0 || demoted > 0) {
        const pDomain = (website.settings as any)?.parentDomain;
        const pPath = (website.settings as any)?.proxyPath || "";
        const canonBase = pDomain ? `https://${pDomain}${pPath}` : undefined;
        scheduleSitemapRegen(websiteId, website.domain, canonBase, settings.sitemapRegenDebounceMinutes * 60 * 1000);
      }
    }
  } catch (err) {
    console.error(`[auto1] Post-generation scoring failed for ${website.domain}:`, err);
  }
}

// ─── Auto 5: Fallback URL promotion queue ────────────────────────────────────

export async function checkFallbackPromotion(
  websiteId: string,
  slug: string,
  automationSettings: AutomationSettings,
): Promise<void> {
  try {
    const { fallbackHitThreshold, fallbackHitWindowDays } = automationSettings;
    const hit = await storage.getFallbackHit(websiteId, slug);
    if (!hit || hit.promoted) return;
    if (hit.hitCount < fallbackHitThreshold) return;

    // Check if within window
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - fallbackHitWindowDays);
    if (hit.firstSeenAt < windowStart && hit.hitCount < fallbackHitThreshold * 2) return;

    // Create notification for admin (only once — check if already notified)
    const existing = await storage.getNotificationByMeta(websiteId, "fallback_promotion", slug);
    if (existing) return;

    await storage.createAdminNotification({
      websiteId,
      type: "fallback_promotion",
      title: "Fallback URL needs review",
      message: `"/${slug}" has been hit ${hit.hitCount} time(s) and may be worth generating. Approve from the Promotion Queue.`,
      metadata: { slug, hitCount: hit.hitCount, firstSeenAt: hit.firstSeenAt },
    });
    console.log(`[auto5] Promotion notification created for /${slug} (${hit.hitCount} hits)`);
  } catch (err) {
    console.error("[auto5] checkFallbackPromotion failed (non-fatal):", err);
  }
}

// ─── Auto 6: Weekly auto-demote weak Tier 1 pages ────────────────────────────

export async function runWeeklyAutoDemote(): Promise<void> {
  console.log("[auto6] Running weekly auto-demote check...");
  try {
    const allWebsites = await storage.getWebsites();
    for (const website of allWebsites) {
      const settings = getAutomationSettings(website);
      const { autodemoteZeroImpressionDays } = settings;
      try {
        const candidates = await storage.getZeroImpressionTier1Pages(website.id, autodemoteZeroImpressionDays);
        if (candidates.length === 0) continue;
        console.log(`[auto6] ${website.domain}: demoting ${candidates.length} zero-impression T1 page(s)`);
        for (const page of candidates) {
          await storage.updatePageTier(page.id, 2);
          await storage.createDemotionLog({
            websiteId: website.id,
            pageId: page.id,
            fromTier: 1,
            toTier: 2,
            reason: `Zero impressions for more than ${autodemoteZeroImpressionDays} days`,
          });
        }
        await storage.createAdminNotification({
          websiteId: website.id,
          type: "auto_demote",
          title: "Auto-demotion completed",
          message: `${candidates.length} Tier 1 page(s) were demoted to Tier 2 due to zero impressions for more than ${autodemoteZeroImpressionDays} days.`,
          metadata: { count: candidates.length, demotedAt: new Date().toISOString() },
        });

        // Re-queue sitemap regen
        const pDomain = (website.settings as any)?.parentDomain;
        const pPath = (website.settings as any)?.proxyPath || "";
        const canonBase = pDomain ? `https://${pDomain}${pPath}` : undefined;
        scheduleSitemapRegen(website.id, website.domain, canonBase, 60 * 1000);
      } catch (err) {
        console.error(`[auto6] Failed for ${website.domain}:`, err);
      }
    }
    console.log("[auto6] Weekly auto-demote complete.");
  } catch (err) {
    console.error("[auto6] runWeeklyAutoDemote failed:", err);
  }
}

// ─── Auto 7: Flag thin banks after bank update ───────────────────────────────

export async function checkThinBanksAfterUpdate(websiteId: string): Promise<void> {
  try {
    const website = await storage.getWebsite(websiteId);
    if (!website) return;
    const settings = getAutomationSettings(website);
    const threshold = settings.thinBankThreshold;

    const thinBanks = await storage.getThinBankWarnings(websiteId, threshold);
    for (const bank of thinBanks) {
      const existing = await storage.getNotificationByMeta(websiteId, "thin_bank", bank.service);
      if (existing) continue;
      await storage.createAdminNotification({
        websiteId,
        type: "thin_bank",
        title: "Thin variation bank detected",
        message: `Bank for "${bank.service}" is at ${bank.completenessScore}% completeness — below the ${threshold}% threshold. Add more variations to improve Tier 1 eligibility.`,
        metadata: { service: bank.service, completenessScore: bank.completenessScore, threshold },
      });
      console.log(`[auto7] Thin bank notification for "${bank.service}" (${bank.completenessScore}%)`);
    }
  } catch (err) {
    console.error("[auto7] checkThinBanksAfterUpdate failed (non-fatal):", err);
  }
}

// ─── Auto 8: Weekly summary email ────────────────────────────────────────────

export async function sendWeeklySummaryEmails(): Promise<void> {
  console.log("[auto8] Preparing weekly summary emails...");
  try {
    const allWebsites = await storage.getWebsites();
    for (const website of allWebsites) {
      const settings = getAutomationSettings(website);
      if (!settings.weeklyEmailEnabled || !settings.weeklyEmailRecipients.length) continue;

      try {
        const summary = await storage.getWeeklySummaryStats(website.id);
        const subject = `Nexus Weekly Summary — ${website.name || website.domain}`;
        const body = buildWeeklyEmailBody(website, summary);
        await sendEmail(settings.weeklyEmailRecipients, subject, body);
        console.log(`[auto8] Weekly email sent for ${website.domain} → ${settings.weeklyEmailRecipients.join(", ")}`);
      } catch (err) {
        console.error(`[auto8] Weekly email failed for ${website.domain}:`, err);
      }
    }
  } catch (err) {
    console.error("[auto8] sendWeeklySummaryEmails failed:", err);
  }
}

function buildWeeklyEmailBody(website: { name?: string | null; domain: string }, summary: {
  pagesGeneratedLastWeek: number;
  pagesPromotedToTier1: number;
  pagesDemoted: number;
  topFallbackHits: Array<{ slug: string; hitCount: number }>;
  thinBanks: Array<{ service: string; completenessScore: number }>;
  avgQualityScore: number | null;
}): string {
  const siteName = website.name || website.domain;
  const thinBankRows = summary.thinBanks.length
    ? summary.thinBanks.map(b => `  • ${b.service}: ${b.completenessScore}%`).join("\n")
    : "  None";
  const fallbackRows = summary.topFallbackHits.length
    ? summary.topFallbackHits.map(h => `  • /${h.slug}: ${h.hitCount} hits`).join("\n")
    : "  None";

  return `Nexus Weekly Summary — ${siteName}
${"=".repeat(50)}

Pages generated last week : ${summary.pagesGeneratedLastWeek}
Pages promoted to Tier 1  : ${summary.pagesPromotedToTier1}
Pages demoted             : ${summary.pagesDemoted}
Average quality score     : ${summary.avgQualityScore !== null ? summary.avgQualityScore.toFixed(1) : "N/A"}

Top Fallback Hits:
${fallbackRows}

Thin Banks (below threshold):
${thinBankRows}

--
Nexus Platform — ${new Date().toDateString()}
`;
}

// ─── Auto 1 + 2: Background scoring job (visible in Jobs dashboard) ──────────

export async function runAutoScoringJob(
  jobId: string,
  website: { id: string; domain: string; settings?: any; accountId?: string },
  opts?: { skipPublishingHooks?: boolean },
): Promise<void> {
  const settings = getAutomationSettings(website);
  if (!settings.autoScoreAfterGeneration) {
    await storage.updateGenerationJob(jobId, { status: "completed", completedAt: new Date() });
    return;
  }

  await storage.updateGenerationJob(jobId, { status: "running", startedAt: new Date() });

  try {
    const { scorePageContent } = await import("./scoring");
    const blueprint = (website.settings as any)?.defaultBlueprintId
      ? await storage.getBlueprint((website.settings as any).defaultBlueprintId)
      : null;
    const minScoreForTier1 = (blueprint as any)?.minScoreForTier1 ?? settings.tier1Threshold;

    const totalUnscored = await storage.countUnscoredPages(website.id);
    await storage.updateGenerationJob(jobId, { totalPages: totalUnscored || 1 });

    let processed = 0, passed = 0, failed = 0;

    while (true) {
      const currentJob = await storage.getGenerationJob(jobId);
      if (currentJob?.status === "cancelled") {
        console.log(`[auto1] Scoring job ${jobId} cancelled`);
        break;
      }

      const unscored = await storage.getUnscoredPages(website.id, 500);
      if (unscored.length === 0) break;

      for (const p of unscored) {
        try {
          const version = await storage.getActivePageVersion(p.id);
          const banks = await storage.getVariationBanks(website.id, p.title.split(" in ")[0] || "");
          const scoreResult = scorePageContent(
            version?.contentHtml || "", p.metaDescription || "", p.title, p.wordCount || 0, banks, minScoreForTier1,
          );
          await storage.updatePageScore(p.id, scoreResult.total, scoreResult as any, scoreResult.recommendedTier);
          passed++;
        } catch {
          failed++;
        }
        processed++;
      }

      await storage.updateGenerationJob(jobId, { processedPages: processed, passedPages: passed, failedPages: failed });
      if (unscored.length < 500) break;
    }

    // Auto 2: Assign tiers after scoring
    if (settings.autoAssignTiersAfterScoring) {
      console.log(`[auto2] Assigning tiers for ${website.domain}`);
      const { promoted, promotedSlugs } = await storage.bulkUpdatePageTiers(website.id, settings.tier1Threshold);
      let demoted = 0;
      if (settings.applyTier3) {
        const r = await storage.bulkSetTier3(website.id, settings.tier2Threshold);
        demoted = r.demoted;
      }
      console.log(`[auto2] Tiers assigned — promoted:${promoted} demoted:${demoted}`);

      // Phase 6 — when scoring runs against a draft generation, suppress Auto 3 (sitemap regen)
      // and Auto 4 (Google indexing). Tier assignment above still completes normally.
      if (!opts?.skipPublishingHooks) {
        if (settings.googleIndexingEnabled && promotedSlugs.length > 0) {
          submitTier1UrlsToGoogle(website.id, promotedSlugs, website).catch(() => {});
        }
        if (promoted > 0 || demoted > 0) {
          const pDomain = (website.settings as any)?.parentDomain;
          const pPath = (website.settings as any)?.proxyPath || "";
          const canonBase = pDomain ? `https://${pDomain}${pPath}` : undefined;
          scheduleSitemapRegen(website.id, website.domain, canonBase, settings.sitemapRegenDebounceMinutes * 60 * 1000);
        }
      } else {
        console.log(`[auto1] Draft mode — Auto 3 (sitemap regen) and Auto 4 (Google indexing) suppressed for ${website.domain}`);
      }
    }

    await storage.updateGenerationJob(jobId, {
      status: "completed",
      completedAt: new Date(),
      processedPages: processed,
      passedPages: passed,
      failedPages: failed,
    });
    console.log(`[auto1] Scoring job complete — ${passed} scored, ${failed} failed for ${website.domain}`);
  } catch (err) {
    console.error(`[auto1] Scoring job ${jobId} failed:`, err);
    await storage.updateGenerationJob(jobId, { status: "error", completedAt: new Date() });
  }
}

// ─── Auto 6: Weekly demote with Jobs dashboard visibility ─────────────────────

export async function runWeeklyAutoDemoteWithJobs(): Promise<void> {
  console.log("[auto6] Running weekly auto-demote check (with job tracking)...");
  try {
    const allWebsites = await storage.getWebsites();
    for (const website of allWebsites) {
      const settings = getAutomationSettings(website);
      const { autodemoteZeroImpressionDays } = settings;
      try {
        const candidates = await storage.getZeroImpressionTier1Pages(website.id, autodemoteZeroImpressionDays);
        if (candidates.length === 0) continue;

        // Create a job record so it's visible in the Jobs dashboard
        const demoteJob = await storage.createGenerationJob({
          accountId: website.accountId!,
          websiteId: website.id,
          name: `Auto-Demote: ${website.domain}`,
          status: "running",
          totalPages: candidates.length,
          processedPages: 0,
          passedPages: 0,
          failedPages: 0,
          settings: { type: "auto_demote", reason: `Zero impressions for ${autodemoteZeroImpressionDays} days` },
        });

        let processed = 0, failed = 0;
        console.log(`[auto6] ${website.domain}: demoting ${candidates.length} zero-impression T1 page(s)`);
        for (const page of candidates) {
          try {
            await storage.updatePageTier(page.id, 2);
            await storage.createDemotionLog({
              websiteId: website.id,
              pageId: page.id,
              fromTier: 1,
              toTier: 2,
              reason: `Zero impressions for more than ${autodemoteZeroImpressionDays} days`,
            });
            processed++;
          } catch {
            failed++;
          }
        }

        await storage.createAdminNotification({
          websiteId: website.id,
          type: "auto_demote",
          title: "Auto-demotion completed",
          message: `${processed} Tier 1 page(s) were demoted to Tier 2 due to zero impressions for more than ${autodemoteZeroImpressionDays} days.`,
          metadata: { count: processed, demotedAt: new Date().toISOString() },
        });

        const pDomain = (website.settings as any)?.parentDomain;
        const pPath = (website.settings as any)?.proxyPath || "";
        const canonBase = pDomain ? `https://${pDomain}${pPath}` : undefined;
        scheduleSitemapRegen(website.id, website.domain, canonBase, 60 * 1000);

        await storage.updateGenerationJob(demoteJob.id, {
          status: "completed",
          completedAt: new Date(),
          processedPages: processed,
          passedPages: processed,
          failedPages: failed,
        });
        console.log(`[auto6] ${website.domain}: demote job done — ${processed} demoted, ${failed} failed`);
      } catch (err) {
        console.error(`[auto6] Failed for ${website.domain}:`, err);
      }
    }
    console.log("[auto6] Weekly auto-demote complete.");
  } catch (err) {
    console.error("[auto6] runWeeklyAutoDemoteWithJobs failed:", err);
  }
}

async function sendEmail(to: string[], subject: string, body: string): Promise<void> {
  const smtpUrl = process.env.SMTP_URL;
  if (!smtpUrl) {
    console.warn("[auto8] SMTP_URL not set — email not sent. Recipients:", to.join(", "));
    console.warn("[auto8] Subject:", subject);
    return;
  }
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport(smtpUrl);
  await transporter.sendMail({
    from: process.env.SMTP_FROM || "noreply@nexus.io",
    to: to.join(", "),
    subject,
    text: body,
  });
}
