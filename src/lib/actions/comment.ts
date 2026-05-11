"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { canEditVideo } from "@/lib/auth/ownership";
import {
  historyLogs,
  videoComments,
  videos,
  xUsers,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";

export interface CommentActionResult {
  ok: boolean;
  message?: string;
  commentId?: string;
}

const createSchema = z.object({
  video_id: z.string().trim().min(1),
  chapter_id: z.string().trim().optional().nullable(),
  body: z.string().trim().min(1).max(500),
  visibility: z.enum(["public", "private"]).default("public"),
});

/**
 * 時間付きコメントを投稿する。
 * 主体 = active_x_user_id (承認済必須)。chapter_id は任意 (時間軸へ紐付ける場合のみ)。
 */
export async function createComment(
  formData: FormData,
): Promise<CommentActionResult> {
  const session = await auth().catch(() => null);
  const sUser = session?.user as
    | { id?: string; active_x_user_id?: string | null }
    | undefined;
  if (!sUser?.id) return { ok: false, message: "ログインが必要です。" };
  const activeX = sUser.active_x_user_id;
  if (!activeX) {
    return { ok: false, message: "X ID を選択してから操作してください。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const x = (
    await db.select().from(xUsers).where(eq(xUsers.id, activeX)).limit(1)
  )[0];
  if (!x || x.approval_status !== "approved") {
    return {
      ok: false,
      message: "承認済みの X ID でのみコメントを投稿できます。",
    };
  }

  const raw = Object.fromEntries(formData);
  // chapter_id が空文字なら null に変換
  if (typeof raw.chapter_id === "string" && raw.chapter_id.trim() === "") {
    raw.chapter_id = null as never;
  }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const data = parsed.data;

  const target = (
    await db.select().from(videos).where(eq(videos.id, data.video_id)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "動画が見つかりません。" };

  const id = generateId("cm");
  const now = Math.floor(Date.now() / 1000);
  await db.insert(videoComments).values({
    id,
    video_id: data.video_id,
    x_user_id: activeX,
    chapter_id: data.chapter_id ?? null,
    body: data.body,
    visibility: data.visibility,
    created_at: now,
  });

  await db.insert(historyLogs).values({
    table_name: "video_comments",
    record_id: id,
    action: "CREATE",
    after_data: JSON.stringify({
      video_id: data.video_id,
      chapter_id: data.chapter_id ?? null,
      visibility: data.visibility,
    }),
    operator_discord_id: sUser.id,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath(`/${target.youtube_video_id ?? data.video_id}`);
  return { ok: true, commentId: id };
}

export async function deleteComment(
  formData: FormData,
): Promise<CommentActionResult> {
  const session = await auth().catch(() => null);
  const sUser = session?.user as
    | { id?: string; role?: string; active_x_user_id?: string | null }
    | undefined;
  if (!sUser?.id) return { ok: false, message: "ログインが必要です。" };

  const commentId = String(formData.get("comment_id") ?? "").trim();
  if (!commentId) return { ok: false, message: "comment_id が必要です。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const existing = (
    await db
      .select()
      .from(videoComments)
      .where(eq(videoComments.id, commentId))
      .limit(1)
  )[0];
  if (!existing) return { ok: false, message: "コメントが見つかりません。" };

  let canMod = sUser.role === "admin" || existing.x_user_id === sUser.active_x_user_id;
  if (!canMod) {
    const targetVideo = (
      await db.select().from(videos).where(eq(videos.id, existing.video_id)).limit(1)
    )[0];
    if (targetVideo) {
      canMod = await canEditVideo({
        db,
        user: { id: sUser.id, role: sUser.role ?? null },
        video: targetVideo,
      });
    }
  }
  if (!canMod) return { ok: false, message: "削除権限がありません。" };

  const now = Math.floor(Date.now() / 1000);
  await db.delete(videoComments).where(eq(videoComments.id, commentId));

  await db.insert(historyLogs).values({
    table_name: "video_comments",
    record_id: commentId,
    action: "DELETE",
    before_data: JSON.stringify({
      video_id: existing.video_id,
      body_preview: existing.body.slice(0, 80),
    }),
    operator_discord_id: sUser.id,
    retention_class: "normal",
    created_at: now,
  });

  const target = (
    await db.select().from(videos).where(eq(videos.id, existing.video_id)).limit(1)
  )[0];
  revalidatePath(`/${target?.youtube_video_id ?? existing.video_id}`);
  return { ok: true };
}
