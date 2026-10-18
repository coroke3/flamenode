import { z } from "zod";
import {
  WRITE_FEATURE_KEYS,
  isWriteFeatureKey,
  type WriteFeatureKey,
} from "./costGuard.ts";
import type { OperationMode } from "./operationMode.ts";

/**
 * Input rules of the manual Cost Guard commands (SA-016..020), moved from
 * src/lib/actions/cost-guard.ts. The action keeps the admin guard, the
 * system_settings read, the full-row CAS + strict audit and the KV mirror.
 * Raw values are passed as read from the form, so trimming and messages stay
 * exactly as before.
 */

export const OVERRIDE_DURATION_SEC = 15 * 60;
const MAX_OVERRIDE_FEATURES = 8;
const MAX_DISABLED_FEATURES = 100;

type Rejected = { ok: false; message: string };

const modeSchema = z.object({
  mode: z.enum(["normal", "economy", "read_only", "static_only"]),
  reason: z.string().trim().min(1).max(500),
});

/** SA-016 setCostGuardMode. `entries` is `Object.fromEntries(formData)`. */
export function parseCostGuardModeInput(
  entries: Record<string, unknown>,
): { ok: true; mode: z.infer<typeof modeSchema>["mode"]; reason: string } | Rejected {
  const parsed = modeSchema.safeParse(entries);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  return { ok: true, ...parsed.data };
}

/** SA-017 setMaintenanceMode. */
export function parseMaintenanceModeInput(raw: {
  isMaintenanceMode: unknown;
  reason: unknown;
}): { ok: true; enable: boolean; reason: string } | Rejected {
  const next = Number(raw.isMaintenanceMode ?? 0);
  const reason = String(raw.reason ?? "").trim();
  if (next !== 0 && next !== 1) return { ok: false, message: "値が不正です。" };
  if (!reason || reason.length > 500) return { ok: false, message: "500文字以内の理由が必要です。" };
  return { ok: true, enable: next === 1, reason };
}

/** Turning maintenance off returns to normal; any other mode is kept. */
export function resolveMaintenanceTargetMode(
  currentMode: OperationMode,
  enable: boolean,
): OperationMode {
  return enable ? "maintenance" : currentMode === "maintenance" ? "normal" : currentMode;
}

/** SA-018 setCostGuardOverride: a short, confirmed, allowlisted exception. */
export function parseCostGuardOverrideInput(raw: {
  reason: unknown;
  confirm: unknown;
  features: readonly unknown[];
}): { ok: true; reason: string; features: WriteFeatureKey[] } | Rejected {
  const reason = String(raw.reason ?? "").trim();
  const confirm = String(raw.confirm ?? "").trim();
  const candidates = raw.features.map(String);
  if (!reason || reason.length > 500) return { ok: false, message: "500文字以内の理由が必要です。" };
  if (confirm !== "OVERRIDE") return { ok: false, message: "確認文字列OVERRIDEが一致しません。" };
  if (candidates.length === 0 || candidates.length > MAX_OVERRIDE_FEATURES || new Set(candidates).size !== candidates.length) return { ok: false, message: `対象機能は重複なしで1〜${MAX_OVERRIDE_FEATURES}件指定してください。` };
  if (!candidates.every(isWriteFeatureKey)) return { ok: false, message: "未知の機能キーが含まれています。" };
  return { ok: true, reason, features: candidates as WriteFeatureKey[] };
}

/**
 * SA-019 setDisabledFeatures: unknown keys, duplicates and order drift are
 * rejected; the stored list always follows WRITE_FEATURE_KEYS order.
 */
export function parseDisabledFeaturesInput(raw: {
  reason: unknown;
  confirm: unknown;
  features: readonly unknown[];
}): { ok: true; reason: string; features: WriteFeatureKey[] } | Rejected {
  const reason = String(raw.reason ?? "").trim();
  const confirm = String(raw.confirm ?? "").trim();
  const candidates = raw.features.map((value) => String(value).trim());
  if (!reason || reason.length > 500) {
    return { ok: false, message: "reason は1〜500文字で指定してください。" };
  }
  if (confirm !== "APPLY") {
    return { ok: false, message: "確認文字列 APPLY が一致しません。" };
  }
  if (candidates.length > MAX_DISABLED_FEATURES || new Set(candidates).size !== candidates.length) {
    return { ok: false, message: "機能キーが重複しているか、件数上限を超えています。" };
  }
  if (!candidates.every(isWriteFeatureKey)) {
    return { ok: false, message: "未許可の機能キーが含まれています。" };
  }
  const selected = new Set(candidates as WriteFeatureKey[]);
  return { ok: true, reason, features: WRITE_FEATURE_KEYS.filter((feature) => selected.has(feature)) };
}

/**
 * SA-019 optimistic check: the form carries the JSON-encoded
 * disabled_features_json it was rendered from.
 */
export function checkExpectedDisabledFeatures(
  expectedDisabledFeatures: unknown,
  currentDisabledFeaturesJson: string | null,
): { ok: true } | Rejected {
  const stale = { ok: false, message: "設定の取得時点を確認できません。ページを再読み込みしてください。" } as const;
  if (typeof expectedDisabledFeatures !== "string") return stale;
  let expectedDisabledFeaturesValue: string | null;
  try {
    const decoded = JSON.parse(expectedDisabledFeatures) as unknown;
    if (decoded !== null && typeof decoded !== "string") return stale;
    expectedDisabledFeaturesValue = decoded;
  } catch {
    return stale;
  }
  if (expectedDisabledFeaturesValue !== currentDisabledFeaturesJson) {
    return { ok: false, message: "設定が別の管理者によって変更されています。ページを再読み込みしてください。" };
  }
  return { ok: true };
}

/** SA-020 clearCostGuardOverride. */
export function parseClearCostGuardOverrideInput(raw: {
  reason: unknown;
  confirm: unknown;
}): { ok: true; reason: string } | Rejected {
  const reason = String(raw.reason ?? "").trim();
  const confirm = String(raw.confirm ?? "").trim();
  if (!reason || reason.length > 500) return { ok: false, message: "500文字以内の解除理由が必要です。" };
  if (confirm !== "CLEAR") return { ok: false, message: "確認文字列CLEARが一致しません。" };
  return { ok: true, reason };
}
