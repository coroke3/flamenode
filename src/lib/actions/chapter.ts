"use server";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { expectedRowCondition } from "@/lib/audit/expectedRowCondition";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDatabase } from "@/lib/cloudflare";
import { canEditVideo } from "@/lib/auth/ownership";

import { writeGuard } from "@/lib/auth/writeGuard";
import { videoChapters, videos } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { parseChapterTime } from "@/lib/utils/chapterTime";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { markPendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";
import type { PendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";
import { MAX_ATOMIC_CHAPTER_BULK_ROWS, parseChapterBulkCsv } from "./chapterLimits";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";

export interface ChapterActionResult extends PendingPublicReflection {
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
});

/**
 * チャプター (動画マーカー) を作成する。
 * 主体 = `user.active_x_user_id` で `approval_status === 'approved'` を要求。
 * 対象動画は FlameNode 内 public のみ投稿可。
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
  // FlameNode 内 public のみ投稿可。
  // (YouTube 側 unlisted で FlameNode 内 public のケースも status === 'public' で吸収される)。
  if (target.visibility_status !== "public") {
    return {
      ok: false,
      message: "この動画にはチャプターコメントを投稿できません。",
    };
  }

  const id = generateId("ch");
  const now = Math.floor(Date.now() / 1000);
  const after = {
    id,
    video_id: data.video_id,
    x_user_id: activeX,
    chapter_time: data.chapter_time,
    chapter_label: data.chapter_label,
    note: data.note ?? null,
    visibility: data.visibility,
    created_at: now,
    updated_at: now,
  };
  const mutationStatements: BatchItem<"sqlite">[] = [db.run(sql`
    INSERT INTO video_chapters (
      id, video_id, x_user_id, chapter_time, chapter_label, note,
      visibility, created_at, updated_at
    ) VALUES (
      ${after.id}, ${after.video_id}, ${after.x_user_id}, ${after.chapter_time},
      ${after.chapter_label}, ${after.note}, ${after.visibility},
      ${after.created_at}, ${after.updated_at}
    )
  `)];
  const expectedMutationChanges = [1];
  const queue = await buildStaticRebuildQueueBatch(db, [{
    targetType: "video",
    targetId: data.video_id,
    reason: "chapter_create",
    requestedByUserId: sUser.id,
  }]);
  mutationStatements.push(...queue.statements);
  expectedMutationChanges.push(...queue.expectedChanges);

  try {
    await mutateWithAudit(db, {
      mutationStatements,
      expectedMutationChanges,
      audits: [{ table_name: "video_chapters", target_id: id, operation: "CREATE", before: null, after: { ...after }, actor_user_id: sUser.id, retention_class: "normal" }],
      staticRebuildWakeSource: queue.statements.length > 0 ? "web" : undefined,
    });
  } catch (error) {
    return chapterMutationError(error);
  }

  await revalidateChapterPath(target.youtube_video_id, data.video_id);
  return markPendingPublicReflection({ ok: true, chapterId: id }, queue.statements.length > 0);
}
const updateSchema = createSchema.extend({
  chapter_id: z.string().trim().min(1),
});

const deleteSchema = z.object({
  chapter_id: z.string().trim().min(1),
});

function chapterMutationError(error: unknown): ChapterActionResult {
  unstable_rethrow(error);
  console.warn(
    "[chapter] atomic mutation failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return {
    ok: false,
    message: "チャプターの保存に失敗しました。画面を更新してもう一度お試しください。",
  };
}

async function revalidateChapterPath(
  youtubeVideoId: string | null,
  videoId: string,
): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "chapter.write", traceId: createTraceId() },
    [{
      name: "revalidate",
      run: async () => {
        revalidatePath(`/${youtubeVideoId ?? videoId}`);
      },
    }],
  );
}

async function canManageChapter(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  user: { id: string; role: string | null },
  activeXId: string,
  chapter: typeof videoChapters.$inferSelect,
  video: typeof videos.$inferSelect,
): Promise<boolean> {
  if (chapter.x_user_id === activeXId || user.role === "admin") return true;
  return canEditVideo({
    db,
    user,
    video,
    requiredKey: "video.chapter_admin",
    privilegeMode: "event",
  });
}

/** 自分のチャプター、または動画管理権限があるチャプターを更新する。 */
export async function updateChapter(
  formData: FormData,
): Promise<ChapterActionResult> {
  const guard = await writeGuard({
    requireApprovedActiveXId: true,
    feature: "chapter_comment",
  });
  if (!guard.ok) return { ok: false, message: guard.message };
  const activeX = guard.activeXId;
  if (!activeX) return { ok: false, message: "X ID を選択してから操作してください。" };

  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const existing = (
    await db.select().from(videoChapters).where(eq(videoChapters.id, parsed.data.chapter_id)).limit(1)
  )[0];
  if (!existing) return { ok: false, message: "チャプターが見つかりません。" };
  const target = (
    await db.select().from(videos).where(eq(videos.id, existing.video_id)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "動画が見つかりません。" };
  if (!(await canManageChapter(
    db,
    { id: guard.user.id, role: guard.user.role ?? null },
    activeX,
    existing,
    target,
  ))) {
    return { ok: false, message: "このチャプターを更新する権限がありません。" };
  }

  const now = Math.floor(Date.now() / 1000);
  const after = {
    ...existing,
    chapter_time: parsed.data.chapter_time,
    chapter_label: parsed.data.chapter_label,
    note: parsed.data.note ?? null,
    visibility: parsed.data.visibility,
    updated_at: now,
  };
  const queue = await buildStaticRebuildQueueBatch(db, [{
    targetType: "video",
    targetId: existing.video_id,
    reason: "chapter_update",
    requestedByUserId: guard.user.id,
  }]);
  try {
    await mutateWithAudit(db, {
      mutationStatements: [
        db.update(videoChapters).set({
          chapter_time: after.chapter_time,
          chapter_label: after.chapter_label,
          note: after.note,
          visibility: after.visibility,
          updated_at: after.updated_at,
        }).where(expectedRowCondition({ expectedCurrent: existing })),
        ...queue.statements,
      ],
      expectedMutationChanges: [1, ...queue.expectedChanges],
      audits: [{
        table_name: "video_chapters",
        target_id: existing.id,
        operation: "UPDATE",
        before: { ...existing },
        after: { ...after },
        actor_user_id: guard.user.id,
        retention_class: "normal",
      }],
      staticRebuildWakeSource: queue.statements.length > 0 ? "web" : undefined,
    });
  } catch (error) {
    return chapterMutationError(error);
  }

  await revalidateChapterPath(target.youtube_video_id, target.id);
  return markPendingPublicReflection(
    { ok: true, chapterId: existing.id, message: "チャプターを更新しました。" },
    queue.statements.length > 0,
  );
}

/** 自分のチャプター、または動画管理権限があるチャプターを完全削除する。 */
export async function deleteChapter(
  formData: FormData,
): Promise<ChapterActionResult> {
  const guard = await writeGuard({
    requireApprovedActiveXId: true,
    feature: "chapter_comment",
  });
  if (!guard.ok) return { ok: false, message: guard.message };
  const activeX = guard.activeXId;
  if (!activeX) return { ok: false, message: "X ID を選択してから操作してください。" };

  const parsed = deleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const existing = (
    await db.select().from(videoChapters).where(eq(videoChapters.id, parsed.data.chapter_id)).limit(1)
  )[0];
  if (!existing) {
    return { ok: true, chapterId: parsed.data.chapter_id, message: "既に削除されています。" };
  }
  const target = (
    await db.select().from(videos).where(eq(videos.id, existing.video_id)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "動画が見つかりません。" };
  if (!(await canManageChapter(
    db,
    { id: guard.user.id, role: guard.user.role ?? null },
    activeX,
    existing,
    target,
  ))) {
    return { ok: false, message: "このチャプターを削除する権限がありません。" };
  }

  const queue = await buildStaticRebuildQueueBatch(db, [{
    targetType: "video",
    targetId: existing.video_id,
    reason: "chapter_delete",
    requestedByUserId: guard.user.id,
  }]);
  try {
    await mutateWithAudit(db, {
      mutationStatements: [
        db.delete(videoChapters).where(expectedRowCondition({ expectedCurrent: existing })),
        ...queue.statements,
      ],
      expectedMutationChanges: [1, ...queue.expectedChanges],
      audits: [{
        table_name: "video_chapters",
        target_id: existing.id,
        operation: "DELETE",
        before: { ...existing },
        after: null,
        actor_user_id: guard.user.id,
        retention_class: "normal",
      }],
      staticRebuildWakeSource: queue.statements.length > 0 ? "web" : undefined,
    });
  } catch (error) {
    return chapterMutationError(error);
  }

  await revalidateChapterPath(target.youtube_video_id, target.id);
  return markPendingPublicReflection(
    { ok: true, chapterId: existing.id, message: "チャプターを削除しました。" },
    queue.statements.length > 0,
  );
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
      privilegeMode: "event",
    })) ||
    (await canEditVideo({
      db,
      user: { id: sUser.id, role: sUser.role ?? null },
      video: target,
      requiredKey: "video.member_chapters",
      privilegeMode: "normal",
    }));
  if (!canMod) {
    return { ok: false, message: "この動画のチャプター一括登録権限がありません。" };
  }
  if (target.visibility_status !== "public") {
    return {
      ok: false,
      message: "この動画にはチャプターコメントを投稿できません。",
    };
  }

  // createChaptersBulk は通常チャプターコメント専用なので、メンバー解決マップは不要。
  // メンバーチャプターは VideoMembersField + replaceVideoMembers 経路で別途扱う。

  const rowsRaw = parseChapterBulkCsv(csv);
  if (rowsRaw.length === 0) {
    return { ok: false, message: "CSV にデータがありません。" };
  }
  if (rowsRaw.length > MAX_ATOMIC_CHAPTER_BULK_ROWS) {
    return {
      ok: false,
      message: `CSVは一度に最大${MAX_ATOMIC_CHAPTER_BULK_ROWS}行まで登録できます。`,
      inserted: 0,
      skipped: rowsRaw.length,
      errors: [`データ行を${MAX_ATOMIC_CHAPTER_BULK_ROWS}行以内に分割してください。`],
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const errors: string[] = [];
  let inserted = 0;
  let skipped = 0;
  let enqueuedPublicReflection = false;
  const pendingRows: Array<{
    id: string;
    chapter_time: number;
    chapter_label: string;
    note: string | null;
    visibility: "public" | "private";
  }> = [];

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
    pendingRows.push({ id, chapter_time: time, chapter_label: rawLabel, note: rawNote || null, visibility });
    inserted += 1;
  }

  if (inserted > 0) {
    const queue = await buildStaticRebuildQueueBatch(db, [{
      targetType: "video",
      targetId: video_id,
      reason: "chapter_bulk_create",
      requestedByUserId: sUser.id,
    }]);
    enqueuedPublicReflection = queue.statements.length > 0;
    try {
      await mutateWithAudit(db, {
        mutationStatements: [db.run(sql`
        INSERT INTO video_chapters (
          id, video_id, x_user_id, chapter_time, chapter_label, note,
          visibility, created_at, updated_at
        ) VALUES ${sql.join(pendingRows.map((row) => sql`(${row.id}, ${video_id}, ${activeX}, ${row.chapter_time}, ${row.chapter_label}, ${row.note}, ${row.visibility}, ${now}, ${now})`), sql`, `)}
      `), ...queue.statements],
        expectedMutationChanges: [inserted, ...queue.expectedChanges],
        audits: pendingRows.map((row) => ({
          table_name: "video_chapters" as const,
          target_id: row.id,
          operation: "CREATE" as const,
          before: null,
          after: { id: row.id, video_id, x_user_id: activeX, chapter_time: row.chapter_time, chapter_label: row.chapter_label, note: row.note, visibility: row.visibility, created_at: now, updated_at: now },
          actor_user_id: sUser.id,
          retention_class: "normal" as const,
        })),
        staticRebuildWakeSource: queue.statements.length > 0 ? "web" : undefined,
      });
    } catch (error) {
      return chapterMutationError(error);
    }
  }

  if (inserted > 0) {
    await revalidateChapterPath(target.youtube_video_id, video_id);
  }
  return markPendingPublicReflection(
    {
      ok: inserted > 0,
      message:
        inserted > 0
          ? `${inserted} 件追加 / ${skipped} 件スキップ`
          : "登録できる行がありませんでした。",
      inserted,
      skipped,
      errors,
    },
    inserted > 0 && enqueuedPublicReflection,
  );
}

/**
 * "1:30" / "0:01:30" / "90" などのチャプター時刻文字列を秒数に変換する。
 * 不正なら null。負数や 24h 超は拒否する。
 */
// parseChapterTime は src/lib/utils/chapterTime.ts に共通化済み。
