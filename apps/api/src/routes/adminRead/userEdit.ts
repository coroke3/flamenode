import { Hono } from "hono";
import type { AdminUserEditResponse } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { parseJsonColumn } from "../personal/context.ts";
import { ADMIN_USER_DETAIL_LINKED_X_LIMIT } from "./shared.ts";

// CURRENT: app/(admin)/admin/users/[id]/edit/page.tsx.
// D1: S2 budget <= 3 statements incl. session: statement 1 fetches user fields and correlated linked X user IDs.
interface RawUserEditRow {
  id: string;
  name: string | null;
  role: "user" | "admin" | "moderator";
  is_banned: number;
  can_create_events: number;
  is_notification_enabled: number;
  x_user_ids: string | null;
}

export const adminUserEditRoutes = new Hono<AppEnv>().get("/:id/edit", async (c) => {
  const userId = c.req.param("id");
  const db = c.env.DB;

  const row = await db
    .prepare(
      `SELECT u.id AS id, u.name AS name, coalesce(u.role, 'user') AS role,
         coalesce(u.is_banned, 0) AS is_banned,
         coalesce(u.can_create_events, 0) AS can_create_events,
         coalesce(u.is_notification_enabled, 1) AS is_notification_enabled,
         (SELECT json_group_array(r.x_user_id) FROM (
            SELECT DISTINCT x_users.id AS x_user_id
            FROM x_user_account_links
            INNER JOIN x_users ON x_users.id = x_user_account_links.x_user_id
            WHERE x_user_account_links.auth_user_id = u.id
            ORDER BY x_users.id
            LIMIT ?
          ) r) AS x_user_ids
       FROM "user" u
       WHERE u.id = ?
       LIMIT 1`,
    )
    .bind(ADMIN_USER_DETAIL_LINKED_X_LIMIT + 1, userId)
    .first<RawUserEditRow>();

  if (!row) return c.json({ error: "Not Found" }, 404);

  // CURRENT reads every linked X ID; the API caps at the shared limit and says so (Work Order U03).
  const linkedXUserIds = parseJsonColumn<string[]>(row.x_user_ids, []) ?? [];
  const xUserIds = linkedXUserIds.slice(0, ADMIN_USER_DETAIL_LINKED_X_LIMIT);

  const body: AdminUserEditResponse = {
    user: {
      id: row.id,
      name: row.name,
      role: row.role,
      is_banned: row.is_banned,
      can_create_events: row.can_create_events,
      is_notification_enabled: row.is_notification_enabled,
    },
    xUserIds,
    truncated: linkedXUserIds.length > ADMIN_USER_DETAIL_LINKED_X_LIMIT,
  };

  return c.json(body);
});
