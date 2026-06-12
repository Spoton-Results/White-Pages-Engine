import { sql } from "drizzle-orm";
import {
  pgTable, text, varchar, integer, boolean, timestamp, jsonb, decimal, pgEnum,
  index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Enums ──────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", ["super_admin", "account_admin", "editor", "viewer"]);
export const accountPlanEnum = pgEnum("account_plan", ["starter", "pro", "enterprise"]);
export const accountStatusEnum = pgEnum("account_status", ["active", "paused", "suspended"]);
export const websiteStatusEnum = pgEnum("website_status", ["live", "syncing", "error", "paused"]);
export const pageStatusEnum = pgEnum("page_status", ["draft", "review", "approved", "published", "pruned"]);
export const jobStatusEnum = pgEnum("job_status", ["pending", "running", "completed", "failed", "cancelled"]);
export const pageTypeEnum = pgEnum("page_type", [
  "state_hub",
  "city_hub",
  "service_city",
  "industry_city",
  "problem_intent",
  "state_service",
  "industry_state",
  "service_problem",
  "city_service_problem",
  "comparison",
]);
export const locationTypeEnum = pgEnum("location_type", ["state", "city", "neighborhood", "county"]);

// ─── Core Tables ─────────────────────────────────────────────────────────────

export const agencies = pgTable("agencies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  monthlyFee: decimal("monthly_fee"),
  startDate: text("start_date"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAgencySchema = createInsertSchema(agencies).omit({ id: true, createdAt: true });
export type InsertAgency = z.infer<typeof insertAgencySchema>;
export type Agency = typeof agencies.$inferSelect;

export const accounts = pgTable("accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agencyId: varchar("agency_id").references(() => agencies.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: accountPlanEnum("plan").notNull().default("starter"),
  status: accountStatusEnum("status").notNull().default("active"),
  clientStatus: varchar("client_status", { length: 20 }).notNull().default("active"),
  reportToken: varchar("report_token", { length: 64 }),
  monthlySeoSpend: decimal("monthly_seo_spend", { precision: 10, scale: 2 }).default("0"),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_accounts_agency_id").on(t.agencyId),
]);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: userRoleEnum("role").notNull().default("viewer"),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_users_account_id").on(t.accountId),
]);

