/**
 * MIG-0636 U05 SA-104: Hono icon-selector write handler (PUT /api/xid/:xUserId/icon).
 * CURRENT contract: src/lib/actions/xid.ts#setXIdIcon.
 *
 * Caller supplies xidSessionStack (same-origin -> session -> authenticated -> db).
 * Combined 1-SELECT preflight loads TOS, CostGuard settings, actor snapshot,
 * linked X row, and up to 40 candidate icons so real sessions stay within
 * ZERO_1102 S3 (3 pre-reads + 1 batch).
 * D-0603-1: static rebuild queue rows commit atomically (wake 0).
 */
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../env.ts";
import { sql } from "@flamenode/server-core/sql";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { buildAfterXUserPublicUpdateQueueBatch } from "@flamenode/server-core/staticRebuild/hooks";
import { auditPreloaded, readAdminJsonBody, BODY_TOO_LARGE_MESSAGE } from "../admin/body.ts";
import { limitXIdActionBody } from "../../middleware/bodyLimit.ts";
import { parseSetXIdIconInput } from "./profileInput.ts";
import { cleanupOldXIconAfterCommit } from "./orphanCleanup.ts";
import {
  evaluateXIdGuardRow,
  resolveXIdDb,
  stripXIdGuardFields,
  TERMS_REACCEPT_REQUIRED_CTE_SQL,
  XID_GUARD_COLUMNS_SQL,
  XID_GUARD_JOINS_SQL,
  XID_LINK_ALIAS_FAIL_CLOSED_SQL,
  type XIdGuardRowFields,
} from "./xidGuard.ts";

type IconCandidateRow = XIdGuardRowFields & {
  _has_link: number;
  _icon_candidates_json: string | null;
  id: string | null;
  icon_url: string | null;
  approval_status: string | null;
};

/** CURRENT getXIconCandidates(...,40): current X icon then public video icons
 * newest-first, distinct in arrival order. The capped JSON source prevents
 * an unbounded response; no client-supplied URL alone grants permission.
 */
function approvedIconCandidate(
  currentIconUrl: string | null,
  candidatesJson: string | null,
  value: string,
): boolean {
  const seen = new Set<string>();
  if (currentIconUrl) seen.add(currentIconUrl);
  if (seen.has(value)) return true;
  if (!candidatesJson || candidatesJson.length > 45000) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(candidatesJson); } catch { return false; }
  if (!Array.isArray(parsed)) return false;
  let count = seen.size;
  for (const candidate of parsed) {
    if (typeof candidate !== "string" || !candidate || seen.has(candidate)) continue;
    if (count >= 40) break;
    seen.add(candidate);
    count++;
    if (candidate === value) return true;
  }
  return false;
}

