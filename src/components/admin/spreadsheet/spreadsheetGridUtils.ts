import {
  detectDelimiter,
  parseDelimited,
  serializeDelimited,
  stripBom,
} from "@/lib/utils/delimited";
import type { SpreadsheetColumnMeta } from "@/lib/admin/spreadsheet/apiTypes";
import {
  formatSpreadsheetCellValue,
  matchSpreadsheetColumnName,
  parseSpreadsheetCellInput,
} from "@/lib/admin/spreadsheet/cellFormat";
import { canEditSpreadsheetGridCell } from "@/lib/admin/spreadsheet/validation";

export { formatSpreadsheetCellValue as formatCellValue, parseSpreadsheetCellInput };

const formatCellValue = formatSpreadsheetCellValue;

export type ColumnMeta = SpreadsheetColumnMeta;

export type CellPos = { rowIndex: number; colIndex: number };

/** 行・列数が変わったあと focus が範囲外にならないよう補正 */
export function clampCellPos(
  pos: CellPos,
  rowCount: number,
  colCount: number,
): CellPos {
  if (rowCount <= 0 || colCount <= 0) {
    return { rowIndex: 0, colIndex: 0 };
  }
  return {
    rowIndex: Math.min(Math.max(0, pos.rowIndex), rowCount - 1),
    colIndex: Math.min(Math.max(0, pos.colIndex), colCount - 1),
  };
}

export type SelectionBounds = {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
};

export function getSelectionBounds(
  anchor: CellPos,
  focus: CellPos,
): SelectionBounds {
  return {
    r0: Math.min(anchor.rowIndex, focus.rowIndex),
    r1: Math.max(anchor.rowIndex, focus.rowIndex),
    c0: Math.min(anchor.colIndex, focus.colIndex),
    c1: Math.max(anchor.colIndex, focus.colIndex),
  };
}

export function canEditCell(tableEditable: boolean, col: ColumnMeta): boolean {
  return canEditSpreadsheetGridCell(tableEditable, col);
}

