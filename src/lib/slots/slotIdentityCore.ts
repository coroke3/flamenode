/**
 * Legacy compatibility bridge (MIG-0305 U03).
 * Canonical definitions live in @flamenode/domain/slots/slotIdentity
 * (packages/domain/src/slots/slotIdentity.ts). Export surface is kept identical
 * to the pre-extraction file.
 */
export {
  type SlotViewerRelation,
  type SlotSubmissionRelation,
  resolveSlotViewerRelation,
  resolveSlotSubmissionRelation,
  canActAsSlotActor,
  canActAsSlotSubmitter,
  type SlotGroupIdentityResult,
  resolveSlotGroupIdentity,
} from "@flamenode/domain/slots/slotIdentity";
