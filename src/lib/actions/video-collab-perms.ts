"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { writeGuard } from "@/lib/auth/writeGuard";
import { canEditVideo } from "@/lib/auth/ownership";
import {
  historyLogs,
  videoCollaboratorPermissions,
  videos,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "@/lib/utils/xid";

/**
 * 作品単位の参加者編集権限を管理する Server Action 群。
 *
 * 認可:
 *   - 操作者は writeGuard を通過していること。
 *   - 当該作品に対して `video.identity` の編集権限を持つこと
 *     (= 作者本人 / admin / event 側で identity 編集権限を持つ運営)。
 *     これは「主となるユーザーが参加者に権限を付与する」用途と整合する。
 */

export interface VideoCollabPermResult {
  ok: boolean;
  message?: string;
}

// permission_key は VideoEditSectionKey と整合させる。
// admin 側 / イベント側の包括的なキー (video.identity, videos.*) は
// この作品単位フローでは扱わない (合作メンバー向け 5 プリセットに絞る)。
const ALLOWED_KEYS = [
  "video.basics",
  "video.credits",
  "video.descriptions",
  "video.members",
  "video.youtube_id",
] as const;
type VideoCollabPermKey = (typeof ALLOWED_KEYS)[number];

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
  permission_keys: z.string().trim().max(500),
});

async function loadEditableVideo(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  user: { id: string; role?: string | null },
  videoId: string,
): Promise<{ id: string; primary_event_id: string | null; creator_id: string | null; owner_discord_user_id: string | null } | null> {
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
 * 参加者編集権限を upsert する。
 *
 * `permission_keys` はカンマ区切り (UI 側のチェックボックス選択結果を結合)。
 * 既存の (video_id, subject, permission_key) 行は allowed=1 のまま更新、
 * 未指定だった key は削除して「チェックボックスの最新状態 = DB 行」に揃える。
 *
 * subject は X ID (連携前でも先付与可) または discord_user_id のいずれか。
 * 両方欠ければ何もしない。
 */
export async function upsertVideoCollaboratorPermissions(
  formData: FormData,
): Promise<VideoCollabPermResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, message: guard.message };
  const user = { id: guard.user.id, role: guard.user.role ?? null };

  const parsed = upsertSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const xUserId = parsed.data.x_user_id || null;
  const discordUserId = parsed.data.discord_user_id?.trim() || null;
  if (!xUserId && !discordUserId) {
    return { ok: false, message: "X ID か Discord User ID のいずれかを指定してください。" };
  }

  const keys = parsed.data.permission_keys
    .split(",")
    .map((k) => k.trim())
    .filter((k): k is VideoCollabPermKey =>
      (ALLOWED_KEYS as readonly string[]).includes(k),
    );

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const video = await loadEditableVideo(db, user, parsed.data.video_id);
  if (!video) {
    return { ok: false, message: "対象作品が見つからない、または権限がありません。" };
  }

  // 既存の subject 行を取得 (どちらの ID で照合するかで where が変わる)。
  const subjectWhere = xUserId
    ? and(
        eq(videoCollaboratorPermissions.video_id, video.id),
        eq(videoCollaboratorPermissions.x_user_id, xUserId),
      )!
    : and(
        eq(videoCollaboratorPermissions.video_id, video.id),
        eq(videoCollaboratorPermissions.discord_user_id, discordUserId!),
      )!;
  const existing = await db
    .select()
    .from(videoCollaboratorPermissions)
    .where(subjectWhere);
  const existingByKey = new Map(existing.map((r) => [r.permission_key, r]));

  const now = Math.floor(Date.now() / 1000);

  // チェック ON の key は upsert
  for (const key of keys) {
    const row = existingByKey.get(key);
    if (row) {
      if (
        row.allowed !== 1 ||
        row.display_name !== parsed.data.display_name
      ) {
        await db
          .update(videoCollaboratorPermissions)
          .set({
            allowed: 1,
            display_name: parsed.data.display_name,
            updated_at: now,
          })
          .where(eq(videoCollaboratorPermissions.id, row.id));
      }
    } else {
      await db.insert(videoCollaboratorPermissions).values({
        id: generateId("vcp"),
        video_id: video.id,
        x_user_id: xUserId,
        discord_user_id: discordUserId,
        display_name: parsed.data.display_name,
        permission_key: key,
        allowed: 1,
        granted_by_user_id: user.id,
        created_at: now,
        updated_at: now,
      });
    }
  }

  // チェック OFF にされた key は削除 (allowed: 0 にせず物理削除して履歴は historyLogs に残す)
  const targetSet = new Set<string>(keys);
  for (const row of existing) {
    if (!targetSet.has(row.permission_key)) {
      await db
        .delete(videoCollaboratorPermissions)
        .where(eq(videoCollaboratorPermissions.id, row.id));
    }
  }

  await db.insert(historyLogs).values({
    table_name: "video_collaborator_permissions",
    record_id: video.id,
    action: "UPDATE",
    after_data: JSON.stringify({
      subject: xUserId ? `x:${xUserId}` : `discord:${discordUserId}`,
      display_name: parsed.data.display_name,
      keys,
    }),
    operator_discord_id: user.id,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath(`/dashboard/edit/${video.id}`);
  return { ok: true, message: "参加者の編集権限を更新しました。" };
}

/**
 * 参加者の編集権限をまとめて削除する (subject 単位)。
 * x_user_id か discord_user_id のいずれかで対象 subject を特定する。
 */
export async function deleteVideoCollaboratorPermissions(
  formData: FormData,
): Promise<VideoCollabPermResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, message: guard.message };
  const user = { id: guard.user.id, role: guard.user.role ?? null };

  const videoId = String(formData.get("video_id") ?? "").trim();
  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const discordUserId = String(formData.get("discord_user_id") ?? "").trim() || null;
  if (!videoId) return { ok: false, message: "video_id がありません。" };
  if (!xUserId && !discordUserId) {
    return { ok: false, message: "対象 subject が指定されていません。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const video = await loadEditableVideo(db, user, videoId);
  if (!video) {
    return { ok: false, message: "対象作品が見つからない、または権限がありません。" };
  }

  const subjectWhere = xUserId
    ? and(
        eq(videoCollaboratorPermissions.video_id, video.id),
        eq(videoCollaboratorPermissions.x_user_id, xUserId),
        isNotNull(videoCollaboratorPermissions.x_user_id),
      )!
    : and(
        eq(videoCollaboratorPermissions.video_id, video.id),
        eq(videoCollaboratorPermissions.discord_user_id, discordUserId!),
        isNull(videoCollaboratorPermissions.x_user_id),
      )!;
  await db.delete(videoCollaboratorPermissions).where(subjectWhere);

  const now = Math.floor(Date.now() / 1000);
  await db.insert(historyLogs).values({
    table_name: "video_collaborator_permissions",
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
