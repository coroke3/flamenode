/** 環境変数未設定時のフォールバック（1ページあたりの行数） */
export const SPREADSHEET_PAGE_SIZE_FALLBACK = 500;

export const SPREADSHEET_PAGE_SIZE_MIN = 1;

/** 誤設定防止の絶対上限 */
export const SPREADSHEET_PAGE_SIZE_CAP = 5000;

/** 1回のインポートで処理できる最大行数 */
export const SPREADSHEET_IMPORT_MAX_ROWS = 500;

/** 貼り付けテキストの最大文字数（クライアント・API 共通） */
export const SPREADSHEET_IMPORT_MAX_TEXT_CHARS = 2_000_000;

export function normalizeSpreadsheetPage(page: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.trunc(page);
}
