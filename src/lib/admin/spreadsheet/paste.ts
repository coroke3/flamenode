import {
  matchSpreadsheetColumnName,
  parseSpreadsheetCellInput,
} from "#spreadsheet/cellFormat";
import {
  detectDelimiter,
  parseDelimited,
  serializeDelimited,
  type DelimiterChar,
} from "#utils/delimited";

export type SpreadsheetDelimiterMode = "auto" | "csv" | "tsv";

export interface SpreadsheetPasteOptions {
  hasHeader: boolean;
  delimiter: SpreadsheetDelimiterMode;
  maxRows?: number;
}

export interface SpreadsheetPasteResult {
  delimiter: DelimiterChar;
  mappedColumns: string[];
  rows: Record<string, string | null>[];
  warnings: string[];
}

function resolveDelimiter(mode: SpreadsheetDelimiterMode, text: string): DelimiterChar {
  if (mode === "csv") return ",";
  if (mode === "tsv") return "\t";
  return detectDelimiter(text);
}

/**
 * 貼り付け / ファイルの区切りテキストをテーブル列にマッピングする。
 */
export function parseSpreadsheetPaste(
  text: string,
  tableColumns: string[],
  options: SpreadsheetPasteOptions,
): SpreadsheetPasteResult {
  const warnings: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) {
    return { delimiter: ",", mappedColumns: [], rows: [], warnings: ["空の入力です"] };
  }

  const delimiter = resolveDelimiter(options.delimiter, trimmed);
  const parseRowLimit =
    typeof options.maxRows === "number" && Number.isFinite(options.maxRows)
      ? Math.max(0, Math.trunc(options.maxRows)) + (options.hasHeader ? 1 : 0)
      : undefined;
  const grid = parseDelimited(
    trimmed,
    delimiter,
    parseRowLimit == null ? undefined : { maxRows: parseRowLimit },
  );
  if (grid.length === 0) {
    return { delimiter, mappedColumns: [], rows: [], warnings: ["行がありません"] };
  }

  let dataRows = grid;
  let columnIndexMap: Array<string | null> = tableColumns.map((c) => c);

  if (options.hasHeader) {
    const headerCells = grid[0] ?? [];
    columnIndexMap = headerCells.map((h) =>
      matchSpreadsheetColumnName(h, tableColumns),
    );
    dataRows = grid.slice(1);

    headerCells.forEach((h, i) => {
      if (!h.trim()) return;
      if (!columnIndexMap[i]) {
        warnings.push(`取り込み対象外の列: ${h.trim()}`);
      }
    });
  } else if (grid[0] && grid[0].length > tableColumns.length) {
    warnings.push(
      `列数がテーブルより多いです (${grid[0].length} > ${tableColumns.length})`,
    );
  }

  const mappedColumns = columnIndexMap.filter((c): c is string => c != null);
  const rows: Record<string, string | null>[] = [];

  for (const line of dataRows) {
    if (line.every((c) => !String(c ?? "").trim())) continue;
    const row: Record<string, string | null> = {};
    for (let i = 0; i < columnIndexMap.length; i++) {
      const col = columnIndexMap[i];
      if (!col) continue;
      row[col] = parseSpreadsheetCellInput(line[i]);
    }
    if (options.hasHeader) {
      for (const col of tableColumns) {
        if (!(col in row)) row[col] = null;
      }
    } else {
      for (let i = 0; i < tableColumns.length; i++) {
        const col = tableColumns[i]!;
        row[col] = parseSpreadsheetCellInput(line[i]);
      }
    }
    rows.push(row);
  }

  return { delimiter, mappedColumns, rows, warnings };
}

export function rowsToDelimitedGrid(
  columns: string[],
  rows: Record<string, unknown>[],
  delimiter: DelimiterChar,
  includeHeader: boolean,
): string {
  const grid: string[][] = [];
  if (includeHeader) grid.push(columns);
  for (const row of rows) {
    grid.push(
      columns.map((col) => {
        const v = row[col];
        if (v == null) return "";
        if (typeof v === "object") return JSON.stringify(v);
        return String(v);
      }),
    );
  }
  return serializeDelimited(grid, delimiter);
}
