"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { historyLogs, systemSettings } from "@/lib/db/schema";
import type { OperationMode } from "@/lib/operationMode/types";

export interface CostGuardResult {
  ok: boolean;
  message?: string;
}

const modeSchema = z.object({
  mode: z.enum(["normal", "economy", "read_only", "static_only", "maintenance"]),
  reason: z.string().trim().max(500).optional().nullable(),
});

const advancedSettingsSchema = z.object({
  thresholds_json: z.string().trim().max(4000).optional().nullable(),
  exception_until: z.string().trim().optional().nullable(),
  exception_features_json: z.string().trim().max(2000).optional().nullable(),
});

async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; result: CostGuardResult }
> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) return { ok: false, result: { ok: false, message: "ログインが必要です。" } };
  if (u.role !== "admin")
    return {
      ok: false,
      result: { ok: false, message: "管理者のみ操作できます。" },
    };
  return { ok: true, userId: u.id };
}

async function upsertGlobal(
  db: NonNullable<ReturnType<typeof import("@/lib/cloudflare").getDatabase>>,
  patch: Partial<typeof systemSettings.$inferInsert>,
): Promise<void> {
  const existing = (
    await db
      .select({ id: systemSettings.id })
      .from(systemSettings)
      .where(eq(systemSettings.id, "default"))
      .limit(1)
  )[0];
  if (existing) {
    await db
      .update(systemSettings)
      .set(patch)
      .where(eq(systemSettings.id, "default"));
  } else {
    await db.insert(systemSettings).values({ id: "default", ...patch });
  }
}

export async function setCostGuardMode(
  formData: FormData,
): Promise<CostGuardResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const parsed = modeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  const { mode, reason } = parsed.data;
  if (mode !== "normal" && !reason) {
    return {
      ok: false,
      message: "normal 以外への変更には理由が必要です。",
    };
  }
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const now = Math.floor(Date.now() / 1000);
  await upsertGlobal(db, {
    operation_mode: mode,
    is_maintenance_mode: mode === "maintenance" ? 1 : 0,
    cost_guard_reason: reason ?? null,
    cost_guard_updated_by_user_id: guard.userId,
    cost_guard_updated_at: now,
  });
  await db.insert(historyLogs).values({
    table_name: "system_settings",
    record_id: "global",
    action: "UPDATE",
    after_data: JSON.stringify({ operation_mode: mode, reason }),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });
  revalidatePath("/admin/cost-guard");
  revalidatePath("/admin");
  return { ok: true };
}

export async function setMaintenanceMode(
  formData: FormData,
): Promise<CostGuardResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const next = Number(formData.get("is_maintenance_mode") ?? 0);
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const now = Math.floor(Date.now() / 1000);
  const current = (
    await db
      .select({
        operation_mode: systemSettings.operation_mode,
      })
      .from(systemSettings)
      .where(eq(systemSettings.id, "default"))
      .limit(1)
  )[0];
  const currentMode = normalizeOperationMode(
    current?.operation_mode,
  );
  const nextMode: OperationMode =
    next === 1 ? "maintenance" : currentMode === "maintenance" ? "normal" : currentMode;
  await upsertGlobal(db, {
    operation_mode: nextMode,
    is_maintenance_mode: next === 1 ? 1 : 0,
  });
  await db.insert(historyLogs).values({
    table_name: "system_settings",
    record_id: "global",
    action: "UPDATE",
    after_data: JSON.stringify({ operation_mode: nextMode, is_maintenance_mode: next }),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });
  revalidatePath("/admin/cost-guard");
  revalidatePath("/admin");
  return { ok: true };
}

function normalizeOperationMode(value: string | null | undefined): OperationMode {
  if (
    value === "normal" ||
    value === "economy" ||
    value === "read_only" ||
    value === "static_only" ||
    value === "maintenance"
  ) {
    return value;
  }
  return "normal";
}

export async function setAutoCostGuard(
  formData: FormData,
): Promise<CostGuardResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const next = Number(formData.get("auto_cost_guard_enabled") ?? 1);
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const now = Math.floor(Date.now() / 1000);
  await upsertGlobal(db, { auto_cost_guard_enabled: next });
  await db.insert(historyLogs).values({
    table_name: "system_settings",
    record_id: "global",
    action: "UPDATE",
    after_data: JSON.stringify({ auto_cost_guard_enabled: next }),
    operator_discord_id: guard.userId,
    retention_class: "normal",
    created_at: now,
  });
  revalidatePath("/admin/cost-guard");
  return { ok: true };
}

export async function setCostGuardAdvancedSettings(
  formData: FormData,
): Promise<CostGuardResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const parsed = advancedSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const thresholdsJson = normalizeJsonString(parsed.data.thresholds_json, "閾値JSON");
  if (!thresholdsJson.ok) return { ok: false, message: thresholdsJson.message };
  const exceptionFeaturesJson = normalizeJsonString(
    parsed.data.exception_features_json,
    "例外機能JSON",
  );
  if (!exceptionFeaturesJson.ok) {
    return { ok: false, message: exceptionFeaturesJson.message };
  }
  const exceptionUntil = parseDateTime(parsed.data.exception_until);
  const now = Math.floor(Date.now() / 1000);
  const patch = {
    cost_guard_thresholds_json: thresholdsJson.value,
    cost_guard_exception_until: exceptionUntil,
    cost_guard_exception_features_json: exceptionFeaturesJson.value,
  };
  await upsertGlobal(db, patch);
  await db.insert(historyLogs).values({
    table_name: "system_settings",
    record_id: "global",
    action: "UPDATE",
    after_data: JSON.stringify(patch),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });
  revalidatePath("/admin/cost-guard");
  return { ok: true, message: "詳細設定を更新しました。" };
}

function normalizeJsonString(
  value: string | null | undefined,
  label: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return { ok: true, value: null };
  try {
    JSON.parse(trimmed);
    return { ok: true, value: trimmed };
  } catch {
    return { ok: false, message: `${label} を解析できません。` };
  }
}

function parseDateTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}
