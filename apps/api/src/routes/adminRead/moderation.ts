import { Hono } from "hono";
import type { AdminModerationResponse, AdminModerationRow } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { ADMIN_MODERATION_LIMIT } from "./shared.ts";

// CURRENT: app/(admin)/admin/moderation/page.tsx. D1: 1 statement (+ the session lookup).
// CURRENT has no try/catch here, so a D1 failure is an error page -> 503 (router onError).
const CASE_TYPES = ["x_reapply", "void", "duplicate", "rights", "operator"] as const;
const CASE_STATUSES = ["open", "resolved", "rejected", "expired", "cancelled"] as const;

export const adminModerationRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const typeParam = c.req.query("type");
  const statusParam = c.req.query("status");
  const typeFilter = (CASE_TYPES as readonly string[]).includes(typeParam ?? "") ? (typeParam as string) : "all";
  const statusFilter = (CASE_STATUSES as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as string)
    : "open";
  const overdueOnly = c.req.query("overdue") === "1";
  const now = Math.floor(Date.now() / 1000);

  const conds: string[] = [];
  const params: unknown[] = [];
  if (typeFilter !== "all") {
    conds.push("c.case_type = ?");
    params.push(typeFilter);
  }
  if (statusFilter !== "all") {
    conds.push("c.status = ?");
    params.push(statusFilter);
  }
  if (overdueOnly) {
    conds.push("c.due_at < ?");
    params.push(now);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  const { results } = await c.env.DB.prepare(
    `SELECT c.id AS id, c.video_id AS video_id, c.case_type AS case_type, c.status AS status,
       c.public_reason AS public_reason, c.private_note AS private_note, c.due_at AS due_at,
       c.locked_until AS locked_until, c.attempt_count AS attempt_count,
       c.related_x_user_id AS related_x_user_id, c.created_by_user_id AS created_by_user_id,
       c.resolved_by_user_id AS resolved_by_user_id, c.created_at AS created_at, c.resolved_at AS resolved_at,
       v.title AS video_title, v.visibility_status AS video_status, x.x_name AS related_x_name
     FROM video_moderation_cases c
     LEFT JOIN videos v ON v.id = c.video_id
     LEFT JOIN x_users x ON x.id = c.related_x_user_id
     ${where}
     ORDER BY c.created_at DESC
     LIMIT ?`,
  )
    .bind(...params, ADMIN_MODERATION_LIMIT)
    .all<AdminModerationRow>();

  const body: AdminModerationResponse = {
    type: typeFilter,
    status: statusFilter,
    overdue: overdueOnly,
    now,
    cases: results,
  };
  return c.json(body);
});
