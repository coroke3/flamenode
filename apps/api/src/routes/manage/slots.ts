import { Hono } from "hono";
import type { ManageSlotRow, ManageSlotsResponse } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { parseJsonColumn } from "../personal/context.ts";
import { canEditEvent, loadManageSnapshot, manageGate } from "./access.ts";

// CURRENT: app/(manage)/manage/events/[id]/slots/page.tsx.
// Authorization (CURRENT): the event must exist, then admin or an "event.slots" permission (else notFound -> 404).
// D1 (S2, <= 3 statements incl. the session lookup): staff snapshot (admins skip it), then one statement.
// CURRENT shows up to 500 rows; S2 caps a response at 100 rows, so rows beyond that are read with ?offset= (0..400).
const MAX_SLOT_ROWS = 100;
const MAX_SLOT_OFFSET = 400;

const SLOT_COLUMNS = [
  "id",
  "event_id",
  "slot_label",
  "start_time",
  "sort_order",
  "status",
  "display_name",
  "x_user_id",
  "reserved_x_id_snapshot",
  "reserved_by_user_id",
  "discord_display_name",
  "discord_id",
  "reservation_group_id",
  "video_id",
  "updated_at",
  "version",
] as const;

function parseSlotStatus(raw: string | undefined): ManageSlotsResponse["statusFilter"] {
  return raw === "available" || raw === "reserved" || raw === "submitted" ? raw : "all";
}

function parseSlotOffset(raw: string | undefined): number {
  const candidate = Number(raw);
  if (!Number.isSafeInteger(candidate) || candidate < 0) return 0;
  return Math.min(candidate, MAX_SLOT_OFFSET);
}

/** CURRENT parseEventPartsJson. */
function parseEventParts(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  } catch {
    return [];
  }
}

export const manageSlotsRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const eventId = c.req.param("id") ?? "";
  const statusFilter = parseSlotStatus(c.req.query("status"));
  const offset = parseSlotOffset(c.req.query("offset"));
  const db = c.env.DB;

  const snapshot = await loadManageSnapshot(db, user);
  const denied = manageGate(c, snapshot);
  if (denied) return denied;
  if (!canEditEvent(snapshot, eventId, "event.slots")) return c.json({ error: "Not Found" }, 404);

  const row = await db
    .prepare(
      `SELECT e.id AS id, e.title AS title, e.accent_color AS accent_color,
         e.slot_part_gap_minutes AS slot_part_gap_minutes, e.parts_json AS parts_json,
         (SELECT COUNT(*) FROM video_events ve INNER JOIN videos v ON v.id = ve.video_id
           WHERE ve.event_id = ? AND v.visibility_status = 'pending') AS pending_count,
         (SELECT json_group_array(json_object('status', q.status, 'count', q.c)) FROM (
            SELECT status AS status, COUNT(*) AS c FROM slots WHERE event_id = ? GROUP BY status) q) AS counts,
         (SELECT json_group_array(json_object(${SLOT_COLUMNS.map((col) => `'${col}', q.${col}`).join(", ")})) FROM (
            SELECT s.id AS id, s.event_id AS event_id, s.slot_label AS slot_label, s.start_time AS start_time,
              s.sort_order AS sort_order, s.status AS status, s.display_name AS display_name,
              s.x_user_id AS x_user_id, s.reserved_x_id_snapshot AS reserved_x_id_snapshot,
              s.reserved_by_user_id AS reserved_by_user_id, u.name AS discord_display_name, u.discord_id AS discord_id,
              s.reservation_group_id AS reservation_group_id, s.video_id AS video_id,
              s.updated_at AS updated_at, s.version AS version
            FROM slots s
            LEFT JOIN "user" u ON s.reserved_by_user_id = u.id
            WHERE s.event_id = ? AND (? = 'all' OR s.status = ?)
            ORDER BY s.start_time ASC, s.sort_order ASC, s.id ASC
            LIMIT ? OFFSET ?) q) AS slots
       FROM events e WHERE e.id = ? LIMIT 1`,
    )
    .bind(eventId, eventId, eventId, statusFilter, statusFilter, MAX_SLOT_ROWS, offset, eventId)
    .first<{
      id: string;
      title: string;
      accent_color: string | null;
      slot_part_gap_minutes: number | null;
      parts_json: string | null;
      pending_count: number;
      counts: string | null;
      slots: string | null;
    }>();
  if (!row) return c.json({ error: "Not Found" }, 404);

  const countRows = parseJsonColumn<{ status: string; count: number }[]>(row.counts, []);
  const counts = Object.fromEntries(countRows.map((entry) => [entry.status, Number(entry.count ?? 0)]));
  const body: ManageSlotsResponse = {
    event: {
      id: row.id,
      title: row.title,
      accent_color: row.accent_color,
      slot_part_gap_minutes: row.slot_part_gap_minutes,
      parts: parseEventParts(row.parts_json),
    },
    isAdmin: snapshot.isAdmin,
    statusFilter,
    offset,
    pageSize: MAX_SLOT_ROWS,
    pendingCount: Number(row.pending_count ?? 0),
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    counts,
    slots: parseJsonColumn<ManageSlotRow[]>(row.slots, []),
  };
  return c.json(body);
});
