// Covers the longest public stale fallback window (24h) while avoiding an
// unnecessary extra day of blocking an otherwise reusable ID.
export const EVENT_ID_REUSE_DELAY_SECONDS = 24 * 60 * 60;
export const EVENT_ID_RENAME_CLEANUP_REASON = "event_id_rename_old_cleanup";

export const EVENT_ID_RENAME_CLEANUP_TARGETS = [
  ["event", "__event_id__"],
  ["event_base", "__event_id__"],
  ["event_slots", "__event_id__"],
  ["list_recent", "global"],
  ["list_popular", "global"],
  ["events_index", "global"],
  ["search_index", "global"],
  ["top_events", "global"],
  ["top_stats", "global"],
  ["top_slot_stats", "global"],
] as const;

export type EventIdRenameCleanupTarget = {
  targetType: string;
  targetId: string;
};

export type EventIdRenameCleanupRow = EventIdRenameCleanupTarget & {
  status: string;
  updatedAt: number;
};

export function eventIdRenameCleanupTargets(
  eventId: string,
): EventIdRenameCleanupTarget[] {
  return EVENT_ID_RENAME_CLEANUP_TARGETS.map(([targetType, targetId]) => ({
    targetType,
    targetId: targetId === "__event_id__" ? eventId : targetId,
  }));
}

export function isEventIdReuseDelayElapsed(
  blockedAt: number | null | undefined,
  now: number,
): boolean {
  if (!Number.isFinite(blockedAt) || !Number.isFinite(now)) return false;
  return now - Number(blockedAt) >= EVENT_ID_REUSE_DELAY_SECONDS;
}

/**
 * Cleanup history is append-only. A target is safe only when its newest
 * rename-cleanup attempt completed successfully; an older failed attempt
 * must not be hidden by an unrelated status row.
 */
export function hasCompletedEventIdRenameCleanup(
  eventId: string,
  rows: EventIdRenameCleanupRow[],
): boolean {
  const latest = new Map<string, EventIdRenameCleanupRow>();
  for (const row of rows) {
    const key = `${row.targetType}:${row.targetId}`;
    const current = latest.get(key);
    if (!current || row.updatedAt > current.updatedAt) latest.set(key, row);
  }
  return eventIdRenameCleanupTargets(eventId).every((target) => {
    const row = latest.get(`${target.targetType}:${target.targetId}`);
    return row?.status === "done";
  });
}
