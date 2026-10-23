import { Hono } from "hono";
import type {
  AdminPermissionSettings,
  AdminUserDetailAuditRow,
  AdminUserDetailLinkRequest,
  AdminUserDetailResponse,
  AdminUserDetailVideo,
  AdminUserDetailXId,
  AdminUserRow,
  AdminUsersRedirectResponse,
  AdminUsersResponse,
  AdminUsersView,
  AdminXUserRow,
} from "@flamenode/contracts";
import { normalizeXId } from "@flamenode/domain/xid";
import type { AppEnv } from "../../env.ts";
import {
  parseJsonColumn,
  TERMS_REACCEPT_REQUIRED_CASE_SQL,
  TERMS_REACCEPT_REQUIRED_CTE_SQL,
} from "../personal/context.ts";
import {
  ADMIN_USERS_PAGE_SIZE,
  ADMIN_USER_DETAIL_AUDIT_LIMIT,
  ADMIN_USER_DETAIL_LINKED_X_LIMIT,
  ADMIN_USER_DETAIL_LINK_REQUESTS_LIMIT,
  ADMIN_USER_DETAIL_VIDEOS_LIMIT,
  clampPage,
  escapeLike,
  sqlNormalizeXId,
} from "./shared.ts";

// CURRENT: app/(admin)/admin/users/page.tsx and users/[id]/page.tsx. GET only.
// users list: 1 D1 statement (+ session) for every view. users/[id]: 2 statements (+ session) = 3.
// The list page wraps its reads in try/catch and renders the empty page, so a D1 failure is 200 + degraded;
// the detail page has no try/catch (error page -> 503 via the router onError).

const USER_COLUMNS = [
  "id",
  "name",
  "image",
  "role",
  "is_banned",
  "can_create_events",
  "active_x_user_id",
  "active_x_name",
  "created_at",
] as const;
const XUSER_COLUMNS = [
  "id",
  "x_name",
  "approval_status",
  "primary_auth_user_id",
  "primary_auth_user_name",
  "linked_auth_user_count",
  "active_holder_count",
] as const;

const jsonObject = (columns: readonly string[]) => columns.map((name) => `'${name}', r.${name}`).join(", ");

const STATUS_FILTERS: Record<string, string> = {
  banned: "u.is_banned = 1",
  admin: "u.role = 'admin'",
  moderator: "u.role = 'moderator'",
  active: "u.is_banned = 0",
  can_create_events: "u.can_create_events = 1",
  tos_not_accepted: "u.is_tos_accepted = 0",
  no_active_x: "u.active_x_user_id IS NULL",
};

const EMPTY_PERMISSIONS: AdminPermissionSettings = { default_editable_fields: null, upcoming_editable_fields: null };

interface Fragment {
  sql: string;
  params: unknown[];
}

/** "user" tab: Discord principals (CURRENT `discord_id IS NOT NULL`) filtered by q / status. */
function discordFilter(q: string, status: string): Fragment {
  const rawQuery = q.trim();
  const lowerTerm = `%${escapeLike(rawQuery).toLowerCase()}%`;
  const xTerm = `%${escapeLike(normalizeXId(rawQuery) || rawQuery).toLowerCase()}%`;
  const conds = ["u.discord_id IS NOT NULL"];
  const params: unknown[] = [];
  if (q) {
    conds.push(`(lower(u.name) LIKE ? OR lower(u.email) LIKE ? OR u.id = ? OR EXISTS (
        SELECT 1 FROM x_user_account_links active_link
        INNER JOIN x_users active_x ON active_x.id = active_link.x_user_id
        WHERE active_link.auth_user_id = u.id
          AND active_x.approval_status = 'approved'
          AND lower(active_x.id) = lower(u.active_x_user_id)
          AND (lower(active_x.id) LIKE ? OR lower(active_x.x_name) LIKE ?)))`);
    params.push(lowerTerm, lowerTerm, q, xTerm, lowerTerm);
  }
  const statusSql = Object.hasOwn(STATUS_FILTERS, status) ? STATUS_FILTERS[status] : undefined;
  if (statusSql) conds.push(statusSql);
  return { sql: conds.join(" AND "), params };
}

