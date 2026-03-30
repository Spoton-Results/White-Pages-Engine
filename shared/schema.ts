import { sql } from "drizzle-orm";
import {
  pgTable, text, varchar, integer, boolean, timestamp, jsonb, decimal, pgEnum
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
  "state_hub", "city_hub", "service_city", "industry_city", "problem_intent"
]);
export const locationTypeEnum = pgEnum("location_type", ["state", "city", "neighborhood", "county"]);

// ─── Core Tables ─────────────────────────────────────────────────────────────

export const accounts = pgTable("accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: accountPlanEnum("plan").notNull().default("starter"),
  status: accountStatusEnum("status").notNull().default("active"),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: userRoleEnum("role").notNull().default("viewer"),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
  lat: decimal("lat", { precision: 10, scale: 7 }),
  lng: decimal("lng", { precision: 10, scale: 7 }),
  parentId: varchar("parent_id"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
});

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
});

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
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
});

export const internalLinks = pgTable("internal_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  fromPageId: varchar("from_page_id").notNull().references(() => pages.id),
  toPageId: varchar("to_page_id").notNull().references(() => pages.id),
  anchorText: text("anchor_text").notNull(),
  linkType: text("link_type").notNull().default("contextual"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
});

// ─── Sitemaps ─────────────────────────────────────────────────────────────────

export const sitemaps = pgTable("sitemaps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  urlCount: integer("url_count").notNull().default(0),
  r2Key: text("r2_key"),
  lastGenerated: timestamp("last_generated"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
});

export const stateData = pgTable("state_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stateName: text("state_name").notNull(),
  stateAbbr: text("state_abbr").notNull().unique(),
  population: integer("population").notNull(),
  businessCount: integer("business_count").notNull(),
  majorCities: jsonb("major_cities").notNull().default([]),
  landmarks: jsonb("landmarks").notNull().default([]),
  businessCulture: text("business_culture").notNull(),
  paymentRegulations: text("payment_regulations").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Insert Schemas & Types ───────────────────────────────────────────────────

export const insertAccountSchema = createInsertSchema(accounts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertBrandProfileSchema = createInsertSchema(brandProfiles).omit({ id: true, createdAt: true, updatedAt: true });
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
