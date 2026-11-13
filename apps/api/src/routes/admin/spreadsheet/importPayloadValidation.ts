/** MIG-0638 U02: unmounted CURRENT import source port. */
/** CURRENT spreadsheet import validation.ts limits and parsing guard. */
export const SPREADSHEET_IMPORT_MAX_ROWS = 500;
export const SPREADSHEET_IMPORT_MAX_TEXT_CHARS = 2_000_000;
export type ImportPayloadIssue = "payload_too_large" | "no_rows" | "too_many_rows";
export function getImportTextSizeIssue(
  text: string,
): "payload_too_large" | null {
  if (text.length > SPREADSHEET_IMPORT_MAX_TEXT_CHARS) return "payload_too_large";
  return null;
}

/** 行数のみ（パース後に使う） */
export function getImportRowCountIssue(
  rowCount: number,
): "no_rows" | "too_many_rows" | null {
  if (rowCount > SPREADSHEET_IMPORT_MAX_ROWS) return "too_many_rows";
  if (rowCount === 0) return "no_rows";
  return null;
}

export function getImportPayloadIssue(
  text: string,
  rowCount: number,
): ImportPayloadIssue | null {
  const sizeIssue = getImportTextSizeIssue(text);
  if (sizeIssue) return sizeIssue;
  return getImportRowCountIssue(rowCount);
}

/** UI 向けメッセージ（プレビュー警告など） */
export function formatImportPayloadIssue(issue: ImportPayloadIssue): string {
  switch (issue) {
    case "payload_too_large":
      return `テキストが長すぎます（上限 ${SPREADSHEET_IMPORT_MAX_TEXT_CHARS.toLocaleString()} 文字）`;
    case "too_many_rows":
      return `行数が上限を超えています（>${SPREADSHEET_IMPORT_MAX_ROWS} 行）`;
    case "no_rows":
      return "取り込む行がありません";
  }
}

