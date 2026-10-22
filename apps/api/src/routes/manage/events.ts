import type { ManageInboxRow, ManageNotificationRow } from "@flamenode/contracts";
import type { SessionUser } from "../../auth/session.ts";
import { parseJsonColumn } from "../personal/context.ts";
import type { ManageSnapshot } from "./access.ts";
import { compareSidebarRows } from "./eventOrder.ts";

// CURRENT: src/lib/manage/navigationEvents.ts (loadEventRows, loadPendingByEvent) and app/(manage)/manage/page.tsx
// (audit_logs inbox, notification_outbox). ONE statement; every section is a bounded JSON subquery.
// ZERO_1102 S2: every LIMIT is a named constant <= 100.

const MAX_MANAGE_EVENTS = 100;
const MAX_INBOX_ROWS = 20;
const MAX_NOTIFICATION_ROWS = 20;
const MAX_MANAGE_LINKED_X = 100;

export interface ManageEventRow {
  id: string;
  title: string;
  accent_color: string | null;
  visibility_status: string | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
  created_at: number | null;
  pending_review_count: number;
}

export interface ManageLinkedX {
  x_user_id: string;
  approval_status: string | null;
}

export interface ManageData {
  /** Sidebar order, at most MAX_MANAGE_EVENTS. */
  events: ManageEventRow[];
  truncated: boolean;
  inbox: ManageInboxRow[];
  notifications: ManageNotificationRow[];
  linked: ManageLinkedX[];
}

export interface ManageDataParts {
  inbox?: boolean;
  notifications?: boolean;
  linked?: boolean;
}

interface Piece {
  sql: string;
  params: unknown[];
}

const EVENT_COLUMNS = [
  "id",
  "title",
  "accent_color",
  "visibility_status",
  "start_time",
  "end_time",
  "entry_start_time",
  "entry_end_time",
  "created_at",
  "pending_review_count",
] as const;
const NOTIFICATION_COLUMNS = [
  "id",
  "type",
  "status",
  "payload_json",
  "attempt_count",
  "last_error",
  "dedupe_key",
  "recipient_user_id",
  "event_id",
  "created_at",
] as const;
const INBOX_COLUMNS = ["id", "target_id", "operation", "actor_user_id", "created_at"] as const;

const jsonObject = (columns: readonly string[]): string => columns.map((c) => `'${c}', q.${c}`).join(", ");

/** Which events the caller may see: admin = every event, staff = the snapshot's manageable ids (one json_each bind). */
function scope(snapshot: ManageSnapshot, column: string): Piece {
  if (snapshot.isAdmin) return { sql: `${column} IN (SELECT id FROM events)`, params: [] };
  return {
    sql: `${column} IN (SELECT CAST(value AS TEXT) FROM json_each(?))`,
    params: [JSON.stringify(snapshot.manageableEventIds)],
  };
}

function eventsPiece(snapshot: ManageSnapshot): Piece {
  const where = scope(snapshot, "e.id");
  return {
    sql: `(SELECT json_group_array(json_object(${jsonObject(EVENT_COLUMNS)})) FROM (
        SELECT e.id AS id, e.title AS title, e.accent_color AS accent_color, e.visibility_status AS visibility_status,
          e.start_time AS start_time, e.end_time AS end_time, e.entry_start_time AS entry_start_time,
          e.entry_end_time AS entry_end_time, e.created_at AS created_at,
          (SELECT COUNT(*) FROM video_events ve INNER JOIN videos v ON v.id = ve.video_id
            WHERE ve.event_id = e.id AND v.visibility_status = 'pending') AS pending_review_count
        FROM events e
        WHERE ${where.sql}
        ORDER BY e.start_time DESC, e.created_at DESC, e.id DESC
        LIMIT ?) q)`,
    params: [...where.params, MAX_MANAGE_EVENTS + 1],
  };
}

function inboxPiece(snapshot: ManageSnapshot): Piece {
  const where = scope(snapshot, "target_id");
  return {
    sql: `(SELECT json_group_array(json_object(${jsonObject(INBOX_COLUMNS)})) FROM (
        SELECT id, target_id, operation, actor_user_id, created_at FROM audit_logs
        WHERE table_name = 'events' AND ${where.sql}
        ORDER BY created_at DESC, id DESC
        LIMIT ?) q)`,
    params: [...where.params, MAX_INBOX_ROWS],
  };
}

function notificationsPiece(snapshot: ManageSnapshot): Piece {
  const where = scope(snapshot, "event_id");
  return {
    sql: `(SELECT json_group_array(json_object(${jsonObject(NOTIFICATION_COLUMNS)})) FROM (
        SELECT ${NOTIFICATION_COLUMNS.join(", ")} FROM notification_outbox
        WHERE ${where.sql}
        ORDER BY created_at DESC, id DESC
        LIMIT ?) q)`,
    params: [...where.params, MAX_NOTIFICATION_ROWS],
  };
}

function linkedPiece(userId: string): Piece {
  return {
    sql: `(SELECT json_group_array(json_object('x_user_id', q.x_user_id, 'approval_status', q.approval_status)) FROM (
        SELECT x_users.id AS x_user_id, x_users.approval_status AS approval_status
        FROM x_user_account_links
        INNER JOIN x_users ON x_users.id = x_user_account_links.x_user_id
        WHERE x_user_account_links.auth_user_id = ?
        LIMIT ?) q)`,
    params: [userId, MAX_MANAGE_LINKED_X],
  };
}

/** The ONE data statement of the event list screens (session and staff snapshot are the other two). */
function manageDataStatement(
  db: D1Database,
  user: SessionUser,
  snapshot: ManageSnapshot,
  parts: ManageDataParts,
): D1PreparedStatement {
  const pieces: [string, Piece | null][] = [
    ["events", eventsPiece(snapshot)],
    ["inbox", parts.inbox ? inboxPiece(snapshot) : null],
    ["notifications", parts.notifications ? notificationsPiece(snapshot) : null],
    ["linked", parts.linked && !snapshot.isAdmin ? linkedPiece(user.id) : null],
  ];
  const select = pieces.map(([name, piece]) => `${piece?.sql ?? "NULL"} AS ${name}`).join(", ");
  return db.prepare(`SELECT ${select}`).bind(...pieces.flatMap(([, piece]) => piece?.params ?? []));
}

export async function loadManageData(
  db: D1Database,
  user: SessionUser,
  snapshot: ManageSnapshot,
  parts: ManageDataParts,
): Promise<ManageData> {
  const row = await manageDataStatement(db, user, snapshot, parts).first<Record<string, unknown>>();
  const all = parseJsonColumn<ManageEventRow[]>(row?.events, []);
  const events = [...all].sort(compareSidebarRows);
  const truncated = events.length > MAX_MANAGE_EVENTS;
  return {
    events: truncated ? events.slice(0, MAX_MANAGE_EVENTS) : events,
    truncated,
    inbox: parseJsonColumn<ManageInboxRow[]>(row?.inbox, []),
    notifications: parseJsonColumn<ManageNotificationRow[]>(row?.notifications, []),
    linked: parseJsonColumn<ManageLinkedX[]>(row?.linked, []),
  };
}
