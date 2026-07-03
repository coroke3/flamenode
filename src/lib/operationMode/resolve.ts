import type { OperationMode } from "./types";

export interface OperationModeRow {
  operation_mode?: string | null;
  cost_guard_mode?: string | null;
  is_maintenance_mode?: number | boolean | null;
}

export function isOperationMode(value: unknown): value is OperationMode {
  return (
    value === "normal" ||
    value === "economy" ||
    value === "read_only" ||
    value === "static_only" ||
    value === "maintenance"
  );
}

export function normalizeOperationMode(
  value: unknown,
): OperationMode | null {
  return isOperationMode(value) ? value : null;
}

/**
 * operation_mode を正本にしつつ、旧DB/旧UIの maintenance flag と
 * cost_guard_mode を互換 fallback として解決する。
 */
export function resolveOperationMode(
  row: OperationModeRow | null | undefined,
): OperationMode {
  if (row?.is_maintenance_mode === 1 || row?.is_maintenance_mode === true) {
    return "maintenance";
  }

  const operationMode = normalizeOperationMode(row?.operation_mode);
  if (operationMode) return operationMode;

  const legacyMode = normalizeOperationMode(row?.cost_guard_mode);
  if (legacyMode) return legacyMode;

  return "normal";
}
