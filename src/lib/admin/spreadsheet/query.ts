import "server-only";
import { sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDatabase } from "@/lib/cloudflare";
import { mutateWithAudit } from "@/lib/audit/mutate";
import type { SpreadsheetTableDef } from "./registry";
import {
  applySpreadsheetForcedInsertValues,
  isSpreadsheetColumnEditable,
  isSpreadsheetForcedInsertColumn,
  SPREADSHEET_SECRET_COLUMNS,
} from "./registry";
import {
  SPREADSHEET_IMPORT_MAX_BATCH_ROWS,
  SPREADSHEET_IMPORT_MAX_ROWS,
} from "./constants";
import {
  clampSpreadsheetPageLimit,
  normalizeSpreadsheetPage,
} from "./settings";

export { SPREADSHEET_IMPORT_MAX_ROWS } from "./constants";
export { SPREADSHEET_IMPORT_MAX_BATCH_ROWS } from "./constants";
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

function recordIdFromPk(pk: Record<string, string>): string {
  return Object.entries(pk)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)
    .join(":");
}

type SpreadsheetMutation = {
  statement: BatchItem<"sqlite">;
  audit: {
    table_name: string;
    target_id: string;
    operation: "CREATE" | "UPDATE" | "DELETE";
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    actor_user_id: string;
    retention_class: "long_audit";
    strict: true;
    context: "admin_spreadsheet";
  };
};

function spreadsheetDb() {
  const db = getDatabase();
  if (!db) throw new Error("db_unavailable");
  return db;
}

function snapshotCondition(
  ctx: SpreadsheetTableContext,
  row: Record<string, unknown>,
): ReturnType<typeof sql> {
  return sql.join(
    ctx.columns.map((column) =>
      sql`${sql.raw(quoteIdent(column.name))} IS ${row[column.name] ?? null}`,
    ),
    sql` AND `,
  );
}

function primaryKeyCondition(
  ctx: SpreadsheetTableContext,
  pk: Record<string, string>,
): ReturnType<typeof sql> {
  return sql.join(
    ctx.primaryKeys.map((key) =>
      sql`${sql.raw(quoteIdent(key))} = ${pk[key]}`,
    ),
    sql` AND `,
  );
}

function fullInsertedRow(
  ctx: SpreadsheetTableContext,
  row: Record<string, string | null>,
): Record<string, unknown> {
  return Object.fromEntries(
    ctx.columns.map((column) => [
      column.name,
      row[column.name] === "" ? null : row[column.name] ?? null,
    ]),
  );
}

function buildInsertMutation(
  ctx: SpreadsheetTableContext,
  rowInput: Record<string, string | null>,
  operatorId: string,
): SpreadsheetMutation {
  for (const key of Object.keys(rowInput)) {
    if (!ctx.columnNames.includes(key)) throw new Error("unknown_column");
    if (
      !isSpreadsheetColumnEditable(ctx.def, key) &&
      !isSpreadsheetForcedInsertColumn(ctx.def.table, key)
    ) {
      throw new Error("column_not_editable");
    }
  }
  const row = applySpreadsheetForcedInsertValues(ctx.def.table, rowInput);
  const pk = primaryKeyFromRowValues(row, ctx.primaryKeys);
  const keys = ctx.columns
    .map((c) => c.name)
    .filter(
      (name) =>
        row[name] !== undefined &&
        (isSpreadsheetColumnEditable(ctx.def, name) ||
          isSpreadsheetForcedInsertColumn(ctx.def.table, name)),
    );
  if (keys.length === 0) throw new Error("empty_row");
  const db = spreadsheetDb();
  const values = keys.map((key) => (row[key] === "" ? null : row[key]));
  return {
    statement: db.run(sql`
      INSERT INTO ${sql.raw(ctx.quotedTable)} (${sql.raw(keys.map(quoteIdent).join(", "))})
      VALUES (${sql.join(values.map((value) => sql`${value}`), sql`, `)})
    `),
    audit: {
      table_name: ctx.def.table,
      target_id: recordIdFromPk(pk),
      operation: "CREATE",
      before: null,
      after: fullInsertedRow(ctx, row),
      actor_user_id: operatorId,
      retention_class: "long_audit",
      strict: true,
      context: "admin_spreadsheet",
    },
  };
}

function buildUpdateMutation(
  ctx: SpreadsheetTableContext,
  pk: Record<string, string>,
  before: Record<string, unknown>,
  values: Record<string, string | null>,
  operatorId: string,
): SpreadsheetMutation {
  const setCols = ctx.columns.filter(
    (column) =>
      column.pk === 0 &&
      isSpreadsheetColumnEditable(ctx.def, column.name) &&
      values[column.name] !== undefined,
  );
  if (setCols.length === 0) throw new Error("empty_row");
  const pkWhere = primaryKeyCondition(ctx, pk);
  const optimistic = snapshotCondition(ctx, before);
  const after = { ...before };
  for (const column of setCols) {
    after[column.name] = values[column.name] === "" ? null : values[column.name];
  }
  const db = spreadsheetDb();
  return {
    statement: db.run(sql`
      UPDATE ${sql.raw(ctx.quotedTable)}
      SET ${sql.join(
        setCols.map((column) =>
          sql`${sql.raw(quoteIdent(column.name))} = ${values[column.name] === "" ? null : values[column.name]}`,
        ),
        sql`, `,
      )}
      WHERE ${pkWhere} AND ${optimistic}
    `),
    audit: {
      table_name: ctx.def.table,
      target_id: recordIdFromPk(pk),
      operation: "UPDATE",
      before,
      after,
      actor_user_id: operatorId,
      retention_class: "long_audit",
      strict: true,
      context: "admin_spreadsheet",
    },
  };
}

