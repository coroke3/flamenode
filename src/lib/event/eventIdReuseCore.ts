/**
 * Legacy compatibility bridge (MIG-0305 U04).
 * Canonical definitions live in @flamenode/domain/event
 * (packages/domain/src/event/idReuse.ts). Export surface is kept identical
 * to the pre-extraction file.
 */
export {
  EVENT_ID_REUSE_DELAY_SECONDS,
  EVENT_ID_RENAME_CLEANUP_REASON,
  EVENT_ID_RENAME_CLEANUP_TARGETS,
  type EventIdRenameCleanupTarget,
  type EventIdRenameCleanupRow,
  eventIdRenameCleanupTargets,
  isEventIdReuseDelayElapsed,
  hasCompletedEventIdRenameCleanup,
} from "@flamenode/domain/event";
