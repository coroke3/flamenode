/**
 * Legacy compatibility bridge for eventOwnershipCore.
 * Canonical definitions live in @flamenode/domain/event
 * (packages/domain/src/event/ownership.ts). Export surface is kept identical
 * to the pre-extraction file.
 */
export {
  type EventStaffPreset,
  type EventStaffOwnershipRow,
  LAST_OWNER_ERROR,
  isEventOwner,
  validateEventStaffSubject,
  validateEventStaffUniqueness,
  assertEventWillRetainOwner,
  planXIdMergeEventStaffOwnerProtection,
  isActorTargetingSelf,
  assertSelfChangeConfirmation,
  assertOwnershipTransferInput,
} from "@flamenode/domain/event";
