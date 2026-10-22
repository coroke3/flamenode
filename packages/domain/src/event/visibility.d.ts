/** Public-visibility fence state written next to the event row in the same D1 batch. */
export type EventVisibilityFenceState = "blocked" | "release_pending";
export type EventVisibilityFenceDecision = {
    state: EventVisibilityFenceState;
    /** true when the event leaves `public`; callers purge public caches. */
    depublicizedFromPublic: boolean;
};
/**
 * Decides the fence for an event visibility change. Returns null when the
 * status does not change (no fence row). Re-publishing also goes through a
 * fence (`release_pending`) so stale artifacts stay hidden until the event
 * artifact is regenerated; every other change is `blocked` (fail closed).
 */
export declare function planEventVisibilityFence(input: {
    previousStatus: string;
    nextStatus: string;
}): EventVisibilityFenceDecision | null;
//# sourceMappingURL=visibility.d.ts.map