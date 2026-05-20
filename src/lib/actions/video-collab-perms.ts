"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { writeGuard } from "@/lib/auth/writeGuard";
import { canEditVideo } from "@/lib/auth/ownership";
import {
  historyLogs,
  videoCollaborators,
  videos,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "@/lib/utils/xid";

/**
 * 作品単位の合作メンバー編集権限 (`video_collaborators`) を管理する Server Action 群。
 *
 * 仕様:
 *   - 粒度は can_edit ON/OFF のみ。section 別判定は持たない。
 *   - 操作者は `video.identity` 権限を持つ必要がある (作者本人 / admin /
 *     イベント運営の identity 権限保持者)。
 *   - subject は X ID (連携前でも先付与可) または discord_user_id のいずれかで指定。
 */

export interface VideoCollabResult {
  ok: boolean;
  message?: string;
}

const upsertSchema = z.object({
  video_id: z.string().trim().min(1).max(64),
  x_user_id: z
    .string()
    .trim()
    .max(32)
    .optional()
    .transform((s) => normalizeXId(s ?? "")),
  discord_user_id: z.string().trim().max(64).optional().nullable(),
  display_name: z.string().trim().min(1).max(80),
  can_edit: z
    .union([z.literal("1"), z.literal("0"), z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "1" || v === "true" || v === undefined),
});

async function loadEditableVideo(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  user: { id: string; role?: string | null },
  videoId: string,
): Promise<
  | {
      id: string;
      primary_event_id: string | null;
      creator_id: string | null;
      owner_discord_user_id: string | null;
    }
  | null
> {
  const row = (
    await db
      .select({
        id: videos.id,
        primary_event_id: videos.primary_event_id,
        creator_id: videos.creator_id,
        owner_discord_user_id: videos.owner_discord_user_id,
      })
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1)
  )[0];
  if (!row) return null;
  const ok = await canEditVideo({
    db,
    user,
    video: row,
    requiredKey: "video.identity",
  });
  if (!ok) return null;
  return row;
}

/**
 * 合作メンバーの編集権限を upsert する。
 * 既存行があれば can_edit と display_name を更新、無ければ追加する。
 */
export async function upsertVideoCollaborator(
  formData: FormData,
): Promise<VideoCollabResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, message: guard.message };
  const user = { id: guard.user.id, role: guard.user.role ?? null };

  const parsed = upsertSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const xUserId = parsed.data.x_user_id || null;
  const discordUserId = parsed.data.discord_user_id?.trim() || null;
  if (!xUserId && !discordUserId) {
    return {
      ok: false,
      message: "X ID か Discord User ID のいずれかを指定してください。",
    };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const video = await loadEditableVideo(db, user, parsed.data.video_id);
  if (!video) {
    return {
      ok: false,
      message: "対象作品が見つからない、または権限がありません。",
    };
  }

  const subjectWhere = xUserId
    ? and(
        eq(videoCollaborators.video_id, video.id),
        eq(videoCollaborators.x_user_id, xUserId),
      )!
    : and(
        eq(videoCollaborators.video_id, video.id),
        eq(videoCollaborators.discord_user_id, discordUserId!),
      )!;
  const existing = (
    await db.select().from(videoCollaborators).where(subjectWhere).limit(1)
  )[0];

  const now = Math.floor(Date.now() / 1000);
  const canEditValue = parsed.data.can_edit ? 1 : 0;

  if (existing) {
    await db
      .update(videoCollaborators)
      .set({
        display_name: parsed.data.display_name,
        can_edit: canEditValue,
        updated_at: now,
      })
      .where(eq(videoCollaborators.id, existing.id));
  } else {
    await db.insert(videoCollaborators).values({
      id: generateId("vco"),
      video_id: video.id,
      x_user_id: xUserId,
      discord_user_id: discordUserId,
      display_name: parsed.data.display_name,
      can_edit: canEditValue,
      granted_by_user_id: user.id,
      created_at: now,
      updated_at: now,
    });
  }

  await db.insert(historyLogs).values({
    table_name: "video_collaborators",
    record_id: video.id,
    action: existing ? "UPDATE" : "CREATE",
    after_data: JSON.stringify({
      subject: xUserId ? `x:${xUserId}` : `discord:${discordUserId}`,
      display_name: parsed.data.display_name,
      can_edit: canEditValue,
    }),
    operator_discord_id: user.id,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath(`/dashboard/edit/${video.id}`);
  return {
    ok: true,
    message: canEditValue
      ? "編集権限を付与しました。"
      : "編集権限を無効化しました。",
  };
}

/**
 * 合作メンバーの編集権限行を削除する (subject 単位)。
 */
export async function deleteVideoCollaborator(
  formData: FormData,
): Promise<VideoCollabResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, message: guard.message };
  const user = { id: guard.user.id, role: guard.user.role ?? null };

  const videoId = String(formData.get("video_id") ?? "").trim();
  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const discordUserId =
    String(formData.get("discord_user_id") ?? "").trim() || null;
  if (!videoId) return { ok: false, message: "video_id がありません。" };
  if (!xUserId && !discordUserId) {
    return { ok: false, message: "対象 subject が指定されていません。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const video = await loadEditableVideo(db, user, videoId);
  if (!video) {
    return {
      ok: false,
      message: "対象作品が見つからない、または権限がありません。",
    };
  }

  const subjectWhere = xUserId
    ? and(
        eq(videoCollaborators.video_id, video.id),
        eq(videoCollaborators.x_user_id, xUserId),
        isNotNull(videoCollaborators.x_user_id),
      )!
    : and(
        eq(videoCollaborators.video_id, video.id),
        eq(videoCollaborators.discord_user_id, discordUserId!),
        isNull(videoCollaborators.x_user_id),
      )!;
  await db.delete(videoCollaborators).where(subjectWhere);

  const now = Math.floor(Date.now() / 1000);
  await db.insert(historyLogs).values({
    table_name: "video_collaborators",
    record_id: video.id,
    action: "DELETE",
    after_data: JSON.stringify({
      subject: xUserId ? `x:${xUserId}` : `discord:${discordUserId}`,
    }),
    operator_discord_id: user.id,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath(`/dashboard/edit/${video.id}`);
  return { ok: true, message: "参加者の編集権限を解除しました。" };
}
