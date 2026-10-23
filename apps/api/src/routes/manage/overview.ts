import { Hono } from "hono";
import type { ManageOverviewResponse } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { parseJsonColumn, resolveActiveXUserId } from "../personal/context.ts";
import { loadManageSnapshot, manageGate } from "./access.ts";
import { jsonObject, type ManageLinkedX } from "./events.ts";
import {
  categorizeNotificationType,
  notificationRowsPiece,
  notifFilterCondition,
  parseNotifFilter,
  toNotification,
  type RawNotificationRow,
} from "./notifications.ts";

// CURRENT: app/(manage)/manage/events/[id]/page.tsx.
// Authorization (CURRENT): admin or the event is in the caller's manageable ids, and the event row exists (else notFound -> 404).
// D1 (S2, <= 3 statements incl. the session lookup): staff snapshot (admins skip it), then one JSON-sections statement.
// CURRENT reads the notification section in a try/catch (event_id migration); the same degrade happens here with
// one extra statement on that failure path only.
const MAX_PENDING_VIDEOS = 10;
const MAX_AUDIT_LOGS = 15;
const MAX_NOTIFICATION_ROWS = 20;
const MAX_NOTIFICATION_TYPES = 100;
const MAX_SLOT_STATUSES = 10;
const MAX_LINKED_X = 100;

const EVENT_COLUMNS = [
  "id",
  "title",
  "accent_color",
  "visibility_status",
  "start_time",
  "end_time",
  "entry_start_time",
  "entry_end_time",
  "pending_review_count",
] as const;

interface Sections {
  event: string | null;
  public_count: number | null;
  slot_counts: string | null;
  pending_videos: string | null;
  audit_logs: string | null;
  notif_counts: string | null;
  notifications: string | null;
  linked: string | null;
}

