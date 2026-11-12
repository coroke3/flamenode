import { memberSuggestionsTarget } from "../staticRebuild/hooks.ts";
import type { EnqueueStaticRebuildInput } from "../staticRebuild/types.ts";

/**
 * Pure SA-082..084 CURRENT static rebuild fanout, after atomic permission
 * preflight and bounded event-ID resolution. The caller enqueues these as
 * part of the SAME audited D1 mutation batch. This is not a Queue sender.
 */
export function permissionRebuildTargets(input: {
  hasNewXUsers: boolean;
  visibilityStatus: string | null;
  eventIds: readonly string[];
  actorUserId: string;
}): EnqueueStaticRebuildInput[] {
  const { hasNewXUsers, visibilityStatus, eventIds, actorUserId } = input;
  return [
    memberSuggestionsTarget("video_permissions_batch"),
    ...(hasNewXUsers
      ? [{
          targetType: "users_index" as const,
          targetId: "global",
          reason: "video_permissions_new_x_user",
          priority: "low" as const,
          requestedByUserId: actorUserId,
        }]
      : []),
    ...(visibilityStatus === "public"
      ? eventIds.map((eventId) => ({
          targetType: "event_release" as const,
          targetId: eventId,
          reason: "video_permissions_batch",
          priority: "high" as const,
          requestedByUserId: actorUserId,
        }))
      : []),
  ];
}
