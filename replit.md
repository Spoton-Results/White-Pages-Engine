# Nexus Platform — White-Pages Publishing SaaS

A production-grade multi-tenant white-pages publishing platform with Claude AI for content generation.

## Architecture

- **Frontend**: React + Wouter + TanStack Query + shadcn/ui (Vite)
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL via Drizzle ORM
- **AI**: Anthropic Claude (claude-3-5-haiku) — first-pass + adversarial review
- **Storage**: Cloudflare R2 (optional) for page artifacts, sitemaps, logs
- **Auth**: Express Sessions + bcryptjs

## Key Features

- Multi-tenant: accounts → websites → pages hierarchy
- Full AI pipeline: prompt build → first-pass → QA rules → second-pass review
- Draft review UI with approve/prune
- Publish queue (single + bulk)
- Sitemap generation (splits at 50k URLs, generates index)
- Generation jobs run async (fire-and-forget, 5s poll)
- Role system: super_admin / account_admin / editor / viewer

## Project Structure

```
shared/schema.ts         # Drizzle schema + Zod types (15 tables)
server/
  index.ts               # Express entry (seeds DB on start)
  routes.ts              # All API routes
  storage.ts             # Database query layer
  auth.ts                # Session auth + bcrypt
  seed.ts                # Demo data (2 accounts, 13 locations, 6 services...)
  services/
    claude.ts            # First-pass + adversarial review
    generation.ts        # Full generation pipeline
    r2.ts                # Cloudflare R2 S3 client
    sitemap.ts           # XML sitemap + index generator
client/src/
  App.tsx                # All routes + auth guard
  hooks/use-auth.ts      # Auth hook
  lib/api.ts             # Fetch wrapper
  pages/
    login.tsx            # Login page
    dashboard/           # Overview with live stats
    accounts/            # Client account management
    websites/            # Domain management
    brand-profiles/      # Brand voice/identity
    locations/           # States, cities, neighborhoods
    services/            # Service offerings
    industries/          # Industry verticals
    query-clusters/      # Keyword cluster management
    blueprints/          # Page generation templates
    drafts/              # Draft review + approve/prune
    publish-queue/       # Approved pages ready to publish
    published/           # Published page management
    jobs/                # AI generation job creation + monitoring
    sitemaps/            # XML sitemap management
    users/               # User & role management
```

## Environment Variables Required

- `DATABASE_URL` — PostgreSQL connection string (auto-provisioned)
- `SESSION_SECRET` — Session signing secret
- `ANTHROPIC_API_KEY` — Required for generation jobs
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` — Optional (R2 storage)
- `R2_PUBLIC_BASE_URL` — Optional R2 public base URL
- `APP_BASE_URL` — Optional app base URL

## Demo Login

- **Email**: admin@nexus.io
- **Password**: admin123

## Seed Data

Two accounts pre-seeded:
1. **Acme Plumbing Co** (Atlanta, GA) — 4 services, 8 locations, 3 blueprints, 5 pages
2. **National HVAC Group** — 2 services, 4 locations, 1 blueprint, 1 page

## Database Tables

accounts, users, brandProfiles, websites, locations, services, industries,
queryClusters, blueprints, pages, pageVersions, internalLinks,
generationJobs, sitemaps, pageMetrics

## Commands

- `npm run dev` — Start development server
- `npm run db:push` — Sync Drizzle schema to PostgreSQL
- `npm run build` — Production build

## Deployment

Configured for autoscale deployment. R2 is optional — generation workflow degrades gracefully without it.
