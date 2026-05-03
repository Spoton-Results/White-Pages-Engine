# SpotOn Nexus — Canonical Operating Blueprint

_Last updated: May 3, 2026_

This document is the durable project source of truth for SpotOn Nexus / White Pages Engine. It combines the uploaded Nexus product references, the current GitHub repository direction, and the Railway + Cloudflare/R2 scale plan.

The purpose of this file is to prevent accidental strategy drift. Every future architecture, scaling, SEO, migration, and deployment decision should be checked against this document.

---

## 1. Product Identity

SpotOn Nexus is a white-label, multi-tenant programmatic SEO publishing platform for marketing agencies.

It lets an agency create large local SEO page networks for its clients, usually by combining:

- client/account
- website/domain
- brand profile
- services
- industries
- locations
- query clusters
- page blueprints
- hub pages
- internal links
- published pages
- leads and conversion tracking
- sitemap/indexing controls

The business objective is to help agencies create scalable, managed white-pages style SEO assets for their clients without manually building every location/service page.

The platform must be able to support high-volume page networks, including 50,000+ pages for a single client and a long-term vision of 1,000,000+ total pages across tenants.

---

## 2. Business Model Canonical

SpotOn Nexus is not a self-serve consumer website builder.

Canonical business model:

- Sold to agencies and/or managed clients.
- Operated as a done-for-you or managed platform.
- Shawn / SpotOn Results controls setup, hosting logic, page strategy, rollout pace, and scaling architecture.
- Agencies use the output for their clients.
- The core value is scalable local SEO publishing, not generic website design.

Primary buyers:

- marketing agencies
- local SEO agencies
- niche service-business marketers
- agencies serving contractors, merchants, home services, or local businesses

The platform should prioritize:

- scale
- reliability
- SEO safety
- page speed
- low hosting cost per page
- agency-client multi-tenancy
- repeatable generation workflows
- controlled rollout
- defensible operational guardrails

---

## 3. Current Infrastructure Canonical

Older project documents reference Replit, Cloudflare Workers, proxy routes, and Replit-hosted public pages. Those references are important historical/product context, but the current scale direction is:

```text
Railway = application/backend/admin/generation/API layer
Postgres = source of truth
Cloudflare + R2 = future published public SEO page delivery layer
GitHub = source-controlled application and schema truth
```

This is the canonical scale architecture going forward:

```text
Railway is the software brain.
Postgres is the source of truth.
Cloudflare/R2 is the public SEO page delivery layer.
```

Railway should not permanently serve every public SEO page request when a client can have 50,000 pages. Railway should handle software logic. Cloudflare/R2 should handle high-volume static public page delivery after pages are rendered and proven valid.

---

## 4. What Stays on Railway

Railway must remain responsible for application functionality:

- admin dashboard
- login/authentication
- account management
- website management
- brand profiles
- industries
- locations
- services
- query clusters
- blueprints
- hub pages
- bulk generation
- generation jobs
- AI workflows
- QA/scoring
- approvals/publishing logic
- reports
- billing
- onboarding
- preview/editing
- API routes
- webhooks
- lead form API endpoints
- fallback page serving
- migration runners
- background jobs, where appropriate

Railway should remain the control plane. It should not be treated as the cheapest place to serve millions of static SEO page views.

---

## 5. What Moves Toward Cloudflare/R2

Only final, published, public-facing SEO HTML artifacts should move toward Cloudflare/R2.

Examples:

- published service-city pages
- published industry-city pages
- published problem-intent pages
- published state hubs
- published city hubs
- generated sitemap files after validation
- static public assets that do not require authentication

R2/Cloudflare should not serve:

- `/admin`
- `/dashboard`
- `/login`
- `/auth/*`
- `/api/*`
- `/billing/*`
- `/onboarding/*`
- `/preview/*`
- `/generate/*`
- `/webhooks/*`
- any authenticated route
- any route that creates, edits, deletes, pays, logs in, submits private data, or runs generation logic

---

## 6. SEO Canonical Rules

The SEO objective is not just to reduce Railway usage. The objective is to reduce Railway usage without damaging indexability, rankings, crawlability, or conversion tracking.

Non-negotiable SEO rules:

