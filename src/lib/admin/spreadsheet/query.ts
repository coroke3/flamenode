import "server-only";
import { getDatabase } from "@/lib/cloudflare";
import { historyLogs } from "@/lib/db/schema";
import type { SpreadsheetTableDef } from "./registry";
import { isSpreadsheetColumnEditable, SPREADSHEET_SECRET_COLUMNS } from "./registry";
import { SPREADSHEET_IMPORT_MAX_ROWS } from "./constants";
import {
  clampSpreadsheetPageLimit,
  normalizeSpreadsheetPage,
} from "./settings";

export { SPREADSHEET_IMPORT_MAX_ROWS } from "./constants";
import {
  assertColumnEditable,
  assertTableEditable,
  enrichSpreadsheetColumns,
  resolveSpreadsheetTableContext,
  quoteIdent,
  type SpreadsheetColumnMeta,
  type SpreadsheetTableContext,
} from "./tableContext";
import { getSpreadsheetD1 } from "./d1Access";
import {
  normalizePrimaryKeyRecord,
  primaryKeyFingerprint,
  primaryKeyFromRowValues,
} from "./validation";

export type { SpreadsheetColumnMeta } from "./tableContext";
export const SPREADSHEET_EXPORT_MAX_ROWS = 5000;
const SPREADSHEET_IMPORT_EXISTING_LOOKUP_CHUNK_SIZE = 40;

export interface SpreadsheetPageResult {
  def: SpreadsheetTableDef;
  columns: SpreadsheetColumnMeta[];
  primaryKeys: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
}

function maskValue(column: string, value: unknown): unknown {
  if (value == null) return value;
  if (!SPREADSHEET_SECRET_COLUMNS.has(column)) return value;
  const s = String(value);
  if (s.length <= 8) return "••••••••";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function serializeRow(
  row: Record<string, unknown>,
  columns: SpreadsheetColumnMeta[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    out[col.name] = maskValue(col.name, row[col.name]);
  }
  return out;
}

function buildPkWhere(
  primaryKeys: string[],
  pk: Record<string, string>,
): { clause: string; binds: string[] } {
  if (primaryKeys.length === 0) {
    throw new Error("missing_primary_key");
  }
  const parts: string[] = [];
  const binds: string[] = [];
  for (const key of primaryKeys) {
    const v = pk[key];
    if (v === undefined || String(v).trim() === "") {
      throw new Error("missing_primary_key");
    }
    parts.push(`${quoteIdent(key)} = ?`);
    binds.push(String(v));
  }
  return { clause: parts.join(" AND "), binds };
}

async function fetchRowByPkRaw(
  ctx: SpreadsheetTableContext,
  pk: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  const { clause, binds } = buildPkWhere(ctx.primaryKeys, pk);
  const stmt = `SELECT * FROM ${ctx.quotedTable} WHERE ${clause} LIMIT 1`;
  const db = await getSpreadsheetD1();
  return db
    .prepare(stmt)
    .bind(...binds)
    .first<Record<string, unknown>>();
}

function primaryKeyFromRawRow(
  row: Record<string, unknown>,
  primaryKeys: string[],
): Record<string, string> | null {
  const pk: Record<string, string> = {};
  for (const key of primaryKeys) {
    const value = row[key];
    if (value == null || String(value).trim() === "") return null;
    pk[key] = String(value);
  }
  return pk;
}

async function fetchExistingRowsByImportPk(
  ctx: SpreadsheetTableContext,
  rows: Record<string, string | null>[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (ctx.primaryKeys.length === 0 || rows.length === 0) return out;

  const pks: Record<string, string>[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    try {
      const pk = primaryKeyFromRowValues(row, ctx.primaryKeys);
      const fingerprint = primaryKeyFingerprint(pk);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      pks.push(pk);
    } catch {
      // Per-row import error handling below preserves the existing behavior.
    }
  }
  if (pks.length === 0) return out;

  const db = await getSpreadsheetD1();
  for (let i = 0; i < pks.length; i += SPREADSHEET_IMPORT_EXISTING_LOOKUP_CHUNK_SIZE) {
    const chunk = pks.slice(i, i + SPREADSHEET_IMPORT_EXISTING_LOOKUP_CHUNK_SIZE);
    const binds: string[] = [];
    const where = chunk
      .map((pk) => {
        const parts: string[] = [];
        for (const key of ctx.primaryKeys) {
          parts.push(`${quoteIdent(key)} = ?`);
          binds.push(pk[key]!);
        }
        return `(${parts.join(" AND ")})`;
      })
      .join(" OR ");
    const data = await db
      .prepare(`SELECT * FROM ${ctx.quotedTable} WHERE ${where}`)
      .bind(...binds)
      .all<Record<string, unknown>>();
    for (const raw of data.results ?? []) {
      const pk = primaryKeyFromRawRow(raw, ctx.primaryKeys);
      if (!pk) continue;
      out.set(primaryKeyFingerprint(pk), raw);
    }
  }

  return out;
}

async function queryTableRows(
  ctx: SpreadsheetTableContext,
  limit: number,
  offset?: number,
): Promise<{ total: number; rawRows: Record<string, unknown>[] }> {
  const db = await getSpreadsheetD1();
  const countStmt = db.prepare(
    `SELECT COUNT(*) AS c FROM ${ctx.quotedTable}`,
  );
  const dataStmt =
    offset != null
      ? db.prepare(
          `SELECT * FROM ${ctx.quotedTable} ORDER BY ${ctx.orderColumn} LIMIT ? OFFSET ?`,
        )
      : db.prepare(
          `SELECT * FROM ${ctx.quotedTable} ORDER BY ${ctx.orderColumn} LIMIT ?`,
        );

  const [countRow, data] = await Promise.all([
    countStmt.first<{ c: number }>(),
    offset != null
      ? dataStmt.bind(limit, offset).all<Record<string, unknown>>()
      : dataStmt.bind(limit).all<Record<string, unknown>>(),
  ]);

  return {
    total: Number(countRow?.c ?? 0),
    rawRows: data.results ?? [],
  };
}

async function writeHistory(opts: {
  operatorId: string;
  table: string;
  recordId: string;
  action: "UPDATE" | "CREATE" | "DELETE";
  before: unknown;
  after: unknown;
}): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  const now = Math.floor(Date.now() / 1000);
  try {
    await db.insert(historyLogs).values({
      table_name: opts.table,
      record_id: opts.recordId,
      action: opts.action,
      before_data: opts.before != null ? JSON.stringify(opts.before) : null,
      after_data: opts.after != null ? JSON.stringify(opts.after) : null,
      operator_discord_id: opts.operatorId,
      retention_class: "long_audit",
      created_at: now,
    });
  } catch {
    /* 履歴書き込み失敗でもセル更新は成功扱いのまま */
  }
}

function recordIdFromPk(pk: Record<string, string>): string {
  return Object.entries(pk)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)
    .join(":");
}

