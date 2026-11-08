/**
 * MIG-0656 U03b: SA-056/057 bounded submitted-slot D1 reads, UNMOUNTED.
 *
 * Sequential reads under S3 budget: (1) scoped existence, approved linked
 * event.slots staff grants and full anchor; (2) up to 21 RAW group members
 * when JS-trim says grouped; (3) video summary + up to 21 submitted refs
 * when JS-trim says video is present. At most three pre-reads, one eventual
 * D1 audited batch. No D1 requests are made by this pure module.
 *
 * The caller MUST reject unauthorized users after read (1), BEFORE reading
 * group or video; this module offers an authorization-enforcing decoder.
 * Read-time results NEVER authorize a mutation: same-batch group, video
 * reference set, per-slot CAS, strict audit, Queue and Outbox are pending.
 */
import { MAX_SLOTS_PER_VIDEO } from "@flamenode/domain/slots/limits";
import { canUpdateEventLabels, type SlotLabelWriteRow } from "./slotWriteScopedRead.ts";
import {
  selectSubmittedDangerSnapshot,
  type SubmittedDangerKind,
  type SubmittedDangerSelection,
  type SubmittedVideoBefore,
} from "./slotSubmittedDangerSelection.ts";

const COLUMNS = [
  "id", "event_id", "reserved_by_user_id", "x_user_id",
  "reserved_x_id_snapshot", "display_name", "slot_label", "start_time",
  "sort_order", "reservation_group_id", "video_id", "status",
  "updated_at", "version",
] as const;
const FIELDS = COLUMNS.map(name => "'" + name + "', s.\"" + name + "\"").join(", ");

/** Five binds: eventId, eventId, actorId, eventId, slotId. */
export const SLOT_SUBMITTED_DANGER_ANCHOR_SQL = [
  "SELECT",
  "(SELECT id FROM events WHERE id = ? LIMIT 1) AS exists_id,",
  "(SELECT json_group_array(json_object(",
  " 'permission_preset', staff.permission_preset,",
  " 'custom_permission_keys_json', staff.custom_permission_keys_json",
  ")) FROM (",
  " SELECT es.permission_preset, es.custom_permission_keys_json",
  " FROM event_staff es",
  " JOIN x_user_account_links l ON l.x_user_id = es.x_user_id",
  " JOIN x_users x ON x.id = l.x_user_id",
  " WHERE es.event_id = ? AND l.auth_user_id = ?",
  " AND x.approval_status = 'approved' LIMIT 101",
  ") staff) AS staff_json,",
  "(SELECT json_object(" + FIELDS + ") FROM slots s",
  " WHERE s.event_id = ? AND s.id = ? LIMIT 1) AS anchor_json",
].join("\n");

/** Two binds: eventId, unmodified stored reservation_group_id. */
export const SLOT_SUBMITTED_DANGER_RAW_GROUP_SQL = [
  "SELECT json_group_array(json_object(" + FIELDS + ")) AS group_json",
  "FROM (SELECT s.* FROM slots s WHERE s.event_id = ?",
  " AND s.reservation_group_id = ? LIMIT " + (MAX_SLOTS_PER_VIDEO + 1) + ") s",
].join("\n");

/**
 * Two binds: JS-trimmed anchor video_id twice. Unlike SQLite trim(),
 * JavaScript trim() recognizes Unicode blank legacy values.
 * If no video ID, this read is skipped for SA-056 and SA-057 fails closed.
 */
export const SLOT_SUBMITTED_DANGER_VIDEO_REFS_SQL = [
  "SELECT",
  "(SELECT json_object('id',v.id,'scheduling_type',v.scheduling_type,",
  " 'updated_at',v.updated_at) FROM videos v WHERE v.id = ? LIMIT 1) AS video_json,",
  "(SELECT json_group_array(json_object('id',s.id)) FROM (",
  " SELECT s.id FROM slots s WHERE s.video_id = ? AND s.status = 'submitted'",
  " LIMIT " + (MAX_SLOTS_PER_VIDEO + 1),
  ") s) AS refs_json",
].join("\n");

export type SubmittedDangerAnchorRead = {
  exists_id: string | null;
  staff_json: string | null;
  anchor_json: string | null;
};
export type SubmittedDangerGroupRead = { group_json: string | null };
export type SubmittedDangerVideoRefsRead = {
  video_json: string | null;
  refs_json: string | null;
};
export type AuthorizedSubmittedDangerAnchor =
  | { ok: true; anchor: SlotLabelWriteRow }
  | { ok: false; message: string };

const CHANGED = "提出グループの状態が変わりました。画面を更新して再試行してください。";
const FORBIDDEN = "Not Found";

