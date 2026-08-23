"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import { writeGuard } from "@/lib/auth/writeGuard";
import { videos } from "@/lib/db/schema";
import { buildReplaceVideoMembersPlan } from "@/lib/video/replaceVideoMembers";
import {
  collectMemberAggregationAffectedXUserIds,
  extractPreviousPublicMemberXUserIdsFromMembersPlan,
} from "@/lib/video/memberAggregationFanOut";
import { validateVideoMemberSubmission } from "@/lib/video/submissionValidation";
import type { VideoActionResult } from "@/lib/video/types";
import {
  appendVideoAtomicWritePlan,
  emptyVideoAtomicWritePlan,
  executeVideoAtomicWritePlan,
  VideoAtomicPlanBudgetError,
} from "@/lib/video/atomicWritePlan";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { markPendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";

function formDataBoolean(formData: FormData, name: string): boolean {
  return formData
    .getAll(name)
    .some((value) => value === "on" || value === "true");
}

function revalidateVideoMembersAdminPaths(input: {
  videoId: string;
  youtubeVideoId: string | null;
  primaryEventId: string | null;
}): void {
  revalidatePath(`/admin/videos/${input.videoId}`);
  revalidatePath(`/admin/videos/${input.videoId}/members`);
  revalidatePath(`/dashboard/edit/${input.videoId}`);
  revalidatePath(`/${input.youtubeVideoId ?? input.videoId}`);
  revalidatePath("/list");
  if (input.primaryEventId) {
    revalidatePath(`/event/${input.primaryEventId}`);
    revalidatePath(`/event/${input.primaryEventId}/slots`);
  }
}

async function revalidateVideoMembersAdminPathsBestEffort(input: {
  videoId: string;
  youtubeVideoId: string | null;
  primaryEventId: string | null;
}): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "admin_video_members", traceId: createTraceId() },
    [
      {
        name: "revalidate_video_members_admin_paths",
        run: async () => {
          revalidateVideoMembersAdminPaths(input);
        },
      },
    ],
  );
}

