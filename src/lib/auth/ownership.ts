import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  eventStaff,
  events as eventsTable,
  videoMembers,
  videoEvents,
  xUsers,
  type videos,
} from "@/lib/db/schema";
import type {
  CollaboratorPermissionKey,
  VideoEditSectionKey,
} from "./videoEditSections";
import {
  VIDEO_PERMISSION_ALIASES,
  NORMAL_SAFE_VIDEO_EDIT_KEYS,
  DANGEROUS_ADMIN_VIDEO_EDIT_KEYS,
  COLLABORATOR_VIDEO_EDIT_KEYS,
  isSafeNormalVideoEditKey,
  isDangerousAdminVideoEditKey,
  isUserDelegatableKey,
  parseDelegatablePermissionKeys,
} from "./ownershipCore";
import type { SessionUserLike } from "./ownershipCore";
import { expandPermissionAliases } from "./permissions/aliases";
import {
  getManageStaffRole,
  resolveStaffPermissionKeys,
  staffRowHasPermissionKey,
  type StaffPermissionRow,
} from "./permissions/permissionResolver";

export type { SessionUserLike };
export {
  isSafeNormalVideoEditKey,
  isDangerousAdminVideoEditKey,
  resolveAdminOrEventVideoPrivilegeMode,
} from "./ownershipCore";

/**
 * オーナーシップ判定ヘルパー。
 *
 * 設計の RBAC (§2-21) を実装する:
 * - admin: すべて操作可
 * - video の creator_x_user_id が「自分の承認済み X ID」: 編集可
 * - event_staff (preset + custom_permission_keys_json): permission_key に応じた細粒度許可
 */

function staffRowHasAnyPermissions(row: StaffPermissionRow): boolean {
  return resolveStaffPermissionKeys(row).size > 0;
}

const staffPermissionSelect = {
  permission_preset: eventStaff.permission_preset,
  custom_permission_keys_json: eventStaff.custom_permission_keys_json,
} as const;

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
        eq(xUsers.linked_user_id, userId),
        eq(xUsers.approval_status, "approved"),
      )!,
    );
  return rows.map((r) => r.id);
}

/** 自分が編集者として担当しているイベント ID 一覧。 */
export async function getEditableEventIds(
  db: DB,
  userId: string,
  candidateEventIds?: readonly string[],
): Promise<string[]> {
  const xIds = await getApprovedXIds(db, userId);
  const subjectCond =
    xIds.length > 0
      ? or(eq(eventStaff.user_id, userId), inArray(eventStaff.x_user_id, xIds))!
      : eq(eventStaff.user_id, userId);
  const candidateIds = candidateEventIds
    ? Array.from(new Set(candidateEventIds.filter(Boolean)))
    : null;
  if (candidateIds && candidateIds.length === 0) return [];
  const rowsQuery = db
    .select({
      event_id: eventStaff.event_id,
      ...staffPermissionSelect,
    })
    .from(eventStaff)
    .where(candidateIds
      ? and(subjectCond, inArray(eventStaff.event_id, candidateIds))!
      : subjectCond);
  const rows = candidateIds ? await rowsQuery.limit(candidateIds.length * 4 + 1) : await rowsQuery;
  if (candidateIds && rows.length > candidateIds.length * 4) {
    throw new Error("editable_event_staff_read_limit_exceeded");
  }
  return Array.from(
    new Set(
      rows.filter(staffRowHasAnyPermissions).map((r) => r.event_id),
    ),
  );
}

/**
 * 当該イベントで自分が持つ permission_key 一覧。
 * x_user_id 連携 / 内部 user_id 連携の両方を見る。
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
          eq(eventStaff.user_id, userId),
          inArray(eventStaff.x_user_id, xIds),
        )!
      : eq(eventStaff.user_id, userId);
  const rows = await db
    .select(staffPermissionSelect)
    .from(eventStaff)
    .where(
      and(
        eq(eventStaff.event_id, eventId),
        subjectCond,
      )!,
    );
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of resolveStaffPermissionKeys(row)) keys.add(key);
  }
  return keys;
}

export async function canManageXIdLinkRequests(
  db: DB,
  user: SessionUserLike,
): Promise<boolean> {
  if (user.role === "admin") return true;
  const xIds = await getApprovedXIds(db, user.id);
  const subjectCond =
    xIds.length > 0
      ? or(eq(eventStaff.user_id, user.id), inArray(eventStaff.x_user_id, xIds))!
      : eq(eventStaff.user_id, user.id);
  const rows = await db
    .select(staffPermissionSelect)
    .from(eventStaff)
    .where(subjectCond);
  return rows.some((row) =>
    resolveStaffPermissionKeys(row).has("xid.link_requests"),
  );
}

/**
 * /manage 配下のイベント運営画面へ入れるか。
 * ManageSidebar / getEditableEventIds と同じ一覧判定を使い、Active X には依存しない。
 */