export async function fetchSpreadsheetPage(opts: {
  table: string;
  page: number;
  limit: number;
}): Promise<SpreadsheetPageResult> {
  const ctx = await resolveSpreadsheetTableContext(opts.table);
  const limit = clampSpreadsheetPageLimit(opts.limit);
  let page = normalizeSpreadsheetPage(opts.page);

  let { total, rawRows } = await queryTableRows(
    ctx,
    limit,
    (page - 1) * limit,
  );
  const maxPage = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  if (page > maxPage) {
    page = maxPage;
    ({ total, rawRows } = await queryTableRows(
      ctx,
      limit,
      (page - 1) * limit,
    ));
  }

  const columns = enrichSpreadsheetColumns(ctx.def, ctx.columns);

  return {
    def: ctx.def,
    columns,
    primaryKeys: ctx.primaryKeys,
    rows: rawRows.map((r) => serializeRow(r, columns)),
    total,
    page,
    limit,
  };
}

export async function updateSpreadsheetCell(opts: {
  table: string;
  primaryKey: Record<string, string>;
  column: string;
  value: string | null;
  operatorId: string;
}): Promise<void> {
  const ctx = await resolveSpreadsheetTableContext(opts.table);
  assertTableEditable(ctx);
  assertColumnEditable(ctx, opts.column);
  const primaryKey = normalizePrimaryKeyRecord(
    ctx.primaryKeys,
    opts.primaryKey,
  );

  const beforeRaw = await fetchRowByPkRaw(ctx, primaryKey);
  if (!beforeRaw) throw new Error("row_not_found");

  const { clause: pkClause, binds: pkBinds } = buildPkWhere(
    ctx.primaryKeys,
    primaryKey,
  );
  const bindValue = opts.value === "" ? null : opts.value;
  const db = await getSpreadsheetD1();
  await db
    .prepare(
      `UPDATE ${ctx.quotedTable} SET ${quoteIdent(opts.column)} = ? WHERE ${pkClause}`,
    )
    .bind(bindValue, ...pkBinds)
    .run();

  const afterRaw = await fetchRowByPkRaw(ctx, primaryKey);

  await writeHistory({
    operatorId: opts.operatorId,
    table: ctx.def.table,
    recordId: recordIdFromPk(primaryKey),
    action: "UPDATE",
    before: beforeRaw,
    after: afterRaw,
  });
}

