import "server-only";
import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { systemSettings } from "@/lib/db/schema";
import type { OperationMode } from "@/lib/operationMode/types";

/**
 * CostGuard の機能キー。
 * slot 系は reserve / release / split / extend / merge の 5 種類を区別する。
 */
export type CostGuardFeatureKey =
  | "post_video_unslotted"
  | "post_video_slotted"
  | "edit_video"
  | "like_or_bookmark"
  | "chapter_comment"
  | "reserve_slot"
  | "release_slot"
  | "split_slot_group"
  | "extend_slot_group"
  | "merge_slot_groups";

export type CostGuardCheckResult =
  | { blocked: false }
  | { blocked: true; reason: "mode" | "feature" };

/**
 * CostGuard 判定。常に DB 直読み (本PR範囲ではキャッシュなし)。
 *
 * 判定順:
 * 1. cost_guard_exception_features_json に feature があり、例外期限内 → 通す
 * 2. cost_guard_mode が read_only / static_only / maintenance → mode で停止
 * 3. disabled_features_json に feature があれば → feature で停止
 * 4. それ以外 → 通す
 *
 * disabled_features_json / cost_guard_exception_features_json の parse 失敗は
 * 全停止を避けるためフェイルオープン。console.warn のみで検知できるようにする。
 */
export async function evaluateCostGuard(
  db: DB,
  feature: CostGuardFeatureKey,
): Promise<CostGuardCheckResult> {
  const row = (
    await db
      .select({
        operation_mode: systemSettings.operation_mode,
        cost_guard_mode: systemSettings.cost_guard_mode,
        is_maintenance_mode: systemSettings.is_maintenance_mode,
        disabled_features_json: systemSettings.disabled_features_json,
        cost_guard_exception_until: systemSettings.cost_guard_exception_until,
        cost_guard_exception_features_json:
          systemSettings.cost_guard_exception_features_json,
      })
      .from(systemSettings)
      .where(eq(systemSettings.id, "default"))
      .limit(1)
  )[0];

  if (!row) return { blocked: false };

  const now = Math.floor(Date.now() / 1000);
  const exceptionActive =
    row.cost_guard_exception_until != null &&
    row.cost_guard_exception_until > now;
  if (exceptionActive) {
    const exceptionFeatures = parseFeatureList(
      row.cost_guard_exception_features_json,
      "cost_guard_exception_features_json",
    );
    if (exceptionFeatures.includes(feature)) return { blocked: false };
  }

  const mode = resolveOperationMode(row);
  if (mode === "read_only" || mode === "static_only" || mode === "maintenance") {
    return { blocked: true, reason: "mode" };
  }

  const disabled = parseFeatureList(
    row.disabled_features_json,
    "disabled_features_json",
  );
  if (disabled.includes(feature)) {
    return { blocked: true, reason: "feature" };
  }
  return { blocked: false };
}

function resolveOperationMode(row: {
  operation_mode?: string | null;
  cost_guard_mode?: string | null;
  is_maintenance_mode?: number | null;
}): OperationMode {
  const raw = row.operation_mode ?? row.cost_guard_mode ?? "normal";
  if (isOperationMode(raw)) return raw;
  if (row.is_maintenance_mode === 1) return "maintenance";
  return "normal";
}

function isOperationMode(value: string): value is OperationMode {
  return (
    value === "normal" ||
    value === "economy" ||
    value === "read_only" ||
    value === "static_only" ||
    value === "maintenance"
  );
}

function parseFeatureList(raw: string | null, column: string): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      return v as string[];
    }
    console.warn(
      `[costGuard] ${column} is not string[]; treating as empty (fail-open)`,
    );
    return [];
  } catch (e) {
    console.warn(
      `[costGuard] failed to parse ${column}; treating as empty (fail-open)`,
      e,
    );
    return [];
  }
}
