/**
 * Legacy compatibility bridge (MIG-0305 U03).
 * Canonical definitions live in @flamenode/domain/slots/releaseGroups
 * (packages/domain/src/slots/releaseGroups.ts). Export surface is kept identical
 * to the pre-extraction file.
 */
export {
  type ReleaseGroupRow,
  type ReleaseGroupDecision,
  buildReleaseGroupDecisions,
} from "@flamenode/domain/slots/releaseGroups";
