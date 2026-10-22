import { Hono } from "hono";
import type {
  AdminAuditDetailResponse,
  AdminAuditListResponse,
  AdminAuditRestoreResponse,
} from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";

// MIG-0626 audit-log admin screens (CURRENT app/(admin)/admin/audit/**). The views show audit rows as stored:
// before/after payloads were redacted when written (src/lib/audit/snapshot.ts), and no column is added here.
// D1 budget: list = session + rows + actor join (3); detail = session + row + prev/next (3); restore = session + 1.

/** CURRENT audit/page.tsx MAX_LIMIT / DEFAULT_LIMIT. */
const MAX_AUDIT_LIMIT = 100;
const DEFAULT_AUDIT_LIMIT = 50;
/** ZERO_1102 S2 response budget for the list (64 KiB minus room for the operator rows and envelope). */
const MAX_AUDIT_LIST_BYTES = 48 * 1024;
/** CURRENT audit/restore/page.tsx MAX_ROWS. */
const MAX_RESTORE_RUNS = 50;

const OPERATIONS = ["CREATE", "UPDATE", "DELETE", "RESTORE", "STATUS_CHANGE", "MERGE", "SYSTEM"];
const RESTORE_STATUSES = ["restorable", "restored", "expired", "not_restorable", "blocked", "failed"];
const NOT_FOUND = { error: "not_found" } as const;

/** CURRENT parseDateBoundary: YYYY-MM-DD interpreted as JST start/end of day. */
function parseDateBoundary(value: string, end: boolean): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const suffix = end ? "T23:59:59+09:00" : "T00:00:00+09:00";
  const t = Date.parse(value + suffix);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

export const adminAuditRoutes = new Hono<AppEnv>();

// ---- GET /audit (audit/page.tsx) ----
adminAuditRoutes.get("/", async (c) => {
  const q = (name: string) => c.req.query(name);
  const tableFilter = (q("table") ?? "").trim();
  const operationFilter = (q("operation") ?? "").trim().toUpperCase();
  const actorFilter = (q("actor") ?? q("operator") ?? "").trim();
  const recordFilter = (q("record") ?? "").trim();
  const restoreStatusFilter = (q("restore_status") ?? "").trim();
  const sinceFilter = (q("since") ?? "").trim();
  const untilFilter = (q("until") ?? "").trim();
  const sinceUnix = sinceFilter ? parseDateBoundary(sinceFilter, false) : null;
  const untilUnix = untilFilter ? parseDateBoundary(untilFilter, true) : null;
  const limitRaw = Number(q("limit") ?? "");
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_AUDIT_LIMIT)
      : DEFAULT_AUDIT_LIMIT;

  const conds: string[] = [];
  const params: unknown[] = [];
  if (tableFilter) {
    conds.push("table_name = ?");
    params.push(tableFilter);
  }
  if (OPERATIONS.includes(operationFilter)) {
    conds.push("operation = ?");
    params.push(operationFilter);
  }
  if (actorFilter) {
    conds.push("actor_user_id = ?");
    params.push(actorFilter);
  }
  if (recordFilter) {
    conds.push("target_id = ?");
    params.push(recordFilter);
  }
  if (RESTORE_STATUSES.includes(restoreStatusFilter)) {
    conds.push("restore_status = ?");
    params.push(restoreStatusFilter);
  }
  if (sinceUnix != null) {
    conds.push("created_at >= ?");
    params.push(sinceUnix);
  }
  if (untilUnix != null) {
    conds.push("created_at <= ?");
    params.push(untilUnix);
  }
  const where = conds.length > 0 ? " WHERE " + conds.join(" AND ") : "";
  const { results: rows } = await c.env.DB.prepare(
    "SELECT * FROM audit_logs" + where + " ORDER BY created_at DESC LIMIT ?",
  )
    .bind(...params, limit)
    .all<AdminAuditListResponse["rows"][number]>();

  // ZERO_1102 S2: response <= 64 KiB. Payload columns (before/after/inverse, up to audit max_payload_bytes each)
  // can exceed that over 100 rows, so rows are kept (newest first) until the budget is used; at least one is kept.
  // DIVERGENCE: CURRENT renders all `limit` rows. The SPA re-queries with a narrower filter when truncated.
  let kept = 0;
  let used = 0;
  for (const row of rows) {
    const size = JSON.stringify(row).length;
    if (kept > 0 && used + size > MAX_AUDIT_LIST_BYTES) break;
    used += size;
    kept += 1;
  }
  const truncated = kept < rows.length;
  rows.length = kept;

  const actorIds = Array.from(new Set(rows.map((row) => row.actor_user_id).filter(Boolean)));
  let operators: AdminAuditListResponse["operators"] = [];
  if (actorIds.length > 0) {
    // One bind for the <= 100 actor IDs (json_each) keeps the statement under D1's bind limit.
    const joined = await c.env.DB.prepare(
      `SELECT u.id AS id, u.name AS name, u.active_x_user_id AS active_x_user_id, x.x_name AS x_name
       FROM "user" u
       LEFT JOIN x_users x ON lower(x.id) = lower(u.active_x_user_id)
       WHERE u.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))`,
    )
      .bind(JSON.stringify(actorIds))
      .all<AdminAuditListResponse["operators"][number]>();
    operators = joined.results;
  }
  const body: AdminAuditListResponse = { limit, truncated, rows, operators };
  return c.json(body);
});

