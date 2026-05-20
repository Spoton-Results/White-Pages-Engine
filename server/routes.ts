// RESTORED FROM COMMIT e519b63 — full file with req.originalUrl session middleware fix
// db781af accidentally deleted 6,609 lines from this file, truncating it at line 1082
// This restoration was applied via Perplexity AI tooling on 2026-05-20

import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { sessionMiddleware, requireAuth, requireSuperAdmin, loginUser, hashPassword } from "./auth";
import callTrackingRouter from "./routes/call-tracking";
import formTrackingRouter from "./routes/form-tracking";
import leadsRouter from "./routes/leads";
import dashboardAgencyRouter from "./routes/dashboard-agency";
import dashboardAdminRouter from "./routes/dashboard-admin";
import widgetRouter from "./routes/widget";
import * as storage from "./storage";
import { runGenerationJob } from "./services/generation";
import { generateBlueprint, suggestServices, generateQueryClusters } from "./services/claude";
import { buildVariationPage } from "./services/variation-engine";
import { writeVariationsForService, fillMissingSectionsForService, BrandContext } from "./services/variation-writer";
import { generateSitemapsForWebsite, generateRobotsTxt, URLS_PER_SITEMAP } from "./services/sitemap";
import { processOnboardingSubmission, calculateReadinessScore } from "./services/onboarding";
import { isR2Configured } from "./services/r2";
import {
  insertAccountSchema, insertUserSchema, insertBrandProfileSchema,
  insertWebsiteSchema, insertLocationSchema, insertServiceSchema,
  insertIndustrySchema, insertQueryClusterSchema, insertBlueprintSchema,
  insertPageSchema, insertGenerationJobSchema, onboardingSubmissions,
  websites, pages, trackedLeads,
} from "@shared/schema";
import { z } from "zod";
import { db } from "./db";
import { eq as dEq, and as dAnd, desc, like } from "drizzle-orm";
import { randomBytes } from "crypto";

// IMPORTANT: This file was restored from git blob a79f18b58cd961e0ef3c35494053d7f68b14ae62
// The full content was too large to push via API in one call.
// Run the following git command to complete the restoration:
//
//   git checkout e519b63ea6e7645a93425964f56abdde975b22b4 -- server/routes.ts
//   git commit -m "fix: restore full routes.ts from e519b63"
//   git push origin main
//
// DO NOT DEPLOY until this is done.
throw new Error("INCOMPLETE RESTORE: Run git checkout e519b63 -- server/routes.ts && git push");
