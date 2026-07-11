import "server-only";

import {
  normalizeSpreadsheetPage,
  SPREADSHEET_PAGE_SIZE_CAP,
  SPREADSHEET_PAGE_SIZE_FALLBACK,
  SPREADSHEET_PAGE_SIZE_MIN,
} from "./constants";

export { normalizeSpreadsheetPage } from "./constants";

/** 実行時のページサイズ（ADMIN_SPREADSHEET_PAGE_SIZE → フォールバック） */
export function getSpreadsheetPageSize(): number {
  const raw = process.env.ADMIN_SPREADSHEET_PAGE_SIZE?.trim();
  if (!raw) return SPREADSHEET_PAGE_SIZE_FALLBACK;

  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < SPREADSHEET_PAGE_SIZE_MIN) {
    return SPREADSHEET_PAGE_SIZE_FALLBACK;
  }
  return Math.min(n, SPREADSHEET_PAGE_SIZE_CAP);
}

/** リクエストの limit を許可範囲に収める（上限は getSpreadsheetPageSize） */
export function clampSpreadsheetPageLimit(requested: number): number {
  const cap = getSpreadsheetPageSize();
  if (!Number.isFinite(requested)) return cap;
  return Math.min(
    Math.max(Math.trunc(requested), SPREADSHEET_PAGE_SIZE_MIN),
    cap,
  );
}

