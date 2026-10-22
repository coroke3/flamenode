import { Hono } from "hono";
import type { ManageAudienceResponse, ManageAudienceRow } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { parseJsonColumn } from "../personal/context.ts";
import { loadManageSnapshot, manageGate } from "./access.ts";
import { resolveManageXIconUrl } from "./icon.ts";

// CURRENT: app/(manage)/manage/events/[id]/audience/page.tsx.
// Authorization (CURRENT): the event exists and the caller is admin or holds any staff permission on it (else 404).
// D1 (S2, <= 3 statements incl. the session lookup): staff snapshot (admins skip it), then one statement.
// CURRENT reads every slot holder / submitter; S2 caps each of the two source lists at 100 rows (ordered by x id, the
// natural GROUP BY order) and sets `truncated`.
const MAX_AUDIENCE_SOURCE_ROWS = 100;

interface SourceRow {
  x_user_id: string | null;
  x_name: string | null;
  icon_url: string | null;
  approval_status: string | null;
  slot_count?: number;
  submitted_count?: number;
  video_count?: number;
}

const AUDIENCE_ID = "COALESCE(s.reserved_x_id_snapshot, s.x_user_id)";

export const manageAudienceRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const eventId = c.req.param("id") ?? "";
  const db = c.env.DB;
  const snapshot = await loadManageSnapshot(db, user);
  const denied = manageGate(c, snapshot);
  if (denied) return denied;
  const permissions = snapshot.permissionsByEvent.get(eventId);
  if (!snapshot.isAdmin && (!permissions || permissions.size === 0)) return c.json({ error: "Not Found" }, 404);

  const row = await db
    .prepare(
      `SELECT e.id AS id, e.title AS title, e.accent_color AS accent_color,
         (SELECT COUNT(*) FROM video_events ve INNER JOIN videos v ON v.id = ve.video_id
           WHERE ve.event_id = ? AND v.visibility_status = 'pending') AS pending_count,
         (SELECT json_group_array(json_object('x_user_id', q.x_user_id, 'x_name', q.x_name, 'icon_url', q.icon_url,
              'approval_status', q.approval_status, 'slot_count', q.slot_count, 'submitted_count', q.submitted_count)) FROM (
            SELECT ${AUDIENCE_ID} AS x_user_id, xu.x_name AS x_name, xu.icon_url AS icon_url, xu.approval_status AS approval_status,
              COUNT(*) AS slot_count, SUM(CASE WHEN s.status = 'submitted' THEN 1 ELSE 0 END) AS submitted_count
            FROM slots s
            LEFT JOIN x_users xu ON xu.id = ${AUDIENCE_ID}
            WHERE s.event_id = ? AND (s.x_user_id IS NOT NULL OR s.reserved_x_id_snapshot IS NOT NULL)
              AND TRIM(COALESCE(s.reserved_x_id_snapshot, s.x_user_id, '')) != ''
            GROUP BY ${AUDIENCE_ID}
            ORDER BY x_user_id ASC
            LIMIT ?) q) AS slot_ids,
         (SELECT json_group_array(json_object('x_user_id', q.x_user_id, 'x_name', q.x_name, 'icon_url', q.icon_url,
              'approval_status', q.approval_status, 'video_count', q.video_count)) FROM (
            SELECT v.creator_x_user_id AS x_user_id, xu.x_name AS x_name, xu.icon_url AS icon_url,
              xu.approval_status AS approval_status, COUNT(*) AS video_count
            FROM videos v
            INNER JOIN video_events ve ON ve.video_id = v.id
            LEFT JOIN x_users xu ON xu.id = v.creator_x_user_id
            WHERE ve.event_id = ? AND v.creator_x_user_id IS NOT NULL
            GROUP BY v.creator_x_user_id
            ORDER BY v.creator_x_user_id ASC
            LIMIT ?) q) AS submitters
       FROM events e WHERE e.id = ? LIMIT 1`,
    )
    .bind(eventId, eventId, MAX_AUDIENCE_SOURCE_ROWS + 1, eventId, MAX_AUDIENCE_SOURCE_ROWS + 1, eventId)
    .first<{
      id: string;
      title: string;
      accent_color: string | null;
      pending_count: number;
      slot_ids: string | null;
      submitters: string | null;
    }>();
  if (!row) return c.json({ error: "Not Found" }, 404);

  const slotRows = parseJsonColumn<SourceRow[]>(row.slot_ids, []);
  const submitterRows = parseJsonColumn<SourceRow[]>(row.submitters, []);
  const truncated = slotRows.length > MAX_AUDIENCE_SOURCE_ROWS || submitterRows.length > MAX_AUDIENCE_SOURCE_ROWS;

  const map = new Map<string, ManageAudienceRow>();
  for (const s of slotRows.slice(0, MAX_AUDIENCE_SOURCE_ROWS)) {
    if (!s.x_user_id) continue;
    map.set(s.x_user_id, {
      x_user_id: s.x_user_id,
      x_name: s.x_name,
      icon_url: s.icon_url,
      approval_status: s.approval_status,
      slot_count: Number(s.slot_count ?? 0),
      submitted_count: Number(s.submitted_count ?? 0),
      video_count: 0,
    });
  }
  for (const v of submitterRows.slice(0, MAX_AUDIENCE_SOURCE_ROWS)) {
    if (!v.x_user_id) continue;
    const existing = map.get(v.x_user_id);
    if (existing) {
      existing.video_count = Number(v.video_count ?? 0);
      if (!existing.x_name && v.x_name) existing.x_name = v.x_name;
      if (!existing.icon_url && v.icon_url) existing.icon_url = v.icon_url;
      if (!existing.approval_status && v.approval_status) existing.approval_status = v.approval_status;
    } else {
      map.set(v.x_user_id, {
        x_user_id: v.x_user_id,
        x_name: v.x_name,
        icon_url: v.icon_url,
        approval_status: v.approval_status,
        slot_count: 0,
        submitted_count: 0,
        video_count: Number(v.video_count ?? 0),
      });
    }
  }
  const sorted = Array.from(map.values()).sort((a, b) => {
    if (b.submitted_count !== a.submitted_count) return b.submitted_count - a.submitted_count;
    if (b.video_count !== a.video_count) return b.video_count - a.video_count;
    return b.slot_count - a.slot_count;
  });
  const audience = await Promise.all(
    sorted.map(async (r) => ({
      ...r,
      icon_url: await resolveManageXIconUrl({ iconUrl: r.icon_url, approvalStatus: r.approval_status, authSecret: c.env.AUTH_SECRET }),
    })),
  );
  const body: ManageAudienceResponse = {
    isAdmin: snapshot.isAdmin,
    event: { id: row.id, title: row.title, accent_color: row.accent_color },
    pendingCount: Number(row.pending_count ?? 0),
    audience,
    truncated,
  };
  return c.json(body);
});
