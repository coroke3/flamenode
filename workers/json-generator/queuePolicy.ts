export type OperationMode =
  | "normal"
  | "economy"
  | "read_only"
  | "static_only"
  | "maintenance";

export interface OperationModeRow {
  operation_mode?: string | null;
}

/** Workers FreeのCPU 10ms内に収めるため、静的生成は常に1 targetずつ処理する。 */
export const MAX_QUEUE_ITEMS_PER_RUN = 1;
export const MAX_QUEUE_ITEMS_ECONOMY = 1;

export function isOperationMode(value: unknown): value is OperationMode {
  return (
    value === "normal" ||
    value === "economy" ||
    value === "read_only" ||
    value === "static_only" ||
    value === "maintenance"
  );
}

export function resolveQueueOperationMode(
  row: OperationModeRow | null | undefined,
): OperationMode {
  if (isOperationMode(row?.operation_mode)) return row.operation_mode;
  return "normal";
}

export function queueLimitForMode(mode: OperationMode): number {
  return mode === "economy" ? MAX_QUEUE_ITEMS_ECONOMY : MAX_QUEUE_ITEMS_PER_RUN;
}

export function queueModeWhereClause(mode: OperationMode): string {
  if (mode === "static_only") return ` AND priority = 'high'`;
  if (mode === "read_only") return ` AND target_type IN ('event', 'video', 'user')`;
  return "";
}

export function shouldSkipQueueTarget(
  mode: OperationMode,
  row: { target_type: string; priority: string },
): boolean {
  return (
    mode === "economy" &&
    (row.target_type === "search_index" || row.target_type === "list_popular") &&
    row.priority !== "high"
  );
}

export function shouldReconcileStaleQueue(mode: OperationMode): boolean {
  return mode === "normal" || mode === "economy";
}
