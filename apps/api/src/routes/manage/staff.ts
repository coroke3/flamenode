import { Hono } from "hono";
import type { ManageStaffMember, ManageStaffResponse } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { parseJsonColumn } from "../personal/context.ts";
import { resolveManageXIconUrl } from "./icon.ts";
import { loadManageSnapshot, manageGate, resolveStaffPermissionKeys } from "./access.ts";

// CURRENT: app/(manage)/manage/events/[id]/staff/page.tsx.
// Authorization (CURRENT): the event must exist and the caller must be admin or hold a staff permission on it
// (otherwise notFound -> 404). The member editor needs event.members (canManageMembers); everyone else is read-only.
// D1 (S2, <= 3 statements incl. the session lookup): staff snapshot (admins skip it), then one statement.
const MAX_STAFF_MEMBERS = 100;

const MEMBER_COLUMNS = [
  "id",
  "x_user_id",
  "display_name",
  "permission_preset",
  "custom_permission_keys_json",
  "is_public",
  "public_role_label",
  "x_name",
  "icon_url",
  "approval_status",
] as const;

interface MemberRow {
  id: string;
  x_user_id: string | null;
  display_name: string;
  permission_preset: string | null;
  custom_permission_keys_json: string | null;
  is_public: number;
  public_role_label: string | null;
  x_name: string | null;
  icon_url: string | null;
  approval_status: string | null;
}

export const manageStaffRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const eventId = c.req.param("id") ?? "";
  const db = c.env.DB;

  const snapshot = await loadManageSnapshot(db, user);
  const denied = manageGate(c, snapshot);
  if (denied) return denied;
  const permissions = snapshot.permissionsByEvent.get(eventId);
  if (!snapshot.isAdmin && (!permissions || permissions.size === 0)) {
    return c.json({ error: "Not Found" }, 404);
  }

  const row = await db
    .prepare(
      `SELECT e.id AS id, e.title AS title, e.accent_color AS accent_color,
         (SELECT COUNT(*) FROM video_events ve INNER JOIN videos v ON v.id = ve.video_id
           WHERE ve.event_id = ? AND v.visibility_status = 'pending') AS pending_count,
         -- CURRENT summary counts cover ALL event staff, not only the first 100
         -- display rows. Keep this a single D1 statement (ZERO_1102 S2).
         (SELECT json_object(
            'ownerCount', COALESCE(SUM(CASE WHEN total.permission_preset = 'owner' THEN 1 ELSE 0 END), 0),
            'publicCount', COALESCE(SUM(CASE WHEN total.is_public = 1 THEN 1 ELSE 0 END), 0),
            'approvedCount', COALESCE(SUM(CASE WHEN linked.approval_status = 'approved' THEN 1 ELSE 0 END), 0)
          ) FROM event_staff total
          LEFT JOIN x_users linked ON linked.id = total.x_user_id
          WHERE total.event_id = e.id) AS member_counts,
         (SELECT json_group_array(json_object(${MEMBER_COLUMNS.map((col) => `'${col}', q.${col}`).join(", ")})) FROM (
            SELECT es.id AS id, es.x_user_id AS x_user_id, es.display_name AS display_name,
              es.permission_preset AS permission_preset,
              es.custom_permission_keys_json AS custom_permission_keys_json,
              es.is_public AS is_public, es.public_role_label AS public_role_label,
              xu.x_name AS x_name, xu.icon_url AS icon_url, xu.approval_status AS approval_status
            FROM event_staff es
            LEFT JOIN x_users xu ON xu.id = es.x_user_id
            WHERE es.event_id = ?
            ORDER BY es.display_name ASC, es.id ASC
            LIMIT ?) q) AS members
       FROM events e WHERE e.id = ? LIMIT 1`,
    )
    .bind(eventId, eventId, MAX_STAFF_MEMBERS + 1, eventId)
    .first<{ id: string; title: string; accent_color: string | null; pending_count: number; member_counts: string; members: string | null }>();
  if (!row) return c.json({ error: "Not Found" }, 404);

  // Unlike the bounded member array, these counts represent every member of the event.
  const counts = parseJsonColumn<{ ownerCount: number; publicCount: number; approvedCount: number }>(
    row.member_counts, { ownerCount: 0, publicCount: 0, approvedCount: 0 },
  );
  const all = parseJsonColumn<MemberRow[]>(row.members, []);
  const membersTruncated = all.length > MAX_STAFF_MEMBERS;
  const rows = membersTruncated ? all.slice(0, MAX_STAFF_MEMBERS) : all;
  const members: ManageStaffMember[] = await Promise.all(
    rows.map(async (member) => ({
      id: member.id,
      x_user_id: member.x_user_id,
      display_name: member.display_name,
      permission_preset: member.permission_preset,
      is_public: member.is_public,
      public_role_label: member.public_role_label,
      permission_keys: Array.from(resolveStaffPermissionKeys(member)),
      x_name: member.x_name,
      icon_url: await resolveManageXIconUrl({
        iconUrl: member.icon_url,
        approvalStatus: member.approval_status,
        authSecret: c.env.AUTH_SECRET,
      }),
    })),
  );
  const body: ManageStaffResponse = {
    event: { id: row.id, title: row.title, accent_color: row.accent_color },
    isAdmin: snapshot.isAdmin,
    canManageMembers: snapshot.isAdmin || (permissions?.has("event.members") ?? false),
    pendingCount: Number(row.pending_count ?? 0),
    members,
    ownerCount: counts.ownerCount,
    publicCount: counts.publicCount,
    approvedCount: counts.approvedCount,
    membersTruncated,
  };
  return c.json(body);
});
