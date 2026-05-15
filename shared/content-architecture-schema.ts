import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  decimal,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import {
  accounts,
  websites,
  services,
  locations,
  blueprints,
  pages,
  generationJobs,
  users,
} from "./schema";

export const sectionRegistry = pgTable("section_registry", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: varchar("key", { length: 100 }).notNull(),
  label: text("label").notNull(),
  description: text("description"),
  defaultOrder: integer("default_order").notNull().default(0),
  sectionType: varchar("section_type", { length: 50 }).notNull().default("content"),
  requiredDefault: boolean("required_default").notNull().default(false),
  supportsLocalization: boolean("supports_localization").notNull().default(false),
  supportsSchema: boolean("supports_schema").notNull().default(false),
  minWords: integer("min_words"),
  maxWords: integer("max_words"),
  metadata: jsonb("metadata").notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("section_registry_key_unique").on(t.key),
  index("idx_section_registry_active").on(t.isActive),
  index("idx_section_registry_type_order").on(t.sectionType, t.defaultOrder),
]);

export const blueprintSections = pgTable("blueprint_sections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  blueprintId: varchar("blueprint_id").notNull().references(() => blueprints.id, { onDelete: "cascade" }),
  sectionId: varchar("section_id").notNull().references(() => sectionRegistry.id, { onDelete: "restrict" }),
  sortOrder: integer("sort_order").notNull().default(0),
  required: boolean("required").notNull().default(true),
  minVariations: integer("min_variations").notNull().default(1),
  promptTemplate: text("prompt_template"),
  renderTemplate: text("render_template"),
  schemaType: varchar("schema_type", { length: 100 }),
  metadata: jsonb("metadata").notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("blueprint_sections_blueprint_section_unique").on(t.blueprintId, t.sectionId),
  index("idx_blueprint_sections_blueprint_order").on(t.blueprintId, t.sortOrder),
  index("idx_blueprint_sections_section").on(t.sectionId),
]);

export const variationGenerations = pgTable("variation_generations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  websiteId: varchar("website_id").references(() => websites.id, { onDelete: "cascade" }),
  serviceId: varchar("service_id").references(() => services.id, { onDelete: "set null" }),
  locationId: varchar("location_id").references(() => locations.id, { onDelete: "set null" }),
  blueprintId: varchar("blueprint_id").references(() => blueprints.id, { onDelete: "set null" }),
  sectionId: varchar("section_id").references(() => sectionRegistry.id, { onDelete: "set null" }),
  generationJobId: varchar("generation_job_id").references(() => generationJobs.id, { onDelete: "set null" }),
  batchId: varchar("batch_id", { length: 120 }),
  provider: varchar("provider", { length: 80 }).notNull().default("anthropic"),
  model: varchar("model", { length: 120 }).notNull(),
  prompt: text("prompt").notNull(),
  systemPrompt: text("system_prompt"),
  promptHash: varchar("prompt_hash", { length: 128 }),
  temperature: decimal("temperature", { precision: 4, scale: 2 }),
  maxTokens: integer("max_tokens"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  latencyMs: integer("latency_ms"),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").notNull().default({}),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_variation_generations_account").on(t.accountId),
  index("idx_variation_generations_website").on(t.websiteId),
  index("idx_variation_generations_batch").on(t.batchId),
  index("idx_variation_generations_section").on(t.sectionId),
  index("idx_variation_generations_status").on(t.status),
  index("idx_variation_generations_created").on(t.createdAt),
]);

export const variationVersions = pgTable("variation_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  generationId: varchar("generation_id").references(() => variationGenerations.id, { onDelete: "set null" }),
  accountId: varchar("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  websiteId: varchar("website_id").references(() => websites.id, { onDelete: "cascade" }),
  serviceId: varchar("service_id").references(() => services.id, { onDelete: "set null" }),
  locationId: varchar("location_id").references(() => locations.id, { onDelete: "set null" }),
  sectionId: varchar("section_id").notNull().references(() => sectionRegistry.id, { onDelete: "restrict" }),
  content: text("content").notNull(),
  contentHash: varchar("content_hash", { length: 128 }),
  active: boolean("active").notNull().default(true),
  versionNumber: integer("version_number").notNull().default(1),
  seoScore: integer("seo_score"),
  freshnessScore: integer("freshness_score"),
  uniquenessScore: integer("uniqueness_score"),
  wordCount: integer("word_count"),
  lastUsedAt: timestamp("last_used_at"),
  usageCount: integer("usage_count").notNull().default(0),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_variation_versions_account").on(t.accountId),
  index("idx_variation_versions_website").on(t.websiteId),
  index("idx_variation_versions_service_section").on(t.serviceId, t.sectionId),
  index("idx_variation_versions_active").on(t.active),
  index("idx_variation_versions_quality").on(t.sectionId, t.active, t.seoScore, t.freshnessScore),
  index("idx_variation_versions_usage").on(t.lastUsedAt, t.usageCount),
]);

export const publishedPageSections = pgTable("published_page_sections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  sectionId: varchar("section_id").notNull().references(() => sectionRegistry.id, { onDelete: "restrict" }),
  variationVersionId: varchar("variation_version_id").references(() => variationVersions.id, { onDelete: "set null" }),
  contentSnapshot: text("content_snapshot").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  renderMetadata: jsonb("render_metadata").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("published_page_sections_page_section_unique").on(t.pageId, t.sectionId),
  index("idx_published_page_sections_page_order").on(t.pageId, t.sortOrder),
  index("idx_published_page_sections_section").on(t.sectionId),
  index("idx_published_page_sections_variation").on(t.variationVersionId),
]);

export const insertSectionRegistrySchema = createInsertSchema(sectionRegistry).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBlueprintSectionSchema = createInsertSchema(blueprintSections).omit({ id: true, createdAt: true, updatedAt: true });
export const insertVariationGenerationSchema = createInsertSchema(variationGenerations).omit({ id: true, createdAt: true });
export const insertVariationVersionSchema = createInsertSchema(variationVersions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPublishedPageSectionSchema = createInsertSchema(publishedPageSections).omit({ id: true, createdAt: true });

export type InsertSectionRegistry = z.infer<typeof insertSectionRegistrySchema>;
export type SectionRegistry = typeof sectionRegistry.$inferSelect;
export type InsertBlueprintSection = z.infer<typeof insertBlueprintSectionSchema>;
export type BlueprintSection = typeof blueprintSections.$inferSelect;
export type InsertVariationGeneration = z.infer<typeof insertVariationGenerationSchema>;
export type VariationGeneration = typeof variationGenerations.$inferSelect;
export type InsertVariationVersion = z.infer<typeof insertVariationVersionSchema>;
export type VariationVersion = typeof variationVersions.$inferSelect;
export type InsertPublishedPageSection = z.infer<typeof insertPublishedPageSectionSchema>;
export type PublishedPageSection = typeof publishedPageSections.$inferSelect;