export function columnIndexToLetter(index: number): string {
  let n = index;
  let result = "";
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

export function cellA1Label(
  rowIndex: number,
  colIndex: number,
  page: number,
  limit: number,
): string {
  const rowNum = (page - 1) * Math.max(1, limit) + rowIndex + 1;
  return `${columnIndexToLetter(colIndex)}${rowNum}`;
}

export function cellLabel(
  rowIndex: number,
  col: ColumnMeta,
  colIndex: number,
  page: number,
  limit: number,
): string {
  return `${cellA1Label(rowIndex, colIndex, page, limit)} (${col.name})`;
}

export type SelectionStats = {
  cells: number;
  filled: number;
  numericSum: number | null;
  preview: string;
};

export function computeSelectionStats(
  rows: Record<string, unknown>[],
  columns: ColumnMeta[],
  anchor: CellPos,
  focus: CellPos,
): SelectionStats {
  const { r0, r1, c0, c1 } = getSelectionBounds(anchor, focus);
  let cells = 0;
  let filled = 0;
  let numericSum = 0;
  let numericCount = 0;
  const previews: string[] = [];

  for (let r = r0; r <= r1; r++) {
    const row = rows[r];
    if (!row) continue;
    for (let c = c0; c <= c1; c++) {
      const col = columns[c];
      if (!col) continue;
      cells += 1;
      const v = formatCellValue(row[col.name]);
      if (v !== "") {
        filled += 1;
        if (previews.length < 3) previews.push(v);
      }
      const n = Number(v);
      if (v !== "" && !Number.isNaN(n) && Number.isFinite(n)) {
        numericSum += n;
        numericCount += 1;
      }
    }
  }

  return {
    cells,
    filled,
    numericSum: numericCount > 0 ? numericSum : null,
    preview: previews.join(" · "),
  };
}

export function selectionSummary(
  anchor: CellPos,
  focus: CellPos,
): string {
  const { r0, r1, c0, c1 } = getSelectionBounds(anchor, focus);
  const cells = (r1 - r0 + 1) * (c1 - c0 + 1);
  if (cells <= 1) return "";
  return `${cells} セル`;
}

export function moveCell(
  pos: CellPos,
  key: string,
  rowCount: number,
  colCount: number,
): CellPos {
  let { rowIndex, colIndex } = pos;
  if (rowCount <= 0 || colCount <= 0) return pos;

  if (key === "Home") colIndex = 0;
  else if (key === "End") colIndex = colCount - 1;
  else if (key === "CtrlHome") {
    rowIndex = 0;
    colIndex = 0;
  } else if (key === "CtrlEnd") {
    rowIndex = rowCount - 1;
    colIndex = colCount - 1;
  } else if (key === "CtrlArrowUp") rowIndex = 0;
  else if (key === "CtrlArrowDown") rowIndex = rowCount - 1;
  else if (key === "CtrlArrowLeft") colIndex = 0;
  else if (key === "CtrlArrowRight") colIndex = colCount - 1;
  else if (key === "PageUp") rowIndex = Math.max(0, rowIndex - 10);
  else if (key === "PageDown")
    rowIndex = Math.min(rowCount - 1, rowIndex + 10);
  else if (key === "ArrowUp") rowIndex = Math.max(0, rowIndex - 1);
  else if (key === "ArrowDown")
    rowIndex = Math.min(rowCount - 1, rowIndex + 1);
  else if (key === "ArrowLeft") colIndex = Math.max(0, colIndex - 1);
  else if (key === "ArrowRight") colIndex = Math.min(colCount - 1, colIndex + 1);
  else if (key === "Tab") colIndex = Math.min(colCount - 1, colIndex + 1);
  else if (key === "ShiftTab") colIndex = Math.max(0, colIndex - 1);
  else if (key === "Enter") rowIndex = Math.min(rowCount - 1, rowIndex + 1);

  return { rowIndex, colIndex };
}

export function isPrintableKey(e: React.KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key.length === 1;
}

export interface GridPasteCell {
  rowIndex: number;
  column: string;
  value: string | null;
}

function countHeaderMatches(
  header: string[],
  tableColumns: ColumnMeta[],
): number {
  let n = 0;
  for (const cell of header) {
    if (matchSpreadsheetColumnName(String(cell ?? ""), tableColumns)) n += 1;
  }
  return n;
}

/** 2次元配列から貼り付けセルを組み立てる（Excel/TSV/HTML 共通） */
export function buildGridPasteCellsFromGrid(
  grid: string[][],
  columns: ColumnMeta[],
  start: CellPos,
  rowCount: number,
): GridPasteCell[] {
  if (grid.length === 0) return [];

  const header = grid[0] ?? [];
  const headerMatchCount = countHeaderMatches(header, columns);
  const useHeaderRow =
    headerMatchCount > 0 &&
    header.some((c) => String(c ?? "").trim() !== "");

  const dataRows = useHeaderRow ? grid.slice(1) : grid;
  const out: GridPasteCell[] = [];

  if (useHeaderRow) {
    for (let r = 0; r < dataRows.length; r++) {
      const line = dataRows[r] ?? [];
      const rowIndex = start.rowIndex + r;
      if (rowIndex >= rowCount) break;
      for (let c = 0; c < line.length; c++) {
        const colName = matchSpreadsheetColumnName(String(header[c] ?? ""), columns);
        if (!colName) continue;
        out.push({
          rowIndex,
          column: colName,
          value: parseSpreadsheetCellInput(line[c], { preserveWhitespace: true }),
        });
      }
    }
    return out;
  }

  const colOffset = start.colIndex;
  for (let r = 0; r < dataRows.length; r++) {
    const line = dataRows[r] ?? [];
    const rowIndex = start.rowIndex + r;
    if (rowIndex >= rowCount) break;
    for (let c = 0; c < line.length; c++) {
      const colIndex = colOffset + c;
      if (colIndex >= columns.length) break;
      const col = columns[colIndex]!;
      out.push({
        rowIndex,
        column: col.name,
        value: parseSpreadsheetCellInput(line[c], { preserveWhitespace: true }),
      });
    }
  }
  return out;
}

export function buildGridPasteCells(
  text: string,
  columns: ColumnMeta[],
  start: CellPos,
  rowCount: number,
): GridPasteCell[] {
  const trimmed = stripBom(text).trim();
  if (!trimmed) return [];
  const delimiter = detectDelimiter(trimmed);
  const grid = parseDelimited(trimmed, delimiter);
  return buildGridPasteCellsFromGrid(grid, columns, start, rowCount);
}

/** クリップボードへ TSV を書き込む（フォールバック付き） */
export async function writeTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function copySelectionAsTsv(
  rows: Record<string, unknown>[],
  columns: ColumnMeta[],
  anchor: CellPos,
  focus: CellPos,
): string {
  const { r0, r1, c0, c1 } = getSelectionBounds(anchor, focus);
  const sliceCols = columns.slice(c0, c1 + 1);
  const grid: string[][] = [];
  for (let r = r0; r <= r1; r++) {
    const row = rows[r];
    if (!row) continue;
    grid.push(sliceCols.map((col) => formatCellValue(row[col.name])));
  }
  return serializeDelimited(grid, "\t");
}

export function buildFillDownCells(
  rows: Record<string, unknown>[],
  columns: ColumnMeta[],
  anchor: CellPos,
  focus: CellPos,
  editable: boolean,
): GridPasteCell[] {
  const { r0, r1, c0, c1 } = getSelectionBounds(anchor, focus);
  if (r1 <= r0) return [];

  const out: GridPasteCell[] = [];
  for (let c = c0; c <= c1; c++) {
    const col = columns[c];
    if (!col || !canEditCell(editable, col)) continue;
    const source = rows[r0];
    if (!source) continue;
    const raw = formatCellValue(source[col.name]);
    const value = raw === "" ? null : raw;
    for (let r = r0 + 1; r <= r1; r++) {
      out.push({ rowIndex: r, column: col.name, value });
    }
  }
  return out;
}

export function buildClearCells(
  columns: ColumnMeta[],
  anchor: CellPos,
  focus: CellPos,
  editable: boolean,
): GridPasteCell[] {
  const { r0, r1, c0, c1 } = getSelectionBounds(anchor, focus);
  const out: GridPasteCell[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const col = columns[c];
      if (!col || !canEditCell(editable, col)) continue;
      out.push({ rowIndex: r, column: col.name, value: null });
    }
  }
  return out;
}

export function rowToDraft(
  row: Record<string, unknown>,
  columns: ColumnMeta[],
  clearPk: boolean,
): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const col of columns) {
    if (clearPk && col.pk > 0) {
      draft[col.name] = "";
    } else {
      draft[col.name] = formatCellValue(row[col.name]);
    }
  }
  return draft;
}

export { cellMatchesFind } from "@/lib/admin/spreadsheet/cellFormat";
export { findNextSpreadsheetMatch } from "@/lib/admin/spreadsheet/gridFind";
