"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { videos, slots, historyLogs } from "@/lib/db/schema";
import { extractYoutubeId } from "@/lib/youtube/id";
import { generateId } from "@/lib/utils/id";

const videoFormSchema = z.object({
  title: z.string().trim().min(1).max(120),
  youtube_url: z.string().trim().url(),
  music: z.string().trim().max(200).optional().nullable(),
  credit: z.string().trim().max(200).optional().nullable(),
  intro_comment: z.string().trim().max(500).optional().nullable(),
  highlights: z.string().trim().max(1000).optional().nullable(),
  production_story: z.string().trim().max(1000).optional().nullable(),
  used_software: z.string().trim().max(200).optional().nullable(),
  closing_comment: z.string().trim().max(500).optional().nullable(),
  is_collab: z
    .union([z.literal("on"), z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on" || v === "true"),
});

export interface VideoActionResult {
  ok: boolean;
  message?: string;
  videoId?: string;
}

/**
 * 自由投稿: イベントに紐づかない作品を新規登録する。
 * 設計の post/page.md および post/slotted/page.md に基づく簡易版。
 */
export async function createFreeVideo(
  formData: FormData,
): Promise<VideoActionResult> {
  const session = await auth().catch(() => null);
  if (!session?.user) return { ok: false, message: "認証が必要です。" };
  const sessionUser = session.user as {
    id?: string;
    name?: string | null;
    image?: string | null;
    active_x_user_id?: string | null;
  };
  const userId = sessionUser.id;
  if (!userId) return { ok: false, message: "ユーザー ID を取得できません。" };

  const parsed = videoFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const youtubeId = extractYoutubeId(parsed.data.youtube_url);
  if (!youtubeId) {
    return { ok: false, message: "YouTube URL が解析できません。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const id = generateId("v");
  const now = Math.floor(Date.now() / 1000);
  const activeX = sessionUser.active_x_user_id ?? "";

  await db.insert(videos).values({
    id,
    owner_discord_user_id: userId,
    creator_id: activeX || null,
    submission_type: parsed.data.is_collab ? "collab" : "individual",
    display_name: sessionUser.name ?? "anonymous",
    contact_x_id: activeX || "anonymous",
    title: parsed.data.title,
    youtube_video_id: youtubeId,
    icon_url: sessionUser.image ?? null,
    status: "public",
    music: parsed.data.music ?? null,
    credit: parsed.data.credit ?? null,
    intro_comment: parsed.data.intro_comment ?? null,
    highlights: parsed.data.highlights ?? null,
    production_story: parsed.data.production_story ?? null,
    used_software: parsed.data.used_software ?? null,
    closing_comment: parsed.data.closing_comment ?? null,
    is_deleted: 0,
    is_manual_hidden: 0,
    like_count: 0,
    youtube_view_count: 0,
    video_score: 0,
    scheduling_type: "manual",
    scheduled_time: now,
    created_at: now,
    updated_at: now,
  });

  await db.insert(historyLogs).values({
    table_name: "videos",
    record_id: id,
    action: "CREATE",
    after_data: JSON.stringify({ title: parsed.data.title, youtube_video_id: youtubeId }),
    operator_discord_id: userId,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath("/");
  revalidatePath("/list");
  revalidatePath("/dashboard");
  return { ok: true, videoId: id };
}

/**
 * スロット提出: スロットを `submitted` に更新し、紐づく動画を登録 / 更新する。
 */
export async function submitSlotVideo(
  formData: FormData,
): Promise<VideoActionResult> {
  const session = await auth().catch(() => null);
  if (!session?.user) return { ok: false, message: "認証が必要です。" };
  const sessionUser = session.user as {
    id?: string;
    name?: string | null;
    image?: string | null;
    active_x_user_id?: string | null;
  };
  const userId = sessionUser.id;
  if (!userId) return { ok: false, message: "ユーザー ID を取得できません。" };

  const slotId = String(formData.get("slot_id") ?? "");
  if (!slotId) return { ok: false, message: "スロット ID がありません。" };

  const parsed = videoFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const youtubeId = extractYoutubeId(parsed.data.youtube_url);
  if (!youtubeId) return { ok: false, message: "YouTube URL が解析できません。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const slotRow = (
    await db
      .select()
      .from(slots)
      .where(and(eq(slots.id, slotId), eq(slots.discord_user_id, userId))!)
      .limit(1)
  )[0];
  if (!slotRow) return { ok: false, message: "スロットが見つかりません。" };

  const now = Math.floor(Date.now() / 1000);
  const videoId = slotRow.video_id ?? generateId("v");
  const exists = !!slotRow.video_id;
  const activeX = sessionUser.active_x_user_id ?? slotRow.x_user_id ?? "";

  if (exists) {
    await db
      .update(videos)
      .set({
        title: parsed.data.title,
        youtube_video_id: youtubeId,
        music: parsed.data.music ?? null,
        credit: parsed.data.credit ?? null,
        intro_comment: parsed.data.intro_comment ?? null,
        highlights: parsed.data.highlights ?? null,
        production_story: parsed.data.production_story ?? null,
        used_software: parsed.data.used_software ?? null,
        closing_comment: parsed.data.closing_comment ?? null,
        submission_type: parsed.data.is_collab ? "collab" : "individual",
        updated_at: now,
      })
      .where(eq(videos.id, videoId));
  } else {
    await db.insert(videos).values({
      id: videoId,
      owner_discord_user_id: userId,
      creator_id: activeX || null,
      submission_type: parsed.data.is_collab ? "collab" : "individual",
      display_name: slotRow.display_name ?? sessionUser.name ?? "anonymous",
      contact_x_id: activeX || "anonymous",
      title: parsed.data.title,
      youtube_video_id: youtubeId,
      icon_url: sessionUser.image ?? null,
      status: "pending",
      primary_event_id: slotRow.event_id,
      scheduling_type: "slotted",
      scheduled_time: slotRow.start_time ?? now,
      music: parsed.data.music ?? null,
      credit: parsed.data.credit ?? null,
      intro_comment: parsed.data.intro_comment ?? null,
      highlights: parsed.data.highlights ?? null,
      production_story: parsed.data.production_story ?? null,
      used_software: parsed.data.used_software ?? null,
      closing_comment: parsed.data.closing_comment ?? null,
      is_deleted: 0,
      is_manual_hidden: 0,
      like_count: 0,
      youtube_view_count: 0,
      video_score: 0,
      created_at: now,
      updated_at: now,
    });
  }

  await db
    .update(slots)
    .set({ status: "submitted", video_id: videoId, updated_at: now })
    .where(eq(slots.id, slotRow.id));

  await db.insert(historyLogs).values({
    table_name: "slots",
    record_id: slotRow.id,
    action: "UPDATE",
    after_data: JSON.stringify({ status: "submitted", video_id: videoId }),
    operator_discord_id: userId,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath("/");
  revalidatePath(`/event/${slotRow.event_id}`);
  revalidatePath("/dashboard");
  return { ok: true, videoId };
}
