/**
 * MIG-0605 U01: RH-001 GET /api/account/summary on Hono.
 * CURRENT: app/api/account/summary/route.ts + src/lib/auth/headerUser.ts +
 * src/lib/auth/currentUser.ts (account summary projection).
 *
 * Runtime S2: session (1 D1 read, MIG-0608) + linked/pending X rows (1) +
 * management check (1, skipped for admin / no approved X).
 * Every response (also logged-out) uses the CURRENT private no-store headers.
 */
import {
  normalizeXId,
  normalizeXIdApprovalStatus,
  xIdApprovalRank,
  type XIdEntry,
} from "@flamenode/domain/xid";
import {
  ALL_PERMISSION_KEYS,
  LEGACY_PERMISSION_KEY_ALIASES,
} from "@flamenode/domain/auth/permissions";
import { Hono } from "hono";
import type { Context } from "hono";
import { sessionMiddleware } from "../../auth/session.ts";
import type { SessionUser } from "../../auth/session.ts";
import type { AppEnv } from "../../env.ts";

export const ACCOUNT_SUMMARY_MAX_X_ROWS = 100;

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

// Presets of src/lib/auth/permissions/presets.ts with a non-empty permissions
// list (pinned against the CURRENT file by test).
export const PRESETS_WITH_PERMISSIONS = [
  "owner",
  "manager",
  "slot_manager",
  "content_editor",
  "reviewer",
  "xid_reviewer",
] as const;

type LinkedRow = {
  x_user_id: string;
  x_name: string | null;
  icon_url: string | null;
  approval_status: string | null;
};
type SqlRow = LinkedRow & { kind: "linked" | "pending" };

function respond(c: Context<AppEnv>, body: unknown, status: 200 | 503 = 200): Response {
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) {
    c.header(name, value);
  }
  return c.json(body, status);
}

/** CURRENT resolveActiveXUserId over already-loaded rows (no DB). */
export function resolveActiveXUserId(
  currentActive: string | null,
  rows: readonly Pick<LinkedRow, "x_user_id" | "approval_status">[],
): string | null {
  const normalizedCurrent = normalizeXId(currentActive) || null;
  const linked = new Map<string, string>();
  for (const row of rows) {
    if (row.approval_status !== "approved") continue;
    const normalized = normalizeXId(row.x_user_id);
    if (normalized && !linked.has(normalized)) linked.set(normalized, row.x_user_id);
  }
  if (linked.size === 0) return null;
  if (normalizedCurrent && linked.has(normalizedCurrent)) {
    return linked.get(normalizedCurrent) ?? null;
  }
  return linked.size === 1 ? (Array.from(linked.values())[0] ?? null) : null;
}

async function loadXRows(db: D1Database, userId: string): Promise<SqlRow[]> {
  const { results } = await db
    .prepare(
      `SELECT kind, x_user_id, x_name, icon_url, approval_status FROM (
         SELECT 'linked' AS kind, x.id AS x_user_id, x.x_name AS x_name,
                x.icon_url AS icon_url, x.approval_status AS approval_status
         FROM x_user_account_links l
         INNER JOIN x_users x ON x.id = l.x_user_id
         WHERE l.auth_user_id = ? LIMIT ${ACCOUNT_SUMMARY_MAX_X_ROWS}
       )
       UNION ALL
       SELECT kind, x_user_id, x_name, icon_url, approval_status FROM (
         SELECT 'pending' AS kind, requested_x_id AS x_user_id, NULL AS x_name,
                NULL AS icon_url, NULL AS approval_status
         FROM x_identity_requests
         WHERE requested_by_auth_user_id = ? AND status = 'pending'
         LIMIT ${ACCOUNT_SUMMARY_MAX_X_ROWS}
       )`,
    )
    .bind(userId, userId)
    .all<SqlRow>();
  return results;
}

async function loadLinkedOnly(db: D1Database, userId: string): Promise<LinkedRow[]> {
  const { results } = await db
    .prepare(
      `SELECT x.id AS x_user_id, x.x_name AS x_name, x.icon_url AS icon_url,
              x.approval_status AS approval_status
       FROM x_user_account_links l
       INNER JOIN x_users x ON x.id = l.x_user_id
       WHERE l.auth_user_id = ? LIMIT ${ACCOUNT_SUMMARY_MAX_X_ROWS}`,
    )
    .bind(userId)
    .all<LinkedRow>();
  return results;
}

const PERMISSION_KEY_INPUTS_JSON = JSON.stringify([
  ...ALL_PERMISSION_KEYS,
  ...LEGACY_PERMISSION_KEY_ALIASES,
]);

