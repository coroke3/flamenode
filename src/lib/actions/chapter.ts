"use server";

import { mutateWithAudit } from "@/lib/audit/mutate";
import { expectedRowCondition } from "@/lib/audit/expectedRowCondition";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { canEditVideo } from "@/lib/auth/ownership";
import { writeGuard } from "@/lib/auth/writeGuard";
import type { DB } from "@/lib/db/client";
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

type VideoRow = typeof videos.$inferSelect;

type PostingTargetResult =
  | { ok: true; target: VideoRow; durationSeconds: number }
  | { ok: false; message: string };

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

const deleteSchema = z.object({
  chapter_id: z.string().trim().min(1).max(128),
});

function acceptsChapterComments(video: VideoRow): boolean {
  return (
    video.visibility_status === "public" ||
    video.visibility_status === "limited"
  );
}

async function loadPostingTarget(
  db: DB,
  videoId: string,
): Promise<PostingTargetResult> {
  const target = (
    await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "動画が見つかりません。" };
  if (!acceptsChapterComments(target)) {
    return {
      ok: false,
      message: "この動画にはチャプターコメントを投稿できません。",
    };
  }

  const metadata = (
    await db
      .select({ duration_seconds: videoYoutubeMetadata.duration_seconds })
      .from(videoYoutubeMetadata)
      .where(eq(videoYoutubeMetadata.video_id, videoId))
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

  return { ok: true, target, durationSeconds };
}

async function canModerateChapterVideo(params: {
  db: DB;
  user: { id: string; role: string | null };
  video: VideoRow;
}): Promise<boolean> {
  if (params.user.role === "admin") return true;
  return canEditVideo({
    db: params.db,
    user: params.user,
    video: params.video,
    requiredKey: "video.chapter_admin",
    privilegeMode: "event",
  });
}

/**
 * 動画内の時刻に紐づくチャプターコメントを新正本 video_chapters に作成する。
 * 旧 video_members.chapters_json には書き込まない。
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
  const postingTarget = await loadPostingTarget(db, data.video_id);
  if (!postingTarget.ok) {
    return { ok: false, message: postingTarget.message };
  }
  const { target, durationSeconds } = postingTarget;

  if (data.chapter_time > durationSeconds) {
    return {
      ok: false,
      message: `動画時間（${durationSeconds}秒）を超える位置には投稿できません。`,
    };
  }

  const id = generateId("ch");
  const now = Math.floor(Date.now() / 1000);
  const chapterTime = Math.round(data.chapter_time * 1000) / 1000;
  const after: typeof videoChapters.$inferInsert = {
    id,
    video_id: data.video_id,
    x_user_id: activeX,
    chapter_time: chapterTime,
    chapter_label: data.chapter_label,
    note: data.note || null,
    visibility: data.visibility,
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

  const postingTarget = await loadPostingTarget(guard.db, parsed.data);
  if (!postingTarget.ok) {
    return {
      ok: false,
      durationSeconds: null,
      message: postingTarget.message,
    };
  }
  return { ok: true, durationSeconds: postingTarget.durationSeconds };
}

/**
 * 画面に表示中の単一動画のチャプターについて、削除できるIDだけを返す。
 * 実際の削除時にも deleteChapter で権限を再検証する。
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
  if (rows.length === 0) return { ok: true, deletableIds: [] };

  const videoIds = new Set(rows.map((row) => row.video_id));
  if (videoIds.size !== 1) {
    return {
      ok: false,
      deletableIds: [],
      message: "複数作品のチャプターを同時に判定できません。",
    };
  }

  const deletable = new Set(
    rows
      .filter(
        (row) =>
          row.x_user_id != null && guard.approvedXIds.includes(row.x_user_id),
      )
      .map((row) => row.id),
  );
  if (deletable.size === rows.length) {
    return { ok: true, deletableIds: Array.from(deletable) };
  }

  const videoId = rows[0].video_id;
  const target = (
    await guard.db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  )[0];
  if (
    target &&
    (await canModerateChapterVideo({
      db: guard.db,
      user: { id: guard.user.id, role: guard.user.role ?? null },
      video: target,
    }))
  ) {
    for (const row of rows) deletable.add(row.id);
  }

  return { ok: true, deletableIds: Array.from(deletable) };
}

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

  const isAuthor =
    existing.x_user_id != null &&
    guard.approvedXIds.includes(existing.x_user_id);
  const canModerate =
    !isAuthor &&
    (await canModerateChapterVideo({
      db,
      user: { id: guard.user.id, role: guard.user.role ?? null },
      video: target,
    }));
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

  try {
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
  } catch (error) {
    const current = (
      await db
        .select({ id: videoChapters.id })
        .from(videoChapters)
        .where(eq(videoChapters.id, existing.id))
        .limit(1)
    )[0];
    if (!current) {
      return { ok: true, message: "チャプターコメントはすでに削除されています。" };
    }
    console.error("chapter comment delete failed", {
      chapterId: existing.id,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return { ok: false, message: "削除に失敗しました。もう一度お試しください。" };
  }

  revalidatePath(`/${target.youtube_video_id ?? existing.video_id}`);
  return { ok: true, message: "チャプターコメントを削除しました。" };
}
