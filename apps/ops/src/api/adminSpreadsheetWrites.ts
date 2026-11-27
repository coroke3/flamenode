/**
 * MIG-0737 U01 / RH-004..006: Ops spreadsheet mutation transport.
 * Contract parity with CURRENT spreadsheetApi.ts (PATCH, POST, DELETE /api/admin/spreadsheet/data).
 * No UI caller or route until MIG-0638 writes and MIG-0726 admin shell are merged and reviewed.
 * Authorization and atomicity MUST be enforced server-side. Never trust this client as a guard.
 */
import { z } from "zod";
import type { OpsFetch, OpsResult } from "./read.js";

export type SpreadsheetMutationResult = OpsResult<{ ok: true; pendingPublicReflection?: boolean }> |
  { status: "disabled" };

const mutationResponseSchema = z.object({
  ok: z.literal(true),
  pendingPublicReflection: z.boolean().optional(),
});

type SpreadsheetPrimaryKey = Record<string, string>;
type SpreadsheetInsertRow = Record<string, string | null>;

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validTable(table: unknown): table is string {
  return nonBlank(table);
}

function validPrimaryKey(value: unknown): value is SpreadsheetPrimaryKey {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.entries(value).every(([key, part]) => nonBlank(key) && nonBlank(part));
}

function validInsertRow(value: unknown): value is SpreadsheetInsertRow {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.entries(value).every(([key, cell]) =>
      nonBlank(key) && (typeof cell === "string" || cell === null));
}

function isDisabled(body: unknown): boolean {
  return body !== null && typeof body === "object" && !Array.isArray(body) &&
    "error" in body && body.error === "spreadsheet_disabled";
}

async function mutateSpreadsheet(
  fetchFn: OpsFetch,
  method: "PATCH" | "POST" | "DELETE",
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<SpreadsheetMutationResult> {
  if (signal?.aborted) return { status: "unavailable" };
  try {
    const response = await fetchFn("/api/admin/spreadsheet/data", {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (signal?.aborted) return { status: "unavailable" };
    if (response.status === 401) return { status: "anonymous" };
    if (response.status === 403) return { status: "forbidden" };
    if (response.status === 501) return { status: "unsupported" };
    if (response.status === 404) {
      const body: unknown = await response.json().catch(() => null);
      if (signal?.aborted) return { status: "unavailable" };
      return isDisabled(body) ? { status: "disabled" } : { status: "notFound" };
    }
    // The CURRENT RH-004..006 responses are HTTP 200 with { ok: true }.
    if (response.status !== 200) return { status: "unavailable" };
    const raw: unknown = await response.json();
    if (signal?.aborted) return { status: "unavailable" };
    const parsed = mutationResponseSchema.safeParse(raw);
    return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/** RH-004. PK is immutable; do not patch PK columns or secret fields from the UI. */
export function patchSpreadsheetCell(
  fetchFn: OpsFetch,
  args: { table: string; primaryKey: SpreadsheetPrimaryKey; column: string; value: string | null },
  signal?: AbortSignal,
): Promise<SpreadsheetMutationResult> {
  if (!validTable(args.table) || !validPrimaryKey(args.primaryKey) ||
    !nonBlank(args.column) ||
    !(args.value === null || typeof args.value === "string") ||
    Object.hasOwn(args.primaryKey, args.column)) {
    return Promise.resolve({ status: "unavailable" });
  }
  return mutateSpreadsheet(fetchFn, "PATCH", {
    table: args.table, primaryKey: args.primaryKey, column: args.column, value: args.value,
  }, signal);
}

/** RH-005. Server still validates table registry, allowed columns, transaction and D1 budget. */
export function insertSpreadsheetRow(
  fetchFn: OpsFetch,
  args: { table: string; row: SpreadsheetInsertRow },
  signal?: AbortSignal,
): Promise<SpreadsheetMutationResult> {
  if (!validTable(args.table) || !validInsertRow(args.row)) {
    return Promise.resolve({ status: "unavailable" });
  }
  return mutateSpreadsheet(fetchFn, "POST", { table: args.table, row: args.row }, signal);
}

/** RH-006. Explicit user confirmation belongs in the UI; this transport never retries DELETE. */
export function deleteSpreadsheetRow(
  fetchFn: OpsFetch,
  args: { table: string; primaryKey: SpreadsheetPrimaryKey },
  signal?: AbortSignal,
): Promise<SpreadsheetMutationResult> {
  if (!validTable(args.table) || !validPrimaryKey(args.primaryKey)) {
    return Promise.resolve({ status: "unavailable" });
  }
  return mutateSpreadsheet(fetchFn, "DELETE", { table: args.table, primaryKey: args.primaryKey }, signal);
}
