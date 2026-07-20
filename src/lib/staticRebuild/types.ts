export const STATIC_REBUILD_TARGET_TYPES = [
  "top",
  "events_index",
  "event",
  "video",
  "user",
  "list_recent",
  "list_popular",
  "search_index",
] as const;

export type StaticRebuildTargetType = (typeof STATIC_REBUILD_TARGET_TYPES)[number];

const STATIC_REBUILD_TARGET_TYPE_SET = new Set<string>(STATIC_REBUILD_TARGET_TYPES);

export function isStaticRebuildTargetType(value: string): value is StaticRebuildTargetType {
  return STATIC_REBUILD_TARGET_TYPE_SET.has(value);
}

export type StaticRebuildPriority = "high" | "normal" | "low";

export type EventFreshness = "active" | "ended";

export type EnqueueStaticRebuildInput = {
  targetType: StaticRebuildTargetType;
  targetId: string;
  reason: string;
  priority?: StaticRebuildPriority;
  requestedByUserId?: string | null;
};
