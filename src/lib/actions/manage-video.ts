"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { canEditEvent } from "@/lib/auth/ownership";
import { writeGuard } from "@/lib/auth/writeGuard";
import { videos, videoEvents } from "@/lib/db/schema";
import {
  D1_RESERVED_CALLER_QUERIES,
  mutateWithAudit,
  planD1AuditMutationBudget,
} from "@/lib/audit/mutate";
import {
  buildVideoStatusChangeNotificationBatch,
  VIDEO_STATUS_NOTIFICATION_PREFETCH_QUERY_COUNT,
} from "@/lib/notifications/videoStatusNotify";
import {
  buildAfterVideoStatusChangeQueueBatch,
  MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS,
} from "@/lib/staticRebuild/hooks";
import { STATIC_REBUILD_BATCH_PREFETCH_QUERY_COUNT } from "@/lib/staticRebuild/enqueue";

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
  const after = {
    ...target,
    visibility_status: status as typeof target.visibility_status,
    updated_at: now,
  };
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
  const notification = await buildVideoStatusChangeNotificationBatch(db, {
    videoId,
    videoTitle: target.title,
    youtubeVideoId: target.youtube_video_id,
    prevStatus,
    nextStatus: status,
    reason: reason || null,
    recipientUserId: target.submitted_by_user_id,
    eventId,
  });
  const queue = await buildAfterVideoStatusChangeQueueBatch(db, {
    videoId, eventIds: rebuildEventIds,
    creatorXUserId: target.creator_x_user_id, primaryEventId: target.primary_event_id,
    requestedByUserId: u.id,
  });

  const mutationStatements = [
      db.update(videos).set({ visibility_status: after.visibility_status, updated_at: now })
        .where(
          and(
            eq(videos.id, videoId),
            eq(videos.visibility_status, prevStatus),
            eq(videos.updated_at, target.updated_at),
          ),
        ),
      ...notification.statements,
      ...queue.statements,
    ];
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
  await mutateWithAudit(db, {
    mutationStatements,
    expectedMutationChanges: [1, ...notification.expectedChanges, ...queue.expectedChanges],
    audits: [{
      table_name: "videos", target_id: videoId, operation: "UPDATE",
      before: { ...target }, after: { ...after },
      actor_user_id: u.id,
      reason: reason || null,
      context: `manage-video-status:${eventId}`,
      retention_class: "normal", strict: true,
    }],
    staticRebuildWakeSource: queue.statements.length > 0 ? "manage" : undefined,
  });

  revalidatePath(`/manage/events/${eventId}/videos`);
  revalidatePath(`/manage/events/${eventId}/videos/${videoId}`);
  revalidatePath(`/manage/events/${eventId}`);
  revalidatePath("/manage");
  revalidatePath(`/${target.youtube_video_id ?? videoId}`);
  revalidatePath("/list");

  return { ok: true, message: "ステータスを更新しました。" };
}
