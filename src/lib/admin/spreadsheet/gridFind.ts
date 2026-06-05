import type { SpreadsheetColumnMeta } from "./apiTypes";
import { cellMatchesFind } from "#spreadsheet/cellFormat";

export type GridCellPos = { rowIndex: number; colIndex: number };

export type FindNextSpreadsheetResult =
  | { found: true; pos: GridCellPos; wrapped: boolean }
  | { found: false };

/** 現在セルの次から検索（見つからなければ先頭から再検索） */
export function findNextSpreadsheetMatch(opts: {
  rows: Record<string, unknown>[];
  columns: SpreadsheetColumnMeta[];
  query: string;
  from: GridCellPos;
  caseSensitive?: boolean;
}): FindNextSpreadsheetResult {
  const { rows, columns, query, from } = opts;
  const caseSensitive = opts.caseSensitive ?? false;
  const rowCount = rows.length;
  const colCount = columns.length;
  if (!query.trim() || rowCount === 0 || colCount === 0) {
    return { found: false };
  }

  const matches = (ri: number, ci: number) => {
    const col = columns[ci];
    const row = rows[ri];
    if (!col || !row) return false;
    return cellMatchesFind(row[col.name], query, caseSensitive);
  };

  for (let r = from.rowIndex; r < rowCount; r++) {
    const startC = r === from.rowIndex ? from.colIndex + 1 : 0;
    for (let c = startC; c < colCount; c++) {
      if (matches(r, c)) {
        return { found: true, pos: { rowIndex: r, colIndex: c }, wrapped: false };
      }
    }
  }
  for (let r = 0; r <= from.rowIndex; r++) {
    const endC = r === from.rowIndex ? from.colIndex : colCount;
    for (let c = 0; c < endC; c++) {
      if (matches(r, c)) {
        return { found: true, pos: { rowIndex: r, colIndex: c }, wrapped: true };
      }
    }
  }
  return { found: false };
}
