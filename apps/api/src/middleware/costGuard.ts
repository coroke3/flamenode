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
  WRITE_FEATURE_KEYS,
  type WriteFeatureKey,
} from "@flamenode/domain/admin";
import type { Context, Next } from "hono";
import { mapAuditSettings, type AuditSettingsRow } from "@flamenode/server-core/audit/settings";
import type { AuditLogSettings } from "@flamenode/server-core/audit/types";
import { MAX_SINGLE_ROW_LIMIT } from "../lib/limits.ts";
import { writeGuardDenyResponse } from "./writeOrigin.ts";

// Keep joined and standalone admission receipts small without changing CostGuard's
// exception-first decision order. Invalid input remains invalid JSON, not NULL.
const KNOWN_WRITE_FEATURE_BLOBS_SQL = WRITE_FEATURE_KEYS.map(
  (key) => "CAST('" + key.replaceAll("'", "''") + "' AS BLOB)",
).join(",");
export function compactWriteFeatureListSql(
  col: 's."disabled_features_json"' | 's."cost_guard_exception_features_json"',
): string {
  return `CASE
    WHEN ${col} IS NULL OR (typeof(${col})='text' AND length(CAST(${col} AS BLOB))=0) THEN NULL
    WHEN typeof(${col})<>'text' OR instr(CAST(${col} AS BLOB), X'00')>0 THEN '!'
    WHEN json_valid(${col})<>1 THEN '!'
    WHEN json_type(${col})<>'array' THEN '!'
    WHEN json_array_length(${col})>100 THEN '!'
    WHEN EXISTS (
      SELECT 1 FROM json_each(${col}) AS j
      WHERE j.type<>'text' OR CAST(j.atom AS BLOB) NOT IN (${KNOWN_WRITE_FEATURE_BLOBS_SQL})
    ) THEN '!'
    ELSE (SELECT json_group_array(v) FROM (
      SELECT DISTINCT j.atom AS v FROM json_each(${col}) AS j ORDER BY v
    ))
  END`;
}

// Only these canonical mode strings are consumed by CostGuard. Preserve
// recognized values and NULL; an unknown value remains non-allowing without
// copying arbitrary TEXT/BLOB bytes into the request-local receipt. Compare
// bytes explicitly so a case-insensitive collation cannot widen acceptance.
export const COMPACT_COST_GUARD_MODE_SQL = `CASE
  WHEN s."operation_mode" IS NULL THEN NULL
  WHEN typeof(s."operation_mode")='text'
    AND CAST(s."operation_mode" AS BLOB) IN (
      CAST('normal' AS BLOB), CAST('economy' AS BLOB),
      CAST('read_only' AS BLOB), CAST('static_only' AS BLOB),
      CAST('maintenance' AS BLOB)
    ) THEN s."operation_mode"
  ELSE '!'
END`;

// The domain uses exceptionUntil only in a numeric relational comparison.
// Oversized legacy TEXT may contain padding around a JS numeric string
// (e.g. hexadecimal); SQLite CAST would change that decision. Strip only
// ASCII ECMAScript whitespace at the edges, and retain embedded-NUL and
// non-TEXT values exactly. This is a lossless decision optimization, NOT
// a universal scalar or admission-row size bound.
export const COMPACT_COST_GUARD_EXCEPTION_UNTIL_SQL = `CASE
  WHEN typeof(s."cost_guard_exception_until") = 'text'
    AND length(CAST(s."cost_guard_exception_until" AS BLOB)) > 8192
    AND instr(CAST(s."cost_guard_exception_until" AS BLOB), X'00') = 0
  THEN trim(s."cost_guard_exception_until", char(9,10,11,12,13,32))
  ELSE s."cost_guard_exception_until"
END`;

