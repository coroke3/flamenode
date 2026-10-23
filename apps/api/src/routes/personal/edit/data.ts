import { MAX_JSON_COLUMN_BYTES } from "../context.ts";

// MIG-0630: ONE data statement per edit request (ZERO_1102 S2: session + context + this = 3 D1 statements, 2 binds).
// Shape = MIG-0623 (entry/rows.ts): a UNION ALL of arms, each `(k, j)` with ONE json_object (<= 64 KiB, enforced)
// per row, every arm bounded by a named LIMIT <= 100 (+1 where a cut must be detected).
// ?1 = video id, ?2 = JSON array of the viewer's approved X IDs (CURRENT approvedXIdsWhere, always via json_each).

/** Public member rows (CURRENT: unbounded). One extra row is read to detect a cut. */
export const MAX_EDIT_MEMBERS = 100;
/** video_events rows (CURRENT: unbounded; the access snapshot itself keeps 4, MAX_ATOMIC_VIDEO_EVENTS). */
export const MAX_EDIT_EVENTS = 100;
/** event_staff rows of the viewer's approved X IDs on the attached events. */
export const MAX_EDIT_STAFF_ROWS = 100;
/** video_members rows of the collab permission list (CURRENT: unbounded). One extra row detects a cut. */
export const MAX_EDIT_COLLAB_SUBJECTS = 100;
/** video_softwares labels. */
export const MAX_EDIT_SOFTWARE_LABELS = 100;
/** CURRENT membershipRows .limit(8). */
export const MAX_MEMBERSHIP_PROBE_ROWS = 8;
/** Every arm is bounded: members 101 + events 100 + titles 100 + staff 100 + collab 101 + software 100 + ~7 singles. */
const MAX_DATA_ROWS = 700;

export const VIDEO_COLUMNS = [
  "id",
  "title",
  "visibility_status",
  "youtube_video_id",
  "updated_at",
  "scheduling_type",
  "source_type",
  "collaboration_type",
  "primary_event_id",
  "part",
  "creator_display_name",
  "creator_x_user_id",
  "creator_icon_url",
  "creator_profile_text",
  "creator_youtube_channel_url",
  "creator_other_social_links",
  "music",
  "music_reference_url",
  "credit",
  "intro_comment",
  "highlights",
  "production_story",
  "closing_comment",
] as const;

export interface VideoRow {
  id: string;
  title: string;
  visibility_status: string;
  youtube_video_id: string | null;
  updated_at: number;
  scheduling_type: string | null;
  source_type: string;
  collaboration_type: string;
  primary_event_id: string | null;
  part: string | null;
  creator_display_name: string | null;
  creator_x_user_id: string | null;
  creator_icon_url: string | null;
  creator_profile_text: string | null;
  creator_youtube_channel_url: string | null;
  creator_other_social_links: string | null;
  music: string | null;
  music_reference_url: string | null;
  credit: string | null;
  intro_comment: string | null;
  highlights: string | null;
  production_story: string | null;
  closing_comment: string | null;
}

export interface MemberRow {
  x_user_id: string | null;
  name: string;
  role: string | null;
  comment: string | null;
  can_edit: number;
  is_public_member: number;
}

export interface StaffRow {
  event_id: string;
  permission_preset: string | null;
  custom_permission_keys_json: string | null;
}

export interface CollabRow {
  rid: number;
  x_user_id: string | null;
  name: string;
  can_edit: number;
  is_public_member: number;
  has_account_link: number;
  has_notifiable_link: number;
}

export interface XRow {
  x_name: string;
  icon_url: string | null;
  profile_text: string | null;
  youtube_channel_url: string | null;
  other_social_links: string | null;
}

export interface EditData {
  video: VideoRow | null;
  /** video_events.event_id ordered by event_id (<= MAX_EDIT_EVENTS) */
  videoEventIds: string[];
  /** titles of the attached events (primary + video_events), by id */
  eventTitles: Map<string, string>;
  /** public members ordered like CURRENT (order_index); MAX_EDIT_MEMBERS + 1 rows at most */
  members: MemberRow[];
  staff: StaffRow[];
  hasCollaboratorEdit: boolean;
  /** CURRENT membershipRows.some(can_edit === 0) over the first 8 rows of the viewer's approved X IDs */
  hasNoEditMembership: boolean;
  policyEvent: { allow_user_video_edits: number | null; user_video_edit_permission_keys_json: string | null } | null;
  policySystem: { default_editable_fields: string | null; upcoming_editable_fields: string | null } | null;
  collab: CollabRow[];
  creatorX: XRow | null;
  softwareLabels: string[];
}

