/** 環境変数未設定時のフォールバック（1ページあたりの行数） */
export const SPREADSHEET_PAGE_SIZE_FALLBACK = 500;

export const SPREADSHEET_PAGE_SIZE_MIN = 1;

/** 誤設定防止の絶対上限 */
export const SPREADSHEET_PAGE_SIZE_CAP = 5000;

/** 1回のインポートで処理できる最大行数 */
export const SPREADSHEET_IMPORT_MAX_ROWS = 500;

export const SPREADSHEET_D1_BATCH_STATEMENT_LIMIT = 50;
export const SPREADSHEET_D1_BATCH_STATEMENT_RESERVE = 10;

/**
 * Spreadsheet import 1回分のD1 statement予算。
 * prep 2 + (nonce guard + row mutation)のassertion付き2(N+1)
 * + audit chunk 2*ceil((N+1)/4) + 安全枠10。
 */
export function estimateSpreadsheetImportD1Statements(rowCount: number): number {
  const rows = Math.max(0, Math.trunc(rowCount));
  const guardedMutations = rows + 1;
  return (
    2 +
    guardedMutations * 2 +
    Math.ceil(guardedMutations / 4) * 2 +
    SPREADSHEET_D1_BATCH_STATEMENT_RESERVE
  );
}

/** nonce guard込みで14行が50 statements、15行は52となるfail-closed上限。 */
export const SPREADSHEET_IMPORT_MAX_BATCH_ROWS = 14;

export function isSpreadsheetImportBatchSizeAllowed(rowCount: number): boolean {
  return (
    Number.isInteger(rowCount) &&
    rowCount >= 1 &&
    rowCount <= SPREADSHEET_IMPORT_MAX_BATCH_ROWS &&
    estimateSpreadsheetImportD1Statements(rowCount) <=
      SPREADSHEET_D1_BATCH_STATEMENT_LIMIT
  );
}

/** 貼り付けテキストの最大文字数（クライアント・API 共通） */
export const SPREADSHEET_IMPORT_MAX_TEXT_CHARS = 2_000_000;

export function normalizeSpreadsheetPage(page: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.trunc(page);
}
