import "server-only";
import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { systemSettings } from "@/lib/db/schema";
import {
  evaluateCostGuardCore,
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
 * 1. activeで既知featureだけの明示override対象なら通す
 * 2. operation_mode が不正、または read_only / static_only / maintenance → mode で停止
 * 3. disabled_features_json が不正、または feature を含む → feature で停止
 * 4. それ以外 → 通す
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
        cost_guard_exception_until: systemSettings.cost_guard_exception_until,
        cost_guard_exception_features_json:
          systemSettings.cost_guard_exception_features_json,
      })
      .from(systemSettings)
      .where(eq(systemSettings.id, "default"))
      .limit(1)
  )[0];

  // baselineはdefault行を必ず作る。不在は設定破損としてfail-closedにする。
  if (!row) return { blocked: true, reason: "mode" };

  const now = Math.floor(Date.now() / 1000);
  return evaluateCostGuardCore({
    feature,
    operationMode: row.operation_mode,
    disabledFeaturesJson: row.disabled_features_json,
    exceptionUntil: row.cost_guard_exception_until,
    exceptionFeaturesJson: row.cost_guard_exception_features_json,
    now,
  });
}
