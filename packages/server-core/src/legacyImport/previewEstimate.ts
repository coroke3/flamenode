import type { CanonicalLegacyPlan, LegacyImportStrategy } from "./normalize.ts";

/**
 * Exact CURRENT RH-002 v4 R2 preview record byte estimator.
 * Contract: src/lib/import/legacy/previewStore.ts#estimateLegacyImportStoredPlanBytes
 * The UTF-8 size counts the complete stored envelope, not just plan JSON.
 * No R2 access, token creation or network operation occurs here.
 */
export const LEGACY_IMPORT_PREVIEW_RECORD_VERSION = 4 as const;

export function estimateLegacyImportStoredPlanBytes(input: {
  authUserId: string;
  strategy: LegacyImportStrategy;
  plan: CanonicalLegacyPlan;
}): number {
  const record = {
    version: LEGACY_IMPORT_PREVIEW_RECORD_VERSION,
    previewToken: "0".repeat(32),
    authUserId: input.authUserId,
    strategy: input.strategy,
    planHash: "0".repeat(64),
    plan: input.plan,
    createdAt: 0,
    expiresAt: 0,
    status: "ready",
    attempt: 0,
    progress: {
      stage: "system_user",
      index: 0,
      counts: {
        createdEvents: 0,
        replacedEvents: 0,
        skippedEvents: 0,
        createdVideos: 0,
        replacedVideos: 0,
        skippedVideos: 0,
        createdXUsers: 0,
        createdAuthUsers: 0,
        createdSoftwares: 0,
        createdCustomQuestions: 0,
        reusedCustomQuestions: 0,
      },
      skipExistingEventIds: [],
      skipExistingVideoIds: [],
    },
  };
  return new TextEncoder().encode(JSON.stringify(record)).byteLength;
}
