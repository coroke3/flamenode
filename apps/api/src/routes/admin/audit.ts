/**
 * MIG-0629: SA-009 / SA-010 admin audit settings & restore dry-run APIs.
 * CURRENT: src/lib/actions/audit-admin.ts (updateAuditLogSettingsAction / getAuditLogDryRun).
 *
 * Mounted under /api/admin/audit behind:
 *   session -> writeGuard -> CostGuard("admin_permissions") -> dbMiddleware.
 *
 * Decisions:
 *   - M1 / D-13-54: SA-010 calls restoreAuditLog with dry_run: true and a dummy host
 *     where all methods throw "audit_dry_run_host_unused". All responses 200 {ok, message?, diff?}.
 *   - M2 / D-13-55: POST /api/admin/audit/settings & POST /api/admin/audit/dry-run.
 *   - D-13-53: updateAuditLogSettings passes auditPreloaded(c) to mutateWithAudit.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import {
  AuditDryRunSchema,
  AuditSettingsPatchSchema,
  type AuditLogDryRunResult,
  type UpdateAuditLogSettingsResult,
} from "@flamenode/contracts";
import { updateAuditLogSettings } from "@flamenode/server-core/audit/settings";
import {
  restoreAuditLog,
  type AuditRestoreHost,
} from "@flamenode/server-core/audit/restore";
import {
  auditPreloaded,
  BODY_TOO_LARGE_MESSAGE,
  readAdminJsonBody,
} from "./body.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";

export const auditAdminRoutes = new Hono<AppEnv>();
auditAdminRoutes.use("*", onlyMutating(costGuardMiddleware("admin_permissions")));

const DRY_RUN_HOST_UNUSED_ERROR = "audit_dry_run_host_unused";
const throwUnused = (): never => {
  throw new Error(DRY_RUN_HOST_UNUSED_ERROR);
};

const dryRunAuditHost: AuditRestoreHost = {
  manifest: {
    read: throwUnused,
    write: throwUnused,
  },
  publicCacheKeys: {
    staticObjectKeys: [],
    userMaxPages: 0,
    eventObjectKeys: throwUnused,
  },
  deletePublicJsonCaches: throwUnused,
  invalidateEventExportCache: throwUnused,
  loadQueueWakeHost: throwUnused,
};

// SA-009 updateAuditLogSettingsAction
auditAdminRoutes.post("/settings", async (c) => {
  const read = await readAdminJsonBody(c.req.raw);
  if (read.kind === "too_large") {
    return c.json<UpdateAuditLogSettingsResult>(
      { ok: false, message: BODY_TOO_LARGE_MESSAGE },
      413,
    );
  }
  if (read.kind !== "ok") {
    return c.json<UpdateAuditLogSettingsResult>(
      { ok: false, message: "入力エラー" },
      400,
    );
  }

  const parsed = AuditSettingsPatchSchema.safeParse(read.value);
  if (!parsed.success) {
    return c.json<UpdateAuditLogSettingsResult>(
      {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "入力エラー",
      },
      400,
    );
  }

  const db = c.get("db");
  const userId = c.get("user")!.id;

  try {
    await updateAuditLogSettings(db, userId, parsed.data, auditPreloaded(c));
    return c.json<UpdateAuditLogSettingsResult>({ ok: true }, 200);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "設定の更新に失敗しました。";
    return c.json<UpdateAuditLogSettingsResult>({ ok: false, message }, 500);
  }
});

// SA-010 getAuditLogDryRun
auditAdminRoutes.post("/dry-run", async (c) => {
  const read = await readAdminJsonBody(c.req.raw);
  if (read.kind === "too_large") {
    return c.json<AuditLogDryRunResult>(
      { ok: false, message: BODY_TOO_LARGE_MESSAGE },
      413,
    );
  }
  if (read.kind !== "ok") {
    return c.json<AuditLogDryRunResult>(
      { ok: false, message: "入力エラー" },
      400,
    );
  }

  const parsed = AuditDryRunSchema.safeParse(read.value);
  if (!parsed.success) {
    return c.json<AuditLogDryRunResult>(
      {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "入力エラー",
      },
      400,
    );
  }

  const db = c.get("db");
  const userId = c.get("user")!.id;

  const result = await restoreAuditLog(
    db,
    {
      auditId: parsed.data.audit_id,
      userId,
      reason: parsed.data.reason,
      dry_run: true,
    },
    dryRunAuditHost,
  );

  return c.json<AuditLogDryRunResult>(
    {
      ok: result.ok,
      message: result.message,
      diff: result.diff,
    },
    200,
  );
});
