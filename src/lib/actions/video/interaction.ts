"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { mutateWithAudit } from "@/lib/audit/mutate";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { getDatabase } from "@/lib/cloudflare";
import { writeGuard } from "@/lib/auth/writeGuard";
import { videos, videoInteractions } from "@/lib/db/schema";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { generateId } from "@/lib/utils/id";
import type { VideoActionResult } from "@/lib/video/types";

type InteractionKind = "like" | "bookmark";
type RequestedState = boolean | "toggle";

async function mutateVideoInteraction(
  formData: FormData,
  requestedState: RequestedState,
): Promise<VideoActionResult & { active?: boolean }> {
  const guard = await writeGuard({
    requireApprovedActiveXId: true,
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
    revalidatePath(`/${target.youtube_video_id ?? videoId}`);
    return { ok: true, active, videoId };
  }

  const now = Math.floor(Date.now() / 1000);
  const interactionAfter = active
    ? {
        id: generateId("vi"),
        x_user_id: activeX,
        video_id: videoId,
        interaction_type: kind,
        source: "app" as const,
        created_at: now,
        synced_at: null,
      }
    : null;
  const interactionStatement = active
    ? db.insert(videoInteractions).values(interactionAfter!)
    : db
        .delete(videoInteractions)
        .where(
          and(
            eq(videoInteractions.id, existing!.id),
            eq(videoInteractions.x_user_id, existing!.x_user_id),
            eq(videoInteractions.video_id, existing!.video_id),
            eq(videoInteractions.interaction_type, existing!.interaction_type),
            eq(videoInteractions.created_at, existing!.created_at),
          )!,
        );

  const mutationStatements: BatchItem<"sqlite">[] = [interactionStatement];
  const expectedChanges: number[] = [1];
  const audits: WriteAuditLogInput[] = [
    {
      table_name: "video_interactions",
      target_id: active ? interactionAfter!.id : existing!.id,
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
  }

  try {
    await mutateWithAudit(db, {
      mutationStatements,
      expectedMutationChanges: expectedChanges,
      audits,
    });
  } catch (error) {
    console.warn("[video-interaction] atomic mutation rejected", error);
    return {
      ok: false,
      message: "操作が競合したか、保存に失敗しました。再読み込みして再試行してください。",
    };
  }

  revalidatePath(`/${target.youtube_video_id ?? videoId}`);
  revalidatePath("/list");
  return { ok: true, active, videoId };
}

export async function toggleVideoInteraction(
  formData: FormData,
): Promise<VideoActionResult & { active?: boolean }> {
  return mutateVideoInteraction(formData, "toggle");
}

/** 明示的に on/off を指定する。FormData の `active` に "true" / "false" を渡す。 */
export async function setVideoInteraction(
  formData: FormData,
): Promise<VideoActionResult & { active?: boolean }> {
  const raw = String(formData.get("active") ?? "");
  if (raw !== "true" && raw !== "false") {
    return { ok: false, message: "active の指定が不正です。" };
  }
  return mutateVideoInteraction(formData, raw === "true");
}
