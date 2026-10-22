export declare const EVENT_ID_REUSE_DELAY_SECONDS: number;
export declare const EVENT_ID_RENAME_CLEANUP_REASON = "event_id_rename_old_cleanup";
export declare const EVENT_ID_RENAME_CLEANUP_TARGETS: readonly [readonly ["event", "__event_id__"], readonly ["event_base", "__event_id__"], readonly ["event_slots", "__event_id__"], readonly ["event_release", "__event_id__"], readonly ["list_recent", "global"], readonly ["list_popular", "global"], readonly ["events_index", "global"], readonly ["search_index", "global"], readonly ["top_events", "global"], readonly ["top_stats", "global"], readonly ["top_slot_stats", "global"]];
export type EventIdRenameCleanupTarget = {
    targetType: string;
    targetId: string;
};
export type EventIdRenameCleanupRow = EventIdRenameCleanupTarget & {
    status: string;
    updatedAt: number;
};
export declare function eventIdRenameCleanupTargets(eventId: string): EventIdRenameCleanupTarget[];
export declare function isEventIdReuseDelayElapsed(blockedAt: number | null | undefined, now: number): boolean;
/**
 * Cleanup history is append-only. A target is safe only when its newest
 * rename-cleanup attempt completed successfully; an older failed attempt
 * must not be hidden by an unrelated status row.
 */
export declare function hasCompletedEventIdRenameCleanup(eventId: string, rows: EventIdRenameCleanupRow[]): boolean;
//# sourceMappingURL=idReuse.d.ts.map