/**
 * MIG-0636 U05 / SA-103: Hono link deletion handler (DELETE /api/xid/:xUserId).
 * CURRENT contract: src/lib/actions/xid.ts#deleteLinkedXId.
 *
 * Caller supplies xidSessionStack (same-origin -> session -> authenticated -> db).
 * Combined 1-SELECT preflight loads user snapshot, TOS, CostGuard settings, actor
 * snapshot, link metadata, and dependency blocker flags so real sessions stay
 * within ZERO_1102 S3 (3 pre-reads + 1 batch). DELETE rechecks every blocker SQL
 * predicate atomically inside the mutation batch.
 */
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../env.ts";
import { normalizeXId } from "@flamenode/domain/xid";
import { sql } from "@flamenode/server-core/sql";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import type { WriteAuditLogInput } from "@flamenode/server-core/audit/types";
import { auditPreloaded, readAdminJsonBody, BODY_TOO_LARGE_MESSAGE } from "../admin/body.ts";
import { limitXIdActionBody } from "../../middleware/bodyLimit.ts";
import { parseDeleteLinkedXInput } from "./profileInput.ts";
import {
  resolveUnlinkAssessment,
  XID_UNLINK_CTES_SQL,
  XID_UNLINK_FACTS_COLUMNS_SQL,
  xUnlinkStillAllowedSql,
  type UnlinkFacts,
} from "./unlinkAssessment.ts";
import {
  evaluateXIdGuardRow,
  resolveXIdDb,
  stripXIdGuardFields,
  TERMS_REACCEPT_REQUIRED_CTE_SQL,
  XID_GUARD_COLUMNS_SQL,
  XID_GUARD_JOINS_SQL,
  type XIdGuardRowFields,
} from "./xidGuard.ts";

type PreflightRow = XIdGuardRowFields &
  UnlinkFacts & {
    id: string;
    active_x_user_id: string | null;
    emailVerified?: number | Date | null;
    _link_role: string | null;
    _link_created_by_request_id: string | null;
    _link_created_at: number | null;
    _link_updated_at: number | null;
  };

