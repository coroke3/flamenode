import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  eventCollaboratorPermissions,
  eventEditors,
  videoEvents,
  xUsers,
  type videos,
} from "@/lib/db/schema";
import type {
  CollaboratorPermissionKey,
  VideoEditSectionKey,
} from "./videoEditSections";

/**
 * オーナーシップ判定ヘルパー。
 *
 * 設計の RBAC (§2-21) を実装する:
 * - admin: すべて操作可
 * - video の creator_id が「自分の承認済み X ID」: 編集可
 * - event_editors に登録済み: 担当イベントの作品を編集可
 * - event_collaborator_permissions: permission_key に応じた細粒度許可
 */

export type SessionUserLike = {
  id: string;
  role?: string | null;
  active_x_user_id?: string | null;
};

export type VideoRow = typeof videos.$inferSelect;

/** 自分の承認済 X ID 一覧 (active_x_user_id とは独立に全部返す)。 */
export async function getApprovedXIds(
  db: DB,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: xUsers.id })
    .from(xUsers)
    .where(
      and(
        eq(xUsers.linked_discord_user_id, userId),
        eq(xUsers.approval_status, "approved"),
      )!,
    );
  return rows.map((r) => r.id);
}

/** 自分が編集者として担当しているイベント ID 一覧。 */
export async function getEditableEventIds(
  db: DB,
  userId: string,
): Promise<string[]> {
  const xIds = await getApprovedXIds(db, userId);
  if (xIds.length === 0) return [];
  const rows = await db
    .select({ event_id: eventEditors.event_id })
    .from(eventEditors)
    .where(inArray(eventEditors.x_user_id, xIds));
  return Array.from(new Set(rows.map((r) => r.event_id)));
}

/**
 * 当該イベントで自分が持つ permission_key 一覧。
 * x_user_id 連携 / discord_user_id 連携の両方を見る。
 */
export async function getCollaboratorPermissions(
  db: DB,
  userId: string,
  eventId: string,
): Promise<Set<string>> {
  const xIds = await getApprovedXIds(db, userId);
  const subjectCond =
    xIds.length > 0
      ? or(
          eq(eventCollaboratorPermissions.discord_user_id, userId),
          inArray(eventCollaboratorPermissions.x_user_id, xIds),
        )!
      : eq(eventCollaboratorPermissions.discord_user_id, userId);
  const rows = await db
    .select({ permission_key: eventCollaboratorPermissions.permission_key })
    .from(eventCollaboratorPermissions)
    .where(
      and(
        eq(eventCollaboratorPermissions.event_id, eventId),
        eq(eventCollaboratorPermissions.allowed, 1),
        subjectCond,
      )!,
    );
  return new Set(rows.map((r) => r.permission_key));
}

/**
 * イベント編集権限の判定。
 * - admin → true
 * - 当該イベントの event_editors → true
 * - 当該イベントの collaborator で permission_key が一致
 *
 * `requiredKey` は必須。省略可にすると「permission を1個でも持つ collaborator」が
 * 別領域 (例: event.members) を持っているだけで他領域 (例: event.slots) を触れる
 * 抜け穴になるため。consistency audit 4-3 参照。
 *
 * VideoEditSectionKey も受ける: canEditVideo が下層で canEditEvent を呼ぶときに
 * `video.basics` 等の section key をそのまま collaborator permission として
 * 照会するため (event_collaborator_permissions.permission_key は text 列で
 * 自由な文字列を入れられる)。
 */
export async function canEditEvent(
  db: DB,
  user: SessionUserLike,
  eventId: string,
  requiredKey: CollaboratorPermissionKey,
): Promise<boolean> {
  if (user.role === "admin") return true;
  const editorIds = await getEditableEventIds(db, user.id);
  if (editorIds.includes(eventId)) return true;
  const keys = await getCollaboratorPermissions(db, user.id, eventId);
  return keys.has(requiredKey);
}

/** assert 版: 権限がなければエラー throw。 */
export async function assertCanEditEvent(
  db: DB,
  user: SessionUserLike,
  eventId: string,
  requiredKey: CollaboratorPermissionKey,
): Promise<void> {
  const ok = await canEditEvent(db, user, eventId, requiredKey);
  if (!ok) {
    throw new Error(`権限が不足しています (${requiredKey})`);
  }
}

/**
 * 動画編集権限の判定。
 *
 * 優先順位:
 * 1. admin → true
 * 2. video.creator_id が「自分の承認済み X ID」 → true
 * 3. video.primary_event_id / video_events で canEditEvent(requiredKey) → true
 *
 * `owner_discord_user_id` 単独は判定対象外 (legacy import 由来の混入を防ぐため。
 * 禁止事項: owner_discord_user_id だけで作品編集を許可しない)。
 *
 * `requiredKey` は必須。section 別の編集権限を明示することで、collaborator が
 * 持っていない section を触れないよう保証する。Batch A 時点では updateVideo は
 * 暫定で `video.basics` を渡す (本格的な section 分割は posting PR 以降)。
 */
export async function canEditVideo(args: {
  db: DB;
  user: SessionUserLike;
  video: Pick<
    VideoRow,
    "creator_id" | "primary_event_id" | "id" | "owner_discord_user_id"
  >;
  requiredKey: VideoEditSectionKey;
}): Promise<boolean> {
  const { db, user, video, requiredKey } = args;
  if (user.role === "admin") return true;

  const approved = await getApprovedXIds(db, user.id);
  if (video.creator_id && approved.includes(video.creator_id)) return true;

  // 動画が属するイベント (primary または video_events 経由) で編集者か?
  const eventIds = new Set<string>();
  if (video.primary_event_id) eventIds.add(video.primary_event_id);
  const evRows = await db
    .select({ event_id: videoEvents.event_id })
    .from(videoEvents)
    .where(eq(videoEvents.video_id, video.id));
  evRows.forEach((r) => eventIds.add(r.event_id));

  if (eventIds.size === 0) return false;
  for (const eId of eventIds) {
    if (await canEditEvent(db, user, eId, requiredKey)) return true;
  }
  return false;
}
