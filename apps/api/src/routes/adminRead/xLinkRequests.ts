import { Hono } from "hono";
import type {
  AdminXLinkAuditRow,
  AdminXLinkRejectedRow,
  AdminXLinkRequestRow,
  AdminXLinkRequestsResponse,
} from "@flamenode/contracts";
import { normalizeXId } from "@flamenode/domain/xid";
import type { AppEnv } from "../../env.ts";
import { resolveManageXIconUrl } from "../manage/icon.ts";
import { parseJsonColumn } from "../personal/context.ts";
import { sqlNormalizeXId } from "./shared.ts";

// CURRENT: app/(admin)/admin/x-link-requests/page.tsx + src/lib/admin/enrichXLinkPendingRows.ts (no video icon fallback,
// as the page calls it without options). D1 (S2, 2 statements + session = 3): (1) pending (100) + rejected (10) with the
// x_users lookups as correlated subqueries (canonical id first, legacy lower(trim(id)) only when canonical misses),
// (2) audit rows (30). No try/catch in CURRENT -> D1 failure is 503. AUTH_SECRET missing -> internal icons null (CURRENT).
export const ADMIN_XLINK_PENDING_LIMIT = 100;
export const ADMIN_XLINK_REJECTED_LIMIT = 10;
export const ADMIN_XLINK_AUDIT_LIMIT = 30;
/** parse inputs above this are treated as unparsed (ZERO_1102 S2 64 KiB); CURRENT parses any size. */
const MAX_AUDIT_PAYLOAD_CHARS = 64 * 1024;
const LINK_TYPES = ["new_link", "existing_link", "alias"];

const XUSER = ["x_name", "icon_url", "approval_status"] as const;
function xUserLookup(idExpr: string): string {
  const canonical = `(SELECT json_object(${XUSER.map((c) => `'${c}', ${c}`).join(", ")}) FROM x_users WHERE id = ${idExpr} ORDER BY id LIMIT 1)`;
  const legacy = `(SELECT json_object(${XUSER.map((c) => `'${c}', ${c}`).join(", ")}) FROM x_users WHERE ${sqlNormalizeXId("id")} = ${idExpr} ORDER BY id LIMIT 1)`;
  return `CASE WHEN ${idExpr} = '' THEN NULL ELSE COALESCE(${canonical}, ${legacy}) END`;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "__undefined__";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseObject(raw: string | null): { ok: boolean; value: Record<string, unknown> } {
  if (!raw) return { ok: true, value: {} };
  if (raw.length > MAX_AUDIT_PAYLOAD_CHARS) return { ok: false, value: {} };
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) return { ok: true, value: value as Record<string, unknown> };
    return { ok: true, value: { value } };
  } catch {
    return { ok: false, value: {} };
  }
}

/** CURRENT parseAuditDiff(...).changedKeys (src/lib/audit/diff.ts). */
export function auditChangedKeys(beforeRaw: string | null, afterRaw: string | null): string[] {
  const before = parseObject(beforeRaw);
  const after = parseObject(afterRaw);
  if (!before.ok || !after.ok) return [];
  const keys = Array.from(new Set([...Object.keys(before.value), ...Object.keys(after.value)])).sort();
  const changed: string[] = [];
  for (const key of keys) {
    const b = Object.hasOwn(before.value, key) ? stableStringify(before.value[key]) : "__missing__";
    const a = Object.hasOwn(after.value, key) ? stableStringify(after.value[key]) : "__missing__";
    if (a !== b) changed.push(key);
  }
  return changed;
}

interface XInfo {
  x_name: string;
  icon_url: string | null;
  approval_status: string | null;
}
interface PendingJson {
  id: string;
  requested_x_id: string | null;
  requested_by_auth_user_id: string;
  discord_name: string | null;
  discord_image: string | null;
  requested_at: number;
  request_type: string;
  target_x_user_id: string | null;
  requested_x: string | null;
  target_x: string | null;
}