export const brandProfiles = pgTable("brand_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  tagline: text("tagline"),
  description: text("description"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  socialLinks: jsonb("social_links").default({}),
  voiceAndTone: text("voice_and_tone"),
  customFields: jsonb("custom_fields").default({}),
  // ✅ ADDED: Page generation override fields
  websiteUrl: text("website_url"),
  phoneOverride: text("phone_override"),
  ctaHeading: text("cta_heading"),
  ctaBody: text("cta_body"),
  ctaButtonLabel: text("cta_button_label"),
  demoBannerUrl: text("demo_banner_url"),
  demoBannerHeading: text("demo_banner_heading"),
  demoBannerSubtext: text("demo_banner_subtext"),
  demoBannerButton: text("demo_banner_button"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});


// Brand Profiles - AI Picture Library Phase 1A storage foundation
export const brandMedia = pgTable("brand_media", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  brandProfileId: varchar("brand_profile_id").notNull().references(() => brandProfiles.id, { onDelete: "cascade" }),
  websiteId: varchar("website_id").references(() => websites.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull(),
  publicUrl: text("public_url").notNull(),
  prompt: text("prompt"),
  category: text("category").notNull().default("business_general"),
  altText: text("alt_text"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_brand_media_brand_profile_id").on(t.brandProfileId),
  index("idx_brand_media_website_id").on(t.websiteId),
  index("idx_brand_media_category").on(t.category),
]);

// Existing Website schema remains unchanged
export const websites = pgTable("websites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  brandProfileId: varchar("brand_profile_id").references(() => brandProfiles.id),
  name: text("name").notNull(),
  domain: text("domain").notNull().unique(),
  subdomain: text("subdomain"),
  status: websiteStatusEnum("status").notNull().default("paused"),
  primaryIndustry: text("primary_industry"),
  targetLocale: text("target_locale").default("en-US"),
  robotsTxt: text("robots_txt"),
  customHead: text("custom_head"),
  r2Prefix: text("r2_prefix"),
  publishedPages: integer("published_pages").notNull().default(0),
  settings: jsonb("settings").default({}),
  onboardingStatus: varchar("onboarding_status", { length: 30 }).default("manual"),
  onboardingSubmissionId: varchar("onboarding_submission_id").references(() => onboardingSubmissions.id),
  launchCap: integer("launch_cap").default(100),
  warmupMode: boolean("warmup_mode").default(true),
  warmupExpiresAt: timestamp("warmup_expires_at"),
  firstPublishAt: timestamp("first_publish_at"),
  coveragePlan: varchar("coverage_plan", { length: 20 }).default("regional"),
  tier1WeeklySubmitCap: integer("tier1_weekly_submit_cap").default(50),
  protectionMode: boolean("protection_mode").default(false),
  protectionExpiresAt: timestamp("protection_expires_at"),
  warmupDay: integer("warmup_day").default(0),
  warmupPageCapOverride: integer("warmup_page_cap_override"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_websites_account_id").on(t.accountId),
  index("idx_websites_domain_lower").on(sql`lower(${t.domain})`),
  index("idx_websites_protection_mode").on(t.protectionMode),
]);

// ─── Location / Service / Industry / Query ───────────────────────────────────

export const locations = pgTable("locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  type: locationTypeEnum("type").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  stateCode: text("state_code"),
  stateName: text("state_name"),
  population: integer("population"),
  cityTier: integer("city_tier"),
  lat: decimal("lat", { precision: 10, scale: 7 }),
  lng: decimal("lng", { precision: 10, scale: 7 }),
  parentId: varchar("parent_id"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_locations_account_id").on(t.accountId),
]);

export const services = pgTable("services", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  keywords: text("keywords").array().default([]),
  industryId: varchar("industry_id"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_services_account_id").on(t.accountId),
]);

export const industries = pgTable("industries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  naicsCode: text("naics_code"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const queryClusters = pgTable("query_clusters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  serviceId: varchar("service_id").references(() => services.id),
  name: text("name").notNull(),
  intentType: text("intent_type").notNull(),
  primaryKeyword: text("primary_keyword").notNull(),
  secondaryKeywords: text("secondary_keywords").array().default([]),
  searchVolume: integer("search_volume"),
  difficulty: integer("difficulty"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_query_clusters_account_id").on(t.accountId),
]);

// ─── Blueprints ───────────────────────────────────────────────────────────────

export const blueprints = pgTable("blueprints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  websiteId: varchar("website_id").references(() => websites.id),
  name: text("name").notNull(),
  pageType: pageTypeEnum("page_type").notNull(),
  titleTemplate: text("title_template").notNull(),
  metaDescTemplate: text("meta_desc_template").notNull(),
  h1Template: text("h1_template").notNull(),
  slugTemplate: text("slug_template").notNull(),
  sections: jsonb("sections").notNull().default([]),
  requiredWordCount: integer("required_word_count").notNull().default(600),
  minPublishScore: decimal("min_publish_score", { precision: 4, scale: 2 }).notNull().default("0.70"),
  minLocalSignal: decimal("min_local_signal", { precision: 4, scale: 2 }).notNull().default("0.60"),
  maxSimilarityThreshold: decimal("max_similarity_threshold", { precision: 4, scale: 2 }).notNull().default("0.85"),
  promptFamily: text("prompt_family").notNull().default("local_service"),
  faqEnabled: boolean("faq_enabled").notNull().default(true),
  schemaTypes: text("schema_types").array().default(["LocalBusiness", "FAQPage"]),
  isActive: boolean("is_active").notNull().default(true),
  defaultTier: integer("default_tier").notNull().default(2),
  minScoreForTier1: integer("min_score_for_tier1").notNull().default(80),
  cityTierRules: jsonb("city_tier_rules"),
  minBankCompleteness: integer("min_bank_completeness").notNull().default(70),
  maxCitiesPerState: integer("max_cities_per_state"),
  stateAllowlist: text("state_allowlist").array(),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_blueprints_account_id").on(t.accountId),
  index("idx_blueprints_website_id").on(t.websiteId),
]);

// ─── Pages ────────────────────────────────────────────────────────────────────

export const pages = pgTable("pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  blueprintId: varchar("blueprint_id").references(() => blueprints.id),
  locationId: varchar("location_id").references(() => locations.id),
  serviceId: varchar("service_id").references(() => services.id),
  industryId: varchar("industry_id").references(() => industries.id),
  queryClusterId: varchar("query_cluster_id").references(() => queryClusters.id),
  pageType: pageTypeEnum("page_type").notNull(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  metaDescription: text("meta_description"),
  h1: text("h1").notNull(),
  canonicalUrl: text("canonical_url"),
  status: pageStatusEnum("status").notNull().default("draft"),
  publishScore: decimal("publish_score", { precision: 4, scale: 2 }),
  localSignalScore: decimal("local_signal_score", { precision: 4, scale: 2 }),
  wordCount: integer("word_count"),
  passedQa: boolean("passed_qa"),
  qaReport: jsonb("qa_report"),
  publishedAt: timestamp("published_at"),
  pruneReason: text("prune_reason"),
  r2Key: text("r2_key"),
  tier: integer("tier").notNull().default(2),
  qualityScore: integer("quality_score"),
  scoreBreakdown: jsonb("score_breakdown"),
  indexStatus: text("index_status").notNull().default("queued"),
  fallbackHitCount: integer("fallback_hit_count").notNull().default(0),
  lastEvaluatedAt: timestamp("last_evaluated_at"),
  rolloutPhase: text("rollout_phase"),
  promotionStatus: text("promotion_status").notNull().default("default"),
  noindex: boolean("noindex").notNull().default(false),
  isDraft: boolean("is_draft").default(false),
  draftReason: varchar("draft_reason", { length: 50 }),
  publishWave: integer("publish_wave").default(0),
  overridePublishedBy: varchar("override_published_by", { length: 100 }),
  overridePublishedAt: timestamp("override_published_at"),
  gscSubmittedAt: timestamp("gsc_submitted_at"),
  duplicateFlag: boolean("duplicate_flag").default(false),
  duplicateOfSlug: varchar("duplicate_of_slug", { length: 500 }),
  duplicateSimilarity: decimal("duplicate_similarity", { precision: 5, scale: 4 }),
  trustScore: integer("trust_score"),
  evidenceScore: integer("evidence_score"),
  contentQualityScore: integer("content_quality_score"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_pages_website_id").on(t.websiteId),
  index("idx_pages_website_slug").on(t.websiteId, t.slug),
  index("idx_pages_website_status").on(t.websiteId, t.status),
  index("idx_pages_website_updated").on(t.websiteId, t.updatedAt),
  index("idx_pages_website_created").on(t.websiteId, t.createdAt),
  index("idx_pages_status").on(t.status),
  index("idx_pages_updated_at").on(t.updatedAt),
  index("idx_pages_duplicate_flag").on(t.websiteId, t.duplicateFlag),
  index("idx_pages_gsc_submitted").on(t.websiteId, t.gscSubmittedAt),
  index("idx_pages_publish_wave").on(t.websiteId, t.publishWave),
  index("idx_pages_pub_tier").on(t.websiteId, t.tier).where(sql`status = 'published'`),
  index("idx_pages_pub_slug").on(t.websiteId, t.slug).where(sql`status = 'published'`),
  index("idx_pages_pub_quality").on(t.websiteId, t.qualityScore).where(sql`status = 'published'`),
  index("idx_pages_pub_updated").on(t.websiteId, t.updatedAt).where(sql`status = 'published'`),
  index("idx_pages_pub_tier_qscore").on(t.websiteId, t.tier).where(sql`status = 'published'`),
  index("idx_pages_recent_activity").on(t.websiteId, t.updatedAt),
]);

// ─── Onboarding Submissions ──────────────────────────────────────────────────

export const onboardingSubmissions = pgTable("onboarding_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  token: varchar("token", { length: 64 }).notNull(),
  stripeSessionId: varchar("stripe_session_id", { length: 255 }),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  planType: varchar("plan_type", { length: 50 }),
  agencyId: varchar("agency_id").references(() => accounts.id),
  accountId: varchar("account_id"),
  websiteId: varchar("website_id"),
  status: varchar("status", { length: 30 }).default("pending"),
  formData: jsonb("form_data"),
  readinessScore: integer("readiness_score").default(0),
  readinessResult: jsonb("readiness_result"),
  onboardingNotes: text("onboarding_notes"),
  governorResults: jsonb("governor_results"),
  brandInputScore: integer("brand_input_score"),
  brandInputResult: jsonb("brand_input_result"),
  gapReport: jsonb("gap_report"),
  createdAt: timestamp("created_at").defaultNow(),
  submittedAt: timestamp("submitted_at"),
  generationStartedAt: timestamp("generation_started_at"),
  completedAt: timestamp("completed_at"),
}, (t) => [
  uniqueIndex("onboarding_submissions_token_unique").on(t.token),
]);

export const insertOnboardingSubmissionSchema = createInsertSchema(onboardingSubmissions).omit({
  id: true,
  createdAt: true,
});
export type InsertOnboardingSubmission = z.infer<typeof insertOnboardingSubmissionSchema>;
export type OnboardingSubmission = typeof onboardingSubmissions.$inferSelect;

export const pageVersions = pgTable("page_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  contentHtml: text("content_html").notNull(),
  contentJson: jsonb("content_json"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  reviewNotes: text("review_notes"),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_page_versions_page_id").on(t.pageId),
  index("idx_page_versions_active").on(t.pageId, t.isActive),
]);

export const internalLinks = pgTable("internal_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  fromPageId: varchar("from_page_id").notNull().references(() => pages.id),
  toPageId: varchar("to_page_id").notNull().references(() => pages.id),
  anchorText: text("anchor_text").notNull(),
  linkType: text("link_type").notNull().default("contextual"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_internal_links_website_id").on(t.websiteId),
]);

// ─── Generation Jobs ─────────────────────────────────────────────────────────

export const generationJobs = pgTable("generation_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().references(() => accounts.id),
  websiteId: varchar("website_id").notNull().references(() => websites.id),
  blueprintId: varchar("blueprint_id").references(() => blueprints.id),
  name: text("name").notNull(),
  status: jobStatusEnum("status").notNull().default("pending"),
  totalPages: integer("total_pages").notNull().default(0),
  processedPages: integer("processed_pages").notNull().default(0),
  passedPages: integer("passed_pages").notNull().default(0),
  failedPages: integer("failed_pages").notNull().default(0),
  errorLog: jsonb("error_log").default([]),
  settings: jsonb("settings").default({}),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_generation_jobs_account_id").on(t.accountId),
  index("idx_generation_jobs_website_id").on(t.websiteId),
]);

