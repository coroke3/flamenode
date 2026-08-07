"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { videos } from "@/lib/db/schema";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";
import {
  findOpenModerationCaseById,
  planVoidModerationCaseOpen,
  planVoidModerationCaseResolve,
} from "@/lib/moderation/openCases";
import { resolveVoidModerationCaseType } from "@/lib/moderation/voidCaseType";
import type { PendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";
import {
  findNextPendingReviewVideoId,
  resolveApproveAndNextHref,
} from "@/lib/admin/videoReviewQueueOrder";
import {
  planVideoVisibilityTransition,
  runVideoVisibilityTransitionPostCommit,
} from "@/lib/video/videoVisibilityTransition";
import {
  executeVideoVisibilityStatusMutation,
  loadVideoRebuildEventIds,
  monotonicVideoUpdatedAt,
  SAME_VIDEO_STATUS_MESSAGE,
  type VideoStatusActionResult,
} from "@/lib/video/videoVisibilityStatusAction";

export type AdminActionResult = VideoStatusActionResult & PendingPublicReflection;

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

export async function approveAdminVideoPublic(
  formData: FormData,
): Promise<AdminActionResult> {
  formData.set("status", "public");
  return setVideoStatus(formData);
}

export async function approveAdminVideoPublicAndNext(
  formData: FormData,
): Promise<AdminActionResult> {
  formData.set("status", "public");
  formData.set("and_next", "1");
  return setVideoStatus(formData);
}

export async function setVideoStatus(formData: FormData): Promise<AdminActionResult> {
  const guard = await requireAdminWrite("admin_video_status");
  if (!guard.ok) return { ok: false, message: guard.message };
  const videoId = String(formData.get("video_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const caseId = String(formData.get("case_id") ?? "").trim();
  const andNext = formData.get("and_next") === "1";
  if (!videoId || videoId.length > 128) return { ok: false, message: "video_idが不正です。" };
  if (!VALID_STATUS.has(status)) return { ok: false, message: "不正なステータスです。" };
  if (status === "voided" && !reason) return { ok: false, message: "voidedへの変更には理由が必要です。" };
  const { db } = guard;
  const before = (await db.select().from(videos).where(eq(videos.id, videoId)).limit(1))[0];
  if (!before) return { ok: false, message: "対象作品が見つかりません。" };
  if (before.visibility_status === status) {
    return { ok: true, message: SAME_VIDEO_STATUS_MESSAGE };
  }

  const rebuildEvents = await loadVideoRebuildEventIds(db, videoId, before.primary_event_id);
  if (!rebuildEvents.ok) return { ok: false, message: rebuildEvents.message };

  const now = monotonicVideoUpdatedAt(before.updated_at);
  const nextStatus = status as (typeof videos.$inferInsert)["visibility_status"];
  if (!nextStatus) return { ok: false, message: "不正なステータスです。" };

  const traceId = createTraceId();

  try {
    const transition = await planVideoVisibilityTransition(db, {
      video: before,
      nextStatus,
      actorUserId: guard.user.id,
      context: "admin_video_status",
      reason: reason || null,
      eventIds: rebuildEvents.eventIds,
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
      if (
        !openCase ||
        openCase.video_id !== videoId ||
        openCase.case_type !== "void"
      ) {
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

    const result = await executeVideoVisibilityStatusMutation({
      db,
      videoId,
      requestedStatus: status,
      transition,
      reason: reason || null,
      logTag: "admin-video-status",
      extraStatements: statements.slice(transition.mutationStatements.length),
      extraExpected: expected.slice(transition.expectedMutationChanges.length),
      extraAudits: audits.slice(transition.audits.length),
      notificationWakeSource:
        transition.notificationBatch.statements.length > 0 ? "admin" : undefined,
      staticRebuildWakeSource:
        transition.queueBatch.statements.length > 0 ? "admin" : undefined,
    });
    if (!result.ok) return result;

    await revalidateVideoStatusPathsBestEffort(
      videoId,
      before.youtube_video_id,
      transition.publicCacheKeys,
    );

    if (andNext && status === "public") {
      const nextVideoId = await findNextPendingReviewVideoId(db, {
        id: before.id,
        created_at: before.created_at,
      });
      return {
        ...result,
        nextHref: resolveApproveAndNextHref(nextVideoId),
      };
    }

    return result;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[admin-video-status] failed", { traceId, error });
    return {
      ok: false,
      message: `承認処理に失敗しました。状態を再取得してもう一度お試しください。エラーID: ${traceId}`,
      errorCode: "status_action_failed",
      traceId,
      retryable: true,
    };
  }
}