function isSlotRow(value: unknown, eventId: string): value is SlotLabelWriteRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && !!row.id.trim() &&
    row.id === row.id.trim() && row.event_id === eventId &&
    typeof row.status === "string" &&
    Number.isSafeInteger(row.version) && (row.version as number) >= 0 &&
    Number.isSafeInteger(row.updated_at) && Number.isSafeInteger(row.sort_order) &&
    (row.start_time === null || Number.isSafeInteger(row.start_time)) &&
    ["reserved_by_user_id", "x_user_id", "reserved_x_id_snapshot",
      "display_name", "slot_label", "reservation_group_id", "video_id"]
      .every(k => row[k] === null || typeof row[k] === "string");
}

function parseJson(raw: string | null): unknown {
  if (typeof raw !== "string") return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}

/**
 * MUST be called before any subsequent group/video SQL. The identical 404
 * for missing event versus denied actor prevents an existence oracle.
 * A successful return is still only a READ permission decision; writeGuard,
 * CostGuard and per-event authorization must also run in the future Hono route.
 */
export function selectAuthorizedSubmittedDangerAnchor(input: {
  eventId: string;
  slotId: string;
  actorRole: string | null | undefined;
  read: SubmittedDangerAnchorRead;
}): AuthorizedSubmittedDangerAnchor {
  const { eventId, slotId, read } = input;
  if (!eventId || eventId !== eventId.trim() || !slotId ||
      slotId !== slotId.trim() || !read) {
    return { ok: false, message: CHANGED };
  }
  // Do not parse anchor_json or expose row status before auth is confirmed.
  try {
    if (!canUpdateEventLabels(input.actorRole, read.staff_json) ||
        read.exists_id !== eventId) {
      return { ok: false, message: FORBIDDEN };
    }
  } catch { return { ok: false, message: FORBIDDEN }; }
  const anchor = parseJson(read.anchor_json);
  if (anchor === null) return { ok: false, message: "対象の枠が見つかりません。" };
  if (!isSlotRow(anchor, eventId) || anchor.id !== slotId) {
    return { ok: false, message: CHANGED };
  }
  return { ok: true, anchor };
}

/** The next I/O step is based on the exact raw key, not SQL trim(). */
export function needsSubmittedDangerGroupRead(anchor: SlotLabelWriteRow): boolean {
  return !!anchor.reservation_group_id?.trim();
}
export function submittedDangerVideoReadId(anchor: SlotLabelWriteRow): string | null {
  return anchor.video_id?.trim() || null;
}

/** Pure decoding after authorization; no callback, DB or route access. */
export function decodeSubmittedDangerReads(input: {
  kind: SubmittedDangerKind;
  eventId: string;
  slotId: string;
  authorized: Extract<AuthorizedSubmittedDangerAnchor, {ok: true}>;
  groupRead: SubmittedDangerGroupRead | null;
  videoRead: SubmittedDangerVideoRefsRead | null;
}): SubmittedDangerSelection {
  const { eventId, slotId, authorized } = input;
  if (!authorized?.ok || !isSlotRow(authorized.anchor, eventId) ||
      authorized.anchor.id !== slotId) {
    return { ok: false, message: CHANGED };
  }
  const anchor = authorized.anchor;
  const grouped = needsSubmittedDangerGroupRead(anchor);
  const groupValue = grouped ? parseJson(input.groupRead?.group_json ?? null) : [];
  if (grouped && (!Array.isArray(groupValue) ||
      groupValue.length > MAX_SLOTS_PER_VIDEO + 1 ||
      groupValue.some(row => !isSlotRow(row, eventId)))) {
    return { ok: false, message: CHANGED };
  }
  const videoId = submittedDangerVideoReadId(anchor);
  const videoValue = videoId ? parseJson(input.videoRead?.video_json ?? null) : null;
  const refValue = videoId ? parseJson(input.videoRead?.refs_json ?? null) : [];
  let videoBefore: SubmittedVideoBefore | null = null;
  if (videoValue !== null) {
    if (typeof videoValue !== "object" || Array.isArray(videoValue)) {
      return { ok: false, message: CHANGED };
    }
    const v = videoValue as Record<string, unknown>;
    if (typeof v.id !== "string" ||
        (v.scheduling_type !== null && typeof v.scheduling_type !== "string") ||
        !Number.isSafeInteger(v.updated_at)) {
      return { ok: false, message: CHANGED };
    }
    videoBefore = {
      id: v.id, scheduling_type: v.scheduling_type, updated_at: v.updated_at as number,
    };
  }
  if (videoId && (!Array.isArray(refValue) ||
      refValue.length > MAX_SLOTS_PER_VIDEO + 1 ||
      refValue.some(row => !row || typeof row !== "object" ||
        Array.isArray(row) || typeof row.id !== "string"))) {
    return { ok: false, message: CHANGED };
  }
  return selectSubmittedDangerSnapshot({
    kind: input.kind, eventId, slotId, anchor,
    groupedRows: grouped ? groupValue as SlotLabelWriteRow[] : [],
    videoBefore, submittedVideoRefs: videoId
      ? refValue as {id: string}[] : [],
  });
}