// ─── Sitemaps ─────────────────────────────────────────────────────────────────

export const sitemaps = pgTable("sitemaps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  urlCount: integer("url_count").notNull().default(0),
  r2Key: text("r2_key"),
  xmlContent: text("xml_content"),
  lastGenerated: timestamp("last_generated"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_sitemaps_website_id").on(t.websiteId),
]);

// ─── Page Metrics ─────────────────────────────────────────────────────────────

export const pageMetrics = pgTable("page_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  websiteId: varchar("website_id").notNull().references(() => websites.id),
  date: text("date").notNull(),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  avgPosition: decimal("avg_position", { precision: 6, scale: 2 }),
  ctr: decimal("ctr", { precision: 6, scale: 4 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Variation Banks (hybrid template system) ────────────────────────────────

export const contentVariationBanks = pgTable("content_variation_banks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  service: text("service").notNull(),
  sectionName: text("section_name").notNull(),
  variations: jsonb("variations").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("cvb_website_service_section_unique").on(
    t.websiteId,
    t.service,
    t.sectionName,
  ),
]);

export const stateData = pgTable("state_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stateName: text("state_name").notNull(),
  stateAbbr: text("state_abbr").notNull(),
  population: integer("population").notNull(),
  businessCount: integer("business_count").notNull(),
  majorCities: jsonb("major_cities").notNull().default([]),
  landmarks: jsonb("landmarks").notNull().default([]),
  businessCulture: text("business_culture").notNull(),
  paymentRegulations: text("payment_regulations").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("state_data_state_abbr_unique").on(t.stateAbbr),
]);

// ─── Leads ────────────────────────────────────────────────────────────────────

export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  pageId: varchar("page_id").references(() => pages.id, { onDelete: "set null" }),
  pageSlug: text("page_slug"),
  name: text("name").notNull(),
  businessName: text("business_name"),
  email: text("email").notNull(),
  phone: text("phone"),
  message: text("message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Fallback Hit Logs ────────────────────────────────────────────────────────

export const fallbackHitLogs = pgTable("fallback_hit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  hitCount: integer("hit_count").notNull().default(1),
  firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  promoted: boolean("promoted").notNull().default(false),
  promotedAt: timestamp("promoted_at"),
});

// ─── Variation Bank Completeness ──────────────────────────────────────────────

export const variationBankCompleteness = pgTable("variation_bank_completeness", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  service: text("service").notNull(),
  hasIntro: boolean("has_intro").notNull().default(false),
  hasHowItWorks: boolean("has_how_it_works").notNull().default(false),
  hasBenefits: boolean("has_benefits").notNull().default(false),
  hasFaq: boolean("has_faq").notNull().default(false),
  hasCta: boolean("has_cta").notNull().default(false),
  hasLocalContext: boolean("has_local_context").notNull().default(false),
  hasUseCase: boolean("has_use_case").notNull().default(false),
  hasProofTrust: boolean("has_proof_trust").notNull().default(false),
  hasPainPoint: boolean("has_pain_point").notNull().default(false),
  hasLocalStat: boolean("has_local_stat").notNull().default(false),
  totalVariations: integer("total_variations").notNull().default(0),
  avgVariationsPerSection: integer("avg_variations_per_section").notNull().default(0),
  completenessScore: integer("completeness_score").notNull().default(0),
  isEligibleForTier1: boolean("is_eligible_for_tier1").notNull().default(false),
  lastComputedAt: timestamp("last_computed_at").notNull().defaultNow(),
});