// ---- GET /audit/restore (audit/restore/page.tsx) ----
adminAuditRoutes.get("/restore", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.id AS id, r.audit_log_id AS audit_log_id, r.status AS status, r.executed_at AS executed_at,
       r.executed_by_user_id AS executed_by_user_id, r.reason AS reason, r.error_message AS error_message,
       a.table_name AS log_table_name, a.target_id AS log_target_id
     FROM (SELECT * FROM audit_restore_runs ORDER BY executed_at DESC LIMIT ?) r
     LEFT JOIN audit_logs a ON a.id = r.audit_log_id
     ORDER BY r.executed_at DESC`,
  )
    .bind(MAX_RESTORE_RUNS)
    .all<{
      id: string;
      audit_log_id: string;
      status: string;
      executed_at: number;
      executed_by_user_id: string;
      reason: string;
      error_message: string | null;
      log_table_name: string | null;
      log_target_id: string | null;
    }>();
  const body: AdminAuditRestoreResponse = {
    runs: results.map(({ log_table_name, log_target_id, ...run }) => ({
      ...run,
      log:
        log_table_name != null && log_target_id != null
          ? { table_name: log_table_name, target_id: log_target_id }
          : null,
    })),
  };
  return c.json(body);
});

// ---- GET /audit/:id (audit/[id]/page.tsx; missing row -> notFound()) ----
adminAuditRoutes.get("/:id", async (c) => {
  const auditId = c.req.param("id");
  if (!auditId) return c.json(NOT_FOUND, 404);
  const row = await c.env.DB.prepare("SELECT * FROM audit_logs WHERE id = ? LIMIT 1")
    .bind(auditId)
    .first<AdminAuditDetailResponse["row"]>();
  if (!row) return c.json(NOT_FOUND, 404);

  // prev/next audit row for the same target_id (CURRENT runs these as two statements; one UNION ALL here).
  const { results } = await c.env.DB.prepare(
    `SELECT 'prev' AS kind, id, created_at FROM (
       SELECT id, created_at FROM audit_logs WHERE target_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT 1)
     UNION ALL
     SELECT 'next' AS kind, id, created_at FROM (
       SELECT id, created_at FROM audit_logs WHERE target_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT 1)`,
  )
    .bind(row.target_id, row.created_at, row.target_id, row.created_at)
    .all<{ kind: "prev" | "next"; id: string; created_at: number }>();
  const neighbor = (kind: "prev" | "next") => {
    const found = results.find((entry) => entry.kind === kind);
    return found ? { id: found.id, created_at: found.created_at } : null;
  };
  const body: AdminAuditDetailResponse = { row, prev: neighbor("prev"), next: neighbor("next") };
  return c.json(body);
});
