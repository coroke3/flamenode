// Operation mode vocabulary and resolution (moved unchanged from
// src/lib/operationMode/types.ts and src/lib/operationMode/resolve.ts).
export type OperationMode =
  | "normal"
  | "economy"
  | "read_only"
  | "static_only"
  | "maintenance";

export type PublicDataStrategy =
  | "static_json_with_live_overlay"
  | "static_json_only"
  | "maintenance";

export type StaticRebuildPolicy = {
  maxItemsPerRun: number;
  highPriorityOnly: boolean;
  allowedTargetTypes: readonly string[] | null;
  skipTargetTypesUnlessHighPriority: readonly string[];
  reconcileStaleQueue: boolean;
};

export const OPERATION_MODE_LABELS: Record<OperationMode, string> = {
  normal: "通常運用",
  economy: "節約モード",
  read_only: "読み取り専用",
  static_only: "静的JSONのみ",
  maintenance: "メンテナンス",
};

export const OPERATION_MODE_DESCRIPTIONS: Record<OperationMode, string> = {
  normal: "通常運用。全機能が利用可能です。",
  economy: "Cloudflare無料枠の節約。重い処理を延期します。",
  read_only: "投稿・編集を停止。公開閲覧とlive APIは有効です。",
  static_only: "D1/Functions節約。静的JSONのみで公開表示します。",
  maintenance: "完全停止。管理者のみ復旧操作が可能です。",
};

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

export function getPublicDataStrategy(mode: OperationMode): PublicDataStrategy {
  if (mode === "maintenance") return "maintenance";
  if (mode === "static_only") return "static_json_only";
  return "static_json_with_live_overlay";
}

