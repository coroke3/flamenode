"use server";

import { markPendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { canEditEvent } from "@/lib/auth/ownership";
import { writeGuard } from "@/lib/auth/writeGuard";
import { videos, videoEvents } from "@/lib/db/schema";
import {
  D1_RESERVED_CALLER_QUERIES,
  mutateWithAudit,
  planD1AuditMutationBudget,
} from "@/lib/audit/mutate";
import { VIDEO_STATUS_NOTIFICATION_PREFETCH_QUERY_COUNT } from "@/lib/notifications/videoStatusNotify";
import { STATIC_REBUILD_BATCH_PREFETCH_QUERY_COUNT } from "@/lib/staticRebuild/enqueue";
import { MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS } from "@/lib/staticRebuild/hooks";
import {
  planVideoVisibilityTransition,
  preCommitVideoVisibilityDepublicization,
  runVideoVisibilityTransitionPostCommit,
} from "@/lib/video/videoVisibilityTransition";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";

export interface ManageVideoActionResult {
  ok: boolean;
  message?: string;
}

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
    return { ok: false, message: "変更先のステータスを選択してください。" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (MANAGE_VIDEO_STATUS_CALLER_QUERY_COUNT > D1_RESERVED_CALLER_QUERIES) {
    return {
      ok: false,
      message: "作品状態更新の事前確認queryがD1予約枠を超えています。",
    };
  }
  const eventRows = await db
    .select({ event_id: videoEvents.event_id })
    .from(videoEvents)
    .where(eq(videoEvents.video_id, videoId))
    .limit(MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS + 1);
  const rebuildEventIds = Array.from(
    new Set(
      [target.primary_event_id, ...eventRows.map((row) => row.event_id)].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  );
  if (rebuildEventIds.length > MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS) {
    return {
      ok: false,
      message: "所属イベント数が上限を超えているため、状態を安全に更新できません。",
    };
  }

  const transition = await planVideoVisibilityTransition(db, {
    video: target,
    nextStatus: status as typeof target.visibility_status,
    actorUserId: u.id,
    context: "manage_video_status",
    reason: reason || null,
    eventIds: rebuildEventIds,
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

  if (transition.depublicizedFromPublic && transition.fenceToken) {
    try {
      await preCommitVideoVisibilityDepublicization({
        videoId,
        fenceToken: transition.fenceToken,
        reason: reason || null,
      });
    } catch (error) {
      unstable_rethrow(error);
      return { ok: false, message: "公開ブロックの記録に失敗しました。" };
    }
  }

  await mutateWithAudit(db, {
    mutationStatements,
    expectedMutationChanges: transition.expectedMutationChanges,
    audits: transition.audits,
    notificationWakeSource:
      transition.notificationBatch.statements.length > 0 ? "manage" : undefined,
    staticRebuildWakeSource: transition.queueBatch.statements.length > 0 ? "manage" : undefined,
  });

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

  return markPendingPublicReflection(
    { ok: true, message: "ステータスを更新しました。" },
    transition.queueBatch.statements.length > 0,
  );
}
