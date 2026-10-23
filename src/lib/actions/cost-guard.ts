"use server";

/**
 * 手動 CostGuard Server Actions。
 * `operation_mode` の D1 書き込み正本はここ（KV ミラー同期付き）。
 * `disabled_features_json` はこの専用 Cost Guard action だけが変更し、
 * Spreadsheet import からは編集できない。すべての変更は同じ full-row CAS + strict audit を通す。
 * Cloudflare 使用量に基づく自動昇格・自動降格は行わない。
 */

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { systemSettings } from "@/lib/db/schema";
import {
  requireCostGuardControlAdmin,
} from "@/lib/auth/writeGuard";
import {
  OVERRIDE_DURATION_SEC,
  checkExpectedDisabledFeatures,
  parseClearCostGuardOverrideInput,
  parseCostGuardModeInput,
  parseCostGuardOverrideInput,
  parseDisabledFeaturesInput,
  parseMaintenanceModeInput,
  resolveMaintenanceTargetMode,
} from "@flamenode/domain/admin";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";
import { resolveOperationMode } from "@/lib/operationMode/resolve";
import { writeOperationModeKvMirror } from "@/lib/operationMode/kvMirror";
import type { OperationMode } from "@/lib/operationMode/types";

export interface CostGuardResult { ok: boolean; message?: string; warning?: string }

type SettingsRow = typeof systemSettings.$inferSelect;
type SettingsPatch = Partial<typeof systemSettings.$inferInsert>;

function fail(error: unknown): CostGuardResult {
  unstable_rethrow(error);
  console.error("[cost-guard] atomic mutation failed", error);
  return { ok: false, message: "設定が競合したか、監査記録に失敗しました。再読み込みしてください。" };
}

async function syncOperationModeKvMirrorBestEffort(input: {
  mode: OperationMode;
  reason: string;
  updatedAt: number;
}): Promise<string | undefined> {
  const warnings = await runPostCommitBestEffort(
    { flow: "cost_guard", traceId: createTraceId() },
    [
      {
        name: "kv_mirror",
        run: async () => {
          await writeOperationModeKvMirror({
            mode: input.mode,
            updated_at: input.updatedAt,
            reason: input.reason,
          });
        },
      },
      {
        name: "revalidate",
        run: async () => {
          revalidatePath("/admin/cost-guard");
          revalidatePath("/admin");
        },
      },
    ],
  );
  if (warnings.some((w) => w.name === "kv_mirror")) {
    return "D1は更新済みですが、KV複製の更新に失敗しました。時間をおいて再度更新してください。";
  }
  return undefined;
}

async function loadSettings(
  db: DB,
): Promise<SettingsRow | null> {
  return (await db.select().from(systemSettings).where(eq(systemSettings.id, "default")).limit(1))[0] ?? null;
}

async function mutateSettings(input: {
  db: DB;
  before: SettingsRow;
  patch: SettingsPatch;
  actorUserId: string;
  reason: string;
  context: string;
  retentionClass?: "normal" | "long_audit";
}): Promise<CostGuardResult> {
  const after = { ...input.before, ...input.patch };
  try {
    await mutateWithAudit(input.db, {
      mutationStatements: [input.db.update(systemSettings).set(input.patch).where(and(
        eq(systemSettings.id, "default"),
        expectedRowCondition({ expectedCurrent: { ...input.before } }),
      )!)],
      expectedMutationChanges: 1,
      audits: [{
        table_name: "system_settings",
        target_id: "default",
        operation: "UPDATE",
        before: { ...input.before },
        after: { ...after },
        actor_user_id: input.actorUserId,
        reason: input.reason,
        context: input.context,
        retention_class: input.retentionClass ?? "long_audit",
        strict: true,
      }],
    });
    return { ok: true };
  } catch (error) { return fail(error); }
}

export async function setCostGuardMode(formData: FormData): Promise<CostGuardResult> {
  const guard = await requireCostGuardControlAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };
  const parsed = parseCostGuardModeInput(Object.fromEntries(formData));
  if (!parsed.ok) return parsed;
  const { mode, reason } = parsed;
  const db = guard.db;
  const before = await loadSettings(db);
  if (!before) return { ok: false, message: "system_settingsが見つかりません。" };
  const now = Math.floor(Date.now() / 1000);
  const result = await mutateSettings({ db, before, actorUserId: guard.user.id, reason, context: "cost_guard_mode", patch: { operation_mode: mode, cost_guard_reason: reason, cost_guard_updated_by_user_id: guard.user.id, cost_guard_updated_at: now } });
  if (!result.ok) return result;
  const warning = await syncOperationModeKvMirrorBestEffort({ mode, reason, updatedAt: now });
  return { ok: true, ...(warning ? { warning, message: warning } : {}) };
}

