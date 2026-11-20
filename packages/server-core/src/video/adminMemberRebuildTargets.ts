import type { EnqueueStaticRebuildInput } from "../staticRebuild/types.ts";
import { MAX_VIDEO_MEMBERS } from "@flamenode/domain/video/atomicLimits";
import { MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS } from "../staticRebuild/hooks.ts";

/**
 * SA-085 admin member save: pure CURRENT-compatible post-mutation rebuild fanout.
 * The host performs admin authorization, CAS/audit, and enqueues every target
 * inside the SAME atomic D1 batch; this builder does not run any side effect.
 */
export function adminVideoMembersRebuildTargets(input: {
  videoId: string;
  actorUserId: string;
  publicContentChanged: boolean;
  membersPlanChanged: boolean;
  eventIds: readonly string[];
  isPublicVideo: boolean;
  affectedCreatorIds: ReadonlySet<string>;
}): EnqueueStaticRebuildInput[] {
  const {
    videoId, actorUserId, publicContentChanged, membersPlanChanged,
    eventIds, isPublicVideo, affectedCreatorIds,
  } = input;
  // MIG-0650 U03aw: CURRENT's pre-read supplies at most eight event targets,
  // and public member before/after sets of at most 100 each bound the
  // symmetric-difference creator fanout to 200. This keeps all rebuild rows
  // below the 256-target JSON1 atomic Queue budget before allocating arrays.
  // A miswired future Hono host must fail closed, not silently drop or
  // enqueue an unbounded selection of public user/event invalidations.
  if (
    eventIds.length > MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS ||
    affectedCreatorIds.size > MAX_VIDEO_MEMBERS * 2
  ) {
    throw new RangeError("video_admin_member_rebuild_target_limit_exceeded");
  }
  return [
    ...(publicContentChanged
      ? [{
          targetType: "video" as const,
          targetId: videoId,
          reason: "video_members_update",
          requestedByUserId: actorUserId,
        }]
      : []),
    ...(membersPlanChanged
      ? [{
          targetType: "member_suggestions" as const,
          targetId: "global",
          reason: "video_members_update",
        }]
      : []),
    ...(publicContentChanged
      ? eventIds.map((eventId) => ({
          targetType: "event_release" as const,
          targetId: eventId,
          reason: "video_members_update",
          priority: "high" as const,
          requestedByUserId: actorUserId,
        }))
      : []),
    ...(isPublicVideo && affectedCreatorIds.size > 0
      ? [
          {
            targetType: "users_index" as const,
            targetId: "global",
            reason: "video_members_update",
          },
          ...[...affectedCreatorIds].map((xUserId) => ({
            targetType: "user" as const,
            targetId: xUserId,
            reason: "video_members_update",
          })),
        ]
      : []),
  ];
}
