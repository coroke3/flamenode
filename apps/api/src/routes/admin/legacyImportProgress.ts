/** MIG-0645: Hono compatibility bridge to canonical CURRENT stage progress. */
export {
  LEGACY_IMPORT_X_USER_STEP_SIZE,
  LEGACY_IMPORT_SOFTWARE_STEP_SIZE,
  LEGACY_IMPORT_QUESTION_STEP_SIZE,
  legacyImportApplyProgressSummary,
} from "@flamenode/server-core/legacyImport/progress";
export type {
  LegacyImportStage,
  LegacyImportProgress,
  LegacyImportProgressPlan,
  LegacyImportProgressSummary,
} from "@flamenode/server-core/legacyImport/progress";
