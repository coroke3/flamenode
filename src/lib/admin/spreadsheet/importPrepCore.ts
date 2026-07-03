import type {
  SpreadsheetDelimiterMode,
  SpreadsheetPasteResult,
} from "#spreadsheet/paste";
import { parseSpreadsheetPaste } from "#spreadsheet/paste";
import { SPREADSHEET_IMPORT_MAX_ROWS } from "#spreadsheet/constants";
import {
  formatImportPayloadIssue,
  getImportPayloadIssue,
  getImportRowCountIssue,
  getImportTextSizeIssue,
} from "#spreadsheet/validation";

function parseSpreadsheetImportText(opts: {
  text: string;
  columnNames: string[];
  hasHeader: boolean;
  delimiter: SpreadsheetDelimiterMode;
  maxRows?: number;
}): SpreadsheetPasteResult {
  return parseSpreadsheetPaste(opts.text, opts.columnNames, {
    hasHeader: opts.hasHeader,
    delimiter: opts.delimiter,
    maxRows: opts.maxRows,
  });
}

export type SpreadsheetImportLocalPreview = {
  rowCount: number;
  mappedColumns: string[];
  warnings: string[];
  preview: Record<string, string | null>[];
};

/** UI 用ローカルプレビュー（サーバーと同じパース・検証ルール） */
export function buildSpreadsheetImportLocalPreview(opts: {
  text: string;
  columnNames: string[];
  hasHeader: boolean;
  delimiter: SpreadsheetDelimiterMode;
}): SpreadsheetImportLocalPreview | null {
  const text = opts.text;
  if (!text.trim()) return null;

  const preIssue = getImportTextSizeIssue(text);
  if (preIssue === "payload_too_large") {
    return {
      rowCount: 0,
      mappedColumns: [],
      warnings: [formatImportPayloadIssue(preIssue)],
      preview: [],
    };
  }

  const parsed = parseSpreadsheetImportText({
    text,
    columnNames: opts.columnNames,
    hasHeader: opts.hasHeader,
    delimiter: opts.delimiter,
    maxRows: SPREADSHEET_IMPORT_MAX_ROWS + 1,
  });
  const warnings = [...parsed.warnings];
  const rowIssue = getImportRowCountIssue(parsed.rows.length);
  if (rowIssue) {
    warnings.push(formatImportPayloadIssue(rowIssue));
  }

  return {
    rowCount: parsed.rows.length,
    mappedColumns: parsed.mappedColumns,
    warnings,
    preview: parsed.rows.slice(0, 12),
  };
}

export type PreparedSpreadsheetImport = {
  rows: Record<string, string | null>[];
  warnings: string[];
  mappedColumns: string[];
};

export function buildReadonlyImportColumnWarnings(opts: {
  rows: Record<string, string | null>[];
  mappedColumns: string[];
  readonlyColumns: string[];
}): string[] {
  const importedColumns = new Set(
    opts.mappedColumns.length > 0
      ? opts.mappedColumns
      : opts.rows.flatMap((row) => Object.keys(row)),
  );
  const ignored = opts.readonlyColumns.filter((column) =>
    importedColumns.has(column),
  );
  if (ignored.length === 0) return [];
  return [`Readonly columns are ignored on import: ${ignored.join(", ")}`];
}

export function omitReadonlyImportColumns(opts: {
  rows: Record<string, string | null>[];
  readonlyColumns: string[];
}): Record<string, string | null>[] {
  if (opts.readonlyColumns.length === 0) return opts.rows;
  const readonlySet = new Set(opts.readonlyColumns);
  return opts.rows.map((row) => {
    const next: Record<string, string | null> = {};
    for (const [column, value] of Object.entries(row)) {
      if (readonlySet.has(column)) continue;
      next[column] = value;
    }
    return next;
  });
}

/**
 * インポート用の行データを解決し、共通検証を通す。
 * 失敗時は errors.ts が理解できる Error を throw する。
 */
export function prepareSpreadsheetImportRows(opts: {
  text?: string | null;
  rows?: Record<string, string | null>[] | null;
  columnNames: string[];
  hasHeader: boolean;
  delimiter: SpreadsheetDelimiterMode;
}): PreparedSpreadsheetImport {
  const text = opts.text ?? "";
  let rows = opts.rows ?? null;
  let warnings: string[] = [];
  let mappedColumns: string[] = [];

  const textSizeIssue = getImportTextSizeIssue(text);
  if (textSizeIssue) {
    throw new Error(textSizeIssue);
  }
  if (rows != null) {
    const rowIssue = getImportRowCountIssue(rows.length);
    if (rowIssue) {
      throw new Error(rowIssue);
    }
  }

  if (text.trim() !== "") {
    const parsed = parseSpreadsheetImportText({
      text,
      columnNames: opts.columnNames,
      hasHeader: opts.hasHeader,
      delimiter: opts.delimiter,
      maxRows: SPREADSHEET_IMPORT_MAX_ROWS + 1,
    });
    rows = parsed.rows;
    warnings = parsed.warnings;
    mappedColumns = parsed.mappedColumns;
  }

  if (!rows || rows.length === 0) {
    throw new Error("no_rows");
  }

  const postIssue = getImportPayloadIssue(text, rows.length);
  if (postIssue) {
    throw new Error(postIssue);
  }

  return { rows, warnings, mappedColumns };
}