async function insertSpreadsheetRowWithContext(
  ctx: SpreadsheetTableContext,
  opts: {
    row: Record<string, string | null>;
    operatorId: string;
  },
): Promise<void> {
  assertTableEditable(ctx);
  const pk = primaryKeyFromRowValues(opts.row, ctx.primaryKeys);

  const keys = ctx.columns
    .map((c) => c.name)
    .filter(
      (name) =>
        opts.row[name] !== undefined &&
        isSpreadsheetColumnEditable(ctx.def, name),
    );
  if (keys.length === 0) throw new Error("empty_row");

  const colList = keys.map(quoteIdent).join(", ");
  const placeholders = keys.map(() => "?").join(", ");
  const values = keys.map((k) => {
    const v = opts.row[k];
    return v === "" ? null : v;
  });

  const db = await getSpreadsheetD1();
  await db
    .prepare(
      `INSERT INTO ${ctx.quotedTable} (${colList}) VALUES (${placeholders})`,
    )
      .bind(...values)
    .run();

  const afterRaw = await fetchRowByPkRaw(ctx, pk);

  await writeHistory({
    operatorId: opts.operatorId,
    table: ctx.def.table,
    recordId: recordIdFromPk(pk),
    action: "CREATE",
    before: null,
    after: afterRaw ?? opts.row,
  });
}

export async function insertSpreadsheetRow(opts: {
  table: string;
  row: Record<string, string | null>;
  operatorId: string;
}): Promise<void> {
  const ctx = await resolveSpreadsheetTableContext(opts.table);
  await insertSpreadsheetRowWithContext(ctx, {
    row: opts.row,
    operatorId: opts.operatorId,
  });
}

export async function deleteSpreadsheetRow(opts: {
  table: string;
  primaryKey: Record<string, string>;
  operatorId: string;
}): Promise<void> {
  const ctx = await resolveSpreadsheetTableContext(opts.table);
  assertTableEditable(ctx);
  const primaryKey = normalizePrimaryKeyRecord(
    ctx.primaryKeys,
    opts.primaryKey,
  );

  const beforeRaw = await fetchRowByPkRaw(ctx, primaryKey);
  if (!beforeRaw) throw new Error("row_not_found");

  const { clause, binds } = buildPkWhere(ctx.primaryKeys, primaryKey);
  const db = await getSpreadsheetD1();
  await db
    .prepare(`DELETE FROM ${ctx.quotedTable} WHERE ${clause}`)
    .bind(...binds)
    .run();

  await writeHistory({
    operatorId: opts.operatorId,
    table: ctx.def.table,
    recordId: recordIdFromPk(primaryKey),
    action: "DELETE",
    before: beforeRaw,
    after: null,
  });
}

export interface SpreadsheetExportResult {
  def: SpreadsheetTableDef;
  columns: SpreadsheetColumnMeta[];
  primaryKeys: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}

export async function fetchSpreadsheetExport(
  table: string,
  maxRows = SPREADSHEET_EXPORT_MAX_ROWS,
): Promise<SpreadsheetExportResult> {
  const ctx = await resolveSpreadsheetTableContext(table);
  const limit = Math.min(Math.max(1, maxRows), SPREADSHEET_EXPORT_MAX_ROWS);
  const { total, rawRows } = await queryTableRows(ctx, limit);

  const columns = enrichSpreadsheetColumns(ctx.def, ctx.columns);

  return {
    def: ctx.def,
    columns,
    primaryKeys: ctx.primaryKeys,
    rows: rawRows.map((r) => serializeRow(r, columns)),
    truncated: total > limit,
  };
}

