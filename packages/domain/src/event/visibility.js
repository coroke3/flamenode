/**
 * Decides the fence for an event visibility change. Returns null when the
 * status does not change (no fence row). Re-publishing also goes through a
 * fence (`release_pending`) so stale artifacts stay hidden until the event
 * artifact is regenerated; every other change is `blocked` (fail closed).
 */
export function planEventVisibilityFence(input) {
    if (input.previousStatus === input.nextStatus)
        return null;
    const state = input.nextStatus === "public" ? "release_pending" : "blocked";
    return {
        state,
        depublicizedFromPublic: input.previousStatus === "public",
    };
}
//# sourceMappingURL=visibility.js.map