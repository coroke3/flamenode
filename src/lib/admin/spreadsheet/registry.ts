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

export type SpreadsheetColumnPolicy = {
  enum?: readonly string[];
  json?: boolean;
  url?: boolean;
  maxLength?: number;
};

export const SPREADSHEET_COLUMN_POLICIES: Record<string, SpreadsheetColumnPolicy> = {
  "user.role": { maxLength: 32 },
  "event_groups.icon_url": { url: true, maxLength: 2048 },
  "event_groups.img_url": { url: true, maxLength: 2048 },
  "event_groups.group_type": { maxLength: 32 },
  "event_groups.visibility_status": { maxLength: 32 },
  "event_group_events.relation_type": { maxLength: 32 },
  "events.icon_url": { url: true, maxLength: 2048 },
  "events.img_url": { url: true, maxLength: 2048 },
  "events.review_settings": { json: true, maxLength: 100_000 },
  "events.editable_fields": { json: true, maxLength: 100_000 },
  "events.repeat_rules": { json: true, maxLength: 100_000 },
  "events.parts_json": { json: true, maxLength: 100_000 },
  "videos.music_reference_url": { url: true, maxLength: 2048 },
  "x_user_icons.icon_url": { url: true, maxLength: 2048 },
  "x_user_youtube_channels.youtube_channel_url": { url: true, maxLength: 2048 },
  "system_settings.cost_guard_thresholds_json": { json: true, maxLength: 100_000 },
  "system_settings.disabled_features_json": { json: true, maxLength: 100_000 },
  "events.user_video_edit_permission_keys_json": { json: true, maxLength: 100_000 },
  "announcements.body": { maxLength: 200_000 },
  "terms_versions.body_markdown": { maxLength: 200_000 },
};

export const SPREADSHEET_DEFAULT_MAX_CELL_CHARS = 100_000;

export function getSpreadsheetColumnPolicy(
  table: string,
  column: string,
  enumValues?: readonly string[],
): SpreadsheetColumnPolicy {
  return {
    ...SPREADSHEET_COLUMN_POLICIES[`${table}.${column}`],
    ...(enumValues && enumValues.length > 0 ? { enum: enumValues } : {}),
  };
}

export function primaryKeysFromColumns(
  columns: Array<{ name: string; pk: number }>,
): string[] {
  return columns
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name);
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
    event_staff: { label: "イベントスタッフ", group: "イベント", mode: "readonly" },
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
    audit_logs: { label: "監査ログ", group: "システム", mode: "readonly" },
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

export const SPREADSHEET_FORCED_INSERT_VALUES_BY_TABLE: Record<
  string,
  Record<string, string>
> = {
  video_chapters: { marker_kind: "chapter" },
};

export function applySpreadsheetForcedInsertValues(
  table: string,
  row: Record<string, string | null>,
): Record<string, string | null> {
  const forced = SPREADSHEET_FORCED_INSERT_VALUES_BY_TABLE[table];
  if (!forced) return row;
  return { ...row, ...forced };
}

export function isSpreadsheetForcedInsertColumn(
  table: string,
  column: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(
    SPREADSHEET_FORCED_INSERT_VALUES_BY_TABLE[table] ?? {},
    column,
  );
}

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
    table === "audit_logs" ||
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

export function resolveSpreadsheetTableDef(
  table: string,
  inSchema: boolean,
): SpreadsheetTableDef {
  const override = SPREADSHEET_TABLE_OVERRIDES[table];
  return {
    table,
    label: override?.label ?? inferLabel(table),
    group: override?.group ?? inferGroup(table),
    mode: override?.mode ?? "readonly",
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
    if (
      !isSpreadsheetTableBlocklisted(name) &&
      schemaSet.has(name) &&
      Object.prototype.hasOwnProperty.call(SPREADSHEET_TABLE_OVERRIDES, name)
    ) {
      names.add(name);
    }
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