export type EditScope = "edit" | "permissions";

const col = (alias: string, columns: readonly string[]) => columns.map((c) => `'${c}', ${alias}.${c}`).join(", ");

/** The statement text. `scope` only drops arms the other endpoint never renders (software label, creator X row). */
export function editStatementSql(scope: EditScope): string {
  const arms = [
    `SELECT 'video' AS k, json_object(${col("v", VIDEO_COLUMNS)}) AS j FROM v`,
    // video_events in storage key order (CURRENT has no ORDER BY; event_id makes the kept rows deterministic).
    `SELECT 'vevent' AS k, json_object('id', q.event_id) AS j FROM (
       SELECT event_id FROM video_events WHERE video_id = ?1 ORDER BY event_id LIMIT ${MAX_EDIT_EVENTS}) q`,
    `SELECT 'etitle' AS k, json_object('id', q.id, 'title', q.title) AS j FROM (
       SELECT id, title FROM events WHERE id IN (SELECT event_id FROM ev) ORDER BY id LIMIT ${MAX_EDIT_EVENTS}) q`,
    `SELECT 'member' AS k, json_object(${col("q", ["x_user_id", "name", "role", "comment", "can_edit", "is_public_member"])}) AS j FROM (
       SELECT x_user_id, name, role, comment, can_edit, is_public_member FROM video_members
       WHERE video_id = ?1 AND is_public_member = 1 ORDER BY order_index, rowid LIMIT ${MAX_EDIT_MEMBERS + 1}) q`,
    `SELECT 'staff' AS k, json_object('event_id', q.event_id, 'permission_preset', q.permission_preset,
         'custom_permission_keys_json', q.custom_permission_keys_json) AS j FROM (
       SELECT event_id, permission_preset, custom_permission_keys_json FROM event_staff
       WHERE event_id IN (SELECT event_id FROM ev) AND x_user_id IN (SELECT x FROM appr)
       ORDER BY event_id, id LIMIT ${MAX_EDIT_STAFF_ROWS}) q`,
    `SELECT 'mine' AS k, json_object(
         'has_edit', EXISTS (SELECT 1 FROM video_members WHERE video_id = ?1 AND can_edit = 1
           AND x_user_id IN (SELECT x FROM appr)),
         'no_edit', EXISTS (SELECT 1 FROM (
           SELECT can_edit FROM video_members WHERE video_id = ?1 AND x_user_id IN (SELECT x FROM appr)
           ORDER BY id LIMIT ${MAX_MEMBERSHIP_PROBE_ROWS}) m WHERE m.can_edit = 0)) AS j`,
    `SELECT 'pol_event' AS k, json_object('allow_user_video_edits', q.allow_user_video_edits,
         'user_video_edit_permission_keys_json', q.user_video_edit_permission_keys_json) AS j FROM (
       SELECT allow_user_video_edits, user_video_edit_permission_keys_json FROM events
       WHERE id = (SELECT primary_event_id FROM v) LIMIT 1) q`,
    `SELECT 'pol_sys' AS k, json_object('default_editable_fields', q.default_editable_fields,
         'upcoming_editable_fields', q.upcoming_editable_fields) AS j FROM (
       SELECT default_editable_fields, upcoming_editable_fields FROM system_settings WHERE id = 'default' LIMIT 1) q`,
    // CURRENT loadVideoCollabSubjects. BUG-COMPATIBLE: CURRENT writes sql`lower(link.x_user_id) = lower(${videoMembers.x_user_id})`
    // inside a single-table drizzle select, where drizzle renders the column BARE ("x_user_id"). Inside the EXISTS that binds to
    // link.x_user_id, so the predicate is a tautology: has_account_link / has_notifiable_link are "any approved link exists"
    // / "any approved link of a notification-enabled user exists" for EVERY row. Reproduced as is (see the work item,
    // brush-up proposal); the intended correlation is lower(link.x_user_id) = lower(m.x_user_id). (The hidden-and-not-editor skip is done in SQL so the LIMIT counts useful rows).
    `SELECT 'collab' AS k, json_object(${col("q", ["rid", "x_user_id", "name", "can_edit", "is_public_member", "has_account_link", "has_notifiable_link"])}) AS j FROM (
       SELECT m.rowid AS rid, m.x_user_id AS x_user_id, m.name AS name, m.can_edit AS can_edit, m.is_public_member AS is_public_member,
         EXISTS (SELECT 1 FROM x_user_account_links link INNER JOIN x_users xu ON xu.id = link.x_user_id
           WHERE xu.approval_status = 'approved') AS has_account_link,
         EXISTS (SELECT 1 FROM x_user_account_links link INNER JOIN x_users xu ON xu.id = link.x_user_id
           INNER JOIN "user" auth_user ON auth_user.id = link.auth_user_id
           WHERE xu.approval_status = 'approved' AND auth_user.is_notification_enabled = 1) AS has_notifiable_link
       FROM video_members m
       WHERE m.video_id = ?1 AND (m.is_public_member = 1 OR m.can_edit = 1)
       ORDER BY m.can_edit DESC, m.rowid LIMIT ${MAX_EDIT_COLLAB_SUBJECTS + 1}) q`,
  ];
  if (scope === "edit") {
    arms.push(
      `SELECT 'x' AS k, json_object(${col("q", ["x_name", "icon_url", "profile_text", "youtube_channel_url", "other_social_links"])}) AS j FROM (
         SELECT x_name, icon_url, profile_text, youtube_channel_url, other_social_links FROM x_users
         WHERE id = (SELECT creator_x_user_id FROM v) LIMIT 1) q`,
      `SELECT 'sw' AS k, json_object('v', q.raw_label) AS j FROM (
         SELECT vs.raw_label AS raw_label FROM video_softwares vs
         INNER JOIN software_catalog sc ON sc.id = vs.software_id WHERE vs.video_id = ?1
         ORDER BY sc.name, vs.raw_label LIMIT ${MAX_EDIT_SOFTWARE_LABELS}) q`,
    );
  }
  return `WITH v AS (SELECT ${VIDEO_COLUMNS.join(", ")} FROM videos WHERE id = ?1 LIMIT 1),
      ev AS (SELECT event_id FROM video_events WHERE video_id = ?1
             UNION SELECT primary_event_id FROM v WHERE primary_event_id IS NOT NULL),
      appr AS (SELECT CAST(value AS TEXT) AS x FROM json_each(?2) WHERE value IS NOT NULL)
    ${arms.join("\n    UNION ALL\n    ")}`;
}

