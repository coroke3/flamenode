"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import { readAdminVideoCollabFlag } from "@flamenode/domain/video";
import { adminVideoMembersRebuildTargets } from "@flamenode/server-core/video/adminMemberRebuildTargets";
import { buildAdminVideoMemberMetadataPlan } from "@flamenode/server-core/video/adminMemberMetadataPlan";
import { writeGuard } from "@/lib/auth/writeGuard";
import { videos } from "@/lib/db/schema";
import { buildReplaceVideoMembersPlan } from "@/lib/video/replaceVideoMembers";
import {
  deriveAdminVideoMemberSaveEffects,
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
import { loadVideoRebuildEventIds } from "@/lib/video/videoVisibilityStatusAction";
import { publicVideoRevalidationPaths } from "@/lib/video/publicVideoRevalidationPaths";

function revalidateVideoMembersAdminPaths(input: {
  videoId: string;
  youtubeVideoId: string | null;
  primaryEventId: string | null;
}): void {
  revalidatePath(`/admin/videos/${input.videoId}`);
  revalidatePath(`/admin/videos/${input.videoId}/members`);
  revalidatePath(`/dashboard/edit/${input.videoId}`);
  for (const publicPath of publicVideoRevalidationPaths(input.videoId, input.youtubeVideoId)) {
    revalidatePath(publicPath);
  }
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

  const rebuildEvents = await loadVideoRebuildEventIds(
    db,
    videoId,
    target.primary_event_id,
  );
  if (!rebuildEvents.ok) return { ok: false, message: rebuildEvents.message };

  const isCollab = readAdminVideoCollabFlag(formData);
  const memberValidation = validateVideoMemberSubmission(formData, isCollab);
  if (!memberValidation.ok) return memberValidation;

  const members = memberValidation.value.members;
  const now = Math.floor(Date.now() / 1000);
  const traceId = createTraceId();

  let queue: Awaited<ReturnType<typeof buildStaticRebuildQueueBatch>>;
  try {
    const plan = emptyVideoAtomicWritePlan();
    const membersPlan = await buildReplaceVideoMembersPlan(db, {
      videoId,
      members,
      chaptersByIndex: memberValidation.value.chaptersByIndex,
      actorUserId: user.id,
    });
    appendVideoAtomicWritePlan(plan, membersPlan);

    const {
      nextCollaborationType,
      videoPublicContentChanged,
      affectedCreatorIds,
      membersPlanChanged,
    } = deriveAdminVideoMemberSaveEffects({
      membersPlan,
      previousCollaborationType: target.collaboration_type,
      members,
      isCollab,
      isPublicVideo: target.visibility_status === "public",
      creatorXUserId: target.creator_x_user_id,
    });

    // 旧実装は保存内容が同じでもvideos.updated_atを毎回更新し、score dirty化と
    // 不要なstatic rebuildを誘発していた。公開内容か合作区分が実際に変わる時だけ
    // video本体をdirtyにする。member-set CASはmembersPlan側で引き続きfail-closed。
    const metadataPlan = buildAdminVideoMemberMetadataPlan(db, {
      target, nextCollaborationType, now, actorUserId: user.id,
      publicContentChanged: videoPublicContentChanged,
    });
    appendVideoAtomicWritePlan(plan, metadataPlan);


    const queueItems = adminVideoMembersRebuildTargets({
      videoId,
      actorUserId: user.id,
      publicContentChanged: videoPublicContentChanged,
      membersPlanChanged,
      eventIds: rebuildEvents.eventIds,
      isPublicVideo: target.visibility_status === "public",
      affectedCreatorIds,
    });

    // 完全no-opならD1 mutation・audit・static rebuildを発生させない。
    if (plan.statements.length === 0) {
      return {
        ok: true,
        message: "参加者設定に変更はありません。",
        videoId,
        youtubeVideoId: target.youtube_video_id ?? undefined,
        eventId: target.primary_event_id ?? undefined,
      };
    }

    queue = await buildStaticRebuildQueueBatch(db, queueItems);
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
