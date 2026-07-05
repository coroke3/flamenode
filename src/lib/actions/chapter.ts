"use server";
import { auditAction } from "@/lib/audit/helpers";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { canEditVideo } from "@/lib/auth/ownership";
import { writeGuard } from "@/lib/auth/writeGuard";
import { videoChapters, videos } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { parseCsv } from "@/lib/utils/csv";
import { parseChapterTime } from "@/lib/utils/chapterTime";
import { enqueueNotification } from "@/lib/notifications/enqueue";

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
  // 旧仕様の video_member_id は chapter.ts では扱わない (メンバーチャプターは
  // video_members.chapters_json + replaceVideoMembers 経路で管理)。
  visibility: z.enum(["public", "private"]).default("public"),
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
  if (target.visibility_status !== "public" && target.visibility_status !== "limited") {
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
    show_on_player_bar: data.show_on_player_bar,
    created_at: now,
    updated_at: now,
  });

  await auditAction(db, {
    table_name: "video_chapters",
    record_id: id,
    action: "CREATE",
    after_data: JSON.stringify({
      video_id: data.video_id,
      chapter_time: data.chapter_time,
      label: data.chapter_label,
      visibility: data.visibility,
    }),
    operator_discord_id: sUser.id,
    retention_class: "normal",
  });

  // 通知: 動画オーナーに新しい public チャプターコメントが付いたことを伝える。
  // 投稿者本人 (Active X の Discord 紐付け) なら通知しない。
  // (private チャプターはオーナーには不要 - 投稿者本人にしか見えないため)
  if (
    data.visibility === "public" &&
    target.submitted_by_discord_user_id &&
    target.submitted_by_discord_user_id !== sUser.id
  ) {
    await enqueueNotification(db, {
      discordUserId: target.submitted_by_discord_user_id,
      type: "chapter_comment_added",
      payload: {
        content: `作品「${target.title}」に新しいチャプターコメント「${data.chapter_label}」が追加されました。`,
        video_id: data.video_id,
        chapter_id: id,
        chapter_time: data.chapter_time,
        author_x_user_id: activeX,
      },
      eventId: target.primary_event_id ?? null,
    });
  }

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

  // updateChapter は通常チャプターコメント専用。video_member_id は触らない。
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(videoChapters)
    .set({
      chapter_time: data.chapter_time,
      chapter_label: data.chapter_label,
      note: data.note ?? null,
      visibility: data.visibility,
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

  await auditAction(db, {
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
  });

  const target = (
    await db.select().from(videos).where(eq(videos.id, existing.video_id)).limit(1)
  )[0];
  revalidatePath(`/${target?.youtube_video_id ?? existing.video_id}`);
  return { ok: true };
}

/**
 * CSV からチャプターを一括投稿する。
 *
 * 入力 CSV のフォーマット (ヘッダー任意):
 *   `time,label,note,visibility,member_name_or_xid`
 *   - `time`: `mm:ss` または `hh:mm:ss` または秒数 (例: 90, 1:30, 0:01:30)
 *   - `label`: 必須。1〜120 文字。
 *   - `note`: 任意。0〜1000 文字。
 *   - `visibility`: 任意 (public / private)。省略時は public。
 *   - `member_name_or_xid`: 任意。マッチした video_members.id を video_member_id に紐付け。
 *      "name" カラムが分離している場合に備え、name / x_user_id どちらでも一致探索する。
 *
 * 権限:
 *   - 動画オーナー (canEditVideo, requiredKey = video.chapter_admin) または admin のみ。
 *   - フロントだけの判定にはしない (CLAUDE.md 方針)。
 *   - 主体 X ID は active_x_user_id を使う (writeGuard で approved 必須)。
 */
const bulkSchema = z.object({
  video_id: z.string().trim().min(1),
  csv: z.string().min(1).max(64 * 1024),
});

export interface BulkChapterActionResult extends ChapterActionResult {
  inserted?: number;
  skipped?: number;
  errors?: string[];
}

export async function createChaptersBulk(
  formData: FormData,
): Promise<BulkChapterActionResult> {
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

  const parsed = bulkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const { video_id, csv } = parsed.data;

  const target = (
    await db.select().from(videos).where(eq(videos.id, video_id)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "動画が見つかりません。" };

  // 編集権限: 動画オーナー or admin。バルクは個別投稿よりも強い権限を要求。
  const canMod =
    sUser.role === "admin" ||
    (await canEditVideo({
      db,
      user: { id: sUser.id, role: sUser.role ?? null },
      video: target,
      requiredKey: "video.chapter_admin",
    }));
  if (!canMod) {
    return { ok: false, message: "この動画のチャプター一括登録権限がありません。" };
  }
  if (target.visibility_status !== "public" && target.visibility_status !== "limited") {
    return {
      ok: false,
      message: "この動画にはチャプターコメントを投稿できません。",
    };
  }

  // createChaptersBulk は通常チャプターコメント専用なので、メンバー解決マップは不要。
  // メンバーチャプターは VideoMembersField + replaceVideoMembers 経路で別途扱う。

  let rowsRaw = parseCsv(csv);
  if (rowsRaw.length === 0) {
    return { ok: false, message: "CSV にデータがありません。" };
  }
  // ヘッダー行スキップ (1列目が time/label でなく、name/label/time キーワードを含む場合)
  const firstLower = rowsRaw[0]!.map((c) => c.trim().toLowerCase());
  if (
    firstLower.includes("time") ||
    firstLower.includes("label") ||
    firstLower.includes("visibility")
  ) {
    rowsRaw = rowsRaw.slice(1);
  }

  const now = Math.floor(Date.now() / 1000);
  const errors: string[] = [];
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < rowsRaw.length; i++) {
    const cols = rowsRaw[i]!;
    const rawTime = (cols[0] ?? "").trim();
    const rawLabel = (cols[1] ?? "").trim();
    const rawNote = (cols[2] ?? "").trim();
    const rawVisibility = (cols[3] ?? "").trim().toLowerCase();
    const rawMember = (cols[4] ?? "").trim();

    if (!rawTime && !rawLabel) {
      skipped += 1;
      continue;
    }
    const time = parseChapterTime(rawTime);
    if (time === null) {
      errors.push(`行 ${i + 1}: 時刻の形式が不正です ("${rawTime}")`);
      skipped += 1;
      continue;
    }
    if (rawLabel.length === 0 || rawLabel.length > 120) {
      errors.push(`行 ${i + 1}: ラベルが必須 (1〜120文字)`);
      skipped += 1;
      continue;
    }
    if (rawNote.length > 1000) {
      errors.push(`行 ${i + 1}: コメントが 1000 文字を超えています`);
      skipped += 1;
      continue;
    }
    const visibility: "public" | "private" =
      rawVisibility === "private" ? "private" : "public";
    // 5 列目 (rawMember) は旧仕様で「担当メンバー名/XID」だったが、メンバーチャプター
    // 分離に伴い無視する。互換のため CSV としては受け付けるが、video_chapters には
    // 反映しない。
    void rawMember;

    const id = generateId("ch");
    await db.insert(videoChapters).values({
      id,
      video_id,
      x_user_id: activeX,
      chapter_time: time,
      chapter_label: rawLabel,
      note: rawNote || null,
      visibility,
      show_on_player_bar: 1,
      created_at: now,
      updated_at: now,
    });
    inserted += 1;
  }

  if (inserted > 0) {
    await auditAction(db, {
      table_name: "video_chapters",
      record_id: video_id,
      action: "CREATE",
      after_data: JSON.stringify({
        bulk: true,
        video_id,
        inserted,
        skipped,
      }),
      operator_discord_id: sUser.id,
      retention_class: "normal",
    });
  }

  revalidatePath(`/${target.youtube_video_id ?? video_id}`);
  return {
    ok: inserted > 0,
    message:
      inserted > 0
        ? `${inserted} 件追加 / ${skipped} 件スキップ`
        : "登録できる行がありませんでした。",
    inserted,
    skipped,
    errors,
  };
}

/**
 * "1:30" / "0:01:30" / "90" などのチャプター時刻文字列を秒数に変換する。
 * 不正なら null。負数や 24h 超は拒否する。
 */
// parseChapterTime は src/lib/utils/chapterTime.ts に共通化済み。
