# Patch: double-dash slug normalization

File to patch: `server/routes.ts`

## Location
Inside `tryGenerateDynamicPage()`, immediately after:
```typescript
if (slug.length > 200) return null;
```

## Line to insert
```typescript
// Normalize double-dashes: 'foo--bar'.split('-') → ['foo','','bar'] breaks location resolver
slug = slug.replace(/--+/g, '-');
```

## Why
Slugs generated with sequential template separators (e.g. `white-label--payment-fraud-detection-software`)
contain `--`. When `slug.split('-')` runs on this, the double-dash produces an empty-string
element in `parts`. The location-resolution `for` loop then builds `candidateLoc` strings
like `-payment-fraud-detection-software` (leading dash), which never match any US city or
state entry. `resolveLocation()` returns `null` for all iterations, causing the function
to `return null` — a 404 on the live domain.

Admin preview is unaffected because it fetches by page ID from the DB, bypassing this
slug-parsing code path entirely.

## Affected pages (examples)
- `how-to-offer-white-label-payment-processing-white-label--payment-fraud-detection-software`
- Any slug where the blueprint generator emitted consecutive dashes

## Fix is safe
`/--+/g` collapses any run of 2+ dashes to a single dash. This cannot break
valid single-dash slugs and is idempotent — running it twice has no effect.