/** "xid" tab: x_users filtered by q. */
function xidFilter(q: string): Fragment {
  if (!q) return { sql: "1 = 1", params: [] };
  const rawQuery = q.trim();
  const lowerTerm = `%${escapeLike(rawQuery).toLowerCase()}%`;
  const xTerm = `%${escapeLike(normalizeXId(rawQuery) || rawQuery).toLowerCase()}%`;
  return {
    sql: `(lower(x.id) LIKE ? OR lower(x.x_name) LIKE ? OR EXISTS (
        SELECT 1 FROM x_user_account_links link
        INNER JOIN "user" auth_user ON auth_user.id = link.auth_user_id
        WHERE link.x_user_id = x.id
          AND (lower(COALESCE(auth_user.name, '')) LIKE ? OR auth_user.id = ?)))`,
    params: [xTerm, lowerTerm, lowerTerm, rawQuery],
  };
}

export const adminUsersRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const q = c.req.query("q") ?? "";
    const status = c.req.query("status") ?? "";
    const view = c.req.query("view") ?? "discord";
    if (view === "links") {
      const redirect: AdminUsersRedirectResponse = { redirect: "/admin/x-link-requests" };
      return c.json(redirect);
    }
    const activeView: AdminUsersView = view === "xid" || view === "permissions" ? view : "discord";
    const { page, pageSize, offset } = clampPage(c.req.query("page") || "1", ADMIN_USERS_PAGE_SIZE);
    const db = c.env.DB;

    let users: AdminUserRow[] = [];
    let xUsers: AdminXUserRow[] = [];
    let permissionSettings = EMPTY_PERMISSIONS;
    let total = 0;
    let degraded = false;
    try {
      if (activeView === "permissions") {
        const row = await db
          .prepare(
            `SELECT default_editable_fields, upcoming_editable_fields FROM system_settings WHERE id = 'default' LIMIT 1`,
          )
          .first<AdminPermissionSettings>();
        if (row) {
          permissionSettings = {
            default_editable_fields: row.default_editable_fields,
            upcoming_editable_fields: row.upcoming_editable_fields,
          };
        }
      } else if (activeView === "xid") {
        const filter = xidFilter(q);
        // CURRENT loadAdminXUserEnrichment as correlated subqueries: owner first -> created_at asc -> auth_user_id asc;
        // primary name skips orphan links; the active holder count needs an existing user whose active X matches.
        const order = `CASE WHEN l.link_role = 'owner' THEN 0 ELSE 1 END, l.created_at, l.auth_user_id`;
        const row = await db
          .prepare(
            `SELECT (SELECT COUNT(*) FROM x_users x WHERE ${filter.sql}) AS total,
               (SELECT json_group_array(json_object(${jsonObject(XUSER_COLUMNS)})) FROM (
                  SELECT x.id AS id, x.x_name AS x_name, x.approval_status AS approval_status,
                    (SELECT l.auth_user_id FROM x_user_account_links l WHERE l.x_user_id = x.id ORDER BY ${order} LIMIT 1) AS primary_auth_user_id,
                    (SELECT au.name FROM x_user_account_links l INNER JOIN "user" au ON au.id = l.auth_user_id
                      WHERE l.x_user_id = x.id ORDER BY ${order} LIMIT 1) AS primary_auth_user_name,
                    (SELECT COUNT(*) FROM x_user_account_links l WHERE l.x_user_id = x.id) AS linked_auth_user_count,
                    (SELECT COUNT(DISTINCT l.auth_user_id) FROM x_user_account_links l
                      INNER JOIN "user" au ON au.id = l.auth_user_id
                      WHERE l.x_user_id = x.id AND au.active_x_user_id IS NOT NULL
                        AND ${sqlNormalizeXId("au.active_x_user_id")} = ${sqlNormalizeXId("x.id")}) AS active_holder_count
                  FROM x_users x WHERE ${filter.sql}
                  ORDER BY x.id LIMIT ? OFFSET ?) r) AS rows`,
          )
          .bind(...filter.params, ...filter.params, pageSize, offset)
          .first<{ total: number; rows: string | null }>();
        total = Number(row?.total ?? 0);
        // icon_url: CURRENT reads the R2 public icon map; not reproduced (handoff), so it is null here.
        xUsers = parseJsonColumn<Omit<AdminXUserRow, "icon_url">[]>(row?.rows, []).map((r) => ({ ...r, icon_url: null }));
      } else {
        const filter = discordFilter(q, status);
        const activeName = `(SELECT x.x_name FROM x_user_account_links l INNER JOIN x_users x ON x.id = l.x_user_id
            WHERE l.auth_user_id = u.id AND x.approval_status = 'approved'
              AND ${sqlNormalizeXId("u.active_x_user_id")} <> ''
              AND ${sqlNormalizeXId("x.id")} = ${sqlNormalizeXId("u.active_x_user_id")}
            ORDER BY x.id LIMIT 1)`;
        const row = await db
          .prepare(
            `SELECT (SELECT COUNT(*) FROM "user" u WHERE ${filter.sql}) AS total,
               (SELECT json_group_array(json_object(${jsonObject(USER_COLUMNS)})) FROM (
                  SELECT u.id AS id, u.name AS name, u.image AS image, u.role AS role, u.is_banned AS is_banned,
                    u.can_create_events AS can_create_events, u.active_x_user_id AS active_x_user_id,
                    ${activeName} AS active_x_name, u.created_at AS created_at
                  FROM "user" u WHERE ${filter.sql}
                  ORDER BY u.created_at DESC LIMIT ? OFFSET ?) r) AS rows`,
          )
          .bind(...filter.params, ...filter.params, pageSize, offset)
          .first<{ total: number; rows: string | null }>();
        total = Number(row?.total ?? 0);
        users = parseJsonColumn<AdminUserRow[]>(row?.rows, []);
      }
    } catch {
      console.error("[adminRead:users] READ_FAILED");
      degraded = true;
      users = [];
      xUsers = [];
      total = 0;
      permissionSettings = EMPTY_PERMISSIONS;
    }

    const body: AdminUsersResponse = {
      view: activeView,
      q,
      status,
      paging: { page, pageSize, total },
      users,
      xUsers,
      permissionSettings,
      degraded,
    };
    return c.json(body);
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const db = c.env.DB;
    const L = (columns: readonly string[]) => columns.map((name) => `'${name}', r.${name}`).join(", ");

    // Statement 1: the user row (all-columns select in CURRENT, only rendered ones here) + terms re-accept flag
    // (getLatestPublishedMajorTerms/termsReacceptRequiredValue) + every list the page shows, each a bounded JSON column.
    const detail = await db
      .prepare(
        `${TERMS_REACCEPT_REQUIRED_CTE_SQL}
         SELECT u.id AS id, u.name AS name, u.email AS email, u."emailVerified" AS emailVerified,
           u.discord_id AS discord_id, u.role AS role, u.can_create_events AS can_create_events,
           u.is_tos_accepted AS is_tos_accepted, u.is_banned AS is_banned,
           u.is_notification_enabled AS is_notification_enabled, u.active_x_user_id AS active_x_user_id,
           u.created_at AS created_at,
           ${TERMS_REACCEPT_REQUIRED_CASE_SQL} AS terms_reaccept_required,
           (SELECT json_group_array(json_object(${L(["id", "x_name", "icon_url", "approval_status"])})) FROM (
              SELECT x_users.id AS id, x_users.x_name AS x_name, x_users.icon_url AS icon_url,
                x_users.approval_status AS approval_status
              FROM x_user_account_links INNER JOIN x_users ON x_users.id = x_user_account_links.x_user_id
              WHERE x_user_account_links.auth_user_id = u.id
              ORDER BY x_users.id LIMIT ?) r) AS x_ids,
           (SELECT json_group_array(json_object(${L(["id", "title", "status", "created_at"])})) FROM (
              SELECT id, title, visibility_status AS status, created_at FROM videos
              WHERE submitted_by_user_id = u.id ORDER BY created_at DESC LIMIT ?) r) AS recent_videos,
           (SELECT json_group_array(json_object(${L(["id", "requested_x_id", "link_type", "target_x_user_id", "status", "requested_at"])})) FROM (
              SELECT id, requested_x_id, request_type AS link_type, target_x_user_id, status, requested_at
              FROM x_identity_requests WHERE requested_by_auth_user_id = u.id
              ORDER BY requested_at DESC LIMIT ?) r) AS link_requests,
           (SELECT json_group_array(json_object('interaction_type', r.interaction_type, 'c', r.c)) FROM (
              SELECT interaction_type, COUNT(*) AS c FROM video_interactions
              WHERE u.active_x_user_id IS NOT NULL AND u.active_x_user_id <> '' AND x_user_id = u.active_x_user_id
              GROUP BY interaction_type) r) AS interactions
         FROM "user" u WHERE u.id = ? LIMIT 1`,
      )
      .bind(
        ADMIN_USER_DETAIL_LINKED_X_LIMIT,
        ADMIN_USER_DETAIL_VIDEOS_LIMIT,
        ADMIN_USER_DETAIL_LINK_REQUESTS_LIMIT,
        id,
      )
      .first<
        AdminUserDetailResponse["user"] & {
          x_ids: string | null;
          recent_videos: string | null;
          link_requests: string | null;
          interactions: string | null;
        }
      >();
    if (!detail) return c.json({ error: "Not Found" }, 404);

    // Statement 2: audit rows the page shows (CURRENT select() all columns; only rendered columns are read).
    const auditColumns = "id, created_at, table_name, operation, actor_user_id, target_id";
    const audit = await db
      .prepare(
        `SELECT 'operator' AS kind, a.* FROM (SELECT ${auditColumns} FROM audit_logs WHERE actor_user_id = ?
           ORDER BY created_at DESC LIMIT ?) a
         UNION ALL
         SELECT 'target' AS kind, b.* FROM (SELECT ${auditColumns} FROM audit_logs WHERE target_id = ?
           ORDER BY created_at DESC LIMIT ?) b`,
      )
      .bind(detail.id, ADMIN_USER_DETAIL_AUDIT_LIMIT, detail.id, ADMIN_USER_DETAIL_AUDIT_LIMIT)
      .all<AdminUserDetailAuditRow & { kind: "operator" | "target" }>();
    const auditRow = ({ kind: _kind, ...row }: AdminUserDetailAuditRow & { kind: string }): AdminUserDetailAuditRow => row;

    const interactions = parseJsonColumn<{ interaction_type: string; c: number }[]>(detail.interactions, []);
    let likeCount = 0;
    let bookmarkCount = 0;
    for (const r of interactions) {
      if (r.interaction_type === "like") likeCount = Number(r.c ?? 0);
      if (r.interaction_type === "bookmark") bookmarkCount = Number(r.c ?? 0);
    }

    const body: AdminUserDetailResponse = {
      user: {
        id: detail.id,
        name: detail.name,
        email: detail.email,
        emailVerified: detail.emailVerified,
        discord_id: detail.discord_id,
        role: detail.role,
        can_create_events: detail.can_create_events,
        is_tos_accepted: detail.is_tos_accepted,
        terms_reaccept_required: detail.terms_reaccept_required === 1 ? 1 : 0,
        is_banned: detail.is_banned,
        is_notification_enabled: detail.is_notification_enabled,
        active_x_user_id: detail.active_x_user_id,
        created_at: detail.created_at,
      },
      xIds: parseJsonColumn<AdminUserDetailXId[]>(detail.x_ids, []),
      recentVideos: parseJsonColumn<AdminUserDetailVideo[]>(detail.recent_videos, []),
      recentByOperator: audit.results.filter((r) => r.kind === "operator").map(auditRow),
      recentOnUser: audit.results.filter((r) => r.kind === "target").map(auditRow),
      likeCount,
      bookmarkCount,
      linkRequests: parseJsonColumn<AdminUserDetailLinkRequest[]>(detail.link_requests, []),
    };
    return c.json(body);
  });