export async function setMaintenanceMode(formData: FormData): Promise<CostGuardResult> {
  const guard = await requireCostGuardControlAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };
  const parsed = parseMaintenanceModeInput({
    isMaintenanceMode: formData.get("is_maintenance_mode"),
    reason: formData.get("reason"),
  });
  if (!parsed.ok) return parsed;
  const { reason } = parsed;
  const db = guard.db;
  const before = await loadSettings(db);
  if (!before) return { ok: false, message: "system_settingsが見つかりません。" };
  const nextMode: OperationMode = resolveMaintenanceTargetMode(resolveOperationMode(before), parsed.enable);
  const now = Math.floor(Date.now() / 1000);
  const result = await mutateSettings({ db, before, actorUserId: guard.user.id, reason, context: "cost_guard_maintenance", patch: { operation_mode: nextMode, cost_guard_reason: reason, cost_guard_updated_by_user_id: guard.user.id, cost_guard_updated_at: now } });
  if (!result.ok) return result;
  const warning = await syncOperationModeKvMirrorBestEffort({ mode: nextMode, reason, updatedAt: now });
  return { ok: true, ...(warning ? { warning, message: warning } : {}) };
}

export async function setCostGuardOverride(formData: FormData): Promise<CostGuardResult> {
  const guard = await requireCostGuardControlAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };
  const parsed = parseCostGuardOverrideInput({
    reason: formData.get("reason"),
    confirm: formData.get("confirm"),
    features: formData.getAll("features"),
  });
  if (!parsed.ok) return parsed;
  const { reason, features } = parsed;
  const db = guard.db;
  const before = await loadSettings(db);
  if (!before) return { ok: false, message: "system_settingsが見つかりません。" };
  const now = Math.floor(Date.now() / 1000);
  const result = await mutateSettings({ db, before, actorUserId: guard.user.id, reason, context: "cost_guard_override_enable", patch: { cost_guard_exception_until: now + OVERRIDE_DURATION_SEC, cost_guard_exception_features_json: JSON.stringify(features), cost_guard_reason: `[15m override] ${reason}`, cost_guard_updated_by_user_id: guard.user.id, cost_guard_updated_at: now } });
  if (!result.ok) return result;
  await runPostCommitBestEffort(
    { flow: "cost_guard_override", traceId: createTraceId() },
    [{ name: "revalidate", run: async () => { revalidatePath("/admin/cost-guard"); } }],
  );
  return { ok: true, message: "15分間の例外を有効化しました。" };
}

/**
 * Cost Guard の恒久的な disabled feature set を管理する専用経路。
 * Spreadsheet から system_settings を直接更新させず、未知キー・重複・順序揺れを拒否する。
 */
export async function setDisabledFeatures(formData: FormData): Promise<CostGuardResult> {
  const guard = await requireCostGuardControlAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };
  const parsed = parseDisabledFeaturesInput({
    reason: formData.get("reason"),
    confirm: formData.get("confirm"),
    features: formData.getAll("features"),
  });
  if (!parsed.ok) return parsed;
  const { reason, features } = parsed;
  const db = guard.db;
  const before = await loadSettings(db);
  if (!before) return { ok: false, message: "system_settings が見つかりません。" };
  const expected = checkExpectedDisabledFeatures(
    formData.get("expected_disabled_features_json"),
    before.disabled_features_json ?? null,
  );
  if (!expected.ok) return expected;
  const now = Math.floor(Date.now() / 1000);
  const result = await mutateSettings({
    db,
    before,
    actorUserId: guard.user.id,
    reason,
    context: "cost_guard_disabled_features",
    patch: {
      disabled_features_json: JSON.stringify(features),
      cost_guard_reason: `[disabled features] ${reason}`,
      cost_guard_updated_by_user_id: guard.user.id,
      cost_guard_updated_at: now,
    },
  });
  if (!result.ok) return result;
  await runPostCommitBestEffort(
    { flow: "cost_guard_disabled_features", traceId: createTraceId() },
    [
      {
        name: "revalidate",
        run: async () => {
          revalidatePath("/admin/cost-guard");
          revalidatePath("/admin");
        },
      },
    ],
  );
  return { ok: true, message: "Cost Guard の無効化機能を更新しました。" };
}

export async function clearCostGuardOverride(formData: FormData): Promise<CostGuardResult> {
  const guard = await requireCostGuardControlAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };
  const parsed = parseClearCostGuardOverrideInput({
    reason: formData.get("reason"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.ok) return parsed;
  const { reason } = parsed;
  const db = guard.db;
  const before = await loadSettings(db);
  if (!before) return { ok: false, message: "system_settingsが見つかりません。" };
  const now = Math.floor(Date.now() / 1000);
  const result = await mutateSettings({ db, before, actorUserId: guard.user.id, reason, context: "cost_guard_override_clear", patch: { cost_guard_exception_until: null, cost_guard_exception_features_json: null, cost_guard_reason: `[override cleared] ${reason}`, cost_guard_updated_by_user_id: guard.user.id, cost_guard_updated_at: now } });
  if (!result.ok) return result;
  await runPostCommitBestEffort(
    { flow: "cost_guard_override_clear", traceId: createTraceId() },
    [{ name: "revalidate", run: async () => { revalidatePath("/admin/cost-guard"); } }],
  );
  return { ok: true, message: "例外を解除しました。" };
}
