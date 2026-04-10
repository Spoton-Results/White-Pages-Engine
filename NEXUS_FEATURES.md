# Nexus White-Pages Platform — Full Feature Reference

> Multi-tenant SEO publishing platform serving 1.5M+ programmatic pages across multiple client domains.  
> Built for SpotOn Results and SubTracker.

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [PLATFORM Section](#2-platform-section)
   - Accounts
   - Websites
   - Brand Profiles
   - Industries
   - Locations
   - Services
   - Query Clusters
   - Blueprints
   - Hub Pages
3. [CONTENT Section](#3-content-section)
   - Published Pages
   - Leads
   - Bulk Generator
   - Generation Jobs
   - Sitemap Manager
   - Internal Links
   - Automation
   - Bank Health
   - SEO Control
4. [ADMIN Section](#4-admin-section)
   - Users & Roles
   - Operations Guide
5. [AI Generation Features](#5-ai-generation-features)
6. [Technical Architecture](#6-technical-architecture)

---

## 1. Platform Overview

Nexus is a white-label programmatic SEO platform that generates, hosts, and manages thousands of location-service pages per client. Each page targets a specific service + location combination (e.g., "Plumbing Services in Austin, TX") and is served through Cloudflare Workers at sub-100ms response times.

**Key numbers:**
- 1.5M+ published pages across all tenants
- 8 automated SEO workflows (scoring, tiering, sitemap, indexing, promotion, demotion, thin-bank detection, weekly digest)
- Multi-tenant: one admin panel manages all client websites from a single interface
- Supports spotonresults.com/pages and subtrackers.spotonresults.com/pages as primary tenants

---

## 2. PLATFORM Section

### Accounts

The top-level container for all client data.

| Feature | Description |
|---|---|
| Create account | Name + URL-safe slug; one account per client company |
| List accounts | View all accounts with page counts and website counts |
| Account switcher | Available on every page that is account-scoped |
| Delete account | Removes account and all associated data |

---

### Websites

Maps a domain to a set of published pages.

| Feature | Description |
|---|---|
| Create website | Domain, parent domain, proxy path, account assignment |
| Edit website | Update name, domain, settings |
| Website settings | Automation thresholds, Google Indexing, email digest |
| Page count sync | Automatically keeps published-page counts accurate |
| Multi-website support | One account can have multiple websites (e.g., main site + subdomain) |
| Cloudflare proxy | Workers serve pages from `/{proxy-path}/*` on the parent domain |

---

### Brand Profiles

Stores the brand voice and identity that is injected into every generated page.

| Feature | Description |
|---|---|
| Create profile | Name, tagline, description, phone, email, voice & tone |
| View profiles | Card grid showing all profiles for the selected account |
| Delete profile | Remove a profile (does not affect already-generated pages) |
| **AI Generate Fields** | Enter brand name → AI fills tagline, description, and voice & tone in one click |

---

### Industries

Classifies content by business vertical for filtering and SEO categorization.

| Feature | Description |
|---|---|
| Create industry | Name, URL slug, NAICS code, description |
| List industries | Table view with all fields |
| Delete industry | Remove unused industries |
| **AI Fill Description** | Enter industry name → AI writes a description and lists related services |

---

### Locations

Manages every geographic target — states, cities, counties, and neighborhoods.

| Feature | Description |
|---|---|
| Add single location | Type (state/city/county/neighborhood), name, slug, state code, population |
| Bulk import — by state | Select one or more US states to import all cities within them |
| Bulk import — by region | Import cities by US geographic region (Northeast, Southeast, etc.) |
| Bulk import — by metro area | Import cities grouped by metro/DMA |
| Bulk import — paste CSV | Paste `City, ST` or `City, StateName` lines to import custom lists |
| Search & filter | Search by name or state code; filter by Tier 1/2/3 city size |
| Top-N filter | Display top 20 / 50 / 100 / 250 / 500 / 1000 cities by population |
| City tier display | Tier 1 = 500K+, Tier 2 = 100K–500K, Tier 3 = <100K population |
| Delete location | Remove individual locations |
| **AI Suggest Cities** | Enter business type + state → AI recommends best cities to target; select/deselect and bulk-import |

---

### Services

The services a business offers — each service drives a full page matrix.

| Feature | Description |
|---|---|
| Create service | Name, slug, description, keywords |
| List services | All services for the selected account |
| Delete service | Remove service (does not delete already-generated pages) |
| **AI Suggest Services** | Enter business name + industry → AI suggests service names, slugs, descriptions, and keywords |
| Variation bank generation | Per-service: generates 5 variations × 8 content sections using Claude AI |
| Fill missing sections | Generates only sections that are empty in the variation bank |

---

### Query Clusters

Groups of related keyword intents used to diversify generated page content.

| Feature | Description |
|---|---|
| Create cluster | Cluster name, intent type, keyword list |
| List clusters | All clusters for the selected account |
| Delete cluster | Remove a cluster |
| **AI Generate Clusters** | Enter service or topic → AI generates a full cluster with intent-grouped keywords |
| Per-blueprint AI generation | Blueprints can trigger cluster generation for each service they cover |

---

### Blueprints

Templates that define the structure, tone, and sections of a generated page.

| Feature | Description |
|---|---|
| Create blueprint | Name, page type, industry, service, HTML structure with placeholders |
| List blueprints | All blueprints for the selected account |
| Edit blueprint | Modify HTML structure, sections, and settings |
| Delete blueprint | Remove unused blueprints |
| **AI Generate Blueprint** | Enter business type + page type → AI writes a full HTML blueprint with all sections |
| Preview blueprint | View rendered HTML before using it for generation |
| Variation bank link | Each blueprint is associated with a service's variation bank |

---

### Hub Pages

Parent "hub" pages that link to and organize groups of child pages.

| Feature | Description |
|---|---|
| Create hub page | Title, slug, hub type (state / service / custom), content |
| Edit hub page | Update title, content, child links, max child link count |
| Publish hub page | Marks hub page as published and visible in sitemap |
| Bulk create hub pages | Enter a list of names → create many hub pages at once |
| **AI content generation** | Optional: AI writes hub page content during bulk creation |
| Child page linking | Hub pages automatically link to their most-relevant child pages |
| Bulk publish | Publish all hub pages in one action |
| Hub page list | View all hub pages with status, type, and child count |
| Delete hub page | Remove hub page (child pages are not deleted) |

---

## 3. CONTENT Section

### Published Pages

The full inventory of all live SEO pages across all websites.

| Feature | Description |
|---|---|
| View all pages | Paginated table of every published page with title, slug, tier, score |
| Filter by website | Switch between websites in the account |
| Filter by tier | Show only Tier 1 / Tier 2 / Tier 3 pages |
| Filter by score range | Min and max quality score filter |
| Filter by service | Show pages for a specific service |
| Filter by location | Search by city name (ILIKE match) |
| Filter by blueprint | Show pages using a specific blueprint |
| Search | Full-text search across title and slug |
| Sort | Sort by score, tier, date, or title |
| Pagination | Configurable page size (25 / 50 / 100 / 250) |
| Preview page | Open the live published page in a new tab |
| Page detail | View quality score, tier, word count, meta description, last updated |
| Edit page | Manually edit title, meta description, or tier |
| Delete page | Remove a published page |
| Export CSV | Download all filtered pages as a CSV file |
| Bulk score | Score all unscored pages for the selected website |
| Bulk tier assignment | Assign tiers to pages based on score thresholds |
| View page content | Inspect the generated HTML of any page |

---

### Leads

Contact form submissions from published pages.

| Feature | Description |
|---|---|
| View all leads | Card-based feed of all incoming leads |
| Filter by website | Show leads for one website or all websites |
| Search | Search by name, email, business name, page slug, or message content |
| Duplicate detection | Flags leads with the same email address across submissions |
| Duplicate filter | Toggle to show only leads with duplicate emails |
| Lead detail | Name, business, email (mailto link), phone (tel link), source page, timestamp |
| Export CSV | Download filtered leads as CSV |
| **AI Qualify** | Per-lead button: AI scores 0–100 (Hot/Warm/Cold), explains why, and writes a ready-to-send draft reply |
| Copy draft reply | One-click copy of AI-generated response |
| Open in email client | Pre-filled mailto link with the draft reply |

---

### Bulk Generator

Generates pages in bulk from configured data.

| Feature | Description |
|---|---|
| Select website | Choose which website to generate for |
| Select services | Pick one, many, or all services |
| Select locations | Pick one, many, or all locations |
| Select blueprint | Choose the page template to use |
| Dry run / estimate | Preview how many pages will be generated before running |
| Run generation | Launch the bulk generation job in the background |
| Progress tracking | Job progress is tracked and viewable in Generation Jobs |
| Duplicate detection | Skips pages that already exist at the same slug |
| AI first pass | Claude writes the initial page HTML using the blueprint and variation bank |
| Post-generation scoring | Optionally auto-score all newly generated pages (Automation 1) |
| Post-generation tiering | Optionally auto-assign tiers after scoring (Automation 2) |

---

### Generation Jobs

Tracks the status and history of all background generation tasks.

| Feature | Description |
|---|---|
| Job list | All generation jobs with status, progress, page counts |
| Job types | Bulk page generation, scoring, tiering, sitemap regen, bank writes |
| Live progress | Job progress updates in real time |
| Job detail | Start time, end time, pages generated, pages failed |
| Error reporting | Failed pages are logged with error messages |
| Cancel job | Stop a running job (where applicable) |

---

### Sitemap Manager

Controls the XML sitemaps served to search engines.

| Feature | Description |
|---|---|
| View sitemaps | List all sitemaps for the selected website |
| Generate sitemap | Build or rebuild the sitemap from all published Tier 1 + Tier 2 pages |
| Sitemap stats | Page count, last generated date, file size |
| Download sitemap | View/download the XML file |
| Auto-regeneration | Sitemaps are automatically rebuilt after tier changes (Automation 3) with a configurable debounce |
| Multi-sitemap support | Large sites split into multiple sitemap files with a sitemap index |
| Tier-based inclusion | Tier 1 pages are always included; Tier 2 and Tier 3 are configurable |

---

### Internal Links

Builds and manages contextual links between pages to distribute PageRank.

| Feature | Description |
|---|---|
| Select website | Choose which website to analyze |
| Link stats | Total links, pages with links, orphaned pages, coverage % |
| Coverage bar | Visual indicator of link coverage health |
| Top linked pages | Bar chart of the most-linked-to pages by inbound count |
| Rebuild links | Recomputes all internal links from scratch in the background |
| Link strategy | For each service+city page: state-nav link + up to 3 cross-service city links |
| Hub linking | State hub pages get hub-to-city links to their top 10 city pages |
| **AI Strategy** | Click to get a health summary and HIGH/MEDIUM/LOW prioritized recommendations |

---

### Automation

8 configurable automated workflows that run after key events.

| Workflow | Description |
|---|---|
| Auto 1 — Score after generation | Automatically scores all newly generated pages when a bulk job finishes |
| Auto 2 — Assign tiers after scoring | Applies tier rules automatically based on quality scores |
| Auto 3 — Sitemap regen after tier changes | Batches tier changes and rebuilds the sitemap after a debounce window |
| Auto 4 — Google Indexing API | Submits newly promoted Tier 1 page URLs to Google's Indexing API |
| Auto 5 — Fallback URL promotion queue | Flags high-traffic fallback URLs for admin review before page generation |
| Auto 6 — Auto-demote weak Tier 1 pages | Demotes Tier 1 pages with zero impressions after a configurable number of days |
| Auto 7 — Thin bank detection | Flags services whose variation bank completeness falls below a threshold |
| Auto 8 — Weekly summary email | Monday 8 AM digest: pages generated, promotions, demotions, fallback hits, thin banks, average score |

**Additional automation features:**

| Feature | Description |
|---|---|
| Configurable thresholds | Tier 1 score cutoff, Tier 3 cutoff, fallback hit threshold, demote days, thin bank % |
| Promotion queue | View and dismiss URLs flagged for promotion |
| Admin notifications | In-app notification feed for all automated events |
| Demotion log | History of all auto-demotion events with reason and tier change |
| **AI Suggest Settings** | AI analyzes site size and current settings, recommends optimal threshold values |

---

### Bank Health

Manages the variation banks that supply unique content for page generation.

| Feature | Description |
|---|---|
| View bank health | Completeness score per service, section-by-section fill status |
| Section status | Shows which of the 8 content sections are filled / thin / empty |
| Write variations | Trigger AI to write 5 variations for all sections of a service |
| Fill missing sections | Trigger AI to write only empty sections (leaves existing content untouched) |
| Bulk write all | Write variations for all services in one operation |
| Thin bank warnings | Services below the completeness threshold are flagged |
| Background jobs | Variation writing runs in the background and shows progress |

**8 content sections per service:**
1. Hero headline
2. Introduction paragraph
3. Why choose us
4. Service details
5. Process / how it works
6. Service area
7. FAQ
8. Call to action

---

### SEO Control

Advanced controls for managing page quality, tier assignments, and SEO scoring.

| Feature | Description |
|---|---|
| View pages by tier | See all Tier 1, Tier 2, and Tier 3 pages |
| Score pages | Run quality scoring on unscored or all pages |
| Score & Promote | Score pages and promote qualifying ones to Tier 1 |
| Apply Tiers | Apply tier rules to all scored pages based on thresholds |
| Bulk Set Page Tier | Set tier for a filtered subset of pages (by service, location, score range, blueprint) |
| Thin bank warnings | See which services have incomplete variation banks |
| Page quality scores | View 0–100 quality scores based on content length, uniqueness, meta quality |
| **AI Suggest Tier** | Given current filters, AI recommends the right tier + score range with a one-sentence reason |
| Filter controls | Filter by service name, location name (city), score range, blueprint name |

---

## 4. ADMIN Section

### Users & Roles

Manages who can access the platform and at what permission level.

| Feature | Description |
|---|---|
| View users | List all registered users |
| Create user | Email, name, role assignment |
| Edit user | Update role or account access |
| Delete user | Remove user access |
| Roles | Admin (full access), Super Admin (includes admin-only routes) |
| Auth guard | All pages require authentication; unauthenticated users are redirected to login |
| Session management | JWT-based sessions with remember-me support |

---

### Operations Guide

Built-in reference documentation for running the platform.

| Feature | Description |
|---|---|
| Step-by-step guide | 3 phases: One-Time Setup, Content Generation, Ongoing Maintenance |
| Full workflow overview | Visual flowchart of the end-to-end content generation process |
| Per-step detail | Expandable cards for each step with instructions and important callouts |
| Glossary tab | Definitions for every platform-specific term (tier, blueprint, variation bank, etc.) |
| **AI Checklist tab** | Select an account → AI analyzes what's configured vs. missing and returns a prioritized action list with a 0–100 health score |

---

## 5. AI Generation Features

All AI features use Claude Haiku (`claude-haiku-4-5-20251001`) and require the `ANTHROPIC_API_KEY` environment variable.

| Location | Feature | What AI Does |
|---|---|---|
| Brand Profiles | AI Generate Fields | Writes tagline, description, voice & tone from brand name |
| Industries | AI Fill Description | Writes industry description + lists 5 related services |
| Locations | AI Suggest Cities | Recommends target cities for a business type + state; bulk-importable |
| Services | AI Suggest Services | Proposes service names, slugs, descriptions, keywords |
| Query Clusters | AI Generate Clusters | Builds a keyword cluster with intent groupings |
| Blueprints | AI Generate Blueprint | Writes a full HTML blueprint from page type + industry |
| Hub Pages | AI Hub Content | Writes hub page body content during bulk creation |
| Bank Health | Write Variations | Writes 5 AI variations for each of 8 content sections per service |
| Bank Health | Fill Missing Sections | Writes only empty sections, leaving existing ones untouched |
| Bulk Generator | First-Pass Generation | Writes complete page HTML using blueprint + variation bank |
| Internal Links | AI Strategy | Assesses link health and gives HIGH/MEDIUM/LOW recommendations |
| Leads | AI Qualify | Scores 0–100 (Hot/Warm/Cold), explains reasoning, writes draft reply |
| Automation | AI Suggest Settings | Recommends 6 threshold values based on site size and current config |
| SEO Control | AI Suggest Tier | Recommends tier + score range for a given set of filters |
| Operations Guide | AI Checklist | Analyzes account state and returns a prioritized setup checklist with health score |

---

## 6. Technical Architecture

### Stack
- **Frontend:** React + TypeScript, Vite, TailwindCSS, shadcn/ui, TanStack Query, wouter
- **Backend:** Node.js + Express, TypeScript, Drizzle ORM
- **Database:** PostgreSQL
- **AI:** Anthropic Claude Haiku (claude-haiku-4-5-20251001)
- **CDN / Proxy:** Cloudflare Workers

### Page Serving
Pages are served by Cloudflare Workers that proxy requests from `parentDomain/proxyPath/slug` to the Nexus backend at `https://sospages.replit.app/sites/{domain}/{slug}`. This means zero-origin-latency for end users.

### Multi-Tenancy
Each `Website` record stores its own domain, proxy path, parent domain, and automation settings. All page generation, scoring, tiering, sitemaps, and internal links are scoped to a specific website.

### SEO Page Structure
Each page is identified by:
- `websiteId` + `slug` (unique per site)
- `tier` (1 = highest priority, 3 = lowest)
- `qualityScore` (0–100, auto-computed)
- `service` + `location` combination
- `blueprintId` (template used)

### Quality Scoring
Pages are scored on:
- Word count (content length)
- Meta description quality and length
- Title tag relevance
- Content uniqueness (via variation bank diversity)

### Variation Bank
Each service has a bank of pre-written content variations organized into 8 sections. During page generation, the system picks one variation per section to assemble unique page content. This is the primary mechanism for content differentiation at scale.

### Automation Pipeline
```
Bulk Generate
    ↓ Auto 1: Score pages
    ↓ Auto 2: Assign tiers
    ↓ Auto 3: Rebuild sitemap (debounced)
    ↓ Auto 4: Submit Tier 1 URLs → Google Indexing API
    ↓ Auto 5: Monitor fallback hits → Promotion queue
    ↓ Auto 6: Weekly: demote zero-impression Tier 1 pages
    ↓ Auto 7: After bank updates: flag thin banks
    ↓ Auto 8: Monday 8 AM: send weekly digest email
```

### Environment Variables
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Enables all AI generation features |
| `GOOGLE_INDEXING_SA_JSON` | Service account for Google Indexing API (Auto 4) |
| `SMTP_URL` | Email delivery for weekly digest (Auto 8) |

---

*Document generated from Nexus platform codebase — April 2026*