1. Keep the same public URLs.
2. Keep canonical URLs stable unless explicitly approved.
3. Keep titles, meta descriptions, schema, H1s, internal links, and rendered HTML behavior stable.
4. Do not create mass 404s.
5. Do not add `noindex` during infrastructure migration unless explicitly intended.
6. Do not change sitemap structure until page serving is proven stable.
7. Do not list URLs in sitemap files that cannot reliably return valid HTML.
8. Do not require client-side JavaScript to render core SEO content.
9. Do not replace rich content with thin placeholder pages.
10. Do not remove old database-backed serving until fallback-first static serving is proven.

Google should see the same page, at the same URL, only faster and more reliably.

---

## 7. R2 Migration Philosophy

The R2 migration is not an app replacement. It is a page delivery optimization.

Correct thinking:

```text
Postgres stores the canonical page data.
Railway generates and manages the page.
Railway renders final HTML.
Railway uploads final HTML to R2.
Cloudflare serves that HTML to public traffic.
Railway remains fallback if R2 misses.
```

Incorrect thinking:

```text
Move the whole app to R2.
Delete database content.
Let R2 replace the admin app.
Serve missing pages as 404.
Cut over globally before testing.
```

---

## 8. Current Schema Prep Direction

For static rendered page delivery, the pages table needs metadata that can track rendered artifacts.

Canonical fields:

```ts
r2Key: text("r2_key"),
contentHash: text("content_hash"),
renderedAt: timestamp("rendered_at", { withTimezone: true }),
```

Current discovery:

- `r2_key` already exists on `pages`.
- `content_hash` and `rendered_at` are needed for static render tracking.
- The first migration should be nullable and non-destructive.
- No default values, no backfill, no destructive SQL in Phase 1.

The schema prep step should never change public page serving by itself.

---

## 9. Guardrails for R2 Static SEO Rollout

The active guardrails issue is:

https://github.com/Spoton-Results/White-Pages-Engine/issues/5

All future R2/static delivery work must follow these guardrails.

Key guardrails:

- same URL guarantee
- fallback-first serving
- no destructive content migration
- published pages only
- form/API protection
- sitemap protection
- render integrity using content hashes
- controlled batch limits
- rollout flags
- observability
- hard stop conditions

Feature flags should exist before live public cutover:

```text
R2_RENDERING_ENABLED
R2_SERVING_ENABLED
R2_FALLBACK_ENABLED
R2_PER_WEBSITE_ENABLEMENT
```

Default live serving should be safe/off until tested.

---

## 10. Scale Architecture for 50,000+ Pages Per Client

A client with 50,000 pages must not depend on Railway rendering every public page request forever.

Bad long-term pattern:

```text
Googlebot or visitor hits URL
→ Railway handles request
→ app queries Postgres
→ app builds HTML
→ app returns response
```

Scale-safe pattern:

```text
Googlebot or visitor hits URL
→ Cloudflare checks R2
→ valid static HTML exists
→ Cloudflare serves from edge
→ Railway is not touched
```

Fallback-safe pattern:

```text
Googlebot or visitor hits URL
→ Cloudflare checks R2
→ missing or invalid object
→ request falls back to Railway
→ Railway serves database-backed page
→ fallback is logged
```

The goal is a high R2/edge hit rate for public pages while keeping Railway available for misses and application functionality.

---

## 11. Lead Form and Conversion Protection

Static pages can still convert leads if forms submit to Railway/API endpoints.

Correct pattern:

```text
Static public page served by R2/Cloudflare
→ visitor submits form
→ form POSTs to Railway API endpoint
→ Railway stores lead
→ Railway triggers notifications/webhooks/workflows
```

Do not route API or form submission paths through static serving.

Every static page rollout must confirm:

- form action is correct
- API endpoint bypasses R2/static worker logic
- CORS/domain behavior works
- spam/security protections still apply
- lead records are created
- notifications still fire

---

## 12. Sitemap Canonical

Sitemaps are powerful and dangerous at this scale.

Rules:

- Do not publish sitemap URLs that return 404.
- Do not move sitemap serving to R2 until listed URLs are either rendered in R2 or safely served by Railway fallback.
- Keep `noindex` behavior unchanged.
- Sitemap generation should respect page status, index status, noindex, and rollout phase.
- Large clients should use sitemap indexes and chunked sitemap files, not one huge sitemap.

A safe sitemap URL must satisfy:

