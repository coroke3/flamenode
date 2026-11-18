/** MIG-0737 U01: pure keyboard navigation and TSV selection for the Ops admin grid.
 * CURRENT reference: spreadsheetGridUtils.ts moveCell/copySelectionAsTsv.
 * No mutation, clipboard API, or external calls happen in this module.
 */
export type GridCell = { row: number; col: number };

export function moveSpreadsheetFocus(
  current: GridCell,
  key: string,
  rowCount: number,
  columnCount: number,
): GridCell {
  if (!Number.isSafeInteger(rowCount) || !Number.isSafeInteger(columnCount) ||
      rowCount < 1 || columnCount < 1) return current;
  let row = current.row;
  let col = current.col;
  if (key === "ArrowUp") row -= 1;
  else if (key === "ArrowDown") row += 1;
  else if (key === "ArrowLeft") col -= 1;
  else if (key === "ArrowRight") col += 1;
  else if (key === "Home") col = 0;
  else if (key === "End") col = columnCount - 1;
  else return current;
  return {
    row: Math.max(0, Math.min(rowCount - 1, row)),
    col: Math.max(0, Math.min(columnCount - 1, col)),
  };
}

function plainCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value) ?? "";
  return String(value);
}

/** Escapes multiline/tab data so copying a selection does not shift TSV columns.
 * This is for clipboard transfer, not an executable CSV export.
 */
function quoteTsvCell(text: string): string {
  return /[\t\r\n"]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function copySpreadsheetSelection(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: ReadonlyArray<{ name: string }>,
  anchor: GridCell,
  focus: GridCell,
): string {
  if (rows.length === 0 || columns.length === 0) return "";
  const minRow = Math.max(0, Math.min(anchor.row, focus.row));
  const maxRow = Math.min(rows.length - 1, Math.max(anchor.row, focus.row));
  const minCol = Math.max(0, Math.min(anchor.col, focus.col));
  const maxCol = Math.min(columns.length - 1, Math.max(anchor.col, focus.col));
  if (minRow > maxRow || minCol > maxCol) return "";
  const output: string[] = [];
  for (let row = minRow; row <= maxRow; row++) {
    const cells: string[] = [];
    for (let col = minCol; col <= maxCol; col++) {
      cells.push(quoteTsvCell(plainCell(rows[row]?.[columns[col].name])));
    }
    output.push(cells.join("\t"));
  }
  return output.join("\n");
}
