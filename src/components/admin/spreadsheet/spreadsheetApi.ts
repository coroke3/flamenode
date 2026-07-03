/**
 * 管理スプレッドシート API の単一入口。
 * fetch / JSON パース / エラー変換をここに集約する。
 */

import type { SpreadsheetDelimiterMode } from "@/lib/admin/spreadsheet/paste";
import {
  formatSpreadsheetApiError,
  parseSpreadsheetApiJson,
} from "./spreadsheetClientUtils";
import { SpreadsheetApiError } from "./spreadsheetErrors";
import type {
  SpreadsheetCatalogResponse,
  SpreadsheetImportPreview,
  SpreadsheetImportResult,
  SpreadsheetPageData,
} from "./spreadsheetTypes";

export { SpreadsheetApiError, spreadsheetUserMessage } from "./spreadsheetErrors";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  const body = await parseSpreadsheetApiJson<T & { error?: string }>(res);
  if (!res.ok) {
    throw new SpreadsheetApiError(
      formatSpreadsheetApiError(res.status, body),
      res.status,
      body.error,
    );
  }
  return body as T;
}

export async function fetchSpreadsheetCatalog(
  refresh = false,
): Promise<SpreadsheetCatalogResponse> {
  const path = refresh
    ? "/api/admin/spreadsheet/tables?refresh=1"
    : "/api/admin/spreadsheet/tables";
  const json = await request<SpreadsheetCatalogResponse>(path);
  if (!Array.isArray(json.tables)) {
    throw new SpreadsheetApiError(
      formatSpreadsheetApiError(200, { error: "invalid_response" }),
      200,
      "invalid_response",
    );
  }
  return {
    ...json,
    groups: json.groups && typeof json.groups === "object" ? json.groups : {},
  };
}

export async function fetchSpreadsheetPage(
  table: string,
  page: number,
  signal?: AbortSignal,
): Promise<SpreadsheetPageData> {
  const json = await request<SpreadsheetPageData>(
    `/api/admin/spreadsheet/data?table=${encodeURIComponent(table)}&page=${page}`,
    { signal },
  );
  if (!Array.isArray(json.columns) || !Array.isArray(json.rows)) {
    throw new SpreadsheetApiError(
      formatSpreadsheetApiError(200, { error: "invalid_response" }),
      200,
      "invalid_response",
    );
  }
  return json;
}

export async function patchSpreadsheetCell(opts: {
  table: string;
  primaryKey: Record<string, string>;
  column: string;
  value: string | null;
}): Promise<void> {
  await request("/api/admin/spreadsheet/data", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
}

export async function insertSpreadsheetRow(opts: {
  table: string;
  row: Record<string, string>;
}): Promise<void> {
  await request("/api/admin/spreadsheet/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
}

export async function deleteSpreadsheetRow(opts: {
  table: string;
  primaryKey: Record<string, string>;
}): Promise<void> {
  await request("/api/admin/spreadsheet/data", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
}

function exportPath(table: string, format: "csv" | "tsv"): string {
  return `/api/admin/spreadsheet/export?table=${encodeURIComponent(table)}&format=${format}&header=1`;
}

async function fetchExportResponse(
  table: string,
  format: "csv" | "tsv",
): Promise<Response> {
  const res = await fetch(exportPath(table, format), { cache: "no-store" });
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || contentType.includes("application/json")) {
    const body = await parseSpreadsheetApiJson<{ error?: string }>(res);
    throw new SpreadsheetApiError(
      formatSpreadsheetApiError(res.status, body),
      res.status,
      body.error,
    );
  }
  return res;
}

export async function exportSpreadsheetBlob(
  table: string,
  format: "csv" | "tsv",
): Promise<{ blob: Blob; truncated: boolean }> {
  const res = await fetchExportResponse(table, format);
  return {
    blob: await res.blob(),
    truncated: res.headers.get("X-Spreadsheet-Truncated") === "1",
  };
}

export async function exportSpreadsheetText(
  table: string,
  format: "csv" | "tsv",
): Promise<{ text: string; truncated: boolean }> {
  const res = await fetchExportResponse(table, format);
  return {
    text: await res.text(),
    truncated: res.headers.get("X-Spreadsheet-Truncated") === "1",
  };
}

export async function previewSpreadsheetImport(body: {
  table: string;
  text: string;
  hasHeader: boolean;
  delimiter: SpreadsheetDelimiterMode;
  mode: "insert" | "upsert";
}): Promise<SpreadsheetImportPreview> {
  const j = await request<SpreadsheetImportPreview & { error?: string }>(
    "/api/admin/spreadsheet/import",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, dryRun: true }),
    },
  );
  if (typeof j.rowCount !== "number" || !Array.isArray(j.preview)) {
    throw new SpreadsheetApiError(
      formatSpreadsheetApiError(200, { error: "invalid_response" }),
      200,
      "invalid_response",
    );
  }
  if (typeof j.previewToken !== "string" || j.previewToken.length === 0) {
    throw new SpreadsheetApiError(
      formatSpreadsheetApiError(200, { error: "invalid_response" }),
      200,
      "invalid_response",
    );
  }
  return j;
}

export async function runSpreadsheetImport(body: {
  table: string;
  text: string;
  hasHeader: boolean;
  delimiter: SpreadsheetDelimiterMode;
  mode: "insert" | "upsert";
  previewToken: string;
}): Promise<SpreadsheetImportResult> {
  const j = await request<SpreadsheetImportResult & { error?: string }>(
    "/api/admin/spreadsheet/import",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (
    typeof j.inserted !== "number" ||
    typeof j.updated !== "number" ||
    typeof j.skipped !== "number"
  ) {
    throw new SpreadsheetApiError(
      formatSpreadsheetApiError(200, { error: "invalid_response" }),
      200,
      "invalid_response",
    );
  }
  return j;
}