export async function canAccessManageEvent(
  db: DB,
  user: SessionUserLike,
  eventId: string,
): Promise<boolean> {
  if (user.role === "admin") return true;
  const editable = await getEditableEventIds(db, user.id);
  return editable.includes(eventId);
}

/** 担当イベントごとの event_staff ロール（表示用）。Active X は見ない。 */
export async function getManageStaffRoleForEvent(
  db: DB,
  userId: string,
  eventId: string,
): Promise<"representative" | "editor" | null> {
  const approvedXIds = await getApprovedXIds(db, userId);
  const subjectCond =
    approvedXIds.length > 0
      ? or(
          eq(eventStaff.user_id, userId),
          inArray(eventStaff.x_user_id, approvedXIds),
        )!
      : eq(eventStaff.user_id, userId);
  const staff = (
    await db
      .select(staffPermissionSelect)
      .from(eventStaff)
      .where(and(eq(eventStaff.event_id, eventId), subjectCond)!)
  ).find(staffRowHasAnyPermissions);
  return staff ? getManageStaffRole(staff) : null;
}

/**
 * 担当イベントに紐づく運営用 X ID（event_staff.x_user_id）一覧。
 * Discord 紐づけのみの行は含めない。
 */
export async function getManageStaffXUserIds(
  db: DB,
  userId: string,
  eventIds: string[],
): Promise<string[]> {
  if (eventIds.length === 0) return [];
  const approvedXIds = await getApprovedXIds(db, userId);
  const subjectCond =
    approvedXIds.length > 0
      ? or(
          eq(eventStaff.user_id, userId),
          inArray(eventStaff.x_user_id, approvedXIds),
        )!
      : eq(eventStaff.user_id, userId);
  const rows = await db
    .select({ x_user_id: eventStaff.x_user_id, ...staffPermissionSelect })
    .from(eventStaff)
    .where(and(inArray(eventStaff.event_id, eventIds), subjectCond)!);
  return Array.from(
    new Set(
      rows
        .filter(staffRowHasAnyPermissions)
        .map((r) => r.x_user_id?.trim())
        .filter((x): x is string => !!x),
    ),
  );
}

export { shouldWarnManageActiveXMismatch } from "./ownershipCore";

/**
 * イベント編集権限の判定。
 *
 * 旧仕様では「スタッフ登録だけで requiredKey によらず全許可」だったが、
 * これだと閲覧目的のスタッフ枠が全権を持ってしまう。新仕様では以下の優先順位:
 *
 * 1. admin → true
 * 2. event_staff の permission_key が一致 → true
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

  const candidateKeys = expandPermissionAliases(requiredKey);
  if (candidateKeys.length === 0) return false;

  const xIds = await getApprovedXIds(db, user.id);
  const subjectCond =
    xIds.length > 0
      ? or(
          eq(eventStaff.user_id, user.id),
          inArray(eventStaff.x_user_id, xIds),
        )!
      : eq(eventStaff.user_id, user.id);
  const rows = await db
    .select(staffPermissionSelect)
    .from(eventStaff)
    .where(and(eq(eventStaff.event_id, eventId), subjectCond)!);

  for (const row of rows) {
    if (candidateKeys.some((key) => staffRowHasPermissionKey(row, key))) {
      return true;
    }
  }
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
 * - `normal`: 作品オーナー (creator_x_user_id ∈ approvedXIds) と
 *   合作メンバー (video_members.can_edit) **のみ**。
 *   admin / event editor / event collaborator の特権は **一切使わない**。
 *   `allow_user_video_edits` (イベント単位の権限拡張) も collaborator 専用の
 *   修飾子として働くだけで、関係ないログインユーザーには適用しない。
 *   /dashboard/edit/[id] の既定モードはこれ (URL に ?privileged= が無い場合)。
 *
 * - `admin`: admin role だけが全権を持つ。event 経由の権限は使わない。
 *
 * - `event`: event_staff の権限キーが効く。
 *   admin 特権は使わない (役割を切り分けるため)。
 *   イベント運営者は自分がオーナーでなくても、そのイベント所属作品を編集できる。
 *
 * 作品オーナーは privilegeMode に関わらず常に編集可能。
 */
export type CanEditVideoPrivilegeMode = "normal" | "admin" | "event";

/**
 * 動画編集権限の判定。`privilegeMode` で評価する権限ソースを切り替える。
 *
 * `submitted_by_user_id` 単独は判定対象外 (投稿記録だけで編集権を与えないため)。
 *
 * `requiredKey` は必須。section 別の編集権限を明示することで、collaborator が
 * 持っていない section を触れないよう保証する。
 */
