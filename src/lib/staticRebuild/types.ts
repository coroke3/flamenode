export const STATIC_REBUILD_TARGET_TYPES = [
  "top",
  "top_recommended",
  "top_latest",
  "top_nostalgic",
  "top_events",
  "top_announcements",
  "top_stats",
  "top_slot_stats",
  "events_index",
  "event_base",
  "event_slots",
  "event",
  "video",
  "user",
  "users_index",
  "list_recent",
  "list_popular",
  "search_index",
  "recommend_core",
  "recommend",
  "rules",
  "youtube_related_blocklist",
  "random_video_pool",
  "member_suggestions",
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

export type RebuildRequestState =
  | "not_needed"
  | "requested"
  | "already_active"
  | "cooldown_suppressed"
  | "failed";

export type DirectEnqueueCause =
  | { kind: "public_miss"; cooldownSeconds: 300 }
  | { kind: "periodic"; cooldownSeconds: number }
  | { kind: "manual_repair"; cooldownSeconds: 0 };

export type DirectEnqueueResult =
  | {
      ok: true;
      action: "inserted" | "active_updated" | "cooldown_skipped";
      rebuildState: RebuildRequestState;
    }
  | {
      ok: false;
      errorCode: string;
      message: string;
      rebuildState: "failed";
    };
