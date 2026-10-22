/**
 * MIG-0602 U02: CostGuard check for admin write routes.
 *
 * Mirrors CURRENT src/lib/auth/writeGuard.ts evaluateCostGuard + the position
 * of the check (right after identity, before any handler work):
 *   - system_settings "default" row missing -> maintenance_mode (503)
 *   - operation_mode / disabled_features blocked -> maintenance_mode / cost_guard_blocked (503)
 *   - read error -> cost_guard_blocked (503)
 * Decision logic is @flamenode/domain/admin evaluateCostGuardCore (shared).
 */
import {
  evaluateCostGuardCore,
  type WriteFeatureKey,
} from "@flamenode/domain/admin";
import type { Context, Next } from "hono";
import { writeGuardDenyResponse } from "./writeOrigin.ts";

type CostGuardRow = {
  operation_mode: string | null;
  disabled_features_json: string | null;
  cost_guard_exception_until: number | null;
  cost_guard_exception_features_json: string | null;
};

export type CostGuardDenyReason = "maintenance_mode" | "cost_guard_blocked";

export async function evaluateCostGuard(
  db: D1Database,
  feature: WriteFeatureKey,
  now: number = Math.floor(Date.now() / 1000),
): Promise<CostGuardDenyReason | null> {
  try {
    const row = await db
      .prepare(
        `SELECT operation_mode, disabled_features_json,
                cost_guard_exception_until, cost_guard_exception_features_json
         FROM system_settings WHERE id = ? LIMIT 1`,
      )
      .bind("default")
      .first<CostGuardRow>();
    if (!row) return "maintenance_mode";
    const decision = evaluateCostGuardCore({
      feature,
      operationMode: row.operation_mode,
      disabledFeaturesJson: row.disabled_features_json,
      exceptionUntil: row.cost_guard_exception_until,
      exceptionFeaturesJson: row.cost_guard_exception_features_json,
      now,
    });
    if (!decision.blocked) return null;
    return decision.reason === "mode" ? "maintenance_mode" : "cost_guard_blocked";
  } catch {
    return "cost_guard_blocked";
  }
}

/** Run after writeGuardMiddleware (identity). All denials are HTTP 503. */
export function costGuardMiddleware(feature: WriteFeatureKey) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const db = (c.env as { DB?: D1Database }).DB;
    // writeGuardMiddleware already returned 503 db_unavailable without a DB.
    const denied = db ? await evaluateCostGuard(db, feature) : "cost_guard_blocked";
    if (denied) {
      return writeGuardDenyResponse(c, denied, 503);
    }
    await next();
  };
}
