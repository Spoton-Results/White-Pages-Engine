/**
 * intent-governance.ts
 * Graduated from intent-governance-run-hotfix.ts — no logic changes.
 * Handles intent governance runs — evaluating and processing AI-generated
 * action intents through the approval/rejection pipeline.
 *
 * Routes: self-prefixed (defined inside the file)
 */
// Re-export the hotfix router as the permanent module.
// The hotfix file's logic is unchanged; this is purely a naming graduation.
// Once confirmed stable, the hotfix file will be deleted.
export { default } from "./intent-governance-run-hotfix";
