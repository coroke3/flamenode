"use server";

/**
 * 手動 CostGuard Server Actions。
 * `operation_mode` / `disabled_features_json` の D1 書き込み正本はここ（と spreadsheet import の admin 経路）のみ。
 * Cloudflare 使用量に基づく自動昇格・自動降格は行わない。
 */

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { systemSettings } from "@/lib/db/schema";
import {
  requireCostGuardControlAdmin,
} from "@/lib/auth/writeGuard";
import {
  isWriteFeatureKey,
  type WriteFeatureKey,
} from "@/lib/auth/writeGuardCore";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";
import { resolveOperationMode } from "@/lib/operationMode/resolve";
import { writeOperationModeKvMirror } from "@/lib/operationMode/kvMirror";
import type { OperationMode } from "@/lib/operationMode/types";

export interface CostGuardResult { ok: boolean; message?: string; warning?: string }

const OVERRIDE_DURATION_SEC = 15 * 60;
const MAX_OVERRIDE_FEATURES = 8;
const modeSchema = z.object({
  mode: z.enum(["normal", "economy", "read_only", "static_only"]),
  reason: z.string().trim().min(1).max(500),
});
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
  db: NonNullable<ReturnType<typeof getDatabase>>,
): Promise<SettingsRow | null> {
  return (await db.select().from(systemSettings).where(eq(systemSettings.id, "default")).limit(1))[0] ?? null;
}

async function mutateSettings(input: {
  db: NonNullable<ReturnType<typeof getDatabase>>;
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
  const parsed = modeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  const { mode, reason } = parsed.data;
  const db = getDatabase();
  if (!db) return { ok: false, message: "DBに接続できません。" };
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
  const next = Number(formData.get("is_maintenance_mode") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();
  if (next !== 0 && next !== 1) return { ok: false, message: "値が不正です。" };
  if (!reason || reason.length > 500) return { ok: false, message: "500文字以内の理由が必要です。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DBに接続できません。" };
  const before = await loadSettings(db);
  if (!before) return { ok: false, message: "system_settingsが見つかりません。" };
  const currentMode = resolveOperationMode(before);
  const nextMode: OperationMode = next === 1 ? "maintenance" : currentMode === "maintenance" ? "normal" : currentMode;
  const now = Math.floor(Date.now() / 1000);
  const result = await mutateSettings({ db, before, actorUserId: guard.user.id, reason, context: "cost_guard_maintenance", patch: { operation_mode: nextMode, cost_guard_reason: reason, cost_guard_updated_by_user_id: guard.user.id, cost_guard_updated_at: now } });
  if (!result.ok) return result;
  const warning = await syncOperationModeKvMirrorBestEffort({ mode: nextMode, reason, updatedAt: now });
  return { ok: true, ...(warning ? { warning, message: warning } : {}) };
}

export async function setCostGuardOverride(formData: FormData): Promise<CostGuardResult> {
  const guard = await requireCostGuardControlAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };
  const reason = String(formData.get("reason") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();
  const candidates = formData.getAll("features").map(String);
  if (!reason || reason.length > 500) return { ok: false, message: "500文字以内の理由が必要です。" };
  if (confirm !== "OVERRIDE") return { ok: false, message: "確認文字列OVERRIDEが一致しません。" };
  if (candidates.length === 0 || candidates.length > MAX_OVERRIDE_FEATURES || new Set(candidates).size !== candidates.length) return { ok: false, message: `対象機能は重複なしで1〜${MAX_OVERRIDE_FEATURES}件指定してください。` };
  if (!candidates.every(isWriteFeatureKey)) return { ok: false, message: "未知の機能キーが含まれています。" };
  const features = candidates as WriteFeatureKey[];
  const db = getDatabase();
  if (!db) return { ok: false, message: "DBに接続できません。" };
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

export async function clearCostGuardOverride(formData: FormData): Promise<CostGuardResult> {
  const guard = await requireCostGuardControlAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };
  const reason = String(formData.get("reason") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (!reason || reason.length > 500) return { ok: false, message: "500文字以内の解除理由が必要です。" };
  if (confirm !== "CLEAR") return { ok: false, message: "確認文字列CLEARが一致しません。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DBに接続できません。" };
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