function buildDeleteMutation(
  ctx: SpreadsheetTableContext,
  pk: Record<string, string>,
  before: Record<string, unknown>,
  operatorId: string,
): SpreadsheetMutation {
  const pkWhere = primaryKeyCondition(ctx, pk);
  const optimistic = snapshotCondition(ctx, before);
  const db = spreadsheetDb();
  return {
    statement: db.run(sql`
      DELETE FROM ${sql.raw(ctx.quotedTable)}
      WHERE ${pkWhere} AND ${optimistic}
    `),
    audit: {
      table_name: ctx.def.table,
      target_id: recordIdFromPk(pk),
      operation: "DELETE",
      before,
      after: null,
      actor_user_id: operatorId,
      retention_class: "long_audit",
      strict: true,
      context: "admin_spreadsheet",
    },
  };
}

async function executeSpreadsheetMutations(
  mutations: SpreadsheetMutation[],
): Promise<void> {
  if (mutations.length === 0) return;
  const db = spreadsheetDb();
  await mutateWithAudit(db, {
    mutationStatements: mutations.map((mutation) => mutation.statement),
    expectedMutationChanges: mutations.map(() => 1),
    audits: mutations.map((mutation) => mutation.audit),
  });
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

  await executeSpreadsheetMutations([
    buildUpdateMutation(
      ctx,
      primaryKey,
      beforeRaw,
      { [opts.column]: opts.value },
      opts.operatorId,
    ),
  ]);
}

async function insertSpreadsheetRowWithContext(
  ctx: SpreadsheetTableContext,
  opts: {
    row: Record<string, string | null>;
    operatorId: string;
  },
): Promise<void> {
  assertTableEditable(ctx);
  await executeSpreadsheetMutations([
    buildInsertMutation(ctx, opts.row, opts.operatorId),
  ]);
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

  await executeSpreadsheetMutations([
    buildDeleteMutation(ctx, primaryKey, beforeRaw, opts.operatorId),
  ]);
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

async function planUpsertSpreadsheetRow(
  ctx: SpreadsheetTableContext,
  opts: {
    row: Record<string, string | null>;
    operatorId: string;
    existingRow?: Record<string, unknown> | null;
    existingRowKnown?: boolean;
  },
): Promise<{ kind: "inserted" | "updated" | "skipped"; mutation?: SpreadsheetMutation }> {
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
    if (setCols.length === 0) return { kind: "skipped" };
    return {
      kind: "updated",
      mutation: buildUpdateMutation(ctx, pk, existing, opts.row, opts.operatorId),
    };
  }
  return {
    kind: "inserted",
    mutation: buildInsertMutation(ctx, opts.row, opts.operatorId),
  };
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
  if (opts.rows.length > SPREADSHEET_IMPORT_MAX_BATCH_ROWS) {
    throw new Error("batch_too_large");
  }

  const errors: Array<{ index: number; message: string }> = [];
  const seenPks = new Set<string>();
  const preparedRows: Array<{ row: Record<string, string | null>; pk: Record<string, string>; fingerprint: string }> = [];
  for (let index = 0; index < opts.rows.length; index++) {
    const row = opts.rows[index]!;
    try {
      for (const key of Object.keys(row)) {
        if (!ctx.columnNames.includes(key)) throw new Error("unknown_column");
        if (
          !isSpreadsheetColumnEditable(ctx.def, key) &&
          !isSpreadsheetForcedInsertColumn(ctx.def.table, key)
        ) {
          throw new Error("column_not_editable");
        }
      }
      const pk = primaryKeyFromRowValues(row, ctx.primaryKeys);
      const fingerprint = primaryKeyFingerprint(pk);
      if (seenPks.has(fingerprint)) throw new Error("duplicate_primary_key");
      seenPks.add(fingerprint);
      if (Object.keys(row).length === 0) throw new Error("empty_row");
      preparedRows.push({ row, pk, fingerprint });
    } catch (error) {
      errors.push({
        index,
        message: error instanceof Error ? error.message : "invalid_row",
      });
    }
  }
  if (errors.length > 0) return { inserted: 0, updated: 0, skipped: 0, errors };

  const existingRowsByPk =
    opts.mode === "upsert"
      ? await fetchExistingRowsByImportPk(ctx, opts.rows)
      : null;
  const mutations: SpreadsheetMutation[] = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const prepared of preparedRows) {
    if (opts.mode === "insert") {
      mutations.push(buildInsertMutation(ctx, prepared.row, opts.operatorId));
      inserted += 1;
      continue;
    }
    const existing = existingRowsByPk?.get(prepared.fingerprint) ?? null;
    const planned = await planUpsertSpreadsheetRow(ctx, {
      row: prepared.row,
      operatorId: opts.operatorId,
      existingRow: existing,
      existingRowKnown: true,
    });
    if (planned.mutation) mutations.push(planned.mutation);
    if (planned.kind === "inserted") inserted += 1;
    else if (planned.kind === "updated") updated += 1;
    else skipped += 1;
  }
  await executeSpreadsheetMutations(mutations);
  return { inserted, updated, skipped, errors: [] };
}
