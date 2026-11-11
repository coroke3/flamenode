import {
  legacyImportStringField,
  validateLegacyImportFileEnvelope,
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
  parseText: (name: string, text: string) => LegacyImportParsedFile;
  selectRange: (
    file: LegacyImportParsedFile,
    range: { start: string; end: string },
  ) => { file: LegacyImportParsedFile; range: LegacyImportFileRange };
}): Promise<LegacyImportReadResult> {
  // Reject the entire envelope before reading any potentially oversized body.
  const envelopeError = validateLegacyImportFileEnvelope(args.files);
  if (envelopeError) return {
    ok: false,
    status: envelopeError.status,
    body: { ok: false, message: envelopeError.message },
  };

  const parsed: LegacyImportParsedFile[] = [];
  const fileRanges: LegacyImportFileRange[] = [];
  for (const file of args.files) {
    const content = await file.text();
    try {
      const parsedFile = args.parseText(file.name, content);
      const index = parsed.length;
      const ranged = args.selectRange(parsedFile, {
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
