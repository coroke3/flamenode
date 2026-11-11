import type { EnqueueStaticRebuildInput } from "../staticRebuild/types.ts";

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
