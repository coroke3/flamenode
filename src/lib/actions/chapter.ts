"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { canEditVideo } from "@/lib/auth/ownership";
import { writeGuard } from "@/lib/auth/writeGuard";
import { historyLogs, videoChapters, videos } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";

export interface ChapterActionResult {
  ok: boolean;
  message?: string;
  chapterId?: string;
}

const createSchema = z.object({
  video_id: z.string().trim().min(1),
  chapter_time: z.coerce.number().min(0).max(60 * 60 * 24),
  chapter_label: z.string().trim().min(1).max(120),
  note: z.string().trim().max(1000).optional().nullable(),
  visibility: z.enum(["public", "private"]).default("public"),
  marker_kind: z
    .enum(["chapter", "comment", "review", "system"])
    .default("chapter")
    .transform(() => "chapter" as const),
  show_on_player_bar: z.coerce.number().min(0).max(1).default(1),
});

/**
 * チャプター (動画マーカー) を作成する。
 * 主体 = `user.active_x_user_id` で `approval_status === 'approved'` を要求。
 * 対象動画は FlameNode 内 public または unlisted のみ投稿可。
 */
export async function createChapter(
  formData: FormData,
): Promise<ChapterActionResult> {
  const guard = await writeGuard({
    requireApprovedActiveXId: true,
    feature: "chapter_comment",
  });
  if (!guard.ok) return { ok: false, message: guard.message };
  const sUser = guard.user;
  const activeX = guard.activeXId;
  if (!activeX) {
    return { ok: false, message: "X ID を選択してから操作してください。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
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

  // 対象動画状態チェック (Batch A 最小実装)。
  // FlameNode 内 public / unlisted のみ投稿可。
  // (YouTube 側 unlisted で FlameNode 内 public のケースも status === 'public' で吸収される)。
  if (target.status !== "public" && target.status !== "unlisted") {
    return {
      ok: false,
      message: "この動画にはチャプターコメントを投稿できません。",
    };
  }

  const id = generateId("ch");
  const now = Math.floor(Date.now() / 1000);
  await db.insert(videoChapters).values({
    id,
    video_id: data.video_id,
    x_user_id: activeX,
    chapter_time: data.chapter_time,
    chapter_label: data.chapter_label,
    note: data.note ?? null,
    visibility: data.visibility,
    marker_kind: data.marker_kind,
    show_on_player_bar: data.show_on_player_bar,
    created_at: now,
    updated_at: now,
  });

  await db.insert(historyLogs).values({
    table_name: "video_chapters",
    record_id: id,
    action: "CREATE",
    after_data: JSON.stringify({
      video_id: data.video_id,
      chapter_time: data.chapter_time,
      label: data.chapter_label,
      visibility: data.visibility,
      marker_kind: data.marker_kind,
    }),
    operator_discord_id: sUser.id,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath(`/${target.youtube_video_id ?? data.video_id}`);
  return { ok: true, chapterId: id };
}

const updateSchema = createSchema.extend({
  chapter_id: z.string().trim().min(1),
});

export async function updateChapter(
  formData: FormData,
): Promise<ChapterActionResult> {
  // 編集は admin / 動画オーナー / 本人いずれも通る可能性があるため
  // writeGuard では Active X を強制しない。BAN/TOS/CostGuard だけ集約する。
  const guard = await writeGuard({ feature: "chapter_comment" });
  if (!guard.ok) return { ok: false, message: guard.message };
  const sUser = guard.user;
  const approvedXIds = guard.approvedXIds;

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const data = parsed.data;

  const existing = (
    await db
      .select()
      .from(videoChapters)
      .where(eq(videoChapters.id, data.chapter_id))
      .limit(1)
  )[0];
  if (!existing) return { ok: false, message: "チャプターが見つかりません。" };

  // 編集権限: 作成者本人 (Active X 切替後でも approvedXIds 経由で本人判定する) or
  // 動画オーナー (canEditVideo) or admin。
  // approvedXIds.includes(existing.x_user_id) でチェックすることで、
  // 過去に別 X ID で投稿したコメントを Active 切替後にも本人として扱える。
  let canMod =
    sUser.role === "admin" ||
    (existing.x_user_id != null && approvedXIds.includes(existing.x_user_id));
  if (!canMod) {
    const targetVideo = (
      await db.select().from(videos).where(eq(videos.id, existing.video_id)).limit(1)
    )[0];
    if (targetVideo) {
      canMod = await canEditVideo({
        db,
        user: { id: sUser.id, role: sUser.role ?? null },
        video: targetVideo,
        requiredKey: "video.chapter_admin",
      });
    }
  }
  if (!canMod) return { ok: false, message: "編集権限がありません。" };

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(videoChapters)
    .set({
      chapter_time: data.chapter_time,
      chapter_label: data.chapter_label,
      note: data.note ?? null,
      visibility: data.visibility,
      marker_kind: data.marker_kind,
      show_on_player_bar: data.show_on_player_bar,
      updated_at: now,
    })
    .where(eq(videoChapters.id, data.chapter_id));

  const target = (
    await db.select().from(videos).where(eq(videos.id, existing.video_id)).limit(1)
  )[0];
  revalidatePath(`/${target?.youtube_video_id ?? existing.video_id}`);
  return { ok: true, chapterId: data.chapter_id };
}

export async function deleteChapter(
  formData: FormData,
): Promise<ChapterActionResult> {
  const guard = await writeGuard({ feature: "chapter_comment" });
  if (!guard.ok) return { ok: false, message: guard.message };
  const sUser = guard.user;
  const approvedXIds = guard.approvedXIds;

  const chapterId = String(formData.get("chapter_id") ?? "").trim();
  if (!chapterId) return { ok: false, message: "chapter_id が必要です。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const existing = (
    await db
      .select()
      .from(videoChapters)
      .where(eq(videoChapters.id, chapterId))
      .limit(1)
  )[0];
  if (!existing) return { ok: false, message: "チャプターが見つかりません。" };

  // 削除権限: 作成者本人 (Active X 切替後でも approvedXIds 経由で本人判定する) or
  // 動画オーナー (canEditVideo) or admin。
  let canMod =
    sUser.role === "admin" ||
    (existing.x_user_id != null && approvedXIds.includes(existing.x_user_id));
  if (!canMod) {
    const targetVideo = (
      await db.select().from(videos).where(eq(videos.id, existing.video_id)).limit(1)
    )[0];
    if (targetVideo) {
      canMod = await canEditVideo({
        db,
        user: { id: sUser.id, role: sUser.role ?? null },
        video: targetVideo,
        requiredKey: "video.chapter_admin",
      });
    }
  }
  if (!canMod) return { ok: false, message: "削除権限がありません。" };

  const now = Math.floor(Date.now() / 1000);
  await db.delete(videoChapters).where(eq(videoChapters.id, chapterId));

  await db.insert(historyLogs).values({
    table_name: "video_chapters",
    record_id: chapterId,
    action: "DELETE",
    before_data: JSON.stringify({
      video_id: existing.video_id,
      chapter_time: existing.chapter_time,
      label: existing.chapter_label,
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
