/**
 * spoton-pages.ts
 * Graduated from spoton-pages-hotfix.ts — no logic changes.
 * Handles SpotOn-branded page serving, slug resolution, and
 * public-facing page rendering for client white-label domains.
 *
 * Routes: self-prefixed (defined inside the file)
 */
// Re-export the hotfix router as the permanent module.
// The hotfix file's logic is unchanged; this is purely a naming graduation.
// Once confirmed stable, the hotfix file will be deleted.
export { default } from "./spoton-pages-hotfix";
