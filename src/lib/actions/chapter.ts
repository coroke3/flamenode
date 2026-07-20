"use server";

import { mutateWithAudit } from "@/lib/audit/mutate";
import { expectedRowCondition } from "@/lib/audit/expectedRowCondition";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { canEditVideo } from "@/lib/auth/ownership";
import { writeGuard } from "@/lib/auth/writeGuard";
import { videoChapters, videoYoutubeMetadata, videos } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { buildNotificationOutboxStatement } from "@/lib/notifications/enqueue";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";

export interface ChapterActionResult {
  ok: boolean;
  message?: string;
  chapterId?: string;
}

export interface ChapterDeleteCapabilitiesResult {
  ok: boolean;
  deletableIds: string[];
  message?: string;
}

export interface ChapterPostingContextResult {
  ok: boolean;
  durationSeconds: number | null;
  message?: string;
}

const chapterTimeSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? value : Number(trimmed);
}, z.number().finite().min(0).max(60 * 60 * 24));

const createSchema = z.object({
  video_id: z.string().trim().min(1).max(128),
  chapter_time: chapterTimeSchema,
  chapter_label: z.string().trim().min(1).max(120),
  note: z.string().trim().max(1000).optional().nullable(),
  visibility: z.enum(["public", "private"]).default("public"),
});

/**
 * 動画内の時刻に紐づく通常チャプターコメントを作成する。
 * メンバー担当チャプターは video_members.chapters_json の別経路で管理する。
 */