export async function updateVideoMembersAdmin(
  formData: FormData,
): Promise<VideoActionResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, reason: guard.reason, message: guard.message };
  const user = guard.user;
  if (user.role !== "admin") {
    return { ok: false, message: "管理者権限が必要です。" };
  }

  // Reuse the request-local D1 resolved by writeGuard.
  const db = guard.db;
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const videoId = String(formData.get("video_id") ?? "").trim();
  if (!videoId) return { ok: false, message: "対象作品が指定されていません。" };

  const target = (
    await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "作品が見つかりません。" };

  const isCollab = formDataBoolean(formData, "is_collab");
  const memberValidation = validateVideoMemberSubmission(formData, isCollab);
  if (!memberValidation.ok) return memberValidation;

  const members = memberValidation.value.members;
  const nextCollaborationType = members.length > 0 || isCollab ? "collab" : "individual";
  const now = Math.floor(Date.now() / 1000);
  const traceId = createTraceId();

  let queue: Awaited<ReturnType<typeof buildStaticRebuildQueueBatch>>;
  try {
    const plan = emptyVideoAtomicWritePlan();

    // 参加者保存の同時更新保護は buildReplaceVideoMembersPlan の member-set CAS を正本にする。
    // ここで videos 行全体を expectedRowCondition すると、タイトル・説明・YouTube同期など
    // メンバーと無関係な項目が並行更新されただけでも保存が失敗し、
    // 「競合しました。再読み込みして再試行してください。」相当の偽競合になる。
    // collaboration_type はメンバー集合から導出されるため、対象 video が存在することだけを
    // 条件に同一atomic batch内で更新する。member-set CAS失敗時はbatch全体がrollbackされる。
    plan.statements.push(
      db
        .update(videos)
        .set({
          collaboration_type: nextCollaborationType,
          updated_at: now,
        })
        .where(eq(videos.id, videoId)),
    );
    plan.expectedChanges.push(1);
    plan.audits.push({
      table_name: "videos",
      target_id: videoId,
      operation: "UPDATE",
      before: {
        id: target.id,
        collaboration_type: target.collaboration_type,
        updated_at: target.updated_at,
      },
      after: {
        id: target.id,
        collaboration_type: nextCollaborationType,
        updated_at: now,
      },
      actor_user_id: user.id,
      context: "admin-video-members",
      reason: "参加者設定から合作区分を同期",
      retention_class: "normal",
      restore_strategy: "none",
      strict: true,
    });

    const membersPlan = await buildReplaceVideoMembersPlan(db, {
      videoId,
      members,
      chaptersByIndex: memberValidation.value.chaptersByIndex,
      actorUserId: user.id,
    });
    appendVideoAtomicWritePlan(plan, membersPlan);
    const hasMemberAudit = membersPlan.audits.some(
      (audit) => audit.table_name === "video_members_set",
    );
    const isPublicVideo = target.visibility_status === "public";
    const affectedCreatorIds = isPublicVideo
      && hasMemberAudit
      ? collectMemberAggregationAffectedXUserIds({
          previousCreatorXUserId: target.creator_x_user_id,
          nextCreatorXUserId: target.creator_x_user_id,
          previousMemberXUserIds:
            extractPreviousPublicMemberXUserIdsFromMembersPlan(membersPlan),
          nextMembers: members,
        })
      : new Set<string>();
    const memberAggregationChanged = affectedCreatorIds.size > 0;
    queue = await buildStaticRebuildQueueBatch(db, [
      { targetType: "video", targetId: videoId, reason: "video_members_update", requestedByUserId: user.id },
      { targetType: "member_suggestions" as const, targetId: "global", reason: "video_members_update" },
      ...(isPublicVideo && memberAggregationChanged
        ? [
            { targetType: "users_index" as const, targetId: "global", reason: "video_members_update" },
            ...[...affectedCreatorIds].map((xUserId) => ({
              targetType: "user" as const,
              targetId: xUserId,
              reason: "video_members_update",
            })),
          ]
        : []),
    ]);
    plan.statements.push(...queue.statements);
    plan.expectedChanges.push(...queue.expectedChanges);
    await executeVideoAtomicWritePlan(db, plan, {
      staticRebuildWakeSource: queue.statements.length > 0 ? "admin" : undefined,
    });
  } catch (error) {
    unstable_rethrow(error);
    const errorName = error instanceof Error ? error.name : typeof error;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const budget = error instanceof VideoAtomicPlanBudgetError ? error.budget : null;
    console.warn("[updateVideoMembersAdmin] atomic save rejected", {
      traceId,
      videoId,
      errorName,
      errorMessage,
      budget: budget
        ? {
            totalQueryCount: budget.totalQueryCount,
            batchQueryCount: budget.batchQueryCount,
            limit: budget.limit,
          }
        : null,
    });
    if (error instanceof VideoAtomicPlanBudgetError) {
      return {
        ok: false,
        message: "参加者設定が一度に処理できる上限を超えています。入力内容を確認してください。",
      };
    }
    // D1 / audit / optimistic guard の失敗を一律に「競合」と断定しない。
    // member-set guard自体はfail-closedのままなのでlost updateは防止される。
    return {
      ok: false,
      message: "参加者設定の保存に失敗しました。最新状態を確認して再試行してください。",
    };
  }

  await revalidateVideoMembersAdminPathsBestEffort({
    videoId,
    youtubeVideoId: target.youtube_video_id,
    primaryEventId: target.primary_event_id,
  });

  return markPendingPublicReflection(
    {
      ok: true,
      message: "参加者設定を保存しました。",
      videoId,
      youtubeVideoId: target.youtube_video_id ?? undefined,
      eventId: target.primary_event_id ?? undefined,
    },
    queue.statements.length > 0,
  );
}
