"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { writeGuard } from "@/lib/auth/writeGuard";
import { getDatabase } from "@/lib/cloudflare";
import { videos } from "@/lib/db/schema";
import { buildReplaceVideoMembersPlan } from "@/lib/video/replaceVideoMembers";
import {
  collectMemberAggregationAffectedXUserIds,
  extractPreviousPublicMemberXUserIdsFromMembersPlan,
} from "@/lib/video/memberAggregationFanOut";
import { validateVideoMemberSubmission } from "@/lib/video/submissionValidation";
import type { VideoActionResult } from "@/lib/video/types";
import { expectedRowCondition } from "@/lib/audit/adapters";
import {
  appendVideoAtomicWritePlan,
  emptyVideoAtomicWritePlan,
  executeVideoAtomicWritePlan,
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

  const db = getDatabase();
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

  let queue: Awaited<ReturnType<typeof buildStaticRebuildQueueBatch>>;
  try {
    const after = { ...target, collaboration_type: nextCollaborationType, updated_at: now };
    const plan = emptyVideoAtomicWritePlan();
    plan.statements.push(db.update(videos).set({
      collaboration_type: nextCollaborationType,
      updated_at: now,
    }).where(and(
      eq(videos.id, videoId),
      expectedRowCondition({ expectedCurrent: target }),
    )!));
    plan.expectedChanges.push(1);
    plan.audits.push({
      table_name: "videos", target_id: videoId, operation: "UPDATE",
      before: { ...target }, after, actor_user_id: user.id,
      context: "admin-video-members", retention_class: "normal", strict: true,
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
    console.warn("[updateVideoMembersAdmin] atomic save rejected", error);
    return { ok: false, message: "保存が競合しました。再読み込みして再試行してください。" };
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