/** CURRENT approvedXIdsWhere's id normalisation (trim, drop empties, unique). */
export function approvedIdsJson(ids: readonly string[]): string {
  return JSON.stringify(Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean))));
}

export async function loadEditData(
  db: D1Database,
  videoId: string,
  approvedXIds: readonly string[],
  scope: EditScope,
): Promise<EditData> {
  const { results } = await db
    .prepare(editStatementSql(scope))
    .bind(videoId, approvedIdsJson(approvedXIds))
    .all<{ k: string; j: string | null }>();
  if (results.length > MAX_DATA_ROWS) throw new Error("edit_rows_exceeded");
  const arms = new Map<string, Array<Record<string, unknown>>>();
  for (const row of results) {
    if (typeof row.j !== "string" || row.j.length > MAX_JSON_COLUMN_BYTES) throw new Error("json_column_invalid");
    const list = arms.get(row.k) ?? [];
    list.push(JSON.parse(row.j) as Record<string, unknown>);
    arms.set(row.k, list);
  }
  const of = <T>(key: string) => (arms.get(key) ?? []) as T[];
  const one = <T>(key: string) => (of<T>(key)[0] ?? null) as T | null;
  const mine = one<{ has_edit: number; no_edit: number }>("mine");
  return {
    video: one<VideoRow>("video"),
    videoEventIds: of<{ id: string }>("vevent").map((r) => r.id),
    eventTitles: new Map(of<{ id: string; title: string }>("etitle").map((r) => [r.id, r.title] as const)),
    members: of<MemberRow>("member"),
    staff: of<StaffRow>("staff"),
    hasCollaboratorEdit: mine?.has_edit === 1,
    hasNoEditMembership: mine?.no_edit === 1,
    policyEvent: one("pol_event"),
    policySystem: one("pol_sys"),
    collab: of<CollabRow>("collab"),
    creatorX: one<XRow>("x"),
    softwareLabels: of<{ v: string }>("sw").map((r) => r.v),
  };
}
