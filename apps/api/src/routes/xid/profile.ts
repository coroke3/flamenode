/**
 * MIG-0636 U05 SA-102: isolated Hono profile mutation implementation.
 * Deliberately UNMOUNTED from createXIdRoutes until exact CURRENT parity,
 * S3 query budget and independent auth review all pass.
 *
 * The caller supplies xidWriteStack: same-origin -> session -> write identity
 * -> CostGuard(xid_links) -> D1 handle. Never use without that guard.
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

type XUserRow = Record<string, unknown> & {
  id: string;
  x_name: string;
  approval_status: string | null;
};

export function createXIdProfileRoutes(guard: MiddlewareHandler<AppEnv>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.patch("/:xUserId/profile", guard, limitXIdActionBody("SA-102"), async (c) => {
    const parsedBody = await readAdminJsonBody(c.req.raw);
    if (parsedBody.kind === "too_large") {
      return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
    }
    const input = parseXIdProfileInput(c.req.param("xUserId"), parsedBody.kind === "ok" ? parsedBody.value : null);
    if (!input.ok) return c.json({ ok: false, message: input.message }, 400);

    const db = c.get("db");
    const authUserId = c.get("user")!.id;
    const xUserId = input.value.xUserId;
    let before: XUserRow | null;
    try {
      // One bound SELECT: only the authenticated user's linked X row can load.
      before = await c.env.DB.prepare(`
        SELECT x.* FROM x_users x
        INNER JOIN x_user_account_links l ON l.x_user_id = x.id
        WHERE x.id = ? AND l.auth_user_id = ? LIMIT 1
      `).bind(xUserId, authUserId).first<XUserRow>();
    } catch {
      return c.json({ ok: false, message: "DBに接続できません。" }, 503);
    }
    if (!before) return c.json({ ok: false, message: "この X ID を編集する権限がありません。" }, 403);
    if (before.approval_status !== "approved") {
      return c.json({ ok: false, message: "承認済みの X ID だけを編集できます。" }, 403);
    }

    const patch = {
      x_name: input.value.xName || before.x_name.trim() || `@${xUserId}`,
      profile_text: input.value.profileText || null,
      portfolio_contact: input.value.portfolioContact,
      youtube_channel_url: input.value.youtubeChannelUrl,
      other_social_links: input.value.otherSocialLinks,
    };
    const after = { ...before, ...patch };
    try {
      const queue = await buildAfterXUserPublicUpdateQueueBatch(db, {
        xUserId, reason: "x_user_profile_update", requestedByUserId: authUserId,
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