export function createXIdIconSelectRoutes(guard: MiddlewareHandler<AppEnv>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.put("/:xUserId/icon", guard, limitXIdActionBody("SA-104"), async (c) => {
    const rawD1 = resolveXIdDb(c);
    if (rawD1 instanceof Response) return rawD1;

    const body = await readAdminJsonBody(c.req.raw);
    if (body.kind === "too_large") {
      return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
    }

    const rawPathXId = c.req.param("xUserId") ?? "";
    const sessionUser = c.get("user")!;
    const authUserId = sessionUser.id;
    let row: IconCandidateRow | null;
    try {
      row = await rawD1.prepare(`
        ${TERMS_REACCEPT_REQUIRED_CTE_SQL}
        SELECT ${XID_GUARD_COLUMNS_SQL},
          (l.x_user_id IS NOT NULL) AS _has_link,
          (SELECT json_group_array(q.icon_url) FROM (
            SELECT creator_icon_url AS icon_url FROM videos
            WHERE creator_x_user_id = ? AND creator_icon_url IS NOT NULL
              AND visibility_status = 'public'
            ORDER BY created_at DESC LIMIT 80
          ) q) AS _icon_candidates_json,
          x.*
        FROM "user" u
        ${XID_GUARD_JOINS_SQL}
        LEFT JOIN x_user_account_links l ON l.auth_user_id = u.id AND l.x_user_id = ?
          AND ${XID_LINK_ALIAS_FAIL_CLOSED_SQL}
        LEFT JOIN x_users x ON x.id = l.x_user_id
        WHERE u.id = ? LIMIT 1
      `).bind(rawPathXId, rawPathXId, authUserId).first<IconCandidateRow>();
    } catch {
      return c.json({ ok: false, message: "DBに接続できません。" }, 503);
    }

    const guardDeny = await evaluateXIdGuardRow(c, sessionUser, row);
    if (guardDeny) return guardDeny;

    const input = parseSetXIdIconInput(rawPathXId, body.kind === "ok" ? body.value : null);
    if (!input.ok) return c.json({ ok: false, message: input.message }, 400);
    const xUserId = input.value.xUserId;

    const { rest } = stripXIdGuardFields(row!);
    const { _has_link, _icon_candidates_json, ...before } = rest;
    if (_has_link !== 1 || typeof before.id !== "string") {
      return c.json({ ok: false, message: "この X ID を編集する権限がありません。" }, 403);
    }
    if (before.approval_status !== "approved") {
      return c.json({ ok: false, message: "承認済みの X ID だけを編集できます。" }, 403);
    }
    if (!approvedIconCandidate(before.icon_url, _icon_candidates_json, input.value.iconUrl)) {
      return c.json({ ok: false, message: "選択できないアイコンです。" }, 400);
    }

    const after = { ...before, icon_url: input.value.iconUrl };
    const db = c.get("db");
    try {
      const queue = await buildAfterXUserPublicUpdateQueueBatch(db, {
        xUserId,
        reason: "x_user_icon_update",
        requestedByUserId: authUserId,
      });
      await mutateWithAudit(db, {
        mutationStatements: [
          db.run(sql`UPDATE x_users SET icon_url = ${input.value.iconUrl}
            WHERE id = ${xUserId}
              AND (${expectedRowCondition({ expectedCurrent: before })})
              AND approval_status = 'approved'
              AND EXISTS (
                SELECT 1 FROM x_user_account_links l
                WHERE l.x_user_id = ${xUserId} AND l.auth_user_id = ${authUserId}
                  AND ${sql.raw(XID_LINK_ALIAS_FAIL_CLOSED_SQL)}
              )
              AND (
                icon_url = ${input.value.iconUrl}
                OR EXISTS (
                  SELECT 1 FROM videos
                  WHERE creator_x_user_id = ${xUserId}
                    AND creator_icon_url = ${input.value.iconUrl}
                    AND visibility_status = 'public'
                )
              )`),
          ...queue.statements,
        ],
        expectedMutationChanges: [1, ...queue.expectedChanges],
        preloaded: auditPreloaded(c),
        audits: [{
          table_name: "x_users",
          target_id: before.id,
          operation: "UPDATE",
          before: { ...before },
          after: { ...after },
          actor_user_id: authUserId,
          actor_x_user_id: xUserId,
          reason: "icon_select",
          retention_class: "long_audit",
          strict: true,
        }],
        // D-0603-1: background Cron consumes queue. Do NOT wake a Queue here.
      });
    } catch {
      return c.json({ ok: false, message: "アイコンを更新できませんでした。再読み込みしてお試しください。" }, 409);
    }
    // CURRENT best-effort orphan cleanup happens only after the D1 commit.
    // A completed atomic D1 write must not be reported as failed simply
    // because an optional R2 binding is unavailable during postcommit GC.
    try {
      const bucket = c.env?.BUCKET;
      if (bucket) {
        await cleanupOldXIconAfterCommit(rawD1, bucket, before.icon_url, input.value.iconUrl);
      }
    } catch {
      // Best effort only. A future cleanup can recheck all live references.
    }
    return c.json({ ok: true, message: "アイコンを更新しました。" });
  });
  return routes;
}
