import {
  AdminSpreadsheetPageResponseSchema,
  AdminSpreadsheetTablesResponseSchema,
  type AdminSpreadsheetPageResponse,
  type AdminSpreadsheetTablesResponse,
} from "@flamenode/contracts";
import type { ZodType } from "zod";
import type { OpsFetch, OpsResult } from "./read.js";

/** MIG-0737 U01: CURRENT RH-003/009 paths; the feature-disabled 404 is distinct from an unknown table. */
export type SpreadsheetReadResult<T> = OpsResult<T> | { status: "disabled" };

async function getSpreadsheetJson<T>(
  fetchFn: OpsFetch,
  path: string,
  schema: ZodType<T>,
  signal?: AbortSignal,
): Promise<SpreadsheetReadResult<T>> {
  try {
    if (signal?.aborted) return { status: "unavailable" };
    const response = await fetchFn(path, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
    if (signal?.aborted) return { status: "unavailable" };
    if (response.status === 401) return { status: "anonymous" };
    if (response.status === 404) {
      // Hono deliberately returns 404 for BOTH a disabled feature and missing data.
      // Never infer a disabled feature from the status alone.
      const error: unknown = await response.json().catch(() => null);
      if (signal?.aborted) return { status: "unavailable" };
      return error && typeof error === "object" && !Array.isArray(error) &&
        "error" in error && error.error === "spreadsheet_disabled"
        ? { status: "disabled" } : { status: "notFound" };
    }
    if (response.status === 501) return { status: "unsupported" };
    if (response.status === 403) {
      const error: unknown = await response.json();
      if (signal?.aborted || !error || typeof error !== "object" || Array.isArray(error)) {
        return { status: "unavailable" };
      }
      const data = error as Record<string, unknown>;
      return {
        status: "forbidden",
        ...(typeof data.reason === "string" ? { reason: data.reason } : {}),
        ...(typeof data.redirect === "string" ? { redirect: data.redirect } : {}),
      };
    }
    if (response.status !== 200) return { status: "unavailable" };
    const body: unknown = await response.json();
    if (signal?.aborted) return { status: "unavailable" };
    const parsed = schema.safeParse(body);
    return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

export function loadSpreadsheetCatalog(
  fetchFn: OpsFetch,
  refresh = false,
  signal?: AbortSignal,
): Promise<SpreadsheetReadResult<AdminSpreadsheetTablesResponse>> {
  return getSpreadsheetJson(
    fetchFn,
    refresh ? "/api/admin/spreadsheet/tables?refresh=1" : "/api/admin/spreadsheet/tables",
    AdminSpreadsheetTablesResponseSchema,
    signal,
  );
}

export function loadSpreadsheetPage(
  fetchFn: OpsFetch,
  table: string,
  page: number,
  signal?: AbortSignal,
): Promise<SpreadsheetReadResult<AdminSpreadsheetPageResponse>> {
  if (!table || !Number.isSafeInteger(page) || page < 1) {
    return Promise.resolve({ status: "unavailable" });
  }
  return getSpreadsheetJson(
    fetchFn,
    `/api/admin/spreadsheet/data?table=${encodeURIComponent(table)}&page=${page}`,
    AdminSpreadsheetPageResponseSchema,
    signal,
  );
}

/** MIG-0737 U01 RH-007: bounded CSV/TSV export. A JSON response must never be offered as a download. */
export type SpreadsheetExportData = { blob: Blob; truncated: boolean };
export type SpreadsheetExportResult = SpreadsheetReadResult<SpreadsheetExportData>;

export async function loadSpreadsheetExport(
  fetchFn: OpsFetch,
  table: string,
  format: "csv" | "tsv",
  signal?: AbortSignal,
): Promise<SpreadsheetExportResult> {
  if (!table || signal?.aborted) return { status: "unavailable" };
  try {
    const response = await fetchFn(
      `/api/admin/spreadsheet/export?table=${encodeURIComponent(table)}&format=${format}&header=1`,
      {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: format === "csv" ? "text/csv" : "text/tab-separated-values" },
        signal,
      },
    );
    if (signal?.aborted) return { status: "unavailable" };
    if (response.status === 401) return { status: "anonymous" };
    if (response.status === 403) return { status: "forbidden" };
    if (response.status === 404) {
      const raw: unknown = await response.json().catch(() => null);
      if (signal?.aborted) return { status: "unavailable" };
      return raw && typeof raw === "object" && !Array.isArray(raw) &&
        "error" in raw && raw.error === "spreadsheet_disabled"
        ? { status: "disabled" } : { status: "notFound" };
    }
    if (response.status === 501) return { status: "unsupported" };
    if (response.status !== 200) return { status: "unavailable" };
    const mime = response.headers.get("content-type")?.toLowerCase() ?? "";
    const expected = format === "csv" ? "text/csv" : "text/tab-separated-values";
    if (mime.split(";")[0]?.trim() !== expected) {
      return { status: "unavailable" };
    }
    const blob = await response.blob();
    if (signal?.aborted) return { status: "unavailable" };
    // Hono's RH-007 caps the bytes/rows and reports partial files via this header.
    return {
      status: "ok",
      data: { blob, truncated: response.headers.get("x-spreadsheet-truncated") === "1" },
    };
  } catch {
    return { status: "unavailable" };
  }
}
