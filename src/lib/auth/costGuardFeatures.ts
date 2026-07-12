import "server-only";
import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { systemSettings } from "@/lib/db/schema";
import { normalizeOperationMode } from "@/lib/operationMode/resolve";
import {
  parseWriteFeatureList,
  type WriteFeatureKey,
} from "./writeGuardCore";

/**
 * CostGuard の機能キー。
 * slot 系は reserve / release / split / extend / merge の 5 種類を区別する。
 */
export type CostGuardFeatureKey = WriteFeatureKey;

export type CostGuardCheckResult =
  | { blocked: false }
  | { blocked: true; reason: "mode" | "feature" };

/**
 * CostGuard 判定。常に DB 直読み (本PR範囲ではキャッシュなし)。
 *
 * 判定順:
 * 1. operation_mode が不正、または read_only / static_only / maintenance → mode で停止
 * 2. disabled_features_json が不正、または feature を含む → feature で停止
 * 3. それ以外 → 通す
 * 管理者を含め例外設定によるbypassは行わない。
 */
export async function evaluateCostGuard(
  db: DB,
  feature: CostGuardFeatureKey,
): Promise<CostGuardCheckResult> {
  const row = (
    await db
      .select({
        operation_mode: systemSettings.operation_mode,
        disabled_features_json: systemSettings.disabled_features_json,
      })
      .from(systemSettings)
      .where(eq(systemSettings.id, "default"))
      .limit(1)
  )[0];

  // baselineはdefault行を必ず作る。不在は設定破損としてfail-closedにする。
  if (!row) return { blocked: true, reason: "mode" };

  const mode = normalizeOperationMode(row.operation_mode);
  if (!mode) return { blocked: true, reason: "mode" };
  if (mode === "read_only" || mode === "static_only" || mode === "maintenance") {
    return { blocked: true, reason: "mode" };
  }

  const disabled = parseWriteFeatureList(row.disabled_features_json);
  if (!disabled.ok || disabled.features.includes(feature)) {
    return { blocked: true, reason: "feature" };
  }
  return { blocked: false };
}
