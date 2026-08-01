"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { getDatabase } from "@/lib/cloudflare";
import { writeGuard } from "@/lib/auth/writeGuard";
import { videos, videoInteractions } from "@/lib/db/schema";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { compositeAuditTargetId } from "@/lib/video/atomicWritePlanCore";
import type { VideoActionResult } from "@/lib/video/types";
import { createTraceId } from "@/lib/observability/flowTrace";

type InteractionKind = "like" | "bookmark";
type RequestedState = boolean | "toggle";

function isVideoInteractionUniqueConstraintError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (!/UNIQUE constraint failed/i.test(message)) return false;
  return /video_interactions/i.test(message);
}

async function revalidateVideoInteractionPaths(
  youtubeVideoId: string | null,
  videoId: string,
): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "video.interaction", traceId: createTraceId() },
    [
      {
        name: "revalidate_video",
        run: async () => {
          revalidatePath(`/${youtubeVideoId ?? videoId}`);
        },
      },
      {
        name: "revalidate_list",
        run: async () => {
          revalidatePath("/list");
        },
      },
    ],
  );
}

async function mutateVideoInteraction(
  formData: FormData,
  requestedState: RequestedState,
): Promise<VideoActionResult & { active?: boolean }> {
  const guard = await writeGuard({
    // requireApprovedActiveXId は false だが、getCurrentUser が resolveActiveXUserId 経由で
    // 承認済みリンクだけを active_x_user_id に解決するため、実質 approved active X が必要。
    requireActiveXId: true,
    requireApprovedActiveXId: false,
    feature: "like_or_bookmark",
  });
  if (!guard.ok) return { ok: false, message: guard.message };
  const activeX = guard.activeXId;
  if (!activeX) {
    return { ok: false, message: "X ID を選択してから操作してください。" };
  }

  const videoId = String(formData.get("video_id") ?? "").trim();
  const rawKind = String(formData.get("kind") ?? "");
  if (!videoId) return { ok: false, message: "対象が指定されていません。" };
  if (rawKind !== "like" && rawKind !== "bookmark") {
    return { ok: false, message: "不正な操作種別です。" };
  }
  const kind: InteractionKind = rawKind;

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  // Both snapshots are read once. Every mutation below compares these values again
  // inside the same D1 batch, so a concurrent toggle fails closed.
  const target = (
    await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "対象作品が見つかりません。" };
  if (target.visibility_status !== "public") {
    return { ok: false, message: "公開中の作品だけ操作できます。" };
  }

  const existing = (
    await db
      .select()
      .from(videoInteractions)
      .where(
        and(
          eq(videoInteractions.x_user_id, activeX),
          eq(videoInteractions.video_id, videoId),
          eq(videoInteractions.interaction_type, kind),
        )!,
      )
      .limit(1)
  )[0];
  const active = requestedState === "toggle" ? !existing : requestedState;

  if (active === Boolean(existing)) {
    await revalidateVideoInteractionPaths(target.youtube_video_id, videoId);
    return { ok: true, active, videoId };
  }

  const now = Math.floor(Date.now() / 1000);
  const interactionAfter = active
    ? {
        x_user_id: activeX,
        video_id: videoId,
        interaction_type: kind,
        created_at: now,
      }
    : null;
  // Preflight 後に公開状態が変わっても interaction だけが残らないよう、
  // 対象動画の公開状態と snapshot を interaction 自体の D1 batch 条件へ含める。
  const publicTargetSnapshotExists = sql`
    EXISTS (
      SELECT 1
      FROM videos AS interaction_target
      WHERE interaction_target.id = ${videoId}
        AND interaction_target.visibility_status = 'public'
        AND interaction_target.updated_at = ${target.updated_at}
    )
  `;
  const interactionStatement = active
    ? db.run(sql`
        INSERT INTO video_interactions (
          x_user_id, video_id, interaction_type, created_at
        )
        SELECT
          ${interactionAfter!.x_user_id}, ${interactionAfter!.video_id},
          ${interactionAfter!.interaction_type}, ${interactionAfter!.created_at}
        WHERE ${publicTargetSnapshotExists}
      `)
    : db
        .delete(videoInteractions)
        .where(
          and(
            eq(videoInteractions.x_user_id, existing!.x_user_id),
            eq(videoInteractions.video_id, existing!.video_id),
            eq(videoInteractions.interaction_type, existing!.interaction_type),
            eq(videoInteractions.created_at, existing!.created_at),
            publicTargetSnapshotExists,
          )!,
        );

  const mutationStatements: BatchItem<"sqlite">[] = [interactionStatement];
  const expectedChanges: number[] = [1];
  const audits: WriteAuditLogInput[] = [
    {
      table_name: "video_interactions",
      target_id: compositeAuditTargetId(activeX, videoId, kind),
      operation: active ? ("CREATE" as const) : ("DELETE" as const),
      before: existing ? { ...existing } : null,
      after: interactionAfter ? { ...interactionAfter } : null,
      actor_user_id: guard.user.id,
      reason: `${kind}:${active ? "activate" : "deactivate"}`,
      context: "video-interaction",
      retention_class: "normal" as const,
      strict: true,
    },
  ];

  let staticRebuildWakeSource: "web" | undefined;
  if (kind === "like") {
    const nextLikeCount = active
      ? target.app_like_count + 1
      : Math.max(0, target.app_like_count - 1);
    const videoAfter = {
      ...target,
      app_like_count: nextLikeCount,
      updated_at: now,
    };
    mutationStatements.push(
      db
        .update(videos)
        .set({ app_like_count: nextLikeCount, updated_at: now })
        .where(
          and(
            eq(videos.id, videoId),
            eq(videos.visibility_status, "public"),
            eq(videos.app_like_count, target.app_like_count),
            eq(videos.updated_at, target.updated_at),
          )!,
        ),
    );
    expectedChanges.push(1);
    audits.push({
      table_name: "videos",
      target_id: videoId,
      operation: "UPDATE" as const,
      before: { ...target },
      after: videoAfter,
      actor_user_id: guard.user.id,
      reason: `like:${active ? "increment" : "decrement"}`,
      context: "video-interaction",
      retention_class: "normal" as const,
      strict: true,
    });

    const queue = await buildStaticRebuildQueueBatch(db, [
      {
        targetType: "video",
        targetId: videoId,
        reason: "video_like_count_change",
        priority: "normal",
        requestedByUserId: guard.user.id,
      },
      {
        targetType: "list_popular",
        targetId: "global",
        reason: "video_like_count_change",
        priority: "normal",
        requestedByUserId: guard.user.id,
      },
    ]);
    mutationStatements.push(...queue.statements);
    expectedChanges.push(...queue.expectedChanges);
    staticRebuildWakeSource = "web";
  }

  try {
    await mutateWithAudit(db, {
      mutationStatements,
      expectedMutationChanges: expectedChanges,
      audits,
      staticRebuildWakeSource,
    });
  } catch (error) {
    unstable_rethrow(error);
    if (active && isVideoInteractionUniqueConstraintError(error)) {
      await revalidateVideoInteractionPaths(target.youtube_video_id, videoId);
      return { ok: true, active, videoId };
    }
    console.warn("[video-interaction] atomic mutation rejected", error);
    return {
      ok: false,
      message: "操作が競合したか、保存に失敗しました。再読み込みして再試行してください。",
    };
  }

  await revalidateVideoInteractionPaths(target.youtube_video_id, videoId);
  return { ok: true, active, videoId };
}

export async function toggleVideoInteraction(
  formData: FormData,
): Promise<VideoActionResult & { active?: boolean }> {
  return mutateVideoInteraction(formData, "toggle");
}
