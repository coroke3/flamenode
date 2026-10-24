/**
 * MIG-0605 U02 (read half): RH-003 GET /data, RH-007 GET /export, RH-009 GET /tables
 * under /api/admin/spreadsheet. The writes (RH-004/005/006 PATCH/POST/DELETE, RH-008 import) are NOT mounted here.
 * CURRENT: app/api/admin/spreadsheet/{data,export,tables}/route.ts + src/lib/admin/spreadsheet/*.
 *
 * Order (CURRENT requireAdminSpreadsheetApi): ADMIN_SPREADSHEET_ENABLED (404 spreadsheet_disabled) BEFORE any
 * session read, then session -> admin read guard (401 / 403 / 503). Mounted ahead of createAdminRoutes() in app.ts
 * so a disabled spreadsheet answers 404 even to an anonymous caller, like CURRENT.
 *
 * Runtime S2: data = session + table definition/columns (1) + rows (1) = 3; export = 3; tables = session + 1 = 2.
 * Bounds (CURRENT allowed 5000 rows / unbounded bytes; see work item decisions SP-1..SP-3):
 *   page rows <= MAX_SPREADSHEET_PAGE_ROWS, export rows <= MAX_SPREADSHEET_EXPORT_ROWS,
 *   response rows <= MAX_SPREADSHEET_RESPONSE_BYTES UTF-8 bytes. Rows that do not fit are dropped and flagged
 *   (`truncated: true` / `X-Spreadsheet-Truncated: 1`), which reuses CURRENT's own "partial export" signal.
 */
import { Hono } from "hono";
import type { Context, MiddlewareHandler, Next } from "hono";
import type {
  AdminSpreadsheetColumnMeta,
  AdminSpreadsheetPageResponse,
  AdminSpreadsheetTablesResponse,
} from "@flamenode/contracts";
import { sessionMiddleware } from "../../../auth/session.ts";
import type { AppEnv } from "../../../env.ts";
import { adminReadGuardMiddleware, onlyReads } from "../../../middleware/adminReadGuard.ts";
import {
  getSpreadsheetDb,
  invalidateSpreadsheetCaches,
  listSpreadsheetCatalog,
  resolveSpreadsheetTableContext,
  SPREADSHEET_ERROR,
  SpreadsheetError,
  type SpreadsheetTableContext,
} from "./catalog.ts";
import { isSpreadsheetSecretColumn } from "./registry.ts";

/** ZERO_1102 S2: SQL LIMIT is rows + 1 (hasMore probe), so both stay <= 100. */
export const MAX_SPREADSHEET_PAGE_ROWS = 50;
export const MAX_SPREADSHEET_EXPORT_ROWS = 99;
/** 48 KiB of row data leaves room under the 64 KiB response budget for the column metadata envelope. */
export const MAX_SPREADSHEET_RESPONSE_BYTES = 48 * 1024;
const SPREADSHEET_PAGE_SIZE_MIN = 1;

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

const utf8 = new TextEncoder();

function respondError(c: Context<AppEnv>, error: string, status: 400 | 404 | 500 | 503): Response {
  return c.json({ error }, status, PRIVATE_HEADERS);
}

/** CURRENT isAdminSpreadsheetEnabled (guard.ts). */
function isEnabled(c: Context<AppEnv>): boolean {
  const v = c.env?.ADMIN_SPREADSHEET_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function enabledGuard(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  if (!isEnabled(c)) return respondError(c, "spreadsheet_disabled", 404);
  await next();
}

/** CURRENT settings.ts getSpreadsheetPageSize with the S2 row cap in place of 500 / 5000. */
export function getSpreadsheetPageSize(raw: string | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed) return MAX_SPREADSHEET_PAGE_ROWS;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < SPREADSHEET_PAGE_SIZE_MIN) return MAX_SPREADSHEET_PAGE_ROWS;
  return Math.min(n, MAX_SPREADSHEET_PAGE_ROWS);
}

