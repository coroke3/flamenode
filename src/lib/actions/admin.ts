"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { videoEvents, videoModerationCases, videos } from "@/lib/db/schema";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { buildVideoStatusChangeNotificationBatch } from "@/lib/notifications/videoStatusNotify";
import { createTraceId } from "@/lib/observability/flowTrace";
import { buildAfterVideoStatusChangeQueueBatch, MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS } from "@/lib/staticRebuild/hooks";
import { generateId } from "@/lib/utils/id";

export interface AdminActionResult { ok: boolean; message?: string }
const VALID_STATUS = new Set(["pending", "public", "private", "voided"]);

function revalidateVideoStatusPaths(videoId: string, youtubeVideoId: string | null): void {
  revalidatePath(`/admin/videos/${videoId}`);
  revalidatePath("/admin/videos");
  revalidatePath("/admin");
  revalidatePath(`/${youtubeVideoId ?? videoId}`);
  revalidatePath("/list");
}

async function revalidateVideoStatusPathsBestEffort(
  videoId: string,
  youtubeVideoId: string | null,
): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "admin_video_status", traceId: createTraceId() },
    [
      {
        name: "revalidate_video_status_paths",
        run: async () => {
          revalidateVideoStatusPaths(videoId, youtubeVideoId);
        },
      },
    ],
  );
}

export async function setVideoStatus(formData: FormData): Promise<AdminActionResult> {
  const guard = await requireAdminWrite("admin_video_status");
  if (!guard.ok) return { ok: false, message: guard.message };
  const videoId = String(formData.get("video_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!videoId || videoId.length > 128) return { ok: false, message: "video_idが不正です。" };
  if (!VALID_STATUS.has(status)) return { ok: false, message: "不正なステータスです。" };
  if (status === "voided" && !reason) return { ok: false, message: "voidedへの変更には理由が必要です。" };
  const { db } = guard;
  const before = (await db.select().from(videos).where(eq(videos.id, videoId)).limit(1))[0];
  if (!before) return { ok: false, message: "対象作品が見つかりません。" };
  if (before.visibility_status === status) return { ok: true, message: "ステータスは変更されていません。" };
  const eventRows = await db.select({ event_id: videoEvents.event_id }).from(videoEvents).where(eq(videoEvents.video_id, videoId)).limit(MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS + 1);
  if (eventRows.length > MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS) return { ok: false, message: "関連イベント数が処理上限を超えています。" };
  const now = Math.max(Math.floor(Date.now() / 1000), before.updated_at + 1);
  const nextStatus = status as (typeof videos.$inferInsert)["visibility_status"];
  const after = { ...before, visibility_status: nextStatus, updated_at: now };
  const statements: BatchItem<"sqlite">[] = [db.update(videos).set({ visibility_status: nextStatus, updated_at: now }).where(and(eq(videos.id, videoId), expectedRowCondition({ expectedCurrent: { ...before } }))!)];
  const expected: (number | null)[] = [1];
  const audits: WriteAuditLogInput[] = [{ table_name: "videos", target_id: videoId, operation: "UPDATE", before: { ...before }, after: { ...after }, actor_user_id: guard.user.id, context: "admin_video_status", reason: reason || `statusを${status}へ変更`, retention_class: status === "voided" ? "long_audit" : "normal", strict: true }];

  if (status === "voided" || before.visibility_status === "voided") {
    const category = String(formData.get("void_reason_category") ?? "").trim();
    const caseType = category === "duplicate" ? "duplicate" : category === "x_id_invalid" ? "x_reapply" : "void";
    const caseId = generateId("vmc");
    const caseAfter: typeof videoModerationCases.$inferSelect = {
      id: caseId, video_id: videoId, case_type: caseType,
      status: status === "voided" ? "open" : "resolved",
      public_reason: reason || null, private_note: status === "voided" ? category || null : "restored",
      due_at: null, locked_until: null, attempt_count: 0, related_x_user_id: null,
      created_by_user_id: guard.user.id, resolved_by_user_id: status === "voided" ? null : guard.user.id,
      created_at: now, resolved_at: status === "voided" ? null : now,
    };
    statements.push(db.insert(videoModerationCases).values(caseAfter)); expected.push(1);
    audits.push({ table_name: "video_moderation_cases", target_id: caseId, operation: "CREATE", after: { ...caseAfter }, actor_user_id: guard.user.id, context: "admin_video_status", reason: reason || "void状態を変更", retention_class: "long_audit", strict: true });
  }
  const notification = await buildVideoStatusChangeNotificationBatch(db, { videoId, videoTitle: before.title, youtubeVideoId: before.youtube_video_id, prevStatus: before.visibility_status, nextStatus: status, reason: reason || null, recipientUserId: before.submitted_by_user_id, eventId: before.primary_event_id, forceNotify: formData.get("force_notify") === "1" });
  const queue = await buildAfterVideoStatusChangeQueueBatch(db, { videoId, eventIds: eventRows.map((row) => row.event_id), creatorXUserId: before.creator_x_user_id, primaryEventId: before.primary_event_id, requestedByUserId: guard.user.id });
  statements.push(...queue.statements, ...notification.statements);
  expected.push(...queue.expectedChanges, ...notification.expectedChanges);
  try {
    await mutateWithAudit(db, {
      mutationStatements: statements,
      expectedMutationChanges: expected,
      audits,
      staticRebuildWakeSource: queue.statements.length > 0 ? "admin" : undefined,
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[admin-video-status] atomic mutation failed", error);
    return { ok: false, message: "更新・通知・静的再生成の記録に失敗しました。" };
  }
  await revalidateVideoStatusPathsBestEffort(videoId, before.youtube_video_id);
  return { ok: true, message: "ステータスを更新しました。" };
}
