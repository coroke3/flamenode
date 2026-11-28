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
  AuditRestoreSchema,
  AuditSettingsPatchSchema,
  type AuditLogDryRunResult,
  type AuditRestoreResponse,
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
  type AdminJsonBody,
} from "./body.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";
import { createAuditRestoreHost } from "../../visibility/auditRestoreHost.ts";

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

// SA-009/010 and opt-in SA-011: a request stream can fail while its body is
// read (for example a disconnected upload or an injected provider exception).
// Uncaught failures would reach Hono's default onError logger with an arbitrary
// Error/cause. Fail closed and never serialize or log the stream exception.
// A valid but malformed JSON body already returns the same input error.
async function readAuditJsonBody(request: Request): Promise<AdminJsonBody> {
  try {
    return await readAdminJsonBody(request);
  } catch {
    return { kind: "invalid" };
  }
}

// SA-009 updateAuditLogSettingsAction
auditAdminRoutes.post("/settings", async (c) => {
  // SA-009 mutates privileged retention policy and returns admin-only outcomes.
  // Match SA-010/011: prevent HTTP/edge storage on success and error paths.
  c.header("Cache-Control", "private, no-store");
  const read = await readAuditJsonBody(c.req.raw);
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
  } catch {
    // A D1/Drizzle failure may contain a full SQL statement, bind values, or
    // request metadata. CURRENT echoes error.message; migration intentionally
    // uses a constant error to avoid reflecting private audit parameters.
    // Keep the existing 500 status and fail-closed atomic update behavior.
    return c.json<UpdateAuditLogSettingsResult>(
      { ok: false, message: "設定の更新に失敗しました。" },
      500,
    );
  }
});

// SA-010 getAuditLogDryRun
auditAdminRoutes.post("/dry-run", async (c) => {
  // SA-010 returns full CURRENT/target audit snapshots and conflict diffs.
  // Never allow shared HTTP/edge caching, including invalid and oversized requests.
  c.header("Cache-Control", "private, no-store");
  const read = await readAuditJsonBody(c.req.raw);
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

  // SA-010 is mounted even while the SA-011 mutation candidate is disabled.
  // An early D1/Drizzle preflight error must never reach Hono's default
  // error logger with private audit IDs, SQL binds or provider metadata.
  let result: Awaited<ReturnType<typeof restoreAuditLog>>;
  try {
    result = await restoreAuditLog(
      db,
      {
        auditId: parsed.data.audit_id,
        userId,
        reason: parsed.data.reason,
        dry_run: true,
      },
      dryRunAuditHost,
    );
  } catch {
    return c.json<AuditLogDryRunResult>(
      { ok: false, message: "事前確認を完了できませんでした。" },
      500,
    );
  }

  // #730: SA-010 is mounted even when SA-011 stays unmounted. An
  // unregistered audit_logs.table_name is interpolated into the shared-core
  // adapter_missing message; never reflect this database-sourced string on
  // either privileged endpoint. Preserve normal dry-run diffs and conflicts.
  return c.json<AuditLogDryRunResult>(
    {
      ok: result.ok,
      message: safeAuditRestoreFailureMessage(result),
      diff: result.diff,
    },
    200,
  );
});

// SEC-730 cross-PR parity: the shared restore owner PR #679 preserves only
// three explicitly reviewed domain diagnostics on mutation_failed. Hono must
// not erase those safe codes, while continuing to reject untrusted SQL,
// Drizzle and provider exception messages from the older shared-core build.
// Exact-string matching is intentional: never match prefixes or substrings.
const ALLOWED_AUDIT_RESTORE_FAILURE_MESSAGES = new Set([
  "video_members_set_snapshot_invalid",
  "video_members_set_target_mismatch",
  "復元を確定できませんでした。変更はロールバックされました: video_status_rebuild_event_limit_exceeded",
]);
const GENERIC_AUDIT_RESTORE_FAILURE_MESSAGE =
  "復元を確定できませんでした。変更はロールバックされました。";

export function safeAuditRestoreFailureMessage(result: {
  ok: boolean;
  reason_code?: string;
  message?: string;
}): string | undefined {
  // A stored audit_logs.table_name is not necessarily a registered table.
  // Shared evaluateRestoreCapability embeds an unknown table name verbatim in
  // the adapter_missing message. Do not reflect that database-sourced string
  // into privileged HTTP responses, even before the shared-core owner fixes
  // persistence of such diagnostics. Other domain outcomes keep CURRENT parity.
  if (!result.ok && result.reason_code === "adapter_missing") {
    return "復元アダプターが見つかりません。";
  }
  if (result.ok || result.reason_code !== "mutation_failed") return result.message;
  return typeof result.message === "string" &&
    ALLOWED_AUDIT_RESTORE_FAILURE_MESSAGES.has(result.message)
    ? result.message
    : GENERIC_AUDIT_RESTORE_FAILURE_MESSAGE;
}

// MIG-0662 SA-011 remains a candidate, NOT a deployable default route.
// createAdminRoutes() intentionally does not mount this separate router without
// an explicit source-level opt-in; the default app.ts route graph cannot execute
// an unapproved audit restoration even after an accidental target deploy.
// Parent admin origin/session/write guards apply; local parity tests opt in.
export const auditRestoreCandidateRoutes = new Hono<AppEnv>();
// Hono route() imports and flattens the previously mounted auditAdminRoutes
// wildcard CostGuard into the parent router before this opt-in POST. Do not
// re-register it here or spend another D1 read. T00 pins this exact ordering.
auditRestoreCandidateRoutes.post("/restore", async (c) => {
  // Audit restoration may return sensitive snapshots and conflict diffs.
  // Explicitly prevent HTTP/edge caching on 200, 400 and 413 responses.
  c.header("Cache-Control", "private, no-store");
  const read = await readAuditJsonBody(c.req.raw);
  if (read.kind === "too_large") {
    return c.json<AuditRestoreResponse>(
      { ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413,
    );
  }
  if (read.kind !== "ok") {
    return c.json<AuditRestoreResponse>({ ok: false, message: "入力エラー" }, 400);
  }

  const parsed = AuditRestoreSchema.safeParse(read.value);
  if (!parsed.success) {
    return c.json<AuditRestoreResponse>(
      { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" }, 400,
    );
  }

  // Shared core may reject an early D1 read before it can produce a domain
  // RestoreResult. Hono's default onError may log that untrusted provider
  // exception. Return a static 500 response and never serialize/log its cause.
  // The candidate remains opt-in only and preserves private/no-store above.
  let result: Awaited<ReturnType<typeof restoreAuditLog>>;
  try {
    result = await restoreAuditLog(
      c.get("db"),
      {
        auditId: parsed.data.audit_id,
        userId: c.get("user")!.id,
        reason: parsed.data.reason,
        confirmText: parsed.data.confirm_text,
        forceOverwrite: parsed.data.force_overwrite === 1,
        dry_run: false,
      },
      createAuditRestoreHost(c),
    );
  } catch {
    return c.json<AuditRestoreResponse>(
      { ok: false, message: "復元処理を完了できませんでした。" },
      500,
    );
  }

  // #730: never echo untrusted provider failure text. Preserve only exact
  // shared-core-allowlisted domain diagnostics and ordinary known conflicts;
  // shared CURRENT and integrated PR #679 need separate security review.
  const publicMessage = safeAuditRestoreFailureMessage(result);
  return c.json<AuditRestoreResponse>(
    {
      ok: result.ok,
      message: publicMessage,
      restore_run_id: result.restore_run_id,
      diff: result.diff,
    },
    200,
  );
});
