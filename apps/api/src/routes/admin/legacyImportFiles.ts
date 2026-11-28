import { parseLegacyImportText } from "@flamenode/server-core/legacyImport/parse";
import { selectLegacyParsedFileRange } from "@flamenode/server-core/legacyImport/range";
import {
  legacyImportStringField,
  LEGACY_IMPORT_MAX_FILES,
  LEGACY_IMPORT_MAX_FILE_BYTES,
  LEGACY_IMPORT_MAX_TOTAL_BYTES,
  validateLegacyImportSelectedRows,
} from "./legacyImportInput.ts";

/**
 * MIG-0645 U02: HTTP multipart preview file selection boundary.
 * Deliberately unmounted: security gates (origin, session, admin write/CostGuard)
 * MUST execute before the caller invokes this function.
 *
 * Dependencies permit the CURRENT parse/range algorithms to be migrated
 * separately without importing any Next.js server modules into Hono.
 */
export type LegacyImportFileLike = {
  name: string;
  size: number;
  text: () => Promise<string>;
};
export type LegacyImportParsedFile = {
  name: string;
  rows: Record<string, unknown>[];
  rowOffset?: number;
};
export type LegacyImportFileRange = {
  fileName: string;
  sourceRows: number;
  startRow: number;
  endRow: number;
  selectedRows: number;
};

export type LegacyImportReadResult =
  | {
      ok: true;
      parsed: LegacyImportParsedFile[];
      fileRanges: LegacyImportFileRange[];
      sourceRowCount: number;
      rowCount: number;
    }
  | {
      ok: false;
      status: 400 | 413;
      body: {
        ok: false;
        message: string;
        file_ranges?: LegacyImportFileRange[];
        requires_repreview?: boolean;
      };
    };

export async function readLegacyImportPreviewFiles(args: {
  formData: FormData;
  files: readonly LegacyImportFileLike[];
  parseText?: (name: string, text: string) => LegacyImportParsedFile;
  selectRange?: (
    file: LegacyImportParsedFile,
    range: { start: string; end: string },
  ) => { file: LegacyImportParsedFile; range: LegacyImportFileRange };
}): Promise<LegacyImportReadResult> {
  // Match CURRENT RH-002 failure order: count first, then check and parse each
  // file in sequence. An earlier malformed file takes precedence over a later
  // oversized file. Each individual file is bounded before its text() call.
  if (args.files.length === 0) return {
    ok: false, status: 400, body: { ok: false, message: "JSON・CSV・TSVファイルを選択してください。" },
  };
  if (args.files.length > LEGACY_IMPORT_MAX_FILES) return {
    ok: false, status: 400,
    body: { ok: false, message: `ファイル数は最大${LEGACY_IMPORT_MAX_FILES}件です。` },
  };

  let totalBytes = 0;
  const parsed: LegacyImportParsedFile[] = [];
  const fileRanges: LegacyImportFileRange[] = [];
  for (const file of args.files) {
    if (file.size > LEGACY_IMPORT_MAX_FILE_BYTES) return {
      ok: false, status: 400,
      body: { ok: false, message: `${file.name}: 1ファイル2MBまでです。大きいファイルは物理分割してください。` },
    };
    totalBytes += file.size;
    if (totalBytes > LEGACY_IMPORT_MAX_TOTAL_BYTES) return {
      ok: false, status: 400,
      body: { ok: false, message: "ファイル合計は4MBまでです。複数回に分けてください。" },
    };
    const content = await file.text();
    try {
      const parsedFile = (args.parseText ?? parseLegacyImportText)(file.name, content);
      const index = parsed.length;
      const ranged = (args.selectRange ?? selectLegacyParsedFileRange)(parsedFile, {
        start: legacyImportStringField(args.formData, `range_start_${index}`),
        end: legacyImportStringField(args.formData, `range_end_${index}`),
      });
      parsed.push(ranged.file);
      fileRanges.push(ranged.range);
    } catch (cause) {
      return {
        ok: false,
        status: 400,
        body: {
          ok: false,
          message: cause instanceof Error ? cause.message : `${file.name}: 解析に失敗しました。`,
        },
      };
    }
  }

  const sourceRowCount = fileRanges.reduce((sum, range) => sum + range.sourceRows, 0);
  const rowCount = parsed.reduce((sum, file) => sum + file.rows.length, 0);
  const rowError = validateLegacyImportSelectedRows(rowCount);
  if (rowError) return {
    ok: false,
    status: rowError.status,
    body: {
      ok: false,
      message: rowError.message,
      file_ranges: fileRanges,
      requires_repreview: false,
    },
  };

  return { ok: true, parsed, fileRanges, sourceRowCount, rowCount };
}