/** CURRENT hasEditableEventByApprovedXIds (one bounded existence query). */
async function hasEditableEvent(
  db: D1Database,
  approvedXIds: readonly string[],
): Promise<boolean> {
  const xIds = Array.from(new Set(approvedXIds.map((v) => v.trim()).filter(Boolean)));
  if (xIds.length === 0) return false;
  const inList = xIds.length <= 80;
  const xCondition = inList
    ? `x_user_id IN (${xIds.map(() => "?").join(", ")})`
    : `x_user_id IN (SELECT CAST(value AS TEXT) FROM json_each(?) WHERE value IS NOT NULL)`;
  const xParams: unknown[] = inList ? xIds : [JSON.stringify(xIds)];
  const presets = PRESETS_WITH_PERMISSIONS.map((p) => `'${p}'`).join(", ");
  const row = await db
    .prepare(
      `SELECT event_id FROM event_staff
       WHERE ${xCondition}
         AND (
           permission_preset IN (${presets})
           OR (
             permission_preset = 'custom'
             AND EXISTS (
               SELECT 1 FROM json_each(
                 CASE
                   WHEN json_valid(custom_permission_keys_json)
                     THEN CASE
                       WHEN json_type(custom_permission_keys_json) = 'array'
                         THEN custom_permission_keys_json
                       ELSE '[]'
                     END
                   ELSE '[]'
                 END
               ) AS custom_permission
               WHERE custom_permission.type = 'text'
                 AND custom_permission.value IN (SELECT value FROM json_each(?))
             )
           )
         )
       LIMIT 1`,
    )
    .bind(...xParams, PERMISSION_KEY_INPUTS_JSON)
    .first();
  return row !== null;
}

function degradedBody(
  user: SessionUser,
  resolvedActive: string | null,
  linked: readonly LinkedRow[],
) {
  const xIds = linked.map((entry) => ({
    x_user_id: entry.x_user_id,
    x_name: entry.x_name?.trim() || `@${entry.x_user_id}`,
    icon_url: entry.icon_url,
    approval_status: normalizeXIdApprovalStatus(entry.approval_status),
    is_active: entry.x_user_id === resolvedActive,
  }));
  return {
    loggedIn: true,
    degraded: true,
    displayName: user.name,
    icon: user.image,
    role: user.role,
    activeXId: resolvedActive,
    xIds,
    canAccessAdmin: user.role === "admin",
    canAccessManage: user.role === "admin",
  };
}

export const accountSummaryRoutes = new Hono<AppEnv>();
accountSummaryRoutes.use("*", sessionMiddleware() as never);

accountSummaryRoutes.get("/", async (c) => {
  const url = new URL(c.req.url);
  const user = c.get("user");
  const unavailable = c.get("sessionState") === "unavailable";

  if (url.searchParams.get("view") === "presence") {
    if (unavailable) {
      return respond(c, { view: "presence", loggedIn: false, unavailable: true }, 503);
    }
    if (!user || user.is_banned === 1) {
      return respond(c, { view: "presence", loggedIn: false });
    }
    return respond(c, {
      view: "presence",
      loggedIn: true,
      displayName: user.name?.trim() || "guest",
      icon: user.image ?? null,
    });
  }

  if (unavailable) return respond(c, { loggedIn: false, unavailable: true }, 503);
  if (!user || user.is_banned === 1) return respond(c, { loggedIn: false });

  const db = c.env.DB;
  let rows: SqlRow[];
  try {
    rows = await loadXRows(db, user.id);
  } catch {
    // CURRENT: the pending-request query is auxiliary; fall back to the
    // authoritative linked rows (degraded). If those fail too -> 503.
    let linked: LinkedRow[];
    try {
      linked = await loadLinkedOnly(db, user.id);
    } catch {
      console.error("[account-summary] linked X read failed");
      return respond(c, { loggedIn: false, unavailable: true }, 503);
    }
    const active = resolveActiveXUserId(user.active_x_user_id, linked);
    return respond(c, degradedBody(user, active, linked));
  }

  const linked = rows.filter((row) => row.kind === "linked");
  // CURRENT loadCurrentUserContext resolves the active X first, then
  // buildHeaderUser resolves it again from that snapshot.
  const contextActive = resolveActiveXUserId(user.active_x_user_id, linked);
  const approved = linked.filter((row) => row.approval_status === "approved");

  const byId = new Map<string, XIdEntry>();
  for (const row of linked) {
    const id = normalizeXId(row.x_user_id);
    if (!id) continue;
    const entry: XIdEntry = {
      x_user_id: id,
      x_name: row.x_name?.trim() || `@${id}`,
      icon_url: row.icon_url,
      approval_status: normalizeXIdApprovalStatus(row.approval_status),
      is_active: false,
    };
    const existing = byId.get(id);
    if (
      !existing ||
      xIdApprovalRank(entry.approval_status) < xIdApprovalRank(existing.approval_status)
    ) {
      byId.set(id, entry);
    }
  }
  for (const row of rows) {
    if (row.kind !== "pending") continue;
    const id = normalizeXId(row.x_user_id);
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      x_user_id: id,
      x_name: `@${id}`,
      icon_url: null,
      approval_status: "pending",
      is_active: false,
    });
  }

  const headerActive =
    normalizeXId(resolveActiveXUserId(normalizeXId(contextActive) || null, approved)) ||
    null;
  const xIds = Array.from(byId.values()).map((entry) => ({
    ...entry,
    is_active: entry.approval_status !== "rejected" && entry.x_user_id === headerActive,
  }));

  const canAccessAdmin = user.role === "admin";
  let canAccessManage: boolean;
  try {
    canAccessManage = canAccessAdmin
      ? true
      : await hasEditableEvent(db, Array.from(new Set(approved.map((r) => r.x_user_id))));
  } catch {
    console.error("[account-summary] management check failed");
    return respond(c, degradedBody(user, contextActive, linked));
  }

  const activeEntry = xIds.find((entry) => entry.is_active);
  return respond(c, {
    loggedIn: true,
    displayName: user.name?.trim() || "guest",
    icon: user.image,
    role: user.role,
    activeXId: activeEntry?.x_user_id ?? contextActive ?? null,
    xIds,
    canAccessAdmin,
    canAccessManage,
  });
});