// ─── Hub Pages ────────────────────────────────────────────────────────────────

export const hubPages = pgTable("hub_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  accountId: varchar("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  hubType: text("hub_type").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  tier: integer("tier").notNull().default(1),
  qualityScore: integer("quality_score"),
  status: text("status").notNull().default("draft"),
  content: text("content"),
  parentSlug: text("parent_slug"),
  maxChildLinks: integer("max_child_links").notNull().default(30),
  metaDescription: text("meta_description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_hub_pages_account_id").on(t.accountId),
  index("idx_hub_pages_website_id").on(t.websiteId),
]);

// ─── Insert Schemas & Types ───────────────────────────────────────────────────

export const insertAccountSchema = createInsertSchema(accounts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertBrandProfileSchema = createInsertSchema(brandProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBrandMediaSchema = createInsertSchema(brandMedia).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWebsiteSchema = createInsertSchema(websites).omit({ id: true, createdAt: true, updatedAt: true, publishedPages: true });
export const insertLocationSchema = createInsertSchema(locations).omit({ id: true, createdAt: true });
export const insertServiceSchema = createInsertSchema(services).omit({ id: true, createdAt: true });
export const insertIndustrySchema = createInsertSchema(industries).omit({ id: true, createdAt: true });
export const insertQueryClusterSchema = createInsertSchema(queryClusters).omit({ id: true, createdAt: true });
export const insertBlueprintSchema = createInsertSchema(blueprints).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPageSchema = createInsertSchema(pages).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPageVersionSchema = createInsertSchema(pageVersions).omit({ id: true, createdAt: true });
export const insertGenerationJobSchema = createInsertSchema(generationJobs).omit({ id: true, createdAt: true });
export const insertSitemapSchema = createInsertSchema(sitemaps).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPageMetricSchema = createInsertSchema(pageMetrics).omit({ id: true, createdAt: true });

export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertBrandProfile = z.infer<typeof insertBrandProfileSchema>;
export type BrandProfile = typeof brandProfiles.$inferSelect;
export type InsertBrandMedia = z.infer<typeof insertBrandMediaSchema>;
export type BrandMedia = typeof brandMedia.$inferSelect;
export type InsertWebsite = z.infer<typeof insertWebsiteSchema>;
export type Website = typeof websites.$inferSelect;
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Location = typeof locations.$inferSelect;
export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof services.$inferSelect;
export type InsertIndustry = z.infer<typeof insertIndustrySchema>;
export type Industry = typeof industries.$inferSelect;
export type InsertQueryCluster = z.infer<typeof insertQueryClusterSchema>;
export type QueryCluster = typeof queryClusters.$inferSelect;
export type InsertBlueprint = z.infer<typeof insertBlueprintSchema>;
export type Blueprint = typeof blueprints.$inferSelect;
export type InsertPage = z.infer<typeof insertPageSchema>;
export type Page = typeof pages.$inferSelect;
export type InsertPageVersion = z.infer<typeof insertPageVersionSchema>;
export type PageVersion = typeof pageVersions.$inferSelect;
export type InsertGenerationJob = z.infer<typeof insertGenerationJobSchema>;
export type GenerationJob = typeof generationJobs.$inferSelect;
export type InsertSitemap = z.infer<typeof insertSitemapSchema>;
export type Sitemap = typeof sitemaps.$inferSelect;
export type InsertPageMetric = z.infer<typeof insertPageMetricSchema>;
export type PageMetric = typeof pageMetrics.$inferSelect;

export const insertContentVariationBankSchema = createInsertSchema(contentVariationBanks).omit({ id: true, createdAt: true });
export const insertStateDataSchema = createInsertSchema(stateData).omit({ id: true, createdAt: true });
export type InsertContentVariationBank = z.infer<typeof insertContentVariationBankSchema>;
export type ContentVariationBank = typeof contentVariationBanks.$inferSelect;
export type InsertStateData = z.infer<typeof insertStateDataSchema>;
export type StateData = typeof stateData.$inferSelect;

export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;

export const insertFallbackHitLogSchema = createInsertSchema(fallbackHitLogs).omit({ id: true, firstSeenAt: true, lastSeenAt: true });
export type InsertFallbackHitLog = z.infer<typeof insertFallbackHitLogSchema>;
export type FallbackHitLog = typeof fallbackHitLogs.$inferSelect;

export const insertVariationBankCompletenessSchema = createInsertSchema(variationBankCompleteness).omit({ id: true, lastComputedAt: true });
export type InsertVariationBankCompleteness = z.infer<typeof insertVariationBankCompletenessSchema>;
export type VariationBankCompleteness = typeof variationBankCompleteness.$inferSelect;

export const insertHubPageSchema = createInsertSchema(hubPages).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHubPage = z.infer<typeof insertHubPageSchema>;
export type HubPage = typeof hubPages.$inferSelect;

// ─── Admin Notifications ──────────────────────────────────────────────────────

export const adminNotifications = pgTable("admin_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_admin_notif_website").on(t.websiteId, t.createdAt),
]);

