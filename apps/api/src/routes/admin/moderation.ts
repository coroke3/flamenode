/**
 * MIG-0731 U03b candidate: case-only moderation resolution.
 * NOT MOUNTED. SA-044 visibility transitions require a separate reviewed path;
 * accepting a nonempty video_status here would skip fences, queues and notices.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import type { AdminOpsResult } from "@flamenode/contracts";
import { normalizeModerationResolutionStatus, normalizeModerationText } from "@flamenode/domain/admin";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { sql } from "@flamenode/server-core/sql";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";
import { auditPreloaded, readAdminJsonBody, BODY_TOO_LARGE_MESSAGE } from "./body.ts";

type Snapshot = Record<string, string | number | null> & {
  id: string; video_id: string; status: string;
  private_note: string | null; resolved_by_user_id: string | null; resolved_at: number | null;
};
export function parseCaseOnlyResolution(value: Record<string, unknown>) {
  if (typeof value.status !== "string") return { ok: false as const, status: 400 as const, message: "不正な status です。" };
  const status = normalizeModerationResolutionStatus(value.status);
  if (!status) return { ok: false as const, status: 400 as const, message: "不正な status です。" };
  if (value.private_note !== undefined && typeof value.private_note !== "string")
    return { ok: false as const, status: 400 as const, message: "private_note が不正です。" };
  if (value.video_status !== undefined && typeof value.video_status !== "string")
    return { ok: false as const, status: 400 as const, message: "video_status が不正です。" };
  if (typeof value.video_status === "string" && value.video_status.trim())
    return { ok: false as const, status: 501 as const, message: "作品状態の変更を伴うモデレーション更新は移行準備中です。" };
  return { ok: true as const, value: {
    status, private_note: normalizeModerationText(value.private_note as string | undefined, 2000),
  } };
}

export const adminModerationCaseOnlyRoutes = new Hono<AppEnv>();
adminModerationCaseOnlyRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "private, no-store");
});
adminModerationCaseOnlyRoutes.onError((_error, c) =>
  c.json<AdminOpsResult>({ ok: false, message: "モデレーション更新を処理できませんでした。" },
    503, { "Cache-Control": "private, no-store" }));
adminModerationCaseOnlyRoutes.use("*", onlyMutating(costGuardMiddleware("admin_moderation_update")));

adminModerationCaseOnlyRoutes.post("/:caseId/status", async (c) => {
  const id = c.req.param("caseId").trim();
  const reply = (code: 200 | 400 | 404 | 409 | 413 | 501, body: AdminOpsResult) => c.json<AdminOpsResult>(body, code);
  if (!id || id.length > 128) return reply(400, { ok: false, message: "id が必要です。" });
  const input = await readAdminJsonBody(c.req.raw);
  if (input.kind === "too_large") return reply(413, { ok: false, message: BODY_TOO_LARGE_MESSAGE });
  const parsed = input.kind === "ok" ? parseCaseOnlyResolution(input.value) : null;
  if (!parsed || !parsed.ok) return reply(parsed?.status ?? 400,
    { ok: false, message: parsed?.message ?? "入力エラー" });
  const { status, private_note } = parsed.value;
  const current = await c.env.DB.prepare("SELECT * FROM video_moderation_cases WHERE id = ? LIMIT 1")
    .bind(id).first<Snapshot>();
  if (!current) return reply(404, { ok: false, message: "case が見つかりません。" });
  if (current.status !== "open") return current.status === status
    ? reply(200, { ok: true, message: "case は既にこの状態です。" })
    : reply(409, { ok: false, message: "既に更新された case です。" });
  const video = await c.env.DB.prepare("SELECT id FROM videos WHERE id = ? LIMIT 1")
    .bind(current.video_id).first<{ id: string }>();
  if (!video) return reply(404, { ok: false, message: "対象作品が見つかりません。" });
  const actor = c.get("user")!.id;
  const after: Snapshot = { ...current, status, private_note: private_note || current.private_note,
    resolved_by_user_id: actor, resolved_at: Math.floor(Date.now() / 1000) };
  const db = c.get("db");
  try {
    await mutateWithAudit(db, {
      mutationStatements: [db.run(sql`
        UPDATE video_moderation_cases SET status = ${after.status},
          private_note = ${after.private_note},
          resolved_by_user_id = ${after.resolved_by_user_id},
          resolved_at = ${after.resolved_at}
        WHERE id = ${id} AND ${expectedRowCondition({ expectedCurrent: { ...current } })}
      `)],
      expectedMutationChanges: 1,
      preloaded: auditPreloaded(c),
      audits: [{ table_name: "video_moderation_cases", target_id: id,
        operation: "UPDATE", before: { ...current }, after: { ...after },
        actor_user_id: actor, retention_class: "long_audit",
        context: "admin_moderation_update",
        reason: private_note || "ケース状態を " + status + " に変更",
        strict: true }],
    });
  } catch {
    return reply(409, { ok: false,
      message: "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。" });
  }
  return reply(200, { ok: true, message: "case を更新しました。" });
});
