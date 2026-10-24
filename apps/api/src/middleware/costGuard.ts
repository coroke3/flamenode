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
import { mapAuditSettings, type AuditSettingsRow } from "@flamenode/server-core/audit/settings";
import type { AuditLogSettings } from "@flamenode/server-core/audit/types";
import { MAX_SINGLE_ROW_LIMIT } from "../lib/limits.ts";
import { writeGuardDenyResponse } from "./writeOrigin.ts";

type CostGuardRow = AuditSettingsRow & {
  operation_mode: string | null;
  disabled_features_json: string | null;
  cost_guard_exception_until: number | null;
  cost_guard_exception_features_json: string | null;
};

export type CostGuardDenyReason = "maintenance_mode" | "cost_guard_blocked";

/**
 * One system_settings read serves both CostGuard and the audit retention
 * settings (ZERO_1102 S3: at most 3 D1 pre-reads). auditSettings is the
 * mapAuditSettings result of the same row (CURRENT reads the same row twice).
 */
export async function evaluateCostGuardWithSettings(
  db: D1Database,
  feature: WriteFeatureKey,
  now: number = Math.floor(Date.now() / 1000),
): Promise<{ denied: CostGuardDenyReason | null; auditSettings?: AuditLogSettings }> {
  try {
    const row = await db
      .prepare(
        `SELECT operation_mode, disabled_features_json,
                cost_guard_exception_until, cost_guard_exception_features_json,
                audit_normal_retention_days, audit_restorable_retention_days,
                audit_long_retention_days, audit_max_payload_bytes, audit_compact_after_days
         FROM system_settings WHERE id = ? LIMIT ${MAX_SINGLE_ROW_LIMIT}`,
      )
      .bind("default")
      .first<CostGuardRow>();
    if (!row) return { denied: "maintenance_mode" };
    const decision = evaluateCostGuardCore({
      feature,
      operationMode: row.operation_mode,
      disabledFeaturesJson: row.disabled_features_json,
      exceptionUntil: row.cost_guard_exception_until,
      exceptionFeaturesJson: row.cost_guard_exception_features_json,
      now,
    });
    if (decision.blocked) {
      return {
        denied: decision.reason === "mode" ? "maintenance_mode" : "cost_guard_blocked",
      };
    }
    return { denied: null, auditSettings: mapAuditSettings(row) };
  } catch {
    return { denied: "cost_guard_blocked" };
  }
}

export async function evaluateCostGuard(
  db: D1Database,
  feature: WriteFeatureKey,
  now: number = Math.floor(Date.now() / 1000),
): Promise<CostGuardDenyReason | null> {
  return (await evaluateCostGuardWithSettings(db, feature, now)).denied;
}

/**
 * Run after writeGuardMiddleware (identity). All denials are HTTP 503.
 * On success sets the "auditSettings" request variable for mutateWithAudit.
 */
export function costGuardMiddleware(feature: WriteFeatureKey) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    // writeGuardMiddleware({ activeX }) already evaluated CostGuard itself.
    if (c.get("costGuardEvaluated") === true) {
      await next();
      return;
    }
    const db = (c.env as { DB?: D1Database }).DB;
    // writeGuardMiddleware already returned 503 db_unavailable without a DB.
    const result = db
      ? await evaluateCostGuardWithSettings(db, feature)
      : { denied: "cost_guard_blocked" as const };
    if (result.denied) {
      return writeGuardDenyResponse(c, result.denied, 503);
    }
    if (result.auditSettings) c.set("auditSettings", result.auditSettings);
    await next();
  };
}