/** CURRENT settings.ts clampSpreadsheetPageLimit. */
function clampPageLimit(requested: number, cap: number): number {
  if (!Number.isFinite(requested)) return cap;
  return Math.min(Math.max(Math.trunc(requested), SPREADSHEET_PAGE_SIZE_MIN), cap);
}

/** CURRENT constants.ts normalizeSpreadsheetPage. */
function normalizePage(page: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.trunc(page);
}

/** CURRENT query.ts maskValue. */
function maskValue(column: string, value: unknown): unknown {
  if (value == null) return value;
  if (!isSpreadsheetSecretColumn(column)) return value;
  const s = String(value);
  if (s.length <= 8) return "••••••••";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function serializeRow(
  row: Record<string, unknown>,
  columns: AdminSpreadsheetColumnMeta[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) out[col.name] = maskValue(col.name, row[col.name]);
  return out;
}

/** CURRENT queryTableRows: limit + 1 rows, no COUNT. */
async function queryTableRows(
  db: D1Database,
  ctx: SpreadsheetTableContext,
  limit: number,
  offset?: number,
): Promise<{ hasMore: boolean; rawRows: Record<string, unknown>[] }> {
  const fetchLimit = limit + 1;
  const base = `SELECT * FROM ${ctx.quotedTable} ORDER BY ${ctx.orderColumn} LIMIT ?`;
  const data =
    offset != null
      ? await db.prepare(`${base} OFFSET ?`).bind(fetchLimit, offset).all<Record<string, unknown>>()
      : await db.prepare(base).bind(fetchLimit).all<Record<string, unknown>>();
  const rows = data.results ?? [];
  return { hasMore: rows.length > limit, rawRows: rows.slice(0, limit) };
}

/** Keeps the leading rows whose serialized size fits `budget`; the rest are dropped (never cut mid-row). */
function fitRows<T>(rows: T[], sizeOf: (row: T) => number, budget: number): { kept: T[]; dropped: boolean } {
  const kept: T[] = [];
  let used = 0;
  for (const row of rows) {
    used += sizeOf(row);
    if (used > budget) return { kept, dropped: true };
    kept.push(row);
  }
  return { kept, dropped: false };
}

/** CURRENT utils/delimited.ts escapeCell + serializeDelimited. */
function escapeCell(value: string, delimiter: string): string {
  const needsQuote =
    value.includes(delimiter) || value.includes('"') || value.includes("\n") || value.includes("\r");
  return needsQuote ? `"${value.replace(/"/g, '""')}"` : value;
}
function delimitedLine(cells: string[], delimiter: string): string {
  return cells.map((cell) => escapeCell(cell, delimiter)).join(delimiter);
}

/** CURRENT paste.ts rowsToDelimitedGrid cell stringification. */
function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function failure(c: Context<AppEnv>, error: unknown): Response {
  if (error instanceof SpreadsheetError) {
    return respondError(
      c,
      error.code,
      error.code === SPREADSHEET_ERROR.DB_UNAVAILABLE ? 503 : 400,
    );
  }
  // Fixed code only: D1 error text can carry SQL and table names (CURRENT returned the raw message).
  console.error("[spreadsheet] READ_FAILED");
  return respondError(c, "internal_error", 500);
}

export function createSpreadsheetReadRoutes(
  options: { session?: MiddlewareHandler<AppEnv> } = {},
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use("*", onlyReads(enabledGuard));
  routes.use(
    "*",
    onlyReads(
      (options.session ?? (sessionMiddleware() as unknown as MiddlewareHandler<AppEnv>)) as (
        c: Context,
        next: Next,
      ) => Promise<Response | void>,
    ),
  );
  routes.use("*", onlyReads(adminReadGuardMiddleware()));

  // RH-003 GET
  routes.get("/data", async (c) => {
    const table = (c.req.query("table") ?? "").trim();
    if (!table) return respondError(c, "unknown_table", 400);
    const page = normalizePage(Number(c.req.query("page") ?? "1"));
    const cap = getSpreadsheetPageSize(c.env.ADMIN_SPREADSHEET_PAGE_SIZE);
    const limitParam = c.req.query("limit");
    const limit = limitParam != null && limitParam !== "" ? clampPageLimit(Number(limitParam), cap) : cap;
    try {
      const db = getSpreadsheetDb(c.env.DB);
      const ctx = await resolveSpreadsheetTableContext(db, table);
      const { hasMore, rawRows } = await queryTableRows(db, ctx, limit, (page - 1) * limit);
      const masked = rawRows.map((row) => serializeRow(row, ctx.columns));
      const { kept, dropped } = fitRows(
        masked,
        (row) => utf8.encode(JSON.stringify(row)).byteLength + 1,
        MAX_SPREADSHEET_RESPONSE_BYTES,
      );
      const body: AdminSpreadsheetPageResponse = {
        def: ctx.def,
        columns: ctx.columns,
        primaryKeys: ctx.primaryKeys,
        rows: kept,
        hasMore: hasMore || dropped,
        page,
        limit,
        ...(dropped ? { truncated: true as const } : {}),
      };
      return c.json(body, 200, PRIVATE_HEADERS);
    } catch (error) {
      return failure(c, error);
    }
  });

  // RH-007 GET
  routes.get("/export", async (c) => {
    const table = (c.req.query("table") ?? "").trim();
    if (!table) return respondError(c, "unknown_table", 400);
    const format = (c.req.query("format") ?? "csv").toLowerCase();
    const delimiter = format === "tsv" ? "\t" : ",";
    const includeHeader = c.req.query("header") !== "0";
    const ext = delimiter === "\t" ? "tsv" : "csv";
    const mime = delimiter === "\t" ? "text/tab-separated-values; charset=utf-8" : "text/csv; charset=utf-8";
    try {
      const db = getSpreadsheetDb(c.env.DB);
      const ctx = await resolveSpreadsheetTableContext(db, table);
      const { hasMore, rawRows } = await queryTableRows(db, ctx, MAX_SPREADSHEET_EXPORT_ROWS);
      const columnNames = ctx.columns.map((col) => col.name);
      const lines = rawRows.map((row) => {
        const masked = serializeRow(row, ctx.columns);
        return delimitedLine(columnNames.map((name) => cellText(masked[name])), delimiter);
      });
      const { kept, dropped } = fitRows(lines, (line) => utf8.encode(line).byteLength + 1, MAX_SPREADSHEET_RESPONSE_BYTES);
      const grid = includeHeader ? [delimitedLine(columnNames, delimiter), ...kept] : kept;
      const truncated = hasMore || dropped;
      const safeTable = table.replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `${safeTable}${truncated ? "-partial" : ""}.${ext}`;
      return new Response(grid.join("\n"), {
        status: 200,
        headers: {
          ...PRIVATE_HEADERS,
          "Content-Type": mime,
          "Content-Disposition": `attachment; filename="${filename}"`,
          "X-Spreadsheet-Truncated": truncated ? "1" : "0",
        },
      });
    } catch (error) {
      return failure(c, error);
    }
  });

  // RH-009 GET
  routes.get("/tables", async (c) => {
    if (c.req.query("refresh") === "1") invalidateSpreadsheetCaches();
    try {
      const catalog = await listSpreadsheetCatalog(c.env.DB);
      const groups = catalog.tables.reduce<Record<string, typeof catalog.tables>>((acc, t) => {
        (acc[t.group] ??= []).push(t);
        return acc;
      }, {});
      const body: AdminSpreadsheetTablesResponse = {
        tables: catalog.tables,
        groups,
        pageSize: getSpreadsheetPageSize(c.env.ADMIN_SPREADSHEET_PAGE_SIZE),
        discoveredAt: new Date().toISOString(),
        ...(catalog.notInSchema.length > 0 ? { notInSchema: catalog.notInSchema } : {}),
        ...(catalog.inSchemaNotInDb.length > 0 ? { inSchemaNotInDb: catalog.inSchemaNotInDb } : {}),
      };
      return c.json(body, 200, PRIVATE_HEADERS);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
