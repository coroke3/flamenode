/**
 * クライアント・サーバー共通のスプレッドシート検証。
 * server-only なし — API と UI の両方から import 可。
 */

import type { SpreadsheetColumnMeta } from "./apiTypes";
import {
  SPREADSHEET_IMPORT_MAX_ROWS,
  SPREADSHEET_IMPORT_MAX_TEXT_CHARS,
} from "#spreadsheet/constants";
import { formatSpreadsheetCellValue } from "#spreadsheet/cellFormat";

export const SPREADSHEET_IMPORT_MAX_FILE_BYTES = 2_000_000;

export function resolveSpreadsheetDefaultValue(
  column: Pick<SpreadsheetColumnMeta, "defaultValue">,
): string | number | null {
  const raw = column.defaultValue?.trim();
  if (!raw || /^null$/i.test(raw)) return null;
  const unwrapped = raw.replace(/^\((.*)\)$/, "$1").trim();
  if (/^unixepoch\(\)$/i.test(unwrapped)) return Math.floor(Date.now() / 1000);
  if (/^current_timestamp$/i.test(unwrapped)) {
    return new Date().toISOString().replace("T", " ").slice(0, 19);
  }
  if (/^-?\d+(?:\.\d+)?$/.test(unwrapped)) return Number(unwrapped);
  if (unwrapped.startsWith("'") && unwrapped.endsWith("'")) {
    return unwrapped.slice(1, -1).replace(/''/g, "'");
  }
  throw new Error("unsupported_default");
}

export type PrimaryKeyIssue = "no_primary_key_columns" | "missing_primary_key";

export type ImportPayloadIssue = "no_rows" | "too_many_rows" | "payload_too_large";

export function getPrimaryKeyIssue(
  primaryKeys: string[],
  pk: Record<string, string>,
): PrimaryKeyIssue | null {
  if (primaryKeys.length === 0) return "no_primary_key_columns";
  for (const key of primaryKeys) {
    const v = pk[key];
    if (v === undefined || String(v).trim() === "") {
      return "missing_primary_key";
    }
  }
  return null;
}

/** サーバー: 不正なら Error を throw（message = エラーコード） */
export function normalizePrimaryKeyRecord(
  primaryKeys: string[],
  pk: Record<string, string>,
): Record<string, string> {
  const issue = getPrimaryKeyIssue(primaryKeys, pk);
  if (issue) {
    throw new Error(
      issue === "no_primary_key_columns" ? "missing_primary_key" : issue,
    );
  }
  const out: Record<string, string> = {};
  for (const key of primaryKeys) {
    out[key] = String(pk[key]);
  }
  return out;
}

/** テキスト長のみ（パース前に使う。rowCount=0 では no_rows にしない） */
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

export function validateImportPayload(
  text: string,
  rowCount: number,
): string | null {
  const issue = getImportPayloadIssue(text, rowCount);
  return issue ? formatImportPayloadIssue(issue) : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 表示行（unknown 値）から主キー候補を組み立てる */
export function buildPrimaryKeyFromDisplayRow(
  row: Record<string, unknown>,
  primaryKeys: string[],
): Record<string, string> {
  const pk: Record<string, string> = {};
  for (const k of primaryKeys) {
    pk[k] = formatSpreadsheetCellValue(row[k]);
  }
  return pk;
}

/** 表示行の主キーを検証（問題があればコードを返す） */
export function validatePrimaryKeyFromDisplayRow(
  row: Record<string, unknown>,
  primaryKeys: string[],
): PrimaryKeyIssue | null {
  return getPrimaryKeyIssue(primaryKeys, buildPrimaryKeyFromDisplayRow(row, primaryKeys));
}

/** インポート行・API ボディから主キー文字列を正規化 */
export function primaryKeyFromRowValues(
  row: Record<string, string | null>,
  primaryKeys: string[],
): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const k of primaryKeys) {
    const v = row[k];
    raw[k] = v == null ? "" : String(v);
  }
  return normalizePrimaryKeyRecord(primaryKeys, raw);
}

/** 行照合・履歴 ID 用（列順で安定） */
export function primaryKeyFingerprint(
  primaryKey: Record<string, string>,
): string {
  return Object.entries(primaryKey)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)
    .join("\0");
}

type InsertColumnMeta = Pick<SpreadsheetColumnMeta, "name" | "pk" | "editable">;

/** 行追加 API 用（非編集列・secret 列を送らない） */
export function buildSpreadsheetInsertPayload(
  draft: Record<string, string>,
  columns: InsertColumnMeta[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of columns) {
    const include = col.pk > 0 || col.editable;
    if (!include || !(col.name in draft)) continue;
    out[col.name] = String(draft[col.name] ?? "");
  }
  return out;
}

/** グリッド上でセル編集可能か（既存行の PK 列は編集不可） */
export function canEditSpreadsheetGridCell(
  tableEditable: boolean,
  col: InsertColumnMeta,
): boolean {
  return tableEditable && col.pk === 0 && col.editable;
}

/** 表示行配列から主キー一致の行インデックスを探す */
export function findRowIndexByPrimaryKey(
  rows: Record<string, unknown>[],
  primaryKeys: string[],
  primaryKey: Record<string, string>,
): number {
  const target = primaryKeyFingerprint(primaryKey);
  return rows.findIndex(
    (r) =>
      primaryKeyFingerprint(buildPrimaryKeyFromDisplayRow(r, primaryKeys)) ===
      target,
  );
}
