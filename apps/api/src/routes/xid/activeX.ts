/**
 * MIG-0636 U02 / SA-098: choose an approved, linked X identity.
 * CURRENT contract: src/lib/actions/xid.ts#setActiveXId.
 * No Next cache invalidation is required by the Hono API; browser clients
 * invalidate their session display after a successful response.
 */
import { SetActiveXBodySchema } from "@flamenode/contracts";
import { normalizeXId } from "@flamenode/domain/xid";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { sql } from "@flamenode/server-core/sql";
import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import { auditPreloaded } from "../admin/body.ts";
import { limitXIdActionBody } from "../../middleware/bodyLimit.ts";

const USER_NOT_FOUND = "ユーザーが見つかりません。";
const LINK_NOT_FOUND = "この X ID は現在のアカウントに紐づいていません。";
const NOT_APPROVED = "承認済みの X ID だけをアクティブにできます。";
const MUTATION_FAILED = "アクティブ X ID の変更に失敗しました。再読み込みしてお試しください。";

type RawUserRow = Record<string, string | number | null> & {
  id: string;
  active_x_user_id: string | null;
  linked_approval_status?: string | null;
};

/**
 * One read for CURRENT user snapshot and the selected linked-X approval.
 * An X alias resolves to the same canonical linked row as CURRENT
 * getLinkedXUserForAuthUser. Do not treat X ownership as authorization
 * without requiring the exact authenticated user link.
 */
async function loadSelectedIdentity(
  db: D1Database,
  authUserId: string,
  requestedXId: string,
): Promise<{ user: Record<string, unknown>; linkedApproval: string | null } | null> {
  const row = await db.prepare(`
    SELECT u.*,
      (SELECT x.approval_status
       FROM x_user_account_links l
       INNER JOIN x_users x ON x.id = l.x_user_id
       WHERE l.auth_user_id = u.id
         AND (l.x_user_id = ?
              OR EXISTS (
                SELECT 1 FROM x_user_aliases aliases
                WHERE aliases.alias_x_id = ? AND aliases.x_user_id = l.x_user_id
              ))
       LIMIT 1) AS linked_approval_status
    FROM "user" u WHERE u.id = ? LIMIT 1
  `).bind(requestedXId, requestedXId, authUserId).first<RawUserRow>();

  if (!row) return null;
  const { linked_approval_status, ...user } = row;
  // Drizzle timestamp_ms columns are Date objects in CURRENT select().
  if (typeof user.emailVerified === "number") {
    (user as Record<string, unknown>).emailVerified = new Date(user.emailVerified);
  }
  return { user, linkedApproval: linked_approval_status ?? null };
}

export const activeXRoutes = new Hono<AppEnv>();
activeXRoutes.post("/", limitXIdActionBody("SA-098"), async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ ok: false, message: "入力内容を確認してください。" }, 400);
  }
  const parsed = SetActiveXBodySchema.safeParse(raw);
  const xUserId = parsed.success ? normalizeXId(parsed.data.x_user_id) : "";
  if (!xUserId) return c.json({ ok: false, message: "X ID が指定されていません。" }, 400);

  const userId = c.get("user")!.id;
  let selected: Awaited<ReturnType<typeof loadSelectedIdentity>>;
  try {
    selected = await loadSelectedIdentity(c.env.DB, userId, xUserId);
  } catch {
    return c.json({ ok: false, message: MUTATION_FAILED }, 503);
  }
  if (!selected) return c.json({ ok: false, message: USER_NOT_FOUND }, 404);
  if (!selected.linkedApproval) return c.json({ ok: false, message: LINK_NOT_FOUND }, 403);
  if (selected.linkedApproval !== "approved") {
    return c.json({ ok: false, message: NOT_APPROVED }, 403);
  }
  if (normalizeXId(selected.user.active_x_user_id as string | null) === xUserId) {
    return c.json({ ok: true, message: "すでにこの X ID がアクティブです。" });
  }

  const before = selected.user;
  const after = { ...before, active_x_user_id: xUserId };
  try {
    await mutateWithAudit(c.get("db"), {
      mutationStatements: [
        c.get("db").run(sql`UPDATE "user" SET active_x_user_id = ${xUserId}
          WHERE id = ${userId} AND (${expectedRowCondition({ expectedCurrent: before })})`),
      ],
      expectedMutationChanges: [1],
      preloaded: auditPreloaded(c),
      audits: [{
        table_name: "user",
        target_id: userId,
        operation: "UPDATE",
        before: { ...before },
        after: { ...after },
        actor_user_id: userId,
        actor_x_user_id: xUserId,
        retention_class: "normal",
      }],
    });
  } catch {
    return c.json({ ok: false, message: MUTATION_FAILED }, 500);
  }
  return c.json({ ok: true, message: "アクティブ X ID を切り替えました。" });
});
