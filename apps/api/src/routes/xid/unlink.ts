/**
 * MIG-0636 U05 / SA-103 isolated link deletion handler.
 * UNMOUNTED until CURRENT branch coverage, S3 D1/CPU budget and independent
 * security review pass. Caller must supply the full xidWriteStack guard.
 */
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../env.ts";
import { sql } from "@flamenode/server-core/sql";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import type { WriteAuditLogInput } from "@flamenode/server-core/audit/types";
import { auditPreloaded, readAdminJsonBody, BODY_TOO_LARGE_MESSAGE } from "../admin/body.ts";
import { limitXIdActionBody } from "../../middleware/bodyLimit.ts";
import { parseDeleteLinkedXInput } from "./profileInput.ts";
import { assessXUnlinkD1, xUnlinkStillAllowedSql } from "./unlinkAssessment.ts";

type PreflightRow = Record<string, string | number | null> & {
  id: string;
  active_x_user_id: string | null;
  _link_role: string;
  _link_created_by_request_id: string | null;
  _link_created_at: number;
  _link_updated_at: number;
};

export function createXIdUnlinkRoutes(guard: MiddlewareHandler<AppEnv>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.delete("/:xUserId", guard, limitXIdActionBody("SA-103"), async (c) => {
    const body = await readAdminJsonBody(c.req.raw);
    if (body.kind === "too_large") {
      return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
    }
    const input = parseDeleteLinkedXInput(c.req.param("xUserId"), body.kind === "ok" ? body.value : null);
    if (!input.ok) return c.json({ ok: false, message: input.message }, 400);
    const xUserId = input.value;
    const authUserId = c.get("user")!.id;

    let row: PreflightRow | null;
    try {
      row = await c.env.DB.prepare(`
        SELECT u.*, l.link_role AS _link_role,
          l.created_by_request_id AS _link_created_by_request_id,
          l.created_at AS _link_created_at, l.updated_at AS _link_updated_at
        FROM "user" u INNER JOIN x_user_account_links l
          ON l.auth_user_id = u.id
        WHERE u.id = ? AND l.x_user_id = ? LIMIT 1
      `).bind(authUserId, xUserId).first<PreflightRow>();
    } catch {
      return c.json({ ok: false, message: "DBに接続できません。" }, 503);
    }
    if (!row) return c.json({ ok: false, message: "この X ID の連携を削除できません。" }, 403);

    let assessment;
    try {
      assessment = await assessXUnlinkD1(c.env.DB, authUserId, xUserId);
    } catch {
      return c.json({ ok: false, message: "依存関係を確認できませんでした。" }, 503);
    }
    if (!assessment.allowed) {
      return c.json({ ok: false, message: assessment.message ?? "連携を削除できません。" }, 409);
    }

    const {
      _link_role, _link_created_by_request_id, _link_created_at, _link_updated_at,
      ...beforeUser
    } = row;
    const beforeLink = {
      x_user_id: xUserId, auth_user_id: authUserId, link_role: _link_role,
      created_by_request_id: _link_created_by_request_id,
      created_at: _link_created_at, updated_at: _link_updated_at,
    };
    const wasActive = beforeUser.active_x_user_id === xUserId;
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
      before: { ...beforeLink }, after: null,
      actor_user_id: authUserId, actor_x_user_id: xUserId,
      retention_class: "long_audit", strict: true,
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
        table_name: "user", target_id: authUserId,
        operation: "UPDATE", before: { ...beforeUser },
        after: { ...beforeUser, active_x_user_id: null },
        actor_user_id: authUserId, actor_x_user_id: xUserId,
        retention_class: "long_audit", strict: true,
      });
    }

    try {
      await mutateWithAudit(db, {
        mutationStatements, expectedMutationChanges, audits,
        preloaded: auditPreloaded(c),
      });
    } catch {
      return c.json({ ok: false, message: "連携を削除できませんでした。再読み込みしてお試しください。" }, 409);
    }
    return c.json({ ok: true, message: "現在の認証アカウントとの X ID 連携を削除しました。" });
  });
  return routes;
}
