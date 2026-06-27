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
  processSearchIndex: boolean;
  processListPopular: boolean;
  processAllTargets: boolean;
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
