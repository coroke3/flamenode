import type { EnqueueStaticRebuildInput } from "./types";

/** Worker が未実装の別名 target を `events_index` へ寄せる。 */
export function normalizeStaticRebuildTarget(
  input: EnqueueStaticRebuildInput,
): EnqueueStaticRebuildInput {
  const aliasType = input.targetType as string;
  if (aliasType === "event_groups_index" || aliasType === "groups_index") {
    return {
      ...input,
      targetType: "events_index",
      targetId: "global",
      reason: `${input.reason}:alias:${aliasType}:${input.targetId}`,
    };
  }
  if (input.targetType === "event_group") {
      return {
        ...input,
        targetType: "events_index",
        targetId: "global",
        reason: `${input.reason}:alias:event_group:${input.targetId}`,
    };
  }
  return input;
}