export async function createChapter(
  formData: FormData,
): Promise<ChapterActionResult> {
  const guard = await writeGuard({
    requireApprovedActiveXId: true,
    feature: "chapter_comment",
  });
  if (!guard.ok) return { ok: false, message: guard.message };

  const activeX = guard.activeXId;
  if (!activeX) {
    return { ok: false, message: "X ID を選択してから操作してください。" };
  }

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const data = parsed.data;
  const db = guard.db;

  const target = (
    await db.select().from(videos).where(eq(videos.id, data.video_id)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "動画が見つかりません。" };

  if (target.visibility_status !== "public" && target.visibility_status !== "limited") {
    return {
      ok: false,
      message: "この動画にはチャプターコメントを投稿できません。",
    };
  }

  const metadata = (
    await db
      .select({ duration_seconds: videoYoutubeMetadata.duration_seconds })
      .from(videoYoutubeMetadata)
      .where(eq(videoYoutubeMetadata.video_id, data.video_id))
      .limit(1)
  )[0];
  const durationSeconds = metadata?.duration_seconds ?? null;
  if (durationSeconds == null || durationSeconds <= 0) {
    return {
      ok: false,
      message:
        "動画時間を確認できないため、チャプターコメントを投稿できません。YouTube情報の同期後に再度お試しください。",
    };
  }
  if (data.chapter_time > durationSeconds) {
    return {
      ok: false,
      message: `動画時間（${durationSeconds}秒）を超える位置には投稿できません。`,
    };
  }

  const id = generateId("ch");
  const now = Math.floor(Date.now() / 1000);
  const chapterTime = Math.round(data.chapter_time * 1000) / 1000;
  const after = {
    id,
    video_id: data.video_id,
    x_user_id: activeX,
    chapter_time: chapterTime,
    chapter_label: data.chapter_label,
    note: data.note || null,
    visibility: data.visibility,
    // 通常コメントはプレイヤーバーへ表示しない。クライアント入力では変更不可。
    show_on_player_bar: 0,
    order_index: 0,
    created_at: now,
    updated_at: now,
  };

  const mutationStatements: BatchItem<"sqlite">[] = [
    db.insert(videoChapters).values(after),
  ];
  const expectedMutationChanges = [1];

  if (
    data.visibility === "public" &&
    target.submitted_by_user_id &&
    target.submitted_by_user_id !== guard.user.id
  ) {
    const notification = await buildNotificationOutboxStatement(db, {
      recipientUserId: target.submitted_by_user_id,
      type: "chapter_comment_added",
      payload: {
        content: `作品「${target.title}」に新しいチャプターコメント「${data.chapter_label}」が追加されました。`,
        video_id: data.video_id,
        chapter_id: id,
        chapter_time: chapterTime,
        author_x_user_id: activeX,
      },
      eventId: target.primary_event_id ?? null,
      dedupeKey: `chapter_comment_added:${id}`,
    });
    if (notification) {
      mutationStatements.push(notification);
      expectedMutationChanges.push(1);
    }
  }

  const queue = await buildStaticRebuildQueueBatch(db, [
    {
      targetType: "video",
      targetId: data.video_id,
      reason: "chapter_create",
      requestedByUserId: guard.user.id,
    },
  ]);
  mutationStatements.push(...queue.statements);
  expectedMutationChanges.push(...queue.expectedChanges);

  await mutateWithAudit(db, {
    mutationStatements,
    expectedMutationChanges,
    audits: [
      {
        table_name: "video_chapters",
        target_id: id,
        operation: "CREATE",
        before: null,
        after: { ...after },
        actor_user_id: guard.user.id,
        retention_class: "normal",
      },
    ],
  });

  revalidatePath(`/${target.youtube_video_id ?? data.video_id}`);
  return { ok: true, chapterId: id };
}

/** 投稿フォームに動画時間と現在の投稿可否を返す。 */
export async function getChapterPostingContext(
  videoId: string,
): Promise<ChapterPostingContextResult> {
  const guard = await writeGuard({
    requireApprovedActiveXId: true,
    feature: "chapter_comment",
  });
  if (!guard.ok) {
    return { ok: false, durationSeconds: null, message: guard.message };
  }

  const parsed = z.string().trim().min(1).max(128).safeParse(videoId);
  if (!parsed.success) {
    return { ok: false, durationSeconds: null, message: "動画IDが不正です。" };
  }

  const target = (
    await guard.db
      .select({
        id: videos.id,
        visibility_status: videos.visibility_status,
      })
      .from(videos)
      .where(eq(videos.id, parsed.data))
      .limit(1)
  )[0];
  if (!target) {
    return { ok: false, durationSeconds: null, message: "動画が見つかりません。" };
  }
  if (target.visibility_status !== "public" && target.visibility_status !== "limited") {
    return {
      ok: false,
      durationSeconds: null,
      message: "この動画にはチャプターコメントを投稿できません。",
    };
  }

  const metadata = (
    await guard.db
      .select({ duration_seconds: videoYoutubeMetadata.duration_seconds })
      .from(videoYoutubeMetadata)
      .where(eq(videoYoutubeMetadata.video_id, parsed.data))
      .limit(1)
  )[0];
  const durationSeconds = metadata?.duration_seconds ?? null;
  if (durationSeconds == null || durationSeconds <= 0) {
    return {
      ok: false,
      durationSeconds: null,
      message:
        "動画時間を確認できないため投稿できません。YouTube情報の同期後に再度お試しください。",
    };
  }

  return { ok: true, durationSeconds };
}

/**
 * 画面に表示中のチャプターについて、現在の利用者が削除できるIDだけを返す。
 * 実際の削除時にも deleteChapter で同じ権限を再検証する。
 */
export async function getChapterDeleteCapabilities(
  chapterIds: string[],
): Promise<ChapterDeleteCapabilitiesResult> {
  const guard = await writeGuard({ feature: "chapter_comment" });
  if (!guard.ok) {
    return { ok: false, deletableIds: [], message: guard.message };
  }

  const parsed = z
    .array(z.string().trim().min(1).max(128))
    .max(200)
    .safeParse(Array.from(new Set(chapterIds)));
  if (!parsed.success) {
    return { ok: false, deletableIds: [], message: "チャプター一覧が不正です。" };
  }
  if (parsed.data.length === 0) return { ok: true, deletableIds: [] };

  const rows = await guard.db
    .select({
      id: videoChapters.id,
      video_id: videoChapters.video_id,
      x_user_id: videoChapters.x_user_id,
    })
    .from(videoChapters)
    .where(inArray(videoChapters.id, parsed.data));

  const deletable = new Set(
    rows
      .filter((row) => guard.approvedXIds.includes(row.x_user_id))
      .map((row) => row.id),
  );

  const remainingVideoIds = Array.from(
    new Set(
      rows
        .filter((row) => !deletable.has(row.id))
        .map((row) => row.video_id),
    ),
  ).slice(0, 10);

  for (const videoId of remainingVideoIds) {
    const target = (
      await guard.db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
    )[0];
    if (!target) continue;

    const canModerate =
      guard.user.role === "admin" ||
      (await canEditVideo({
        db: guard.db,
        user: { id: guard.user.id, role: guard.user.role ?? null },
        video: target,
        requiredKey: "video.chapter_admin",
        privilegeMode: "event",
      }));
    if (!canModerate) continue;

    for (const row of rows) {
      if (row.video_id === videoId) deletable.add(row.id);
    }
  }

  return { ok: true, deletableIds: Array.from(deletable) };
}

const deleteSchema = z.object({
  chapter_id: z.string().trim().min(1).max(128),
});

/**
 * 通常チャプターコメントを video_chapters から物理削除する。
 * 投稿者本人、動画の chapter_admin 権限者、admin のみ実行できる。
 */
export async function deleteChapter(
  formData: FormData,
): Promise<ChapterActionResult> {
  const guard = await writeGuard({ feature: "chapter_comment" });
  if (!guard.ok) return { ok: false, message: guard.message };

  const parsed = deleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: "削除対象のチャプターが不正です。" };
  }

  const db = guard.db;
  const existing = (
    await db
      .select()
      .from(videoChapters)
      .where(eq(videoChapters.id, parsed.data.chapter_id))
      .limit(1)
  )[0];
  if (!existing) {
    return { ok: true, message: "チャプターコメントはすでに削除されています。" };
  }

  const target = (
    await db.select().from(videos).where(eq(videos.id, existing.video_id)).limit(1)
  )[0];
  if (!target) {
    return { ok: false, message: "対象動画が見つかりません。" };
  }

  const isAuthor = guard.approvedXIds.includes(existing.x_user_id);
  const canModerate =
    !isAuthor &&
    (guard.user.role === "admin" ||
      (await canEditVideo({
        db,
        user: { id: guard.user.id, role: guard.user.role ?? null },
        video: target,
        requiredKey: "video.chapter_admin",
        privilegeMode: "event",
      })));

  if (!isAuthor && !canModerate) {
    return {
      ok: false,
      message: "このチャプターコメントを削除する権限がありません。",
    };
  }

  const queue = await buildStaticRebuildQueueBatch(db, [
    {
      targetType: "video",
      targetId: existing.video_id,
      reason: "chapter_delete",
      requestedByUserId: guard.user.id,
    },
  ]);

  await mutateWithAudit(db, {
    mutationStatements: [
      db
        .delete(videoChapters)
        .where(
          and(
            eq(videoChapters.id, existing.id),
            expectedRowCondition({ expectedCurrent: existing }),
          )!,
        ),
      ...queue.statements,
    ],
    expectedMutationChanges: [1, ...queue.expectedChanges],
    audits: [
      {
        table_name: "video_chapters",
        target_id: existing.id,
        operation: "DELETE",
        before: { ...existing },
        after: null,
        actor_user_id: guard.user.id,
        reason: isAuthor ? "投稿者による削除" : "管理権限による削除",
        retention_class: "normal",
      },
    ],
  });

  revalidatePath(`/${target.youtube_video_id ?? existing.video_id}`);
  return { ok: true, message: "チャプターコメントを削除しました。" };
}
