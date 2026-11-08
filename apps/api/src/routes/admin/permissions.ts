/**
 * MIG-0642 U02 (SA-049): updateGlobalEditableFields on Hono.
 * CURRENT: src/lib/actions/permissions-admin.ts (feature `admin_permissions`).
 * PUT /api/admin/permissions/editable-fields. One system_settings read, a
 * no-op short circuit, then full-row CAS + strict `long_audit` in one D1
 * batch. No static rebuild queue and no Queue wake. Next revalidatePath has no
 * Hono equivalent.
 */
import { AdminEditableFieldsBodySchema, type AdminTermsNotificationsResult } from "@flamenode/contracts";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { AuditMutationError, mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import {
  normalizeGeneralEditableFields,
  serializeGeneralEditableFields,
} from "@flamenode/server-core/video/generalEditPermissions";
import { sql } from "@flamenode/server-core/sql";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../env.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "./body.ts";

export const PERMISSIONS_CONFLICT_MESSAGE =
  "別の管理者が一般作品権限を更新しました。ページを再読み込みして、現在の設定を確認してください。";
export const PERMISSIONS_FAILURE_MESSAGE =
  "一般作品権限の保存に失敗しました。時間をおいて再度お試しください。";

type SettingsSnapshot = {
  id: string;
  default_editable_fields: string | null;
  upcoming_editable_fields: string | null;
};

type Status = 200 | 400 | 404 | 409 | 413 | 500;
const respond = (c: Context<AppEnv>, status: Status, body: AdminTermsNotificationsResult) =>
  c.json(body, status);

export const adminPermissionsRoutes = new Hono<AppEnv>();

// Never let a failed preflight D1 read or a late binding getter throw into Hono's
// default error handler. Keep the provider error out of logs and responses.
adminPermissionsRoutes.onError((_error, c) => {
  c.header("Cache-Control", "private, no-store");
  return c.json<AdminTermsNotificationsResult>(
    { ok: false, message: "管理操作を処理できませんでした。再度お試しください。" },
    503,
  );
});
adminPermissionsRoutes.use("*", onlyMutating(costGuardMiddleware("admin_permissions")));

// SA-049 updateGlobalEditableFields
adminPermissionsRoutes.put("/editable-fields", async (c) => {
  const read = await readAdminJsonBody(c.req.raw);
  if (read.kind === "too_large") return respond(c, 413, { ok: false, message: BODY_TOO_LARGE_MESSAGE });
  const shape = read.kind === "ok" ? AdminEditableFieldsBodySchema.safeParse(read.value) : null;
  if (!shape || !shape.success) return respond(c, 400, { ok: false, message: "入力エラー" });

  const row = await c.env.DB
    .prepare(
      `SELECT id, default_editable_fields, upcoming_editable_fields
       FROM system_settings WHERE id = ? LIMIT 1`,
    )
    .bind("default")
    .first<SettingsSnapshot>();
  if (!row) {
    return respond(c, 404, {
      ok: false,
      message:
        "一般作品権限の設定行が見つかりません。DBマイグレーションの適用状態を確認してください。",
    });
  }

  const before: SettingsSnapshot = {
    id: row.id,
    default_editable_fields: row.default_editable_fields,
    upcoming_editable_fields: row.upcoming_editable_fields,
  };
  const patch = {
    default_editable_fields: serializeGeneralEditableFields(
      normalizeGeneralEditableFields(shape.data.default_editable_fields ?? []),
    ),
    upcoming_editable_fields: serializeGeneralEditableFields(
      normalizeGeneralEditableFields(shape.data.upcoming_editable_fields ?? []),
    ),
  };
  const norm = (v: string | null | undefined) => v || "";
  if (
    norm(before.default_editable_fields) === patch.default_editable_fields &&
    norm(before.upcoming_editable_fields) === patch.upcoming_editable_fields
  ) {
    return respond(c, 200, { ok: true, message: "一般作品権限に変更はありません。", settings: patch });
  }

  const db = c.get("db");
  const actor = c.get("user")!.id;
  try {
    await mutateWithAudit(db, {
      mutationStatements: [
        db.run(sql`
          UPDATE system_settings
          SET default_editable_fields = ${patch.default_editable_fields},
              upcoming_editable_fields = ${patch.upcoming_editable_fields}
          WHERE id = ${"default"} AND ${expectedRowCondition({ expectedCurrent: { ...before } })}
        `),
      ],
      expectedMutationChanges: 1,
      preloaded: auditPreloaded(c),
      audits: [
        {
          table_name: "system_settings",
          target_id: "default",
          operation: "UPDATE",
          before,
          after: { ...before, ...patch },
          actor_user_id: actor,
          context: "admin_permissions",
          reason: "一般作品権限を更新",
          retention_class: "long_audit",
          strict: true,
        },
      ],
    });
  } catch (error) {
    if (error instanceof AuditMutationError) {
      return respond(c, 409, { ok: false, message: PERMISSIONS_CONFLICT_MESSAGE });
    }
    console.error("[permissions-admin] atomic mutation failed");
    return respond(c, 500, { ok: false, message: PERMISSIONS_FAILURE_MESSAGE });
  }
  return respond(c, 200, { ok: true, message: "一般作品権限を保存しました。", settings: patch });
});