```text
status = published
noindex = false
URL returns valid HTML
canonical matches expected URL
page has content/title/meta/schema
```

---

## 13. Rollout Sequence Canonical

The safe sequence is:

### Phase 1 — Schema Prep

Add nullable static render metadata.

No runtime serving change.

### Phase 2 — Render/Upload Support

Add R2 client and render-to-R2 service.

No live public serving cutover.

### Phase 3 — Small Batch Backfill

Render a small test set.

Recommended early batch sizes:

```text
10 pages
50 pages
250 pages
500 pages
```

Do not start with 50,000 pages.

### Phase 4 — HTML Integrity Verification

Compare Railway-rendered HTML and R2-rendered HTML.

Verify:

- title
- meta description
- H1
- canonical
- schema
- internal links
- lead form
- status code
- byte size
- content hash

### Phase 5 — Cloudflare Worker Fallback-First Serving

Worker checks R2 first for eligible public routes.

If missing, fallback to Railway.

### Phase 6 — One Website Pilot

Enable for one test website only.

Do not enable globally.

### Phase 7 — Monitor and Expand

Expand by website/account only after errors are low and fallback works.

---

## 14. Hard Stop Conditions

Pause rollout immediately if any of these occur:

- public 404 spike
- 5xx spike
- lead form failures
- API route interference
- canonical mismatch
- sitemap includes broken URLs
- static HTML missing title/meta/schema
- R2 upload failures exceed acceptable threshold
- fallback to Railway fails
- Googlebot gets different/broken content
- page speed gets worse instead of better
- database write paths break
- admin/auth routes are cached or exposed incorrectly

---

## 15. Suggested Observability

Track at minimum:

- R2 hit count
- R2 miss count
- Railway fallback count
- render success count
- render failure count
- upload success count
- upload failure count
- pages with missing R2 object
- pages with stale content hash
- public 404 count
- public 5xx count
- average TTFB for public pages
- lead form success/failure rate
- sitemap URL validation status

For agency scale, the dashboard should eventually show:

```text
Website
Published pages
Rendered pages
Missing R2 pages
Stale pages
Failed renders
Last render time
Last sitemap generation
R2 hit rate
Fallback rate
Lead form health
```

---

## 16. Future Table Recommendation

The immediate migration can use `pages.r2_key`, `pages.content_hash`, and `pages.rendered_at`.

At larger scale, add a dedicated artifact table:

```text
page_static_artifacts
```

Suggested fields:

```text
id
page_id
website_id
slug
r2_key
content_hash
render_status
rendered_at
last_publish_version_id
http_status
byte_size
error_message
created_at
updated_at
```

Why this matters:

- better render history
- retry visibility
- stale artifact detection
- safer batch operations
- easier per-website rollout
- cleaner operational dashboard

Do not rush this table unless the simple page-level metadata becomes insufficient.

---

## 17. Repo Change Rules

Every future PR should state:

1. Does this change live public serving?
2. Does this affect SEO URLs/canonicals/sitemaps?
3. Does this affect forms/API/auth/admin routes?
4. Does this include destructive SQL?
5. Is there a fallback path?
6. Is the change feature-flagged?
7. Which guardrails from issue #5 does it touch?

Destructive database changes are not allowed unless explicitly approved after a backup/rollback plan.

---

## 18. Current Next Moves

Canonical next moves from this point:

1. Finish/merge schema prep PR.
2. Add R2 render/upload support only.
3. Do not change live serving yet.
4. Render a small batch of published pages.
5. Verify static HTML integrity.
6. Build Cloudflare Worker fallback-first serving.
7. Enable for one test website.
8. Monitor errors, forms, sitemap, Googlebot behavior, and Railway usage.
9. Expand per website, not globally.

---

## 19. Permanent Strategic Rule

The platform wins only if it scales without sacrificing SEO safety or app functionality.

Therefore:

```text
Do not optimize hosting cost at the expense of indexability.
Do not optimize speed at the expense of forms and conversion tracking.
Do not optimize scale by removing fallback.
Do not treat static delivery as a replacement for the application.
```

The correct target state:

```text
Cloudflare/R2 handles most published public SEO traffic.
Railway handles app logic, generation, APIs, admin, forms, and fallback.
Postgres remains the source of truth.
GitHub contains the controlled architecture and migration history.
```
