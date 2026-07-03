import type { SpreadsheetImportMode } from "./query";
import { buildStableSha256Token } from "../../utils/stableToken.ts";

export type SpreadsheetImportPreviewTokenPayload = {
  table: string;
  mode: SpreadsheetImportMode;
  columns: string[];
  primaryKeys: string[];
  rows: Record<string, string | null>[];
};

export async function buildSpreadsheetImportPreviewToken(
  payload: SpreadsheetImportPreviewTokenPayload,
): Promise<string> {
  return buildStableSha256Token(payload);
}
