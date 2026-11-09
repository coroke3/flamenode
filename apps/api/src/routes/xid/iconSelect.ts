/**
 * MIG-0636 U05 SA-104: isolated icon-selector write handler.
 * UNMOUNTED pending CURRENT parity, orphan R2 cleanup and S3 budget acceptance.
 * Guard supplied by caller must enforce origin, identity, TOS, CostGuard and D1.
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

type IconRow = Record<string, unknown> & {
  id: string;
  icon_url: string | null;
  approval_status: string | null;
};
type IconCandidateRow = IconRow & { _icon_candidates_json: string | null };

/** CURRENT getXIconCandidates(...,40): current X icon then public video icons
 * newest-first, distinct in arrival order. The capped JSON source prevents
 * an unbounded response; no client-supplied URL alone grants permission.
 */
function approvedIconCandidate(
  row: IconCandidateRow,
  value: string,
): boolean {
  const seen = new Set<string>();
  if (row.icon_url) seen.add(row.icon_url);
  if (seen.has(value)) return true;
  const raw = row._icon_candidates_json;
  if (!raw || raw.length > 45000) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return false; }
  if (!Array.isArray(parsed)) return false;
  let count = seen.size;
  for (const candidate of parsed) {
    if (typeof candidate !== "string" || !candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    count++;
    if (candidate === value) return true;
    if (count >= 40) break;
  }
  return false;
}

export function createXIdIconSelectRoutes(guard: MiddlewareHandler<AppEnv>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.put("/:xUserId/icon", guard, limitXIdActionBody("SA-104"), async (c) => {
    const body = await readAdminJsonBody(c.req.raw);
    if (body.kind === "too_large") {
      return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
    }
    const input = parseSetXIdIconInput(c.req.param("xUserId"), body.kind === "ok" ? body.value : null);
    if (!input.ok) return c.json({ ok: false, message: input.message }, 400);
    const xUserId = input.value.xUserId;
    const authUserId = c.get("user")!.id;
    let row: IconCandidateRow | null;
    try {
      row = await c.env.DB.prepare(`
        SELECT x.*,
          (SELECT json_group_array(q.icon_url) FROM (
            SELECT creator_icon_url AS icon_url FROM videos
            WHERE creator_x_user_id = ? AND creator_icon_url IS NOT NULL
              AND visibility_status = 'public'
            ORDER BY created_at DESC LIMIT 80
          ) q) AS _icon_candidates_json
        FROM x_users x
        INNER JOIN x_user_account_links l ON l.x_user_id = x.id
        WHERE x.id = ? AND l.auth_user_id = ? LIMIT 1
      `).bind(xUserId, xUserId, authUserId).first<IconCandidateRow>();
    } catch {
      return c.json({ ok: false, message: "DBに接続できません。" }, 503);
    }
    if (!row) return c.json({ ok: false, message: "この X ID を編集する権限がありません。" }, 403);
    if (row.approval_status !== "approved") {
      return c.json({ ok: false, message: "承認済みの X ID だけを編集できます。" }, 403);
    }
    if (!approvedIconCandidate(row, input.value.iconUrl)) {
      return c.json({ ok: false, message: "選択できないアイコンです。" }, 400);
    }
    const { _icon_candidates_json: _candidates, ...before } = row;
    const after = { ...before, icon_url: input.value.iconUrl };
    const db = c.get("db");
    try {
      const queue = await buildAfterXUserPublicUpdateQueueBatch(db, {
        xUserId, reason: "x_user_icon_update", requestedByUserId: authUserId,
      });
      await mutateWithAudit(db, {
        mutationStatements: [
          db.run(sql`UPDATE x_users SET icon_url = ${input.value.iconUrl}
            WHERE id = ${xUserId}
              AND (${expectedRowCondition({ expectedCurrent: before })})
              AND approval_status = 'approved'
              AND EXISTS (
                SELECT 1 FROM x_user_account_links
                WHERE x_user_id = ${xUserId} AND auth_user_id = ${authUserId}
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
          table_name: "x_users", target_id: before.id, operation: "UPDATE",
          before: { ...before }, after: { ...after }, actor_user_id: authUserId,
          actor_x_user_id: xUserId, reason: "icon_select", retention_class: "long_audit",
          strict: true,
        }],
      });
    } catch {
      return c.json({ ok: false, message: "アイコンを更新できませんでした。再読み込みしてお試しください。" }, 409);
    }
    // CURRENT also cleans up unreferenced old icons post-commit. That flow is
    // not wired here: this route MUST remain unmounted until ported and tested.
    return c.json({ ok: true, message: "アイコンを更新しました。" });
  });
  return routes;
}