export type SpreadsheetImportMode = "insert" | "upsert";

export interface SpreadsheetImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ index: number; message: string }>;
}

async function upsertSpreadsheetRowWithContext(
  ctx: SpreadsheetTableContext,
  opts: {
    row: Record<string, string | null>;
    operatorId: string;
    existingRow?: Record<string, unknown> | null;
    existingRowKnown?: boolean;
  },
): Promise<"inserted" | "updated" | "skipped"> {
  assertTableEditable(ctx);

  const pk = primaryKeyFromRowValues(opts.row, ctx.primaryKeys);

  const existing = opts.existingRowKnown
    ? (opts.existingRow ?? null)
    : await fetchRowByPkRaw(ctx, pk);

  if (existing) {
    const setCols = ctx.columns.filter(
      (c) =>
        c.pk === 0 &&
        isSpreadsheetColumnEditable(ctx.def, c.name) &&
        opts.row[c.name] !== undefined,
    );
    if (setCols.length === 0) return "skipped";

    const setParts: string[] = [];
    const binds: unknown[] = [];
    for (const col of setCols) {
      setParts.push(`${quoteIdent(col.name)} = ?`);
      const v = opts.row[col.name];
      binds.push(v === "" ? null : v);
    }
    const { clause, binds: pkBinds } = buildPkWhere(ctx.primaryKeys, pk);
    const db = await getSpreadsheetD1();
    await db
      .prepare(
        `UPDATE ${ctx.quotedTable} SET ${setParts.join(", ")} WHERE ${clause}`,
      )
      .bind(...binds, ...pkBinds)
      .run();

    const afterRaw = await fetchRowByPkRaw(ctx, pk);
    await writeHistory({
      operatorId: opts.operatorId,
      table: ctx.def.table,
      recordId: recordIdFromPk(pk),
      action: "UPDATE",
      before: existing,
      after: afterRaw,
    });
    return "updated";
  }

  await insertSpreadsheetRowWithContext(ctx, opts);
  return "inserted";
}

export async function applySpreadsheetImport(
  opts: {
    table: string;
    mode: SpreadsheetImportMode;
    rows: Record<string, string | null>[];
    operatorId: string;
  },
  existingCtx?: SpreadsheetTableContext,
): Promise<SpreadsheetImportResult> {
  const ctx = existingCtx ?? (await resolveSpreadsheetTableContext(opts.table));
  assertTableEditable(ctx);

  if (opts.rows.length > SPREADSHEET_IMPORT_MAX_ROWS) {
    throw new Error("too_many_rows");
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: Array<{ index: number; message: string }> = [];
  const existingRowsByPk =
    opts.mode === "upsert"
      ? await fetchExistingRowsByImportPk(ctx, opts.rows)
      : null;
  const touchedImportPks = new Set<string>();

  for (let i = 0; i < opts.rows.length; i++) {
    const row = opts.rows[i]!;
    let importPkFingerprint: string | null = null;
    let existingRowKnown = false;
    let existingRow: Record<string, unknown> | null = null;

    if (existingRowsByPk) {
      try {
        const pk = primaryKeyFromRowValues(row, ctx.primaryKeys);
        importPkFingerprint = primaryKeyFingerprint(pk);
        if (!touchedImportPks.has(importPkFingerprint)) {
          existingRowKnown = true;
          existingRow = existingRowsByPk.get(importPkFingerprint) ?? null;
        }
      } catch {
        // Let the normal per-row import error path report this row.
      }
    }

    try {
      if (opts.mode === "insert") {
        await insertSpreadsheetRowWithContext(ctx, {
          row,
          operatorId: opts.operatorId,
        });
        inserted += 1;
      } else {
        const result = await upsertSpreadsheetRowWithContext(ctx, {
          row,
          operatorId: opts.operatorId,
          existingRow,
          existingRowKnown,
        });
        if (result === "inserted") inserted += 1;
        else if (result === "updated") updated += 1;
        else skipped += 1;
      }
    } catch (e) {
      errors.push({
        index: i,
        message: e instanceof Error ? e.message : "import_failed",
      });
    }
    if (importPkFingerprint) touchedImportPks.add(importPkFingerprint);
  }

  return { inserted, updated, skipped, errors };
}
