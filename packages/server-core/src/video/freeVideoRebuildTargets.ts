import { topVideoVisibilityTargets } from "../staticRebuild/hooks.ts";
import type { EnqueueStaticRebuildInput } from "../staticRebuild/types.ts";

/**
 * SA-086 static-rebuild fanout, shared by CURRENT Next and TARGET Hono.
 * No D1 work and no wake; caller adds the resulting D1 statements to its atomic batch.
 */
export function buildFreeVideoRebuildTargets(args: {
  videoId: string;
  userId: string;
  activeXId: string;
  eventId: string | null;
}): EnqueueStaticRebuildInput[] {
  const { videoId, userId, activeXId, eventId } = args;
  const queueTargets = [
      {
        targetType: "video" as const,
        targetId: videoId,
        reason: "video_create",
        priority: "high" as const,
        requestedByUserId: userId,
      },
      { targetType: "list_recent" as const, targetId: "global", reason: "video_create" },
      { targetType: "list_popular" as const, targetId: "global", reason: "video_create" },
      { targetType: "search_index" as const, targetId: "global", reason: "video_create" },
      { targetType: "users_index" as const, targetId: "global", reason: "video_create" },
      { targetType: "member_suggestions" as const, targetId: "global", reason: "video_create" },
      ...topVideoVisibilityTargets("video_create"),
      {
        targetType: "random_video_pool" as const,
        targetId: "global",
        reason: "video_create",
        priority: "normal" as const,
        requestedByUserId: userId,
      },
      { targetType: "user" as const, targetId: activeXId, reason: "video_create" },
      ...(eventId
        ? [
            {
              targetType: "event_base" as const,
              targetId: eventId,
              reason: "video_create",
              priority: "high" as const,
            },
            {
              targetType: "event_slots" as const,
              targetId: eventId,
              reason: "video_create",
              priority: "high" as const,
            },
            {
              targetType: "event_release" as const,
              targetId: eventId,
              reason: "video_create",
              priority: "high" as const,
            },
          ]
        : []),
  ];
  return queueTargets;
}
