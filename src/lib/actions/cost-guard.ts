"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { historyLogs, systemSettings } from "@/lib/db/schema";

export interface CostGuardResult {
  ok: boolean;
  message?: string;
}

const modeSchema = z.object({
  mode: z.enum(["normal", "economy", "read_only", "static_only", "maintenance"]),
  reason: z.string().trim().max(500).optional().nullable(),
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
      .where(eq(systemSettings.id, "global"))
      .limit(1)
  )[0];
  if (existing) {
    await db
      .update(systemSettings)
      .set(patch)
      .where(eq(systemSettings.id, "global"));
  } else {
    await db.insert(systemSettings).values({ id: "global", ...patch });
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
    cost_guard_mode: mode,
    cost_guard_reason: reason ?? null,
    cost_guard_updated_by_user_id: guard.userId,
    cost_guard_updated_at: now,
  });
  await db.insert(historyLogs).values({
    table_name: "system_settings",
    record_id: "global",
    action: "UPDATE",
    after_data: JSON.stringify({ cost_guard_mode: mode, reason }),
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
  await upsertGlobal(db, { is_maintenance_mode: next });
  await db.insert(historyLogs).values({
    table_name: "system_settings",
    record_id: "global",
    action: "UPDATE",
    after_data: JSON.stringify({ is_maintenance_mode: next }),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });
  revalidatePath("/admin/cost-guard");
  revalidatePath("/admin");
  return { ok: true };
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
