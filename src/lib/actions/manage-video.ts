"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { canEditEvent } from "@/lib/auth/ownership";
import { writeGuard } from "@/lib/auth/writeGuard";
import { videos, videoEvents } from "@/lib/db/schema";
import {
  D1_RESERVED_CALLER_QUERIES,
  planD1AuditMutationBudget,
} from "@/lib/audit/mutate";
import { VIDEO_STATUS_NOTIFICATION_PREFETCH_QUERY_COUNT } from "@/lib/notifications/videoStatusNotify";
import { STATIC_REBUILD_BATCH_PREFETCH_QUERY_COUNT } from "@/lib/staticRebuild/enqueue";
import {
  handleVideoVisibilityMutationFailure,
  planVideoVisibilityTransition,
  runVideoVisibilityTransitionPostCommit,
} from "@/lib/video/videoVisibilityTransition";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";
import { attachApproveAndNextHref } from "@/lib/admin/videoReviewQueueOrder";
import {
  executeVideoVisibilityStatusMutation,
  loadVideoRebuildEventIds,
  monotonicVideoUpdatedAt,
  SAME_VIDEO_STATUS_MESSAGE,
  type VideoStatusActionResult,
} from "@/lib/video/videoVisibilityStatusAction";

export type ManageVideoActionResult = VideoStatusActionResult;

/** イベント運営者が通常操作で変更できる公開状態。内部状態は管理者側に集約する。 */
const MANAGE_ALLOWED_STATUS = new Set(["pending", "public", "private"]);
const MANAGE_VIDEO_STATUS_OWN_PREFETCH_QUERY_COUNT = 3;
const MANAGE_VIDEO_STATUS_PERMISSION_QUERY_COUNT = 2;
export const MANAGE_VIDEO_STATUS_CALLER_QUERY_COUNT =
  MANAGE_VIDEO_STATUS_OWN_PREFETCH_QUERY_COUNT +
  MANAGE_VIDEO_STATUS_PERMISSION_QUERY_COUNT +
  VIDEO_STATUS_NOTIFICATION_PREFETCH_QUERY_COUNT +
  STATIC_REBUILD_BATCH_PREFETCH_QUERY_COUNT;

function revalidateManageVideoPaths(
  eventId: string,
  videoId: string,
  youtubeVideoId: string | null,
): void {
  revalidatePath(`/manage/events/${eventId}/videos`);
  revalidatePath(`/manage/events/${eventId}/videos/${videoId}`);
  revalidatePath(`/manage/events/${eventId}`);
  revalidatePath("/manage");
  revalidatePath(`/${youtubeVideoId ?? videoId}`);
  revalidatePath("/list");
}

export async function approveManageVideoPublic(
  formData: FormData,
): Promise<ManageVideoActionResult> {
  formData.set("status", "public");
  return setManageVideoStatus(formData);
}

export async function approveManageVideoPublicAndNext(
  formData: FormData,
): Promise<ManageVideoActionResult> {
  formData.set("status", "public");
  formData.set("and_next", "1");
  return setManageVideoStatus(formData);
}

export async function setManageVideoStatus(
  formData: FormData,
): Promise<ManageVideoActionResult> {
  const identity = await writeGuard({ feature: "manage_video_status" });
  if (!identity.ok) return { ok: false, message: identity.message };
  const u = identity.user;

  const eventId = String(formData.get("event_id") ?? "").trim();
  const videoId = String(formData.get("video_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const andNext = formData.get("and_next") === "1";

  if (!eventId || !videoId) {
    return { ok: false, message: "event_id と video_id が必要です。" };
  }
  if (!MANAGE_ALLOWED_STATUS.has(status)) {
    return { ok: false, message: "このステータスへは変更できません。" };
  }

  const db = identity.db;

  const isAdmin = u.role === "admin";
  const sessionUser = { id: u.id, role: u.role, active_x_user_id: u.active_x_user_id };
  if (!isAdmin) {
    const allowed = await canEditEvent(db, sessionUser, eventId, "video.status");
    if (!allowed) {
      return { ok: false, message: "このイベントの作品審査権限がありません。" };
    }
  }

  const link = (
    await db
      .select({ video_id: videoEvents.video_id })
      .from(videoEvents)
      .where(
        and(
          eq(videoEvents.event_id, eventId),
          eq(videoEvents.video_id, videoId),
        )!,
      )
      .limit(1)
  )[0];
  if (!link) {
    return { ok: false, message: "このイベントに紐づく作品ではありません。" };
  }

  const target = (
    await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "対象作品が見つかりません。" };

  const prevStatus = target.visibility_status;
  if (prevStatus === status) {
    return attachApproveAndNextHref(
      db,
      { ok: true, message: SAME_VIDEO_STATUS_MESSAGE },
      { andNext, status, current: target, eventId },
    );
  }

  const now = monotonicVideoUpdatedAt(target.updated_at);
  if (MANAGE_VIDEO_STATUS_CALLER_QUERY_COUNT > D1_RESERVED_CALLER_QUERIES) {
    return {
      ok: false,
      message: "作品状態更新の事前確認queryがD1予約枠を超えています。",
    };
  }

  const rebuildEvents = await loadVideoRebuildEventIds(db, videoId, target.primary_event_id);
  if (!rebuildEvents.ok) {
    return { ok: false, message: rebuildEvents.message };
  }

  const traceId = createTraceId();
  let transition: Awaited<ReturnType<typeof planVideoVisibilityTransition>> | null =
    null;

  try {
    transition = await planVideoVisibilityTransition(db, {
      video: target,
      nextStatus: status as typeof target.visibility_status,
      actorUserId: u.id,
      context: "manage_video_status",
      reason: reason || null,
      eventIds: rebuildEvents.eventIds,
      notificationEventId: eventId,
      now,
    });

    const mutationStatements = [...transition.mutationStatements];
    const budget = planD1AuditMutationBudget({
      mutationStatementCount: mutationStatements.length,
      mutationAssertionCount: mutationStatements.length,
      auditEntryCount: 1,
      distinctActorCount: 1,
    });
    if (!budget.withinLimit) {
      return {
        ok: false,
        message: "作品状態更新の原子的処理がD1の上限を超えます。",
      };
    }

    const result = await executeVideoVisibilityStatusMutation({
      db,
      videoId,
      requestedStatus: status,
      transition,
      reason: reason || null,
      logTag: "manage-video-status",
      notificationWakeSource:
        transition.notificationBatch.statements.length > 0 ? "manage" : undefined,
      staticRebuildWakeSource:
        transition.queueBatch.statements.length > 0 ? "manage" : undefined,
    });
    if (!result.ok) return result;

    await runPostCommitBestEffort(
      { flow: "manage_video_status", traceId: createTraceId() },
      [{
        name: "manage_video_visibility_post_commit",
        run: async () => {
          await runVideoVisibilityTransitionPostCommit({
            publicCacheKeys: transition.publicCacheKeys,
            revalidate: () => {
              revalidateManageVideoPaths(eventId, videoId, target.youtube_video_id);
            },
          });
        },
      }],
    );

    return attachApproveAndNextHref(db, result, {
      andNext,
      status,
      current: target,
      eventId,
    });
  } catch (error) {
    return handleVideoVisibilityMutationFailure(db, error, {
      flow: "manage_video_status",
      traceId,
      videoId,
      eventId,
      depublicizedFromPublic: Boolean(transition?.depublicizedFromPublic),
      fenceToken: transition?.fenceToken ?? null,
    });
  }
}
