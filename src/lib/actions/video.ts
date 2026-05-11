"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import {
  historyLogs,
  slots,
  videos,
  videoInteractions,
  xUsers,
} from "@/lib/db/schema";
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

  // 表示名・アイコンの決定ロジック:
  // 1. アクティブな X ID があれば、x_users.x_name / icon_url を最優先
  // 2. 無ければ Discord のセッション情報をフォールバック
  let displayName = sessionUser.name ?? "anonymous";
  let iconUrl: string | null = sessionUser.image ?? null;
  if (activeX) {
    const xRow = (
      await db.select().from(xUsers).where(eq(xUsers.id, activeX)).limit(1)
    )[0];
    if (xRow) {
      displayName = xRow.x_name || displayName;
      iconUrl = xRow.icon_url ?? iconUrl;
    }
  }

  await db.insert(videos).values({
    id,
    owner_discord_user_id: userId,
    creator_id: activeX || null,
    submission_type: parsed.data.is_collab ? "collab" : "individual",
    display_name: displayName,
    contact_x_id: activeX || "anonymous",
    title: parsed.data.title,
    youtube_video_id: youtubeId,
    icon_url: iconUrl,
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
    let displayName = slotRow.display_name ?? sessionUser.name ?? "anonymous";
    let iconUrl: string | null = sessionUser.image ?? null;
    if (activeX) {
      const xRow = (
        await db.select().from(xUsers).where(eq(xUsers.id, activeX)).limit(1)
      )[0];
      if (xRow) {
        // スロットの display_name が空なら X の表示名で補完
        if (!slotRow.display_name) displayName = xRow.x_name || displayName;
        iconUrl = xRow.icon_url ?? iconUrl;
      }
    }

    await db.insert(videos).values({
      id: videoId,
      owner_discord_user_id: userId,
      creator_id: activeX || null,
      submission_type: parsed.data.is_collab ? "collab" : "individual",
      display_name: displayName,
      contact_x_id: activeX || "anonymous",
      title: parsed.data.title,
      youtube_video_id: youtubeId,
      icon_url: iconUrl,
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

/**
 * 既存作品の編集保存。作者本人または管理者のみ可。
 * VideoForm の `mode = "edit"` 経由で呼ばれる。
 */
export async function updateVideo(
  formData: FormData,
): Promise<VideoActionResult> {
  const session = await auth().catch(() => null);
  const sessionUser = session?.user as
    | { id?: string; role?: string }
    | undefined;
  if (!sessionUser?.id)
    return { ok: false, message: "認証が必要です。" };

  const videoId = String(formData.get("video_id") ?? "").trim();
  if (!videoId) return { ok: false, message: "video_id が空です。" };

  const parsed = videoFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const youtubeId = extractYoutubeId(parsed.data.youtube_url);
  if (!youtubeId) return { ok: false, message: "YouTube URL が解析できません。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const target = (
    await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "対象作品が見つかりません。" };
  if (
    target.owner_discord_user_id !== sessionUser.id &&
    sessionUser.role !== "admin"
  ) {
    return { ok: false, message: "編集権限がありません。" };
  }

  const now = Math.floor(Date.now() / 1000);
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

  await db.insert(historyLogs).values({
    table_name: "videos",
    record_id: videoId,
    action: "UPDATE",
    after_data: JSON.stringify({
      title: parsed.data.title,
      youtube_video_id: youtubeId,
    }),
    operator_discord_id: sessionUser.id,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath("/");
  revalidatePath(`/${target.youtube_video_id ?? videoId}`);
  revalidatePath(`/${youtubeId}`);
  revalidatePath("/dashboard");
  return { ok: true, videoId };
}

/**
 * 作品にいいね or ブックマークを toggle する。
 * 既存の interaction があれば削除、無ければ追加する (TOGGLE 動作)。
 * 主体は `user.active_x_user_id`。未設定なら拒否する。
 */
export async function toggleVideoInteraction(
  formData: FormData,
): Promise<VideoActionResult & { active?: boolean }> {
  const session = await auth().catch(() => null);
  const sessionUser = session?.user as
    | { id?: string; active_x_user_id?: string | null }
    | undefined;
  if (!sessionUser?.id)
    return { ok: false, message: "ログインが必要です。" };
  const activeX = sessionUser.active_x_user_id;
  if (!activeX) {
    return {
      ok: false,
      message: "X ID を選択してから操作してください。",
    };
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

  if (existing) {
    await db
      .delete(videoInteractions)
      .where(eq(videoInteractions.id, existing.id));
    if (kind === "like") {
      await db
        .update(videos)
        .set({
          like_count: Math.max(0, (target.like_count ?? 0) - 1),
          updated_at: now,
        })
        .where(eq(videos.id, videoId));
    }
    revalidatePath(`/${target.youtube_video_id ?? videoId}`);
    return { ok: true, active: false, videoId };
  }

  await db.insert(videoInteractions).values({
    id: generateId("vi"),
    x_user_id: activeX,
    video_id: videoId,
    interaction_type: kind,
    source: "app",
    created_at: now,
  });
  if (kind === "like") {
    await db
      .update(videos)
      .set({
        like_count: (target.like_count ?? 0) + 1,
        updated_at: now,
      })
      .where(eq(videos.id, videoId));
  }
  revalidatePath(`/${target.youtube_video_id ?? videoId}`);
  return { ok: true, active: true, videoId };
}
