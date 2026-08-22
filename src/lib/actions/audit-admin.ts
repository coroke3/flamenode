"use server";

import { z } from "zod";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import type { DB } from "@/lib/db/client";
import { updateAuditLogSettings } from "@/lib/audit/settings";
import { restoreAuditLog } from "@/lib/audit/restore";
import type { AuditLogSettings, RestoreResult } from "@/lib/audit/types";

// ============================================================
// 共通ヘルパー
// ============================================================

interface ActionError {
  ok: false;
  message: string;
}

async function requireAdmin(): Promise<
  { ok: true; userId: string; db: DB } | ActionError
> {
  const guard = await requireAdminWrite("admin_permissions");
  if (!guard.ok) return { ok: false, message: guard.message };
  return { ok: true, userId: guard.user.id, db: guard.db };
}

// ============================================================
// updateAuditLogSettingsAction
// ============================================================

const settingsPatchSchema = z.object({
  normal_retention_days: z.coerce.number().int().min(7).max(365).optional(),
  restorable_retention_days: z.coerce.number().int().min(14).max(1095).optional(),
  long_audit_retention_days: z.coerce.number().int().min(30).max(3650).optional(),
  max_payload_bytes: z.coerce.number().int().min(1000).max(1000000).optional(),
  compact_after_days: z.coerce.number().int().min(1).max(365).optional(),
});

export interface UpdateAuditLogSettingsResult {
  ok: boolean;
  message?: string;
}

/**
 * 監査ログ設定を更新するサーバーアクション。
 */
export async function updateAuditLogSettingsAction(
  formData: FormData,
): Promise<UpdateAuditLogSettingsResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };

  const parsed = settingsPatchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }

  const db = guard.db;

  try {
    await updateAuditLogSettings(db, guard.userId, parsed.data as Partial<AuditLogSettings>);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "設定の更新に失敗しました。";
    return { ok: false, message: msg };
  }
}

// ============================================================
// getAuditLogDryRun
// ============================================================

const dryRunSchema = z.object({
  audit_id: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(500),
});

export interface AuditLogDryRunResult {
  ok: boolean;
  message?: string;
  diff?: RestoreResult["diff"];
}

/**
 * リストアの dry run を実行するサーバーアクション。
 * 実際の書き込みは行わず、競合情報と差分を返す。
 */
export async function getAuditLogDryRun(
  formData: FormData,
): Promise<AuditLogDryRunResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };

  const parsed = dryRunSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }

  const db = guard.db;

  const result = await restoreAuditLog(db, {
    auditId: parsed.data.audit_id,
    userId: guard.userId,
    reason: parsed.data.reason,
    dry_run: true,
  });

  return {
    ok: result.ok,
    message: result.message,
    diff: result.diff,
  };
}

// ============================================================
// restoreAuditLogAction
// ============================================================

const restoreSchema = z.object({
  audit_id: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(500),
  confirm_text: z.string().trim().optional(),
  force_overwrite: z.coerce.number().int().min(0).max(1).default(0),
});

export interface RestoreAuditLogActionResult {
  ok: boolean;
  message?: string;
  restore_run_id?: string;
  diff?: RestoreResult["diff"];
}

/**
 * 監査ログからのリストアを実行するサーバーアクション。
 */
export async function restoreAuditLogAction(
  formData: FormData,
): Promise<RestoreAuditLogActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };

  const parsed = restoreSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }

  const db = guard.db;

  const result = await restoreAuditLog(db, {
    auditId: parsed.data.audit_id,
    userId: guard.userId,
    reason: parsed.data.reason,
    confirmText: parsed.data.confirm_text,
    forceOverwrite: parsed.data.force_overwrite === 1,
    dry_run: false,
  });

  return {
    ok: result.ok,
    message: result.message,
    restore_run_id: result.restore_run_id,
    diff: result.diff,
  };
}
