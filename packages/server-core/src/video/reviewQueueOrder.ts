import { and, desc, eq, lt, or } from "drizzle-orm";
import { videoEvents, videos } from "@flamenode/db/schema";
import type { ServerCoreDb } from "../db.ts";

export const videoReviewQueueOrder = [
  desc(videos.created_at),
  desc(videos.id),
] as const;

export type ReviewQueueScope = {
  /** Manage console: scopes next queue and hrefs to one event. */
  eventId?: string;
  /** Admin list filter: scopes next queue and hrefs via `?event=` query. */
  adminEventFilter?: string;
};

export async function findNextPendingReviewVideoId(
  db: ServerCoreDb,
  current: { id: string; created_at: number },
  scope?: ReviewQueueScope,
): Promise<string | null> {
  const pendingCond = eq(videos.visibility_status, "pending");
  const afterCurrentInQueue = or(
    lt(videos.created_at, current.created_at),
    and(eq(videos.created_at, current.created_at), lt(videos.id, current.id)),
  );
  const baseWhere = and(pendingCond, afterCurrentInQueue)!;
  const eventScopeId = scope?.eventId ?? scope?.adminEventFilter;
  const rows = eventScopeId
    ? await db
        .select({ id: videos.id })
        .from(videos)
        .innerJoin(videoEvents, eq(videoEvents.video_id, videos.id))
        .where(and(eq(videoEvents.event_id, eventScopeId), baseWhere)!)
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

export function adminReviewQueueFallbackHref(adminEventFilter?: string): string {
  const base = "/admin/videos?status=review";
  return adminEventFilter ? `${base}&event=${encodeURIComponent(adminEventFilter)}` : base;
}

export function manageReviewQueueFallbackHref(eventId: string): string {
  return `/manage/events/${encodeURIComponent(eventId)}/videos?status=review`;
}

export function buildReviewDetailHref(
  videoId: string,
  scope?: ReviewQueueScope,
): string {
  if (scope?.eventId) {
    return `/manage/events/${encodeURIComponent(scope.eventId)}/videos/${videoId}`;
  }
  if (scope?.adminEventFilter) {
    return `/admin/videos/${videoId}?event=${encodeURIComponent(scope.adminEventFilter)}`;
  }
  return `/admin/videos/${videoId}`;
}

export function resolveApproveAndNextHref(
  nextVideoId: string | null,
  scope?: ReviewQueueScope,
): string {
  if (nextVideoId) return buildReviewDetailHref(nextVideoId, scope);
  return scope?.eventId
    ? manageReviewQueueFallbackHref(scope.eventId)
    : adminReviewQueueFallbackHref(scope?.adminEventFilter);
}

function resolveReviewQueueScope(input: {
  eventId?: string;
  adminEventFilter?: string;
}): ReviewQueueScope | undefined {
  if (input.eventId) return { eventId: input.eventId };
  if (input.adminEventFilter) return { adminEventFilter: input.adminEventFilter };
  return undefined;
}

/** Attach the next review URL even when the current status mutation was idempotent. */
export async function attachApproveAndNextHref<T extends { ok: boolean; nextHref?: string }>(
  db: ServerCoreDb,
  result: T,
  input: {
    andNext: boolean;
    status: string;
    current: { id: string; created_at: number };
    eventId?: string;
    adminEventFilter?: string;
  },
): Promise<T> {
  if (!input.andNext || input.status !== "public" || !result.ok) return result;
  const scope = resolveReviewQueueScope(input);
  const nextVideoId = await findNextPendingReviewVideoId(db, input.current, scope);
  return { ...result, nextHref: resolveApproveAndNextHref(nextVideoId, scope) };
}
