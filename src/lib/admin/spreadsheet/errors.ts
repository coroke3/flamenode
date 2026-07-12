/** API が返す spreadsheet 系エラーコード */
export const SPREADSHEET_ERROR = {
  DB_UNAVAILABLE: "db_unavailable",
  UNKNOWN_TABLE: "unknown_table",
  TABLE_READONLY: "table_readonly",
} as const;

function mapSqliteMessage(message: string): string | null {
  if (/UNIQUE constraint failed/i.test(message)) return "unique_violation";
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return "foreign_key_violation";
  }
  if (/NOT NULL constraint failed/i.test(message)) return "not_null_violation";
  return null;
}

export function spreadsheetErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const mapped = mapSqliteMessage(error.message);
    if (mapped) return mapped;
    return error.message;
  }
  return "internal_error";
}

export function spreadsheetHttpStatus(message: string): number {
  if (message.startsWith("unknown_column:") || message.startsWith("column_not_editable:")) {
    return 400;
  }
  switch (message) {
    case SPREADSHEET_ERROR.UNKNOWN_TABLE:
    case SPREADSHEET_ERROR.TABLE_READONLY:
    case "column_not_editable":
    case "unknown_column":
    case "missing_fields":
    case "empty_row":
    case "missing_primary_key":
    case "no_rows":
    case "too_many_rows":
    case "batch_too_large":
    case "duplicate_primary_key":
    case "unsupported_default":
    case "missing_required_column":
    case "value_too_long":
    case "invalid_enum":
    case "invalid_json_value":
    case "invalid_url":
    case "invalid_integer":
    case "invalid_number":
    case "payload_too_large":
    case "invalid_json":
    case "unique_violation":
    case "foreign_key_violation":
    case "not_null_violation":
      return 400;
    case "preview_required":
      return 409;
    case "row_not_found":
      return 404;
    case "preview_unavailable":
    case SPREADSHEET_ERROR.DB_UNAVAILABLE:
      return 503;
    default:
      return 500;
  }
}