export const manageOverviewRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const eventId = c.req.param("id") ?? "";
  const notifCategory = parseNotifFilter(c.req.query("notif"));
  const db = c.env.DB;

  const snapshot = await loadManageSnapshot(db, user);
  const denied = manageGate(c, snapshot);
  if (denied) return denied;
  if (!snapshot.isAdmin && !snapshot.manageableEventIds.includes(eventId)) return c.json({ error: "Not Found" }, 404);

  const read = (withNotifications: boolean): Promise<Sections | null> => {
    const params: unknown[] = [];
    const piece = (sql: string, ...binds: unknown[]): string => {
      params.push(...binds);
      return sql;
    };
    const condition = notifFilterCondition(notifCategory, "n.type");
    const notif = notificationRowsPiece(
      condition ? `n.event_id = ? AND ${condition}` : "n.event_id = ?",
      [eventId],
      MAX_NOTIFICATION_ROWS,
    );
    const columns: string[] = [
      piece(
        `(SELECT json_object(${jsonObject(EVENT_COLUMNS)}) FROM (
          SELECT e.id AS id, e.title AS title, e.accent_color AS accent_color, e.visibility_status AS visibility_status,
            e.start_time AS start_time, e.end_time AS end_time, e.entry_start_time AS entry_start_time,
            e.entry_end_time AS entry_end_time,
            (SELECT COUNT(*) FROM video_events ve INNER JOIN videos v ON v.id = ve.video_id
              WHERE ve.event_id = e.id AND v.visibility_status = 'pending') AS pending_review_count
          FROM events e WHERE e.id = ? LIMIT 1) q) AS event`,
        eventId,
      ),
      piece(
        `(SELECT COUNT(*) FROM videos v INNER JOIN video_events ve ON ve.video_id = v.id
          WHERE ve.event_id = ? AND v.visibility_status = 'public') AS public_count`,
        eventId,
      ),
      piece(
        `(SELECT json_group_array(json_object('status', q.status, 'c', q.c)) FROM (
          SELECT status AS status, COUNT(*) AS c FROM slots WHERE event_id = ? GROUP BY status LIMIT ?) q) AS slot_counts`,
        eventId,
        MAX_SLOT_STATUSES,
      ),
      piece(
        `(SELECT json_group_array(json_object('id', q.id, 'title', q.title, 'display_name', q.display_name, 'created_at', q.created_at)) FROM (
          SELECT v.id AS id, v.title AS title, v.creator_display_name AS display_name, v.created_at AS created_at
          FROM videos v INNER JOIN video_events ve ON ve.video_id = v.id
          WHERE ve.event_id = ? AND v.visibility_status = 'pending'
          ORDER BY v.created_at DESC, v.id DESC LIMIT ?) q) AS pending_videos`,
        eventId,
        MAX_PENDING_VIDEOS,
      ),
      piece(
        `(SELECT json_group_array(json_object('id', q.id, 'operation', q.operation, 'actor_user_id', q.actor_user_id, 'created_at', q.created_at)) FROM (
          SELECT id, operation, actor_user_id, created_at FROM audit_logs
          WHERE table_name = 'events' AND target_id = ?
          ORDER BY created_at DESC, id DESC LIMIT ?) q) AS audit_logs`,
        eventId,
        MAX_AUDIT_LOGS,
      ),
      withNotifications
        ? piece(
            `(SELECT json_group_array(json_object('type', q.type, 'c', q.c)) FROM (
              SELECT type AS type, COUNT(*) AS c FROM notification_outbox WHERE event_id = ? GROUP BY type LIMIT ?) q) AS notif_counts`,
            eventId,
            MAX_NOTIFICATION_TYPES,
          )
        : "NULL AS notif_counts",
      withNotifications ? piece(`${notif.sql} AS notifications`, ...notif.params) : "NULL AS notifications",
      piece(
        `(SELECT json_group_array(json_object('x_user_id', q.x_user_id, 'approval_status', q.approval_status)) FROM (
          SELECT x_users.id AS x_user_id, x_users.approval_status AS approval_status
          FROM x_user_account_links INNER JOIN x_users ON x_users.id = x_user_account_links.x_user_id
          WHERE x_user_account_links.auth_user_id = ? LIMIT ?) q) AS linked`,
        user.id,
        MAX_LINKED_X,
      ),
    ];
    return db.prepare(`SELECT ${columns.join(", ")}`).bind(...params).first<Sections>();
  };

  let sections: Sections | null;
  let notificationSchemaMissing = false;
  try {
    sections = await read(true);
    // oversize / malformed notification JSON degrades like a failed notification read (CURRENT try/catch)
    parseJsonColumn(sections?.notif_counts, []);
    parseJsonColumn(sections?.notifications, []);
  } catch {
    console.warn("[manage] notification_outbox.event_id unavailable");
    notificationSchemaMissing = true;
    sections = await read(false);
  }
  if (!sections?.event) return c.json({ error: "Not Found" }, 404);

  const slotCounts: Record<string, number> = {};
  for (const r of parseJsonColumn<{ status: string; c: number }[]>(sections.slot_counts, [])) slotCounts[r.status] = Number(r.c ?? 0);
  const notifCounts = { all: 0, video: 0, x_id: 0, slot: 0, chapter: 0, other: 0 };
  for (const r of parseJsonColumn<{ type: string; c: number }[]>(sections.notif_counts, [])) {
    const count = Number(r.c ?? 0);
    notifCounts.all += count;
    const bucket = categorizeNotificationType(r.type);
    if (bucket === "video") notifCounts.video += count;
    else if (bucket === "x_id") notifCounts.x_id += count;
    else if (bucket === "slot") notifCounts.slot += count;
    else if (bucket === "chapter") notifCounts.chapter += count;
    else notifCounts.other += count;
  }
  const event = parseJsonColumn<ManageOverviewResponse["event"] | null>(sections.event, null);
  if (!event) return c.json({ error: "Not Found" }, 404);
  const body: ManageOverviewResponse = {
    isAdmin: snapshot.isAdmin,
    event,
    editorRole: snapshot.isAdmin ? null : (snapshot.roleByEvent.get(eventId) ?? null),
    activeXUserId: resolveActiveXUserId(user.active_x_user_id, parseJsonColumn<ManageLinkedX[]>(sections.linked, [])),
    manageStaffXUserIds: snapshot.manageStaffXUserIds,
    publicVideoCount: Number(sections.public_count ?? 0),
    slotCounts,
    pendingVideos: parseJsonColumn(sections.pending_videos, []),
    auditLogs: parseJsonColumn(sections.audit_logs, []),
    notifCategory,
    notifCounts,
    notificationSchemaMissing,
    notifications: parseJsonColumn<RawNotificationRow[]>(sections.notifications, []).map(toNotification),
  };
  return c.json(body);
});