export const insertAdminNotificationSchema = createInsertSchema(adminNotifications).omit({ id: true, createdAt: true });
export type InsertAdminNotification = z.infer<typeof insertAdminNotificationSchema>;
export type AdminNotification = typeof adminNotifications.$inferSelect;

// ─── Demotion Logs ────────────────────────────────────────────────────────────

export const demotionLogs = pgTable("demotion_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  pageId: varchar("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  fromTier: integer("from_tier").notNull(),
  toTier: integer("to_tier").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_demotion_logs_website").on(t.websiteId, t.createdAt),
]);

export const insertDemotionLogSchema = createInsertSchema(demotionLogs).omit({ id: true, createdAt: true });
export type InsertDemotionLog = z.infer<typeof insertDemotionLogSchema>;
export type DemotionLog = typeof demotionLogs.$inferSelect;

// ─── Phase 9: Launch Health Scores ───────────────────────────────────────────

export const launchHealthScores = pgTable("launch_health_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  score: integer("score").default(0),
  maxScore: integer("max_score").default(100),
  breakdown: jsonb("breakdown"),
  calculatedAt: timestamp("calculated_at").defaultNow(),
}, (t) => [
  index("idx_launch_health_website").on(t.websiteId),
  index("idx_launch_health_date").on(t.calculatedAt),
]);
export type LaunchHealthScore = typeof launchHealthScores.$inferSelect;

