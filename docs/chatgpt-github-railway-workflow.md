# ChatGPT + GitHub + Railway Workflow

This project is now managed through ChatGPT, GitHub, and Railway.

Replit is not part of the operating workflow.

## Canonical Development Flow

1. ChatGPT makes code changes directly in GitHub.
2. GitHub stores the source of truth.
3. Railway deploys from GitHub.
4. Before deploy, run the retention QA command locally or in the connected build environment.

## Required Pre-Deploy Commands

Run these before expecting Railway to deploy cleanly:

```bash
npm run qa:retention
npm run build
```

`qa:retention` runs:

```bash
npm run smoke:agency && npm run check
```

## What qa:retention Checks

The retention QA command checks:

- Agency Dashboard route wiring
- Report Center route wiring
- Sidebar navigation labels
- Agency Dashboard MVP page
- Report Center MVP page
- ROI scoring fields
- Churn-risk flags
- Recommended next action fields
- Monthly report routes
- Share-link routes
- Public `/r/:token` report route
- Mobile layout markers
- TypeScript compile check

## Railway Deploy Rule

Railway should deploy only after these commands pass:

```bash
npm run qa:retention
npm run build
```

## Current Retention System Routes

Frontend routes:

- `/agency-dashboard`
- `/report-links`

Backend/API routes:

- `/api/agency-dashboard/summary`
- `/api/agency-dashboard/clients`
- `/api/agency-dashboard/clients/:accountId`
- `/api/agency-dashboard/clients/:accountId/monthly-report`
- `/api/agency-dashboard/clients/:accountId/monthly-report/share`
- `/api/agency-dashboard/report-links`
- `/api/agency-dashboard/report-links/:linkId/revoke`
- `/api/agency-dashboard/report-links/:linkId/regenerate`
- `/r/:token`

## Operational Meaning

The Agency Dashboard is the proof-of-work and retention control screen.

The Report Center is the client-safe sharing layer.

The Monthly Report is the client-facing proof document.

Together, they support this flow:

```txt
Agency Dashboard → identify client status
Report Center → copy/send/manage report links
Monthly Report → client-facing proof of work
Railway → production deployment
```

## Current Rule

Do not describe future build steps as Replit work.

Use this language instead:

- ChatGPT build
- GitHub commit
- Railway deploy
- Railway build logs
- GitHub source of truth
- Railway production check
