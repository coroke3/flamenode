"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { writeGuard } from "@/lib/auth/writeGuard";
import { canEditVideo } from "@/lib/auth/ownership";
import {
  historyLogs,
  videoMembers,
  videos,
  xUsers,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "@/lib/utils/xid";
import { shouldEnqueueUserNotification } from "@/lib/notifications/context";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { buildVideoEditPermissionGrantedNotification } from "@/lib/notifications/templates/video";

/**
 * 作品単位の共同編集者権限を管理する Server Action 群。
 *
 * 旧テーブル `video_collaborators` は廃止済み。
 * 正本は `video_members.can_edit = 1` の行。これにより表示メンバー・チャプター担当・
 * 共同編集者を 1 テーブルで管理する。
 *
 * 仕様:
 *   - 粒度は can_edit ON/OFF のみ。範囲は COLLABORATOR_VIDEO_EDIT_KEYS で制限される。
 *   - 操作者は `video.identity` 権限を持つ必要がある (作者本人 / admin / event
 *     identity 権限保持者)。
 *   - subject は X ID (連携前でも先付与可) または discord_user_id で指定。
 *   - 既存の表示メンバーに subject が含まれていれば、その行に can_edit を立てる。
 *     含まれていなければ非公開メンバー (is_public_member = 0) として新規追加。
 *   - 監査ログは history_logs に retention_class=long_audit で記録。
 *
 * 関数名は旧テーブル時代の名前 (`upsertVideoCollaborator` 等) を一旦維持。
 * UI / import 側を書き換えるタイミングで `*VideoMemberPerm` 系へ改名する想定。
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
  notify: z
    .union([z.literal("1"), z.literal("0")])
    .optional()
    .transform((v) => v === "1"),
});

async function loadEditableVideo(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  user: { id: string; role?: string | null },
  videoId: string,
): Promise<
  | {
      id: string;
      title: string;
      primary_event_id: string | null;
      creator_x_user_id: string | null;
      submitted_by_discord_user_id: string | null;
    }
  | null
> {
  const row = (
    await db
      .select({
        id: videos.id,
        title: videos.title,
        primary_event_id: videos.primary_event_id,
        creator_x_user_id: videos.creator_x_user_id,
        submitted_by_discord_user_id: videos.submitted_by_discord_user_id,
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

/** 既存の video_members 行を「同じ subject (x_user_id or discord_user_id)」で検索する。 */
async function findMemberRowForSubject(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  videoId: string,
  xUserId: string | null,
  discordUserId: string | null,
): Promise<typeof videoMembers.$inferSelect | null> {
  if (xUserId) {
    const rows = await db
      .select()
      .from(videoMembers)
      .where(
        and(
          eq(videoMembers.video_id, videoId),
          isNotNull(videoMembers.x_user_id),
          sql`lower(${videoMembers.x_user_id}) = ${xUserId.toLowerCase()}`,
        )!,
      )
      .limit(1);
    if (rows[0]) return rows[0];
  }
  if (discordUserId) {
    const rows = await db
      .select()
      .from(videoMembers)
      .where(
        and(
          eq(videoMembers.video_id, videoId),
          eq(videoMembers.discord_user_id, discordUserId),
        )!,
      )
      .limit(1);
    if (rows[0]) return rows[0];
  }
  return null;
}

async function resolveSubjectDiscordRecipient(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  xUserId: string | null,
  discordUserId: string | null,
): Promise<string | null> {
  if (discordUserId?.trim()) return discordUserId.trim();
  if (!xUserId) return null;
  const xRow = (
    await db
      .select({ linked: xUsers.linked_discord_user_id })
      .from(xUsers)
      .where(eq(xUsers.id, xUserId))
      .limit(1)
  )[0];
  return xRow?.linked?.trim() || null;
}

/**
 * 共同編集者の権限を upsert する。
 *
 * - 既存の video_members 行が同じ subject にあれば、その行の can_edit と
 *   表示名・discord_user_id・edit_* タイムスタンプを更新する。
 * - 無ければ新規 video_members 行を **is_public_member = 0** で追加 (非公開編集者)。
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

  const now = Math.floor(Date.now() / 1000);
  const canEditValue = parsed.data.can_edit ? 1 : 0;
  const shouldNotify = String(formData.get("notify") ?? "1") !== "0";
  const existing = await findMemberRowForSubject(
    db,
    video.id,
    xUserId,
    discordUserId,
  );

  // X ID 指定があれば xUsers に pending で先行作成 (UI で「未承認 X ID への先付与」)
  if (xUserId) {
    const xRow = (
      await db.select().from(xUsers).where(eq(xUsers.id, xUserId)).limit(1)
    )[0];
    if (!xRow) {
      await db.insert(xUsers).values({
        id: xUserId,
        x_name: parsed.data.display_name || `@${xUserId}`,
        approval_status: "pending",
        approval_requested_at: now,
      });
    }
  }

  if (existing) {
    await db
      .update(videoMembers)
      .set({
        name: parsed.data.display_name,
        can_edit: canEditValue,
        discord_user_id: discordUserId ?? existing.discord_user_id ?? null,
        edit_granted_by_user_id:
          canEditValue === 1 ? user.id : existing.edit_granted_by_user_id,
        edit_granted_at:
          canEditValue === 1 && existing.edit_granted_at == null
            ? now
            : existing.edit_granted_at,
        edit_updated_at: now,
      })
      .where(eq(videoMembers.id, existing.id));
  } else {
    // 末尾に追加 (order_index は 9999 -> 表示順は後で並べ替え可能)
    await db.insert(videoMembers).values({
      id: generateId("vm"),
      video_id: video.id,
      x_user_id: xUserId,
      discord_user_id: discordUserId,
      name: parsed.data.display_name,
      role: null,
      comment: null,
      order_index: 9999,
      can_edit: canEditValue,
      // 「表示しないが編集権限だけ持つ人」を表現する。公開メンバー欄には出さない。
      is_public_member: 0,
      edit_granted_by_user_id: canEditValue === 1 ? user.id : null,
      edit_granted_at: canEditValue === 1 ? now : null,
      edit_updated_at: now,
    });
  }

  await db.insert(historyLogs).values({
    table_name: "video_members",
    record_id: existing?.id ?? video.id,
    action: existing ? "UPDATE" : "CREATE",
    before_data: existing
      ? JSON.stringify({
          can_edit: existing.can_edit,
          name: existing.name,
          is_public_member: existing.is_public_member,
        })
      : null,
    after_data: JSON.stringify({
      subject: xUserId ? `x:${xUserId}` : `discord:${discordUserId}`,
      display_name: parsed.data.display_name,
      can_edit: canEditValue,
      is_public_member: existing?.is_public_member ?? 0,
    }),
    operator_discord_id: user.id,
    retention_class: "long_audit",
    created_at: now,
  });

  const wasCanEdit = existing?.can_edit === 1;
  const isNewGrant = canEditValue === 1 && !wasCanEdit;
  if (
    isNewGrant &&
    shouldNotify &&
    shouldEnqueueUserNotification()
  ) {
    const savedMember = (
      await findMemberRowForSubject(db, video.id, xUserId, discordUserId)
    );
    const subjectDiscord =
      savedMember?.discord_user_id?.trim() ||
      (await resolveSubjectDiscordRecipient(
        db,
        savedMember?.x_user_id ?? xUserId,
        discordUserId,
      ));
    const subjectX = savedMember?.x_user_id ?? xUserId;
    const dedupeSubject = subjectX
      ? `x:${subjectX}`
      : subjectDiscord
        ? `discord:${subjectDiscord}`
        : null;
    if (subjectDiscord && subjectDiscord !== user.id && dedupeSubject) {
      await enqueueNotification(db, {
        discordUserId: subjectDiscord,
        type: "video_edit_permission_granted",
        dedupeKey: `video_edit_permission_granted:${video.id}:${dedupeSubject}`,
        payload: buildVideoEditPermissionGrantedNotification({
          videoId: video.id,
          videoTitle: video.title,
        }),
        eventId: video.primary_event_id,
      });
    }
  }

  revalidatePath(`/dashboard/edit/${video.id}`);
  return {
    ok: true,
    message: canEditValue
      ? "作品編集への参加を付与しました。"
      : "作品編集への参加を無効化しました。",
  };
}

/**
 * 共同編集者の編集権限を解除する。
 *
 * - 対象が非公開メンバー (is_public_member = 0) の場合は **行ごと削除** する。
 *   非公開メンバーは「権限のためだけにあった行」なので、権限を外したら残す意味がない。
 * - 公開メンバー (is_public_member = 1) の場合は **can_edit = 0 にするだけ** で
 *   行は残す (表示・チャプター担当には引き続き必要なため)。
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

  const existing = await findMemberRowForSubject(
    db,
    video.id,
    xUserId || null,
    discordUserId,
  );
  if (!existing) {
    return { ok: true, message: "該当する権限行はすでにありません。" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (existing.is_public_member === 0) {
    // 非公開メンバー: 行ごと削除
    await db.delete(videoMembers).where(eq(videoMembers.id, existing.id));
  } else {
    // 公開メンバー: 行は残し can_edit のみ落とす
    await db
      .update(videoMembers)
      .set({
        can_edit: 0,
        edit_updated_at: now,
      })
      .where(eq(videoMembers.id, existing.id));
  }

  await db.insert(historyLogs).values({
    table_name: "video_members",
    record_id: existing.id,
    action: existing.is_public_member === 0 ? "DELETE" : "UPDATE",
    before_data: JSON.stringify({
      can_edit: existing.can_edit,
      name: existing.name,
      is_public_member: existing.is_public_member,
    }),
    after_data: JSON.stringify({
      subject: xUserId ? `x:${xUserId}` : `discord:${discordUserId}`,
      action: "revoke_can_edit",
    }),
    operator_discord_id: user.id,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath(`/dashboard/edit/${video.id}`);
  return { ok: true, message: "作品編集への参加を解除しました。" };
}
