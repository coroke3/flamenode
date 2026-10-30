/** MIG-0737 U01 / RH-008: CURRENT spreadsheet import two-phase transport.
 * IMPORTANT: isolated until MIG-0638 backend write routes and Ops admin auth are reviewed.
 * Preview tokens are server-issued opaque secrets, never stored in HTML or localStorage.
 */
import { z } from "zod";
import type { OpsFetch, OpsResult } from "./read.js";

export const MAX_IMPORT_TEXT_CHARS = 2_000_000;
export const MAX_IMPORT_APPLY_ROWS = 7;

export type SpreadsheetImportDraft = {
  table: string;
  text: string;
  hasHeader: boolean;
  delimiter: "auto" | "csv" | "tsv";
  mode: "insert" | "upsert";
};

const previewSchema = z.object({
  rowCount: z.number().int().nonnegative(),
  mappedColumns: z.array(z.string()),
  warnings: z.array(z.string()),
  preview: z.array(z.record(z.string().nullable())),
  previewToken: z.string().min(1),
  applyMaxRows: z.number().int().positive().optional(),
});

const applySchema = z.object({
  inserted: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.array(z.object({ index: z.number().int().nonnegative(), message: z.string() })).optional(),
  warnings: z.array(z.string()).optional(),
  pendingPublicReflection: z.boolean().optional(),
});

export type SpreadsheetImportPreview = z.infer<typeof previewSchema>;
export type SpreadsheetImportApplyResult = z.infer<typeof applySchema>;
export type SpreadsheetImportResponse<T> = OpsResult<T> | { status: "disabled" };

function validDraft(draft: SpreadsheetImportDraft): boolean {
  return draft.table.trim().length > 0 &&
    draft.text.trim().length > 0 &&
    draft.text.length <= MAX_IMPORT_TEXT_CHARS &&
    (draft.delimiter === "auto" || draft.delimiter === "csv" || draft.delimiter === "tsv") &&
    (draft.mode === "insert" || draft.mode === "upsert") &&
    typeof draft.hasHeader === "boolean";
}

/** Stable snapshot for preview invalidation. Token remains outside this string. */
export function spreadsheetImportFingerprint(draft: SpreadsheetImportDraft): string {
  return JSON.stringify([draft.table, draft.text, draft.hasHeader, draft.delimiter, draft.mode]);
}

async function submitImport<T>(
  fetchFn: OpsFetch,
  body: Record<string, unknown>,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<SpreadsheetImportResponse<T>> {
  if (signal?.aborted) return { status: "unavailable" };
  try {
    const res = await fetchFn("/api/admin/spreadsheet/import", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (signal?.aborted) return { status: "unavailable" };
    if (res.status === 401) return { status: "anonymous" };
    if (res.status === 403) return { status: "forbidden" };
    if (res.status === 404) {
      const body: unknown = await res.json().catch(() => null);
      if (signal?.aborted) return { status: "unavailable" };
      return body && typeof body === "object" && !Array.isArray(body) &&
        "error" in body && body.error === "spreadsheet_disabled"
        ? { status: "disabled" } : { status: "notFound" };
    }
    if (res.status === 501) return { status: "unsupported" };
    if (res.status !== 200) return { status: "unavailable" };
    const payload: unknown = await res.json();
    if (signal?.aborted) return { status: "unavailable" };
    const checked = schema.safeParse(payload);
    return checked.success ? { status: "ok", data: checked.data } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

export function previewSpreadsheetImport(
  fetchFn: OpsFetch,
  draft: SpreadsheetImportDraft,
  signal?: AbortSignal,
): Promise<SpreadsheetImportResponse<SpreadsheetImportPreview>> {
  if (!validDraft(draft)) return Promise.resolve({ status: "unavailable" });
  return submitImport(fetchFn, { ...draft, dryRun: true }, previewSchema, signal).then((result) => {
    if (result.status !== "ok") return result;
    const p = result.data;
    // CURRENT uses a 7-row D1 statement cap for apply. Previewing more is allowed,
    // but a token for >7 rows must never enable the apply action.
    if (p.rowCount < 1 || p.rowCount > 500 || p.preview.length > Math.min(p.rowCount, 20)) {
      return { status: "unavailable" };
    }
    return result;
  });
}

/** Caller must provide a token bound to the identical draft; UI must re-confirm. */
export function applySpreadsheetImport(
  fetchFn: OpsFetch,
  draft: SpreadsheetImportDraft,
  preview: SpreadsheetImportPreview,
  previewFingerprint: string,
  signal?: AbortSignal,
): Promise<SpreadsheetImportResponse<SpreadsheetImportApplyResult>> {
  if (!validDraft(draft) || spreadsheetImportFingerprint(draft) !== previewFingerprint ||
    !preview.previewToken ||
    preview.rowCount < 1 || preview.rowCount > MAX_IMPORT_APPLY_ROWS ||
    (preview.applyMaxRows != null && preview.rowCount > Math.min(preview.applyMaxRows, MAX_IMPORT_APPLY_ROWS))) {
    return Promise.resolve({ status: "unavailable" });
  }
  return submitImport(fetchFn, { ...draft, previewToken: preview.previewToken }, applySchema, signal);
}
