"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { videoEvents, videos } from "@/lib/db/schema";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";
import {
  findOpenModerationCaseById,
  planVoidModerationCaseOpen,
  planVoidModerationCaseResolve,
} from "@/lib/moderation/openCases";
import { resolveVoidModerationCaseType } from "@/lib/moderation/voidCaseType";
import { markPendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";
import type { PendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";
import { MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS } from "@/lib/staticRebuild/hooks";
import {
  planVideoVisibilityTransition,
  preCommitVideoVisibilityDepublicization,
  runVideoVisibilityTransitionPostCommit,
} from "@/lib/video/videoVisibilityTransition";

export interface AdminActionResult extends PendingPublicReflection {
  ok: boolean;
  message?: string;
}
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
  publicCacheKeys: readonly string[],
): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "admin_video_status", traceId: createTraceId() },
    [
      {
        name: "video_visibility_post_commit",
        run: async () => {
          await runVideoVisibilityTransitionPostCommit({
            publicCacheKeys,
            revalidate: () => {
              revalidateVideoStatusPaths(videoId, youtubeVideoId);
            },
          });
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
  const caseId = String(formData.get("case_id") ?? "").trim();
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
  if (!nextStatus) return { ok: false, message: "不正なステータスです。" };

  const transition = await planVideoVisibilityTransition(db, {
    video: before,
    nextStatus,
    actorUserId: guard.user.id,
    context: "admin_video_status",
    reason: reason || null,
    eventIds: eventRows.map((row) => row.event_id),
    forceNotify: formData.get("force_notify") === "1",
    now,
  });

  const statements: BatchItem<"sqlite">[] = [...transition.mutationStatements];
  const expected: (number | null)[] = [...transition.expectedMutationChanges];
  const audits = [...transition.audits];

  if (status === "voided") {
    const category = String(formData.get("void_reason_category") ?? "").trim();
    const caseType = resolveVoidModerationCaseType(category);
    const moderation = await planVoidModerationCaseOpen(db, {
      videoId,
      caseType,
      publicReason: reason || null,
      privateNote: category || null,
      actorUserId: guard.user.id,
      now,
      auditContext: "admin_video_status",
    });
    statements.push(...moderation.statements);
    expected.push(...moderation.expectedChanges);
    audits.push(...moderation.audits);
  } else if (before.visibility_status === "voided") {
    if (!caseId) {
      return { ok: false, message: "voided解除には case_id が必要です。" };
    }
    const openCase = await findOpenModerationCaseById(db, caseId);
    if (!openCase || openCase.video_id !== videoId) {
      return { ok: false, message: "解決対象の open case が見つかりません。" };
    }
    const moderation = planVoidModerationCaseResolve(db, openCase, {
      actorUserId: guard.user.id,
      now,
      privateNote: "restored",
      auditContext: "admin_video_status",
      reason: reason || "void 解除",
    });
    statements.push(...moderation.statements);
    expected.push(...moderation.expectedChanges);
    audits.push(...moderation.audits);
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
      console.error("[admin-video-status] R2 visibility block failed", error);
      return { ok: false, message: "公開ブロックの記録に失敗しました。" };
    }
  }

  try {
    await mutateWithAudit(db, {
      mutationStatements: statements,
      expectedMutationChanges: expected,
      audits,
      notificationWakeSource:
        transition.notificationBatch.statements.length > 0 ? "admin" : undefined,
      staticRebuildWakeSource:
        transition.queueBatch.statements.length > 0 ? "admin" : undefined,
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[admin-video-status] atomic mutation failed", error);
    return { ok: false, message: "更新・通知・静的再生成の記録に失敗しました。" };
  }
  await revalidateVideoStatusPathsBestEffort(
    videoId,
    before.youtube_video_id,
    transition.publicCacheKeys,
  );
  return markPendingPublicReflection(
    { ok: true, message: "ステータスを更新しました。" },
    transition.queueBatch.statements.length > 0,
  );
}
