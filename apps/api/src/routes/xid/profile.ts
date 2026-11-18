/**
 * MIG-0636 U05 SA-102: Hono X profile mutation handler (PATCH /api/xid/:xUserId/profile).
 * CURRENT contract: src/lib/actions/xid.ts#updateXIdProfile.
 *
 * Caller supplies xidSessionStack (same-origin -> session -> authenticated -> db).
 * Combined 1-SELECT preflight loads TOS, CostGuard settings, actor snapshot, and
 * linked X row so real sessions stay within ZERO_1102 S3 (3 pre-reads + 1 batch).
 * D-0603-1: static rebuild queue rows commit atomically; Cron consumes queue (wake 0).
 */
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../env.ts";
import { sql } from "@flamenode/server-core/sql";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { buildAfterXUserPublicUpdateQueueBatch } from "@flamenode/server-core/staticRebuild/hooks";
import { auditPreloaded, readAdminJsonBody, BODY_TOO_LARGE_MESSAGE } from "../admin/body.ts";
import { limitXIdActionBody } from "../../middleware/bodyLimit.ts";
import { parseXIdProfileInput } from "./profileInput.ts";
import {
  evaluateXIdGuardRow,
  resolveXIdDb,
  stripXIdGuardFields,
  TERMS_REACCEPT_REQUIRED_CTE_SQL,
  XID_GUARD_COLUMNS_SQL,
  XID_GUARD_JOINS_SQL,
  type XIdGuardRowFields,
} from "./xidGuard.ts";

type ProfilePreflightRow = XIdGuardRowFields & {
  _has_link: number;
  id: string | null;
  x_name: string | null;
  approval_status: string | null;
};

export function createXIdProfileRoutes(guard: MiddlewareHandler<AppEnv>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.patch("/:xUserId/profile", guard, limitXIdActionBody("SA-102"), async (c) => {
    const rawD1 = resolveXIdDb(c);
    if (rawD1 instanceof Response) return rawD1;

    const parsedBody = await readAdminJsonBody(c.req.raw);
    if (parsedBody.kind === "too_large") {
      return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
    }

    const rawPathXId = c.req.param("xUserId") ?? "";
    const sessionUser = c.get("user")!;
    const authUserId = sessionUser.id;
    let preflight: ProfilePreflightRow | null;
    try {
      // One bound SELECT: user TOS + CostGuard settings + actor snapshot + linked X row.
      preflight = await rawD1.prepare(`
        ${TERMS_REACCEPT_REQUIRED_CTE_SQL}
        SELECT ${XID_GUARD_COLUMNS_SQL},
          (l.x_user_id IS NOT NULL) AS _has_link,
          x.*
        FROM "user" u
        ${XID_GUARD_JOINS_SQL}
        LEFT JOIN x_user_account_links l ON l.auth_user_id = u.id AND l.x_user_id = ?
        LEFT JOIN x_users x ON x.id = l.x_user_id
        WHERE u.id = ? LIMIT 1
      `).bind(rawPathXId, authUserId).first<ProfilePreflightRow>();
    } catch {
      return c.json({ ok: false, message: "DBに接続できません。" }, 503);
    }

    const guardDeny = await evaluateXIdGuardRow(c, sessionUser, preflight);
    if (guardDeny) return guardDeny;

    const input = parseXIdProfileInput(
      rawPathXId,
      parsedBody.kind === "ok" ? parsedBody.value : null,
    );
    if (!input.ok) return c.json({ ok: false, message: input.message }, 400);

    const { rest } = stripXIdGuardFields(preflight!);
    const { _has_link, ...before } = rest;
    if (_has_link !== 1 || typeof before.id !== "string") {
      return c.json({ ok: false, message: "この X ID を編集する権限がありません。" }, 403);
    }
    if (before.approval_status !== "approved") {
      return c.json({ ok: false, message: "承認済みの X ID だけを編集できます。" }, 403);
    }

    const db = c.get("db");
    const xUserId = input.value.xUserId;
    const patch = {
      x_name: input.value.xName || (before.x_name ?? "").trim() || `@${xUserId}`,
      profile_text: input.value.profileText || null,
      portfolio_contact: input.value.portfolioContact,
      youtube_channel_url: input.value.youtubeChannelUrl,
      other_social_links: input.value.otherSocialLinks,
    };
    const after = { ...before, ...patch };
    try {
      const queue = await buildAfterXUserPublicUpdateQueueBatch(db, {
        xUserId,
        reason: "x_user_profile_update",
        requestedByUserId: authUserId,
      });
      await mutateWithAudit(db, {
        mutationStatements: [
          db.run(sql`UPDATE x_users SET
            x_name = ${patch.x_name},
            profile_text = ${patch.profile_text},
            portfolio_contact = ${patch.portfolio_contact},
            youtube_channel_url = ${patch.youtube_channel_url},
            other_social_links = ${patch.other_social_links}
            WHERE id = ${xUserId}
              AND (${expectedRowCondition({ expectedCurrent: before })})
              AND approval_status = 'approved'
              AND EXISTS (
                SELECT 1 FROM x_user_account_links
                WHERE x_user_id = ${xUserId} AND auth_user_id = ${authUserId}
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
          retention_class: "long_audit",
          strict: true,
        }],
        // D-0603-1: background Cron consumes queue. Do NOT wake a Queue here.
      });
    } catch {
      // This includes CAS conflict and strict audit failure: one D1 batch rolls back.
      return c.json({ ok: false, message: "X ID のプロフィールを更新できませんでした。再読み込みしてお試しください。" }, 409);
    }
    return c.json({ ok: true, message: "X ID のプロフィールを更新しました。" });
  });
  return routes;
}
