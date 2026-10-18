/**
 * Legacy compatibility bridge. Canonical definitions live in
 * @flamenode/domain/video (packages/domain/src/video/fieldChangeGuard.ts).
 */
export {
  type VideoFieldChangeSnapshot,
  type AssertAllowedVideoFieldChangesArgs,
  type AssertAllowedVideoFieldChangesResult,
  assertAllowedVideoFieldChanges,
} from "@flamenode/domain/video";