export const adminXLinkRequestsRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const db = c.env.DB;
  const typeMarks = LINK_TYPES.map(() => "?").join(", ");
  const reqNorm = sqlNormalizeXId("r.requested_x_id");
  const tgtNorm = sqlNormalizeXId("r.target_x_user_id");
  const head = await db
    .prepare(
      `SELECT
         (SELECT json_group_array(json_object('id', q.id, 'requested_x_id', q.requested_x_id,
              'requested_by_auth_user_id', q.requested_by_auth_user_id, 'discord_name', q.discord_name,
              'discord_image', q.discord_image, 'requested_at', q.requested_at, 'request_type', q.request_type,
              'target_x_user_id', q.target_x_user_id, 'requested_x', json(q.requested_x), 'target_x', json(q.target_x)))
            FROM (
              SELECT r.id AS id, r.requested_x_id AS requested_x_id, r.requested_by_auth_user_id AS requested_by_auth_user_id,
                u.name AS discord_name, u.image AS discord_image, r.requested_at AS requested_at,
                r.request_type AS request_type, r.target_x_user_id AS target_x_user_id,
                ${xUserLookup(reqNorm)} AS requested_x, ${xUserLookup(tgtNorm)} AS target_x
              FROM x_identity_requests r LEFT JOIN "user" u ON u.id = r.requested_by_auth_user_id
              WHERE r.status = 'pending' AND r.request_type IN (${typeMarks})
              ORDER BY r.requested_at DESC LIMIT ?) q) AS pending,
         (SELECT json_group_array(json_object('id', q.id, 'requested_x_id', q.requested_x_id,
              'requested_by_auth_user_id', q.requested_by_auth_user_id, 'request_type', q.request_type,
              'requested_at', q.requested_at))
            FROM (
              SELECT id, requested_x_id, requested_by_auth_user_id, request_type, requested_at
              FROM x_identity_requests
              WHERE status = 'rejected' AND request_type IN (${typeMarks})
              ORDER BY requested_at DESC LIMIT ?) q) AS rejected`,
    )
    .bind(...LINK_TYPES, ADMIN_XLINK_PENDING_LIMIT, ...LINK_TYPES, ADMIN_XLINK_REJECTED_LIMIT)
    .first<{ pending: string | null; rejected: string | null }>();
  const audit = await db
    .prepare(
      `SELECT id, table_name, operation, target_id, before_json, after_json, created_at FROM audit_logs
       WHERE table_name IN ('x_identity_requests', 'x_user_account_links', 'x_users')
         AND operation IN ('UPDATE', 'CREATE', 'DELETE')
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(ADMIN_XLINK_AUDIT_LIMIT)
    .all<{
      id: string;
      table_name: string;
      operation: string;
      target_id: string | null;
      before_json: string | null;
      after_json: string | null;
      created_at: number;
    }>();

  const secret = c.env.AUTH_SECRET;
  const pendingRows = parseJsonColumn<Array<Omit<PendingJson, "requested_x" | "target_x"> & { requested_x: XInfo | null; target_x: XInfo | null }>>(head?.pending, []);
  const pending: AdminXLinkRequestRow[] = await Promise.all(
    pendingRows.map(async (row) => {
      const requestedXId = normalizeXId(row.requested_x_id);
      const targetXId = normalizeXId(row.target_x_user_id);
      const requested = requestedXId ? row.requested_x : null;
      const target = targetXId ? row.target_x : null;
      const [requestedIcon, targetIcon] = await Promise.all([
        resolveManageXIconUrl({ iconUrl: requested?.icon_url, approvalStatus: requested?.approval_status ?? null, authSecret: secret }),
        resolveManageXIconUrl({ iconUrl: target?.icon_url, approvalStatus: target?.approval_status ?? null, authSecret: secret }),
      ]);
      return {
        id: row.id,
        requested_x_id: requestedXId || "",
        requested_by_auth_user_id: row.requested_by_auth_user_id,
        discord_name: row.discord_name,
        discord_image: row.discord_image,
        requested_at: row.requested_at,
        request_type: row.request_type,
        target_x_user_id: row.target_x_user_id,
        requested_x_name: requested?.x_name ?? null,
        requested_icon_url: requestedIcon,
        requested_approval_status: requested?.approval_status ?? null,
        target_icon_url: targetIcon,
        target_approval_status: target?.approval_status ?? null,
      };
    }),
  );
  const recentAudit: AdminXLinkAuditRow[] = audit.results.map((row) => ({
    id: row.id,
    table_name: row.table_name,
    operation: row.operation,
    target_id: row.target_id,
    created_at: row.created_at,
    changedKeys: auditChangedKeys(row.before_json, row.after_json).slice(0, 6),
  }));
  const body: AdminXLinkRequestsResponse = {
    pending,
    recentRejected: parseJsonColumn<AdminXLinkRejectedRow[]>(head?.rejected, []),
    recentAudit,
  };
  return c.json(body);
});