export async function canEditVideo(args: {
  db: DB;
  user: SessionUserLike;
  video: Pick<
    VideoRow,
    "creator_x_user_id" | "primary_event_id" | "id" | "submitted_by_user_id"
  >;
  requiredKey: VideoEditSectionKey;
  privilegeMode: CanEditVideoPrivilegeMode;
}): Promise<boolean> {
  const { db, user, video, requiredKey, privilegeMode } = args;

  // admin role の全権許容は "admin" のみ。
  // "normal" モードでは admin role でも safe key だけが通る (後段で判定)。
  if (
    privilegeMode === "admin" && user.role === "admin"
  ) {
    return true;
  }

  const approved = await getApprovedXIds(db, user.id);
  // 作品オーナーは常に編集可。(privilegeMode に依存しない)
  if (video.creator_x_user_id && approved.includes(video.creator_x_user_id)) return true;

  // 通常モード (normal) の特例:
  //   - admin role が safe key を要求している場合は、全作品で許可。
  //     ただし danger key は不可。「管理者権限を使う」(?privileged=admin) が必須。
  //   - イベント管理者が safe key を要求していて、その作品が自分の管理イベントに
  //     属していれば許可。
  if (privilegeMode === "normal" && isSafeNormalVideoEditKey(requiredKey)) {
    if (user.role === "admin") return true;
    // イベント管理者: 自分が編集できるイベントに、この作品が属しているか
    const editableEventIds = await getEditableEventIds(db, user.id);
    if (editableEventIds.length > 0) {
      const videoEventIds = new Set<string>();
      if (video.primary_event_id) videoEventIds.add(video.primary_event_id);
      const evRows = await db
        .select({ event_id: videoEvents.event_id })
        .from(videoEvents)
        .where(eq(videoEvents.video_id, video.id));
      for (const r of evRows) videoEventIds.add(r.event_id);
      for (const eid of editableEventIds) {
        if (videoEventIds.has(eid)) return true;
      }
    }
  }

  // 作品単位の合作メンバー編集権限 (video_members.can_edit)。
  // 表示メンバー・チャプター担当・共同編集権限を
  // 1 テーブルで管理する設計に統一。`can_edit=1` の video_member は作品単位の共同
  // 編集者として扱う。範囲は COLLABORATOR_VIDEO_EDIT_KEYS で制限される。
  const memberSubjectCond =
    approved.length > 0
      ? or(
          eq(videoMembers.user_id, user.id),
          inArray(videoMembers.x_user_id, approved),
        )!
      : eq(videoMembers.user_id, user.id);
  const editableMemberRows = await db
    .select({ can_edit: videoMembers.can_edit })
    .from(videoMembers)
    .where(
      and(
        eq(videoMembers.video_id, video.id),
        eq(videoMembers.can_edit, 1),
        memberSubjectCond,
      )!,
    )
    .limit(1);
  const isCollaborator = editableMemberRows.length > 0;

  // この時点で eventIds を確定させる (allow_user_video_edits の判定にも使う)。
  const eventIds = new Set<string>();
  if (video.primary_event_id) eventIds.add(video.primary_event_id);
  const evRows = await db
    .select({ event_id: videoEvents.event_id })
    .from(videoEvents)
    .where(eq(videoEvents.video_id, video.id));
  evRows.forEach((r) => eventIds.add(r.event_id));

  if (isCollaborator) {
    // (a) collaborator のデフォルト許可キー (合作コンテンツ系) は無条件で OK。
    if (COLLABORATOR_VIDEO_EDIT_KEYS.has(requiredKey)) return true;
    // (b) それ以外は、イベント単位の `allow_user_video_edits` で許可キーが
    //     明示的に拡張されている場合のみ OK。
    //     `allow_user_video_edits` は「ログインユーザー全員に解放する」機能では
    //     なく、**既に通常編集できる人 (owner / collaborator) が触れるキーを
    //     イベント側で増減できる**修飾子として扱う。
    //     owner は元々全権なのでここに来ない。実質 collaborator 専用の拡張。
    if (
      eventIds.size > 0 &&
      isUserDelegatableKey(requiredKey) &&
      (await isEventDelegationGranted(db, eventIds, requiredKey))
    ) {
      return true;
    }
    return false;
  }

  // privilegeMode === "normal" / "admin" では event 経由の権限を使わない。
  // - normal: 「管理者・運営の特権を一切信用しない」モード。owner / collaborator 限定。
  // - admin: admin 特権チェックは前段で済んでいる。ここに来た時点で event 経由は不要。
  // 重要: `allow_user_video_edits` も owner / collaborator 以外には適用しない。
  //       一般ログインユーザーが他人の作品を編集できる経路を作らないため。
  if (privilegeMode === "normal" || privilegeMode === "admin") return false;

  // privilegeMode === "event": イベント運営権限のチェック。
  // event_staff の権限キーにより、自分がオーナーでなくても
  // イベント所属作品を編集できる。
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
 * 対象イベントのうち、 `allow_user_video_edits === 1` かつ
 * `user_video_edit_permission_keys_json` に `requiredKey` が含まれているものが 1 つでも
 * あれば true を返す。
 */
async function isEventDelegationGranted(
  db: DB,
  eventIds: Set<string>,
  requiredKey: VideoEditSectionKey,
): Promise<boolean> {
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
  return false;
}
