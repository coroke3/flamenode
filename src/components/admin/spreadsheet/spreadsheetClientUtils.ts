import type { PrimaryKeyIssue } from "@/lib/admin/spreadsheet/validation";

/** 主キー検証結果を UI メッセージに変換（クライアント・サーバー共通コード） */
export function formatPrimaryKeyIssue(issue: PrimaryKeyIssue): string {
  if (issue === "no_primary_key_columns") {
    return "主キーがないテーブルではこの操作はできません";
  }
  return formatSpreadsheetApiError(400, { error: "missing_primary_key" });
}

/** 非 JSON レスポンス（HTML エラーページ等）でも落ちないパース */
export async function parseSpreadsheetApiJson<T>(
  res: Response,
): Promise<T & { error?: string }> {
  const text = await res.text();
  if (!text.trim()) {
    return { error: res.ok ? undefined : "internal_error" } as T & {
      error?: string;
    };
  }
  try {
    return JSON.parse(text) as T & { error?: string };
  } catch {
    return {
      error: res.status === 503 ? "db_unavailable" : "internal_error",
    } as T & { error?: string };
  }
}

/** スプレッドシート API エラーを UI 向けメッセージに変換 */
export function formatSpreadsheetApiError(
  status: number,
  body: { error?: string },
): string {
  switch (body.error) {
    case "db_unavailable":
      return "D1 に接続できません。dev サーバーを再起動し、必要なら npm run db:local-apply を実行してください。";
    case "spreadsheet_disabled":
      return "スプレッドシート機能が無効です（ADMIN_SPREADSHEET_ENABLED）。";
    case "unauthorized":
      return "ログインが必要です。";
    case "forbidden":
      return "管理者権限が必要です。";
    case "internal_error":
    case "invalid_response":
      return "サーバーでエラーが発生しました。しばらくしてから再試行してください。";
    case "unknown_table":
      return "テーブルが見つかりません。サイドバーから「テーブル更新」を試してください。";
    case "table_readonly":
      return "このテーブルは読み取り専用です。";
    case "column_not_editable":
    case "unknown_column":
      return "この列は編集できません。";
    case "missing_primary_key":
      return "主キーが未入力、またはこのテーブルでは行の特定ができません。";
    case "row_not_found":
      return "行が見つかりません。ページを再読み込みしてください。";
    case "missing_fields":
    case "invalid_json":
      return "リクエストが不正です。ページを再読み込みしてください。";
    case "too_many_rows":
      return "一度に取り込める行数の上限を超えています。";
    case "payload_too_large":
      return "取り込みテキストが大きすぎます。ファイルを分割するか行数を減らしてください。";
    case "no_rows":
      return "取り込む行がありません。";
    case "empty_row":
      return "空の行は追加できません。";
    case "unique_violation":
      return "主キーまたは一意制約に重複があります。";
    case "foreign_key_violation":
      return "参照先のデータが存在しないため保存できません。";
    case "not_null_violation":
      return "必須列が空のため保存できません。";
    default:
      return body.error ?? `HTTP ${status}`;
  }
}
