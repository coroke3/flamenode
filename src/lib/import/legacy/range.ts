import type { LegacyParsedFile } from "./parse";

export type LegacyImportFileRange = {
  fileName: string;
  sourceRows: number;
  startRow: number;
  endRow: number;
  selectedRows: number;
};

export type RangedLegacyParsedFile = {
  file: LegacyParsedFile;
  range: LegacyImportFileRange;
};

function positiveRowNumber(raw: string, label: string, fileName: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${fileName}: ${label}は1以上の整数で指定してください。`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${fileName}: ${label}が大きすぎます。`);
  }
  return parsed;
}

/**
 * 1始まり・終了位置を含む範囲を、解析済みファイルへ適用する。
 * 空欄は先頭または末尾を意味し、normalize時の元行番号はrowOffsetで維持する。
 */
export function selectLegacyParsedFileRange(
  file: LegacyParsedFile,
  input: { start: string; end: string },
): RangedLegacyParsedFile {
  const sourceRows = file.rows.length;
  const startRow = positiveRowNumber(input.start, "開始位置", file.name) ?? 1;
  const endRow = positiveRowNumber(input.end, "終了位置", file.name) ?? sourceRows;

  if (startRow > sourceRows) {
    throw new Error(
      `${file.name}: 開始位置 ${startRow.toLocaleString()} はデータ件数 ${sourceRows.toLocaleString()} を超えています。`,
    );
  }
  if (endRow > sourceRows) {
    throw new Error(
      `${file.name}: 終了位置 ${endRow.toLocaleString()} はデータ件数 ${sourceRows.toLocaleString()} を超えています。`,
    );
  }
  if (endRow < startRow) {
    throw new Error(`${file.name}: 終了位置は開始位置以上にしてください。`);
  }

  const rows = file.rows.slice(startRow - 1, endRow);
  return {
    file: {
      ...file,
      rows,
      rowOffset: (file.rowOffset ?? 0) + startRow - 1,
    },
    range: {
      fileName: file.name,
      sourceRows,
      startRow,
      endRow,
      selectedRows: rows.length,
    },
  };
}
