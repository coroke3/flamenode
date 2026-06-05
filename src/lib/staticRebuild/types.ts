export type StaticRebuildTargetType =
  | "top"
  | "events_index"
  | "event"
  | "video"
  | "user"
  | "list_recent"
  | "list_popular"
  | "search_index";

export type StaticRebuildPriority = "high" | "normal" | "low";

export type EventFreshness = "active" | "ended" | "archived";

export type EnqueueStaticRebuildInput = {
  targetType: StaticRebuildTargetType;
  targetId: string;
  reason: string;
  priority?: StaticRebuildPriority;
  requestedByUserId?: string | null;
};