// Audit settings in admission receipts are only a preload. The audit logger
// accepts a complete snapshot of nonnegative safe integers, otherwise its
// existing planner/runtime charge and execute the authoritative settings read.
// SQLite's INTEGER affinity can hold huge TEXT/BLOB values. Such values
// cannot be valid preloads; send NULL (still invalid), never a default or a
// numeric cast. Preserve every numeric value and the missing-row distinction.
// This bounds these five receipt fields, not the authoritative fallback read.
export function compactAuditSettingSql(column: keyof AuditSettingsRow): string {
  const col = `s."${column}"`;
  return `CASE WHEN typeof(${col}) IN ('integer', 'real', 'null')
    THEN ${col} ELSE NULL END`;
}

export type CostGuardRow = AuditSettingsRow & {
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
export type CostGuardSnapshot = {
  row: CostGuardRow | null;
  /** True only when the joined read and the source-specific fallback both failed. */
  unavailable?: boolean;
};

/** Read the canonical default row; used only on the joined-read fallback path. */
export async function loadCostGuardSettingsRow(
  db: D1Database,
): Promise<CostGuardRow | null> {
  return db
    .prepare(
      `SELECT ${COMPACT_COST_GUARD_MODE_SQL} AS operation_mode,
              ${compactWriteFeatureListSql('s."disabled_features_json"')} AS disabled_features_json,
              ${COMPACT_COST_GUARD_EXCEPTION_UNTIL_SQL} AS cost_guard_exception_until,
              ${compactWriteFeatureListSql('s."cost_guard_exception_features_json"')} AS cost_guard_exception_features_json,
              ${compactAuditSettingSql("audit_normal_retention_days")} AS audit_normal_retention_days,
              ${compactAuditSettingSql("audit_restorable_retention_days")} AS audit_restorable_retention_days,
              ${compactAuditSettingSql("audit_long_retention_days")} AS audit_long_retention_days,
              ${compactAuditSettingSql("audit_max_payload_bytes")} AS audit_max_payload_bytes,
              ${compactAuditSettingSql("audit_compact_after_days")} AS audit_compact_after_days
       FROM system_settings s WHERE s."id" = ? LIMIT ${MAX_SINGLE_ROW_LIMIT}`,
    )
    .bind("default")
    .first<CostGuardRow>();
}

export function evaluateCostGuardFromRow(
  row: CostGuardRow | null,
  feature: WriteFeatureKey,
  now: number = Math.floor(Date.now() / 1000),
): { denied: CostGuardDenyReason | null; auditSettings?: AuditLogSettings } {
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
}

export function evaluateCostGuardSnapshot(
  snapshot: CostGuardSnapshot,
  feature: WriteFeatureKey,
  now: number = Math.floor(Date.now() / 1000),
): { denied: CostGuardDenyReason | null; auditSettings?: AuditLogSettings } {
  if (snapshot.unavailable) return { denied: "cost_guard_blocked" };
  return evaluateCostGuardFromRow(snapshot.row, feature, now);
}

/**
 * Existing standalone adapter. Routes outside the shared write guard keep
 * the same one-read behavior and fixed-code provider failure mapping.
 */
export async function evaluateCostGuardWithSettings(
  db: D1Database,
  feature: WriteFeatureKey,
  now: number = Math.floor(Date.now() / 1000),
): Promise<{ denied: CostGuardDenyReason | null; auditSettings?: AuditLogSettings }> {
  try {
    return evaluateCostGuardFromRow(await loadCostGuardSettingsRow(db), feature, now);
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
    let db: D1Database | undefined;
    try {
      db = (c.env as { DB?: D1Database } | undefined)?.DB;
    } catch {
      // Do not expose a provider exception or fall through to mutation handlers.
      return writeGuardDenyResponse(c, "cost_guard_blocked", 503);
    }
    // writeGuardMiddleware already returned 503 db_unavailable without a DB.
    const snapshot = c.get("costGuardSnapshot") as CostGuardSnapshot | undefined;
    const result = snapshot
      ? evaluateCostGuardSnapshot(snapshot, feature)
      : db
        ? await evaluateCostGuardWithSettings(db, feature)
        : { denied: "cost_guard_blocked" as const };
    if (result.denied) {
      return writeGuardDenyResponse(c, result.denied, 503);
    }
    if (result.auditSettings) c.set("auditSettings", result.auditSettings);
    await next();
  };
}