// ─── Phase 9: Client Weekly Digests ──────────────────────────────────────────

export const clientWeeklyDigests = pgTable("client_weekly_digests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  accountId: varchar("account_id").notNull(),
  recipientEmail: varchar("recipient_email", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 500 }),
  bodyHtml: text("body_html"),
  bodyText: text("body_text"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
  status: varchar("status", { length: 20 }).default("pending"),
}, (t) => [
  index("idx_client_digest_website").on(t.websiteId),
  index("idx_client_digest_status").on(t.status),
]);
export type ClientWeeklyDigest = typeof clientWeeklyDigests.$inferSelect;

// ─── Phase 10: Call Tracking Numbers ─────────────────────────────────────────

export const callTrackingNumbers = pgTable("call_tracking_numbers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  pageId: varchar("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  serviceId: varchar("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  locationId: varchar("location_id").references(() => locations.id, { onDelete: "set null" }),
  dynamicNumber: varchar("dynamic_number", { length: 20 }).notNull(),
  forwardToNumber: varchar("forward_to_number", { length: 20 }).notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  uniqueIndex("call_tracking_numbers_dynamic_number_unique").on(t.dynamicNumber),
  index("idx_call_tracking_page").on(t.pageId),
  index("idx_call_tracking_website").on(t.websiteId),
]);

