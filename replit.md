# Nexus Platform — White-Pages Publishing SaaS

A production-grade multi-tenant white-pages publishing platform built for SpotOn Results (merchant services). Targets 100K+ SEO pages across services × locations × query clusters.

## Architecture

- **Frontend**: React + Wouter + TanStack Query + shadcn/ui (Vite)
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL via Drizzle ORM
- **AI**: Anthropic Claude (`claude-haiku-4-5-20251001`) — use only this model; larger models hit quota
- **Storage**: Cloudflare R2 (optional) for page artifacts, sitemaps, logs
- **Auth**: Express Sessions + bcryptjs

## Key Features

- Multi-tenant: accounts → websites → pages hierarchy
- Full AI pipeline: prompt build → first-pass → QA rules → second-pass review
- Hybrid template system: variation banks + AI fill-in for unlimited unique pages
- Draft review UI with approve/prune
- Publish queue (single + bulk)
- Sitemap generation (splits at 50k URLs, generates index)
- Generation jobs run async (fire-and-forget, 5s poll)
- Role system: super_admin / account_admin / editor / viewer
- Contact form on all pages → leads table → Leads admin page at `/leads`
- Backlinks on all pages: header brand, CTA section, footer → all link to `mainWebsiteUrl`
- State/city navigation grids on all pages (deduped, sorted A-Z)

## Project Structure

```
shared/schema.ts         # Drizzle schema + Zod types (16 tables)
server/
  index.ts               # Express entry (seeds DB on start)
  routes.ts              # All API routes + renderPageHtml template
  storage.ts             # Database query layer
  auth.ts                # Session auth + bcrypt
  seed.ts                # SpotOn seed: 6 services, 50 state locs, 30 city locs, 50 state_data
  services/
    claude.ts            # First-pass + adversarial review
    generation.ts        # Full generation pipeline
    variation-engine.ts  # Template-based page generation (no API quota)
    variation-writer.ts  # AI-writes variation banks
    r2.ts                # Cloudflare R2 S3 client
    sitemap.ts           # XML sitemap + index generator
client/src/
  App.tsx                # All routes + auth guard
  hooks/use-auth.ts      # Auth hook
  lib/api.ts             # Fetch wrapper (already parses JSON — don't call .json() on result)
  pages/
    login.tsx
    dashboard/
    accounts/
    websites/
    brand-profiles/
    locations/
    services/
    industries/
    query-clusters/
    blueprints/
    drafts/
    publish-queue/
    published/
    jobs/
    sitemaps/
    users/
    leads/               # Leads admin (/leads) — contact form submissions
```

## SpotOn Results Production Config

- **Website ID**: `b7cfd050-7a02-4ef2-bcdb-1e044b063c3f`
- **Account ID**: `70ec4b1c-80b2-4c17-9d22-f63275d21310`
- **Domain**: `pages.spotonresults.com`
- **Main site**: `https://www.spotonresults.com`
- **CTA**: heading/text/button configured in website settings
- **Email leads**: set `contactEmail` in website settings + SMTP_* env vars
- **Pages**: regenerate via variation engine (bulk generate state + city pages)

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string (auto-provisioned)
- `SESSION_SECRET` — Session signing secret
- `ANTHROPIC_API_KEY` — Required for AI generation; use `claude-haiku-4-5-20251001`
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — Optional email for lead notifications
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` — Optional

## Demo Login

- **Email**: admin@nexus.io
- **Password**: admin123

## Database Tables

accounts, users, brandProfiles, websites, locations, services, industries,
queryClusters, blueprints, pages, pageVersions, internalLinks,
generationJobs, sitemaps, pageMetrics, contentVariationBanks, stateData, leads

## Commands

- `npm run dev` — Start development server
- `npm run db:push` — Sync Drizzle schema to PostgreSQL
- `npm run build` — Production build

## Page Template (renderPageHtml)

All public pages include:
1. Header with clickable brand name → mainWebsiteUrl
2. Hero section (title, meta description)
3. Main content (AI-generated HTML)
4. Contact form (submits to `/api/public/contact`, creates a lead)
5. Location nav grids (states A-Z + cities for current state if applicable)
6. Footer with brand link + phone + main URL

## Deployment

Configured for autoscale deployment. R2 is optional — generation workflow degrades gracefully without it.