export function createXIdUnlinkRoutes(guard: MiddlewareHandler<AppEnv>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.delete("/:xUserId", guard, limitXIdActionBody("SA-103"), async (c) => {
    const rawD1 = resolveXIdDb(c);
    if (rawD1 instanceof Response) return rawD1;

    const body = await readAdminJsonBody(c.req.raw);
    if (body.kind === "too_large") {
      return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
    }

    const rawPathXId = c.req.param("xUserId") ?? "";
    const sessionUser = c.get("user")!;
    const authUserId = sessionUser.id;
    let row: PreflightRow | null;
    try {
      row = await rawD1.prepare(`
        ${TERMS_REACCEPT_REQUIRED_CTE_SQL},
        ${XID_UNLINK_CTES_SQL}
        SELECT
          u.*,
          ${XID_GUARD_COLUMNS_SQL},
          l.link_role AS _link_role,
          l.created_by_request_id AS _link_created_by_request_id,
          l.created_at AS _link_created_at,
          l.updated_at AS _link_updated_at,
          ${XID_UNLINK_FACTS_COLUMNS_SQL}
        FROM "user" u
        ${XID_GUARD_JOINS_SQL}
        LEFT JOIN x_user_account_links l ON l.auth_user_id = u.id AND l.x_user_id = ?
        WHERE u.id = ? LIMIT 1
      `).bind(authUserId, rawPathXId, rawPathXId, authUserId).first<PreflightRow>();
    } catch {
      return c.json({ ok: false, message: "DBに接続できません。" }, 503);
    }

    const guardDeny = await evaluateXIdGuardRow(c, sessionUser, row);
    if (guardDeny) return guardDeny;

    const input = parseDeleteLinkedXInput(
      rawPathXId,
      body.kind === "ok" ? body.value : null,
    );
    if (!input.ok) return c.json({ ok: false, message: input.message }, 400);
    const xUserId = input.value;

    const { rest } = stripXIdGuardFields(row!);
    const {
      link_present,
      owner_blocked,
      video_blocked,
      slot_blocked,
      pending_blocked,
      dependency_blocked,
      _link_role,
      _link_created_by_request_id,
      _link_created_at,
      _link_updated_at,
      ...beforeUser
    } = rest;
    // Drizzle timestamp_ms columns are Date objects in CURRENT select().
    if (typeof beforeUser.emailVerified === "number") {
      (beforeUser as Record<string, unknown>).emailVerified = new Date(beforeUser.emailVerified);
    }

    const assessment = resolveUnlinkAssessment({
      link_present,
      owner_blocked,
      video_blocked,
      slot_blocked,
      pending_blocked,
      dependency_blocked,
    });
    if (!assessment.linked || _link_role === null || _link_created_at === null || _link_updated_at === null) {
      return c.json({ ok: false, message: "この X ID の連携を削除できません。" }, 403);
    }
    if (!assessment.allowed) {
      return c.json({ ok: false, message: assessment.message ?? "連携を削除できません。" }, 409);
    }

    const beforeLink = {
      x_user_id: xUserId,
      auth_user_id: authUserId,
      link_role: _link_role,
      created_by_request_id: _link_created_by_request_id,
      created_at: _link_created_at,
      updated_at: _link_updated_at,
    };
    const wasActive = normalizeXId(beforeUser.active_x_user_id as string | null) === xUserId;
    const db = c.get("db");
    const mutationStatements = [
      db.run(sql`
        DELETE FROM x_user_account_links
        WHERE x_user_id = ${xUserId} AND auth_user_id = ${authUserId}
          AND link_role = ${_link_role}
          AND created_at = ${_link_created_at}
          AND updated_at = ${_link_updated_at}
          AND (
            (created_by_request_id IS NULL AND ${_link_created_by_request_id} IS NULL)
            OR created_by_request_id = ${_link_created_by_request_id}
          )
          AND EXISTS (
            SELECT 1 FROM "user" AS current_user
            WHERE current_user.id = ${authUserId}
              AND (
                (current_user.active_x_user_id IS NULL AND ${beforeUser.active_x_user_id} IS NULL)
                OR current_user.active_x_user_id = ${beforeUser.active_x_user_id}
              )
          )
          AND (${xUnlinkStillAllowedSql(authUserId, xUserId)})
      `),
    ];
    const expectedMutationChanges: number[] = [1];
    const audits: WriteAuditLogInput[] = [{
      table_name: "x_user_account_links",
      target_id: `${xUserId}:${authUserId}`,
      operation: "DELETE",
      before: { ...beforeLink },
      after: null,
      actor_user_id: authUserId,
      actor_x_user_id: xUserId,
      retention_class: "long_audit",
      strict: true,
    }];
    if (wasActive) {
      mutationStatements.push(
        db.run(sql`
          UPDATE "user" SET active_x_user_id = NULL WHERE id = ${authUserId}
            AND (${expectedRowCondition({ expectedCurrent: beforeUser })})
        `),
      );
      expectedMutationChanges.push(1);
      audits.push({
        table_name: "user",
        target_id: authUserId,
        operation: "UPDATE",
        before: { ...beforeUser },
        after: { ...beforeUser, active_x_user_id: null },
        actor_user_id: authUserId,
        actor_x_user_id: xUserId,
        retention_class: "long_audit",
        strict: true,
      });
    }

    try {
      await mutateWithAudit(db, {
        mutationStatements,
        expectedMutationChanges,
        audits,
        preloaded: auditPreloaded(c),
      });
    } catch {
      return c.json({ ok: false, message: "連携を削除できませんでした。再読み込みしてお試しください。" }, 409);
    }
    return c.json({ ok: true, message: "現在の認証アカウントとの X ID 連携を削除しました。" });
  });
  return routes;
}