export const insertCallTrackingNumberSchema = createInsertSchema(callTrackingNumbers).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCallTrackingNumber = z.infer<typeof insertCallTrackingNumberSchema>;
export type CallTrackingNumber = typeof callTrackingNumbers.$inferSelect;

// ─── Phase 10: Tracked Calls ──────────────────────────────────────────────────

export const trackedCalls = pgTable("tracked_calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  pageId: varchar("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  serviceId: varchar("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  locationId: varchar("location_id").references(() => locations.id, { onDelete: "set null" }),
  dynamicNumber: varchar("dynamic_number", { length: 20 }).notNull(),
  callerPhoneHash: varchar("caller_phone_hash", { length: 255 }),
  callDurationSeconds: integer("call_duration_seconds"),
  callTimestamp: timestamp("call_timestamp").notNull(),
  callStatus: varchar("call_status", { length: 50 }),
  callProviderId: varchar("call_provider_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_tracked_calls_website").on(t.websiteId),
  index("idx_tracked_calls_page").on(t.pageId),
  index("idx_tracked_calls_timestamp").on(t.callTimestamp),
]);

export const insertTrackedCallSchema = createInsertSchema(trackedCalls).omit({ id: true, createdAt: true });
export type InsertTrackedCall = z.infer<typeof insertTrackedCallSchema>;
export type TrackedCall = typeof trackedCalls.$inferSelect;

// ─── Phase 10: Tracked Leads ─────────────────────────────────────────────────

export const trackedLeads = pgTable("tracked_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  pageId: varchar("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  serviceId: varchar("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  locationId: varchar("location_id").references(() => locations.id, { onDelete: "set null" }),
  formName: varchar("form_name", { length: 255 }),
  submitterName: varchar("submitter_name", { length: 255 }),
  submitterEmail: varchar("submitter_email", { length: 255 }),
  submitterPhone: varchar("submitter_phone", { length: 20 }),
  message: text("message"),
  sourcePageUrl: text("source_page_url"),
  sourcePageTitle: varchar("source_page_title", { length: 255 }),
  formTimestamp: timestamp("form_timestamp").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_tracked_leads_website").on(t.websiteId),
  index("idx_tracked_leads_page").on(t.pageId),
  index("idx_tracked_leads_timestamp").on(t.formTimestamp),
]);

export const insertTrackedLeadSchema = createInsertSchema(trackedLeads).omit({ id: true, createdAt: true });
export type InsertTrackedLead = z.infer<typeof insertTrackedLeadSchema>;
export type TrackedLead = typeof trackedLeads.$inferSelect;

// ─── Phase 10: Booked Jobs ────────────────────────────────────────────────────

export const bookedJobs = pgTable("booked_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").references(() => trackedLeads.id, { onDelete: "set null" }),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  pageId: varchar("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  accountId: varchar("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  jobValue: decimal("job_value", { precision: 10, scale: 2 }),
  bookedDate: timestamp("booked_date").notNull(),
  status: varchar("status", { length: 50 }).default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_booked_jobs_account").on(t.accountId),
  index("idx_booked_jobs_page").on(t.pageId),
  index("idx_booked_jobs_date").on(t.bookedDate),
]);

export const insertBookedJobSchema = createInsertSchema(bookedJobs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBookedJob = z.infer<typeof insertBookedJobSchema>;
export type BookedJob = typeof bookedJobs.$inferSelect;
