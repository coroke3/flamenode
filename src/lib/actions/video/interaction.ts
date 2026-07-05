"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { writeGuard } from "@/lib/auth/writeGuard";
import { videos, videoInteractions } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { adjustVideoAppLikeCount } from "@/lib/db/videoLikeCount";
import type { VideoActionResult } from "@/lib/video/types";

async function mutateVideoInteraction(
  formData: FormData,
  active: boolean,
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
  const kind = String(formData.get("kind") ?? "");
  if (!videoId) return { ok: false, message: "対象が指定されていません。" };
  if (kind !== "like" && kind !== "bookmark") {
    return { ok: false, message: "不正な操作種別です。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const target = (
    await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "作品が見つかりません。" };

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

  const now = Math.floor(Date.now() / 1000);

  if (!active) {
    if (!existing) {
      revalidatePath(`/${target.youtube_video_id ?? videoId}`);
      return { ok: true, active: false, videoId };
    }
    await db
      .delete(videoInteractions)
      .where(eq(videoInteractions.id, existing.id));
    if (kind === "like") {
      await adjustVideoAppLikeCount(db, videoId, -1, now);
    }
    revalidatePath(`/${target.youtube_video_id ?? videoId}`);
    return { ok: true, active: false, videoId };
  }

  if (existing) {
    revalidatePath(`/${target.youtube_video_id ?? videoId}`);
    return { ok: true, active: true, videoId };
  }

  try {
    await db.insert(videoInteractions).values({
      id: generateId("vi"),
      x_user_id: activeX,
      video_id: videoId,
      interaction_type: kind,
      source: "app",
      created_at: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE constraint failed/i.test(message)) {
      return { ok: true, active: true, videoId };
    }
    return { ok: false, message: "操作に失敗しました。時間をおいて再試行してください。" };
  }
  if (kind === "like") {
    await adjustVideoAppLikeCount(db, videoId, 1, now);
  }
  revalidatePath(`/${target.youtube_video_id ?? videoId}`);
  return { ok: true, active: true, videoId };
}

export async function toggleVideoInteraction(
  formData: FormData,
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
  const kind = String(formData.get("kind") ?? "");
  if (!videoId) return { ok: false, message: "対象が指定されていません。" };
  if (kind !== "like" && kind !== "bookmark") {
    return { ok: false, message: "不正な操作種別です。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const existing = (
    await db
      .select({ id: videoInteractions.id })
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

  return mutateVideoInteraction(formData, !existing);
}

/** 明示的に on/off を指定する。formData の `active` に "true" / "false" を渡す。 */
export async function setVideoInteraction(
  formData: FormData,
): Promise<VideoActionResult & { active?: boolean }> {
  const raw = String(formData.get("active") ?? "");
  if (raw !== "true" && raw !== "false") {
    return { ok: false, message: "active の指定が不正です。" };
  }
  return mutateVideoInteraction(formData, raw === "true");
}
