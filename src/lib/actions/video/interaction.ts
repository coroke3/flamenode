"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { writeGuard } from "@/lib/auth/writeGuard";
import { videos, videoInteractionsAuth } from "@/lib/db/schema";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { compositeAuditTargetId } from "@/lib/video/atomicWritePlanCore";
import type { VideoActionResult } from "@/lib/video/types";
import { createTraceId } from "@/lib/observability/flowTrace";
import { nextVideoAppLikeCount } from "@flamenode/domain/video";
import { publicVideoRevalidationPaths } from "@/lib/video/publicVideoRevalidationPaths";

type InteractionKind = "like" | "bookmark";
type RequestedState = boolean | "toggle";

function rethrowVideoInteractionFrameworkControl(error: unknown): void {
  const seen = new Set<object>();
  while (typeof error === "object" && error !== null && !seen.has(error)) {
    seen.add(error);

    // Next inspects these fields. Pass only their own data values so provider
    // accessors cannot run inside the framework's classifier.
    let metadata: { digest: unknown; message: unknown; $$typeof: unknown };
    let cause: unknown;
    try {
      metadata = {
        digest: Object.getOwnPropertyDescriptor(error, "digest")?.value,
        message: Object.getOwnPropertyDescriptor(error, "message")?.value,
        $$typeof: Object.getOwnPropertyDescriptor(error, "$$typeof")?.value,
      };
      cause = error instanceof Error ? Object.getOwnPropertyDescriptor(error, "cause")?.value : undefined;
    } catch {
      return;
    }

    try {
      unstable_rethrow(metadata);
    } catch (controlFlow) {
      if (controlFlow === metadata) throw error;
    }

    error = cause;
  }
}

function isVideoInteractionAuthUniqueConstraintError(err: unknown): boolean {
  // D1/provider exceptions are untrusted. A throwing message getter or
  // coercion must not replace the stable mutation failure with a new error.
  try {
    const message = err instanceof Error ? err.message : String(err);
    return typeof message === "string" &&
      /UNIQUE constraint failed/i.test(message) &&
      /video_interactions_auth/i.test(message);
  } catch {
    return false;
  }
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
          for (const publicPath of publicVideoRevalidationPaths(videoId, youtubeVideoId)) {
            revalidatePath(publicPath);
          }
        },
      },
      {
        name: "revalidate_list",
        run: async () => {
          revalidatePath("/list");
        },
      },
      {
        name: "revalidate_library",
        run: async () => {
          revalidatePath("/dashboard/library");
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
    requireActiveXId: false,
    requireApprovedActiveXId: false,
    feature: "like_or_bookmark",
  });
  if (!guard.ok) return { ok: false, message: guard.message };
  const authUserId = guard.user.id;

  const videoId = String(formData.get("video_id") ?? "").trim();
  const rawKind = String(formData.get("kind") ?? "");
  if (!videoId) return { ok: false, message: "対象が指定されていません。" };
  if (rawKind !== "like" && rawKind !== "bookmark") {
    return { ok: false, message: "不正な操作種別です。" };
  }
  const kind: InteractionKind = rawKind;

  const db = guard.db;

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
      .from(videoInteractionsAuth)
      .where(
        and(
          eq(videoInteractionsAuth.auth_user_id, authUserId),
          eq(videoInteractionsAuth.video_id, videoId),
          eq(videoInteractionsAuth.interaction_type, kind),
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
        auth_user_id: authUserId,
        video_id: videoId,
        interaction_type: kind,
        created_at: now,
      }
    : null;
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
        INSERT INTO video_interactions_auth (
          auth_user_id, video_id, interaction_type, created_at
        )
        SELECT
          ${interactionAfter!.auth_user_id}, ${interactionAfter!.video_id},
          ${interactionAfter!.interaction_type}, ${interactionAfter!.created_at}
        WHERE ${publicTargetSnapshotExists}
      `)
    : db
        .delete(videoInteractionsAuth)
        .where(
          and(
            eq(videoInteractionsAuth.auth_user_id, existing!.auth_user_id),
            eq(videoInteractionsAuth.video_id, existing!.video_id),
            eq(videoInteractionsAuth.interaction_type, existing!.interaction_type),
            eq(videoInteractionsAuth.created_at, existing!.created_at),
            publicTargetSnapshotExists,
          )!,
        );

  const mutationStatements: BatchItem<"sqlite">[] = [interactionStatement];
  const expectedChanges: number[] = [1];
  const audits: WriteAuditLogInput[] = [
    {
      table_name: "video_interactions_auth",
      target_id: compositeAuditTargetId(authUserId, videoId, kind),
      operation: active ? ("CREATE" as const) : ("DELETE" as const),
      before: existing ? { ...existing } : null,
      after: interactionAfter ? { ...interactionAfter } : null,
      actor_user_id: authUserId,
      reason: `${kind}:${active ? "activate" : "deactivate"}`,
      context: "video-interaction",
      retention_class: "normal" as const,
      strict: true,
    },
  ];

  let staticRebuildWakeSource: "web" | undefined;
  if (kind === "like") {
    const nextLikeCount = nextVideoAppLikeCount(target.app_like_count, active);
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
      actor_user_id: authUserId,
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
        requestedByUserId: authUserId,
      },
      {
        targetType: "list_popular",
        targetId: "global",
        reason: "video_like_count_change",
        priority: "normal",
        requestedByUserId: authUserId,
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
    rethrowVideoInteractionFrameworkControl(error);
    if (active && isVideoInteractionAuthUniqueConstraintError(error)) {
      await revalidateVideoInteractionPaths(target.youtube_video_id, videoId);
      return { ok: true, active, videoId };
    }
    // Diagnostics are best effort; do not expose raw provider errors or let
    // a broken logger replace the action's fixed failure result.
    try {
      console.warn("[video-interaction] atomic mutation rejected");
    } catch {
      // The mutation already failed; return the fixed error below.
    }
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
