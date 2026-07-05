import type { OperationMode } from "./types";

export interface OperationModeRow {
  operation_mode?: string | null;
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

export function resolveOperationMode(
  row: OperationModeRow | null | undefined,
): OperationMode {
  const operationMode = normalizeOperationMode(row?.operation_mode);
  return operationMode ?? "normal";
}
