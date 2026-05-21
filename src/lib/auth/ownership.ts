import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { isMissingDbObjectError } from "@/lib/db/optionalObjects";
import {
  eventCollaboratorPermissions,
  eventEditors,
  events as eventsTable,
  videoCollaborators,
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

const VIDEO_PERMISSION_ALIASES: Record<VideoEditSectionKey, readonly string[]> = {
  "video.basics": ["video.basics", "videos.title"],
  "video.identity": ["video.identity", "videos.title"],
  "video.descriptions": ["video.descriptions", "videos.review_data"],
  "video.credits": ["video.credits", "videos.music_credit"],
  "video.members": ["video.members", "videos.members"],
  "video.youtube_id": ["video.youtube_id", "videos.youtube_id"],
  "video.primary_event": ["video.primary_event", "videos.primary_event"],
  "video.status": ["video.status"],
  "video.chapter_admin": ["video.chapter_admin"],
  "videos.title": ["videos.title", "video.basics", "video.identity"],
  "videos.music_credit": ["videos.music_credit", "video.credits"],
  "videos.members": ["videos.members", "video.members"],
  "videos.review_data": ["videos.review_data", "video.descriptions"],
  "videos.youtube_id": ["videos.youtube_id", "video.youtube_id"],
  "videos.primary_event": ["videos.primary_event", "video.primary_event"],
};

/**
 * video_collaborators.can_edit が許可する section の許可リスト (ホワイトリスト方式)。
 *
 * 重要: ここに列挙されていないキーは、合作メンバー編集権限 (can_edit) では絶対に
 * 通らない。特に下記は **永久に絶対許可しない**:
 *   - "video.identity" / "videos.title" / "video.basics" (提出主体・タイトル系)
 *   - "videos.youtube_id" / "video.youtube_id" (YouTube ID 差し替え)
 *   - "videos.primary_event" / "video.primary_event" (所属イベント変更)
 *   - "video.status" / "video.chapter_admin" (公開状態 / チャプター運用)
 *
 * 現在の video_collaborators には粗い can_edit フラグしかないため、
 * 合作コンテンツ系 (説明文・メンバー欄・振り返り) のみホワイトリストで許可する。
 * 将来 video_collaborator_permissions テーブルで section ごとに細分化したい。
 */
const COLLABORATOR_VIDEO_EDIT_KEYS = new Set<VideoEditSectionKey>([
  "video.descriptions",
  "video.members",
  "videos.review_data",
  "videos.members",
  "video.credits",
  "videos.music_credit",
]);

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
 *
 * 旧仕様では「event_editors に登録されていれば requiredKey によらず全許可」だったが、
 * これだと閲覧目的のスタッフ枠が全権を持ってしまう。新仕様では以下の優先順位:
 *
 * 1. admin → true
 * 2. event_collaborator_permissions の permission_key が一致 → true
 * 3. event_editors に representative として登録 → true (代表は全権付与)
 * 4. event_editors に editor として登録 (legacy) → 既存互換のため一旦許可
 *    (将来的に event_collaborator_permissions だけを正本にする)
 *
 * `requiredKey` は必須。省略可にすると「permission を1個でも持つ collaborator」が
 * 別領域 (例: event.members) を持っているだけで他領域 (例: event.slots) を触れる
 * 抜け穴になるため。consistency audit 4-3 参照。
 */
export async function canEditEvent(
  db: DB,
  user: SessionUserLike,
  eventId: string,
  requiredKey: CollaboratorPermissionKey,
): Promise<boolean> {
  if (user.role === "admin") return true;
  // collaborator 権限が明示されていれば最優先で許可。
  const keys = await getCollaboratorPermissions(db, user.id, eventId);
  if (keys.has(requiredKey)) return true;
  // 後方互換: event_editors への登録は legacy データ向けに依然有効。
  // TODO: event_editors を「役職表示用」に縮退させ、permission_key だけを権限正本にする。
  const editorIds = await getEditableEventIds(db, user.id);
  if (editorIds.includes(eventId)) return true;
  return false;
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
 * 動画編集権限の判定モード。
 *
 * - `normal`: 作品オーナー (creator_id ∈ approvedXIds) と
 *   合作メンバー (video_collaborators.can_edit) だけを許可する。
 *   admin / event editor / event collaborator の特権は **一切使わない**。
 *   「管理者が誤って通常編集モードで触ると壊れる」事故を避けるためのモード。
 *   /dashboard/edit/[id] の既定モードはこれ (URL に ?privileged= が無い場合)。
 *
 * - `admin`: admin だけが全権を持つ。event 経由の権限は使わない。
 *
 * - `event`: event editor / event_collaborator_permissions だけが効く。
 *   admin 特権は使わない (役割を切り分けるため)。
 *
 * - `any` (default): 後方互換。admin / event editor / collaborator / owner
 *   いずれかが許可されれば true。明示的にモードを渡さない既存呼び出しはこれを使う。
 *   将来的には呼び出し側で常に明示するのが望ましい。
 *
 * 作品オーナーは privilegeMode に関わらず常に編集可能。
 */
export type CanEditVideoPrivilegeMode = "normal" | "admin" | "event" | "any";

/**
 * 動画編集権限の判定。`privilegeMode` で評価する権限ソースを切り替える。
 *
 * `owner_discord_user_id` 単独は判定対象外 (legacy import 由来の混入を防ぐため。
 * 禁止事項: owner_discord_user_id だけで作品編集を許可しない)。
 *
 * `requiredKey` は必須。section 別の編集権限を明示することで、collaborator が
 * 持っていない section を触れないよう保証する。
 */
export async function canEditVideo(args: {
  db: DB;
  user: SessionUserLike;
  video: Pick<
    VideoRow,
    "creator_id" | "primary_event_id" | "id" | "owner_discord_user_id"
  >;
  requiredKey: VideoEditSectionKey;
  /** 既定 "any"。詳細は CanEditVideoPrivilegeMode を参照。 */
  privilegeMode?: CanEditVideoPrivilegeMode;
}): Promise<boolean> {
  const { db, user, video, requiredKey } = args;
  const privilegeMode: CanEditVideoPrivilegeMode = args.privilegeMode ?? "any";

  // admin role を許容するのは "admin" / "any" のみ。
  if (
    (privilegeMode === "admin" || privilegeMode === "any") &&
    user.role === "admin"
  ) {
    return true;
  }

  const approved = await getApprovedXIds(db, user.id);
  // 作品オーナーは常に編集可。(privilegeMode に依存しない)
  if (video.creator_id && approved.includes(video.creator_id)) return true;

  // 作品単位の合作メンバー編集権限 (video_collaborators)。
  // 主となるユーザー (creator_id 一致者 / admin / 運営) が「この合作作品の編集者
  // として参加できるか」を ON/OFF で許可するゲート。許可されている場合は、
  // 操作者が他の手段 (admin / event editor 等) で持っている権限の範囲で編集できる
  // と解釈する (細粒度 section 判定は持たない)。
  //
  // が、ここで can_edit=1 だけでは「creator でも event editor でもないが合作
  // メンバーとして編集できる」状態を許容したいので、true を返す。
  // 範囲は呼び出し側の section 別 disable/permission_keys 判定で担保される。
  const collabSubjectCond =
    approved.length > 0
      ? or(
          eq(videoCollaborators.discord_user_id, user.id),
          inArray(videoCollaborators.x_user_id, approved),
        )!
      : eq(videoCollaborators.discord_user_id, user.id);
  const collabRows = await db
    .select({ can_edit: videoCollaborators.can_edit })
    .from(videoCollaborators)
    .where(
      and(
        eq(videoCollaborators.video_id, video.id),
        eq(videoCollaborators.can_edit, 1),
        collabSubjectCond,
      )!,
    )
    .limit(1)
    .catch((error: unknown) => {
      if (isMissingDbObjectError(error, "video_collaborators")) {
        return [];
      }
      throw error;
    });
  if (collabRows.length > 0) {
    // Current video_collaborators only has a broad can_edit flag. Keep it scoped
    // to collaborative content sections until a future permission_key column exists.
    return COLLABORATOR_VIDEO_EDIT_KEYS.has(requiredKey);
  }

  // この時点で eventIds を確定させる (allow_user_video_edits の判定にも使う)。
  const eventIds = new Set<string>();
  if (video.primary_event_id) eventIds.add(video.primary_event_id);
  const evRows = await db
    .select({ event_id: videoEvents.event_id })
    .from(videoEvents)
    .where(eq(videoEvents.video_id, video.id));
  evRows.forEach((r) => eventIds.add(r.event_id));

  // イベント単位の「一般ユーザーへの編集権委譲」チェック。
  // 危険キーは委譲できない (videos.youtube_id / videos.primary_event / video.identity)。
  // privilegeMode に依存せず、TOS 同意済みのログインユーザーであれば適用される。
  if (eventIds.size > 0 && isUserDelegatableKey(requiredKey)) {
    const evs = await db
      .select({
        id: eventsTable.id,
        allow: eventsTable.allow_user_video_edits,
        json: eventsTable.user_video_edit_permission_keys_json,
      })
      .from(eventsTable)
      .where(inArray(eventsTable.id, Array.from(eventIds)));
    for (const e of evs) {
      if (e.allow !== 1) continue;
      const keys = parseDelegatablePermissionKeys(e.json);
      if (keys.has(requiredKey)) return true;
    }
  }

  // privilegeMode === "normal" / "admin" では event 経由の権限を使わない。
  // - normal: 「管理者・運営の特権を一切信用しない」モード。owner / collaborator 限定。
  // - admin: admin 特権チェックは前段で済んでいる。ここに来た時点で event 経由は不要。
  if (privilegeMode === "normal" || privilegeMode === "admin") return false;

  if (eventIds.size === 0) return false;
  const aliases = VIDEO_PERMISSION_ALIASES[requiredKey] ?? [requiredKey];
  for (const eId of eventIds) {
    for (const key of aliases) {
      if (await canEditEvent(db, user, eId, key as CollaboratorPermissionKey)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * `allow_user_video_edits` でユーザーに委譲してよい section key の許可リスト。
 * 危険キーはここに入れない (永久に管理者・オーナー専用)。
 */
const USER_DELEGATABLE_KEYS = new Set<string>([
  "videos.title",
  "videos.music_credit",
  "videos.members",
  "videos.review_data",
  "video.descriptions",
  "video.credits",
  "video.members",
]);

function isUserDelegatableKey(key: VideoEditSectionKey): boolean {
  return USER_DELEGATABLE_KEYS.has(key);
}

function parseDelegatablePermissionKeys(
  raw: string | null | undefined,
): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const out = new Set<string>();
    for (const v of parsed) {
      if (typeof v === "string" && USER_DELEGATABLE_KEYS.has(v)) {
        out.add(v);
      }
    }
    return out;
  } catch {
    return new Set();
  }
}
