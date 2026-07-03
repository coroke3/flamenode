/**
 * 管理画面スプレッドシート — テーブルメタデータと編集ポリシー。
 * 実テーブル一覧は D1 の sqlite_master から自動取得し、ここは表示名・グループ・既定の編集可否を上書きする。
 */

export type SpreadsheetMode = "editable" | "readonly";

export interface SpreadsheetTableDef {
  /** SQLite テーブル名 */
  table: string;
  label: string;
  group: string;
  mode: SpreadsheetMode;
  /** Drizzle schema.ts に定義があるか（マイグレーション未適用の検知用） */
  inSchema: boolean;
}

export type SpreadsheetTableOverride = {
  label?: string;
  group?: string;
  mode?: SpreadsheetMode;
};

/** 表示名・グループ・編集可否の手動上書き（任意） */
export const SPREADSHEET_TABLE_OVERRIDES: Record<string, SpreadsheetTableOverride> =
  {
    user: { label: "ユーザー", group: "認証", mode: "editable" },
    account: { label: "OAuth アカウント", group: "認証", mode: "readonly" },
    session: { label: "セッション", group: "認証", mode: "readonly" },
    verificationToken: {
      label: "検証トークン",
      group: "認証",
      mode: "readonly",
    },

    x_users: { label: "X ID", group: "X ID", mode: "editable" },
    x_user_aliases: { label: "X ID エイリアス", group: "X ID", mode: "editable" },
    x_account_link_requests: {
      label: "X 連携申請",
      group: "X ID",
      mode: "editable",
    },
    x_user_icons: { label: "X アイコン", group: "X ID", mode: "editable" },
    x_id_merge_requests: {
      label: "X ID 統合申請",
      group: "X ID",
      mode: "editable",
    },
    x_id_merge_reverts: {
      label: "X ID 統合取消",
      group: "X ID",
      mode: "readonly",
    },

    event_groups: { label: "イベントグループ", group: "イベント", mode: "editable" },
    events: { label: "イベント", group: "イベント", mode: "editable" },
    event_staff: { label: "イベントスタッフ", group: "イベント", mode: "editable" },
    slots: { label: "枠", group: "イベント", mode: "editable" },

    videos: { label: "作品", group: "作品", mode: "editable" },
    video_youtube_metadata: {
      label: "YouTube メタ",
      group: "作品",
      mode: "editable",
    },
    video_moderation_cases: {
      label: "モデレーション",
      group: "作品",
      mode: "editable",
    },
    video_events: { label: "作品×イベント", group: "作品", mode: "editable" },
    video_members: { label: "作品メンバー", group: "作品", mode: "editable" },
    video_chapters: { label: "チャプター", group: "作品", mode: "editable" },
    video_interactions: {
      label: "インタラクション",
      group: "作品",
      mode: "editable",
    },
    software_catalog: { label: "ソフトカタログ", group: "マスタ", mode: "editable" },
    software_aliases: { label: "ソフト別名", group: "マスタ", mode: "editable" },

    announcements: { label: "お知らせ", group: "公開", mode: "editable" },
    terms_versions: { label: "利用規約", group: "公開", mode: "editable" },
    user_tos_consents: { label: "規約同意", group: "公開", mode: "readonly" },

    notification_outbox: {
      label: "通知 outbox",
      group: "システム",
      mode: "readonly",
    },
    history_logs: { label: "履歴ログ", group: "システム", mode: "readonly" },
    system_settings: { label: "システム設定", group: "システム", mode: "editable" },
    cost_usage_snapshots: {
      label: "コスト snapshot",
      group: "システム",
      mode: "readonly",
    },
  };

/** スプレッドシートから除外するシステムテーブル */
export const SPREADSHEET_TABLE_BLOCKLIST = new Set([
  "__drizzle_migrations",
  "d1_migrations",
  "sqlite_sequence",
]);

export const SPREADSHEET_DEPRECATED_READONLY_TABLES = [
  "api" + "_endpoints",
  "dashboard_metrics_cache",
  "event_staff" + "_permissions",
  "video" + "_comments",
  "video" + "_stats",
  "video" + "_softwares",
] as const;

/** セル編集禁止（表示はマスク） */
export const SPREADSHEET_SECRET_COLUMNS = new Set([
  "refresh_token",
  "access_token",
  "id_token",
  "sessionToken",
  "token",
  "verification_token",
  "session_state",
  "password",
]);

const DEFAULT_READONLY_TABLES = new Set([
  "account",
  "session",
  "verificationToken",
  ...SPREADSHEET_DEPRECATED_READONLY_TABLES,
  "user_tos_consents",
  "x_id_merge_reverts",
  "notification_outbox",
  "history_logs",
  "cost_usage_snapshots",
]);

const SECRET_COLUMN_PATTERN =
  /(?:^|_)(?:token|secret|password|credential)s?$/i;

export function isValidSqliteTableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function isSpreadsheetTableBlocklisted(name: string): boolean {
  if (!isValidSqliteTableName(name)) return true;
  if (name.startsWith("sqlite_")) return true;
  if (name.startsWith("_")) return true;
  return SPREADSHEET_TABLE_BLOCKLIST.has(name);
}

function inferGroup(table: string): string {
  if (
    table === "user" ||
    table === "account" ||
    table === "session" ||
    table === "verificationToken"
  ) {
    return "認証";
  }
  if (table.startsWith("x_")) return "X ID";
  if (table.startsWith("event")) return "イベント";
  if (table.startsWith("video")) return "作品";
  if (table.startsWith("software")) return "マスタ";
  if (
    table === "announcements" ||
    table === "terms_versions" ||
    table === "user_tos_consents"
  ) {
    return "公開";
  }
  if (
    table === "notification_outbox" ||
    table === "history_logs" ||
    table === "system_settings" ||
    table === "cost_usage_snapshots"
  ) {
    return "システム";
  }
  return "その他";
}

function inferLabel(table: string): string {
  return table.replace(/_/g, " ");
}

function inferMode(table: string): SpreadsheetMode {
  if (DEFAULT_READONLY_TABLES.has(table)) return "readonly";
  if (table.endsWith("_logs")) return "readonly";
  if (table.endsWith("_outbox")) return "readonly";
  return "editable";
}

export function resolveSpreadsheetTableDef(
  table: string,
  inSchema: boolean,
): SpreadsheetTableDef {
  const override = SPREADSHEET_TABLE_OVERRIDES[table];
  return {
    table,
    label: override?.label ?? inferLabel(table),
    group: override?.group ?? inferGroup(table),
    mode: override?.mode ?? inferMode(table),
    inSchema,
  };
}

/** DB 上のテーブル名から SpreadsheetTableDef 一覧を構築 */
export function buildSpreadsheetTableDefs(
  dbTableNames: string[],
  schemaTableNames: Iterable<string>,
): SpreadsheetTableDef[] {
  const schemaSet = new Set(schemaTableNames);
  const names = new Set<string>();

  for (const name of dbTableNames) {
    if (!isSpreadsheetTableBlocklisted(name)) names.add(name);
  }

  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((table) => resolveSpreadsheetTableDef(table, schemaSet.has(table)));
}

export function isSpreadsheetColumnEditable(
  def: SpreadsheetTableDef,
  column: string,
): boolean {
  if (def.mode === "readonly") return false;
  if (SPREADSHEET_SECRET_COLUMNS.has(column)) return false;
  if (SECRET_COLUMN_PATTERN.test(column)) return false;
  return true;
}
