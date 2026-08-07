import { and, desc, eq, lt, or } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { videoEvents, videos } from "@/lib/db/schema";

export const videoReviewQueueOrder = [
  desc(videos.created_at),
  desc(videos.id),
] as const;

/** Returns the next pending review item after `current` in queue order (created_at DESC, id DESC). */
export async function findNextPendingReviewVideoId(
  db: DB,
  current: { id: string; created_at: number },
  scope?: { eventId: string },
): Promise<string | null> {
  const pendingCond = eq(videos.visibility_status, "pending");
  const afterCurrentInQueue = or(
    lt(videos.created_at, current.created_at),
    and(eq(videos.created_at, current.created_at), lt(videos.id, current.id)),
  );

  const baseWhere = and(pendingCond, afterCurrentInQueue)!;

  const rows = scope?.eventId
    ? await db
        .select({ id: videos.id })
        .from(videos)
        .innerJoin(videoEvents, eq(videoEvents.video_id, videos.id))
        .where(and(eq(videoEvents.event_id, scope.eventId), baseWhere)!)
        .orderBy(...videoReviewQueueOrder)
        .limit(1)
    : await db
        .select({ id: videos.id })
        .from(videos)
        .where(baseWhere)
        .orderBy(...videoReviewQueueOrder)
        .limit(1);

  return rows[0]?.id ?? null;
}

export function adminReviewQueueFallbackHref(): string {
  return "/admin/videos?status=review";
}

export function manageReviewQueueFallbackHref(eventId: string): string {
  return `/manage/events/${eventId}/videos?status=review`;
}

export function buildReviewDetailHref(
  videoId: string,
  scope?: { eventId: string },
): string {
  if (scope?.eventId) {
    return `/manage/events/${scope.eventId}/videos/${videoId}`;
  }
  return `/admin/videos/${videoId}`;
}

export function resolveApproveAndNextHref(
  nextVideoId: string | null,
  scope?: { eventId: string },
): string {
  if (nextVideoId) {
    return buildReviewDetailHref(nextVideoId, scope);
  }
  return scope?.eventId
    ? manageReviewQueueFallbackHref(scope.eventId)
    : adminReviewQueueFallbackHref();
}
