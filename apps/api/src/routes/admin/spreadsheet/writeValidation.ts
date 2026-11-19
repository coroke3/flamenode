/**
 * MIG-0638 U01b: pure CURRENT spreadsheet cell validation for RH-004..006.
 * Derived from src/lib/admin/spreadsheet/query.ts#validateSpreadsheetInputValues.
 * Keep error codes and validation order identical; this module performs no D1
 * calls and must only run AFTER the admin write guard and table resolution.
 */
import {
  buildSpreadsheetImportPreviewBinding,
  verifySpreadsheetImportPreviewToken,
} from "./importPreviewToken.ts";
import { sql, type SQL } from "@flamenode/server-core/sql";
import type { ServerCoreDb } from "@flamenode/server-core/db";
import {
  assertAtomicAuditMutationBindLimits,
  planAtomicAuditMutationBudget,
  type AtomicAuditMutationInput,
} from "@flamenode/server-core/audit/mutate";
import type { PreloadedAuditContext } from "@flamenode/server-core/audit/logger";
import { buildStaticRebuildQueueBatch } from "@flamenode/server-core/staticRebuild/enqueue";
import {
  isStaticRebuildTargetType,
  type EnqueueStaticRebuildInput,
} from "@flamenode/server-core/staticRebuild/types";
import {
  getSpreadsheetColumnPolicy,
  isSpreadsheetColumnEditable,
  isSpreadsheetPhysicalDeleteBlocked,
  SPREADSHEET_DEFAULT_MAX_CELL_CHARS,
  type SpreadsheetTableDef,
} from "./registry.ts";

export interface SpreadsheetWriteValidationContext {
  def: SpreadsheetTableDef;
  columnNames: readonly string[];
  columns: readonly {
    name: string;
    type: string;
    notNull: boolean;
    enumValues?: readonly string[];
    defaultValue?: string | null;
    generated?: boolean;
  }[];
}

/**
 * U01b RH-004/005/006: guarded Hono write routes will call this AFTER
 * the shared admin origin/session/write guard and bounded JSON reader.
 * CURRENT accepts table, primaryKey, column/value and row as described in
 * app/api/admin/spreadsheet/data/route.ts. We retain its missing_fields code
 * for absent structural fields and treat ill-typed JSON cells as invalid_row,
 * instead of allowing implicit object->string coercion in D1/audit planning.
 * This pure parser neither resolves tables nor performs a DB mutation.
 */
export type SpreadsheetCrudMethod = "PATCH" | "POST" | "DELETE";
export type SpreadsheetCrudBody =
  | { method: "PATCH"; table: string; primaryKey: Readonly<Record<string, string>>; column: string; value: string | null }
  | { method: "POST"; table: string; row: Readonly<Record<string, string | null>> }
  | { method: "DELETE"; table: string; primaryKey: Readonly<Record<string, string>> };

function spreadsheetJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function spreadsheetJsonStringRecord(
  value: unknown,
  allowNull: boolean,
): Record<string, string | null> {
  if (!spreadsheetJsonRecord(value)) throw new Error("missing_fields");
  const cells: Array<[string, string | null]> = [];
  for (const [key, cell] of Object.entries(value)) {
    if (typeof cell !== "string" && (!allowNull || cell !== null)) {
      throw new Error("invalid_row");
    }
    // Object.fromEntries stores keys such as "__proto__" as data fields.
    // Never retain a reference to a mutable caller-owned JSON body.
    cells.push([key, cell as string | null]);
  }
  return Object.freeze(Object.fromEntries(cells));
}

export function parseSpreadsheetCrudBody(
  method: SpreadsheetCrudMethod,
  body: unknown,
): SpreadsheetCrudBody {
  if (method !== "PATCH" && method !== "POST" && method !== "DELETE") {
    throw new Error("invalid_row");
  }
  if (!spreadsheetJsonRecord(body)) throw new Error("missing_fields");
  const rawTable = Object.hasOwn(body, "table") ? body.table : undefined;
  if (typeof rawTable !== "string" || rawTable.trim() === "") {
    throw new Error("missing_fields");
  }
  const table = rawTable.trim();
  if (method === "POST") {
    const row = spreadsheetJsonStringRecord(
      Object.hasOwn(body, "row") ? body.row : undefined,
      true,
    );
    return Object.freeze({ method, table, row });
  }
  const primaryKey = spreadsheetJsonStringRecord(
    Object.hasOwn(body, "primaryKey") ? body.primaryKey : undefined,
    false,
  ) as Record<string, string>;
  if (method === "DELETE") {
    return Object.freeze({ method, table, primaryKey });
  }
  const rawColumn = Object.hasOwn(body, "column") ? body.column : undefined;
  if (typeof rawColumn !== "string" || rawColumn.trim() === "") {
    throw new Error("missing_fields");
  }
  const rawValue = Object.hasOwn(body, "value") ? body.value : null;
  // CURRENT PATCH interprets an omitted or nullish cell value as SQL NULL.
  if (rawValue !== null && rawValue !== undefined && typeof rawValue !== "string") {
    throw new Error("invalid_row");
  }
  return Object.freeze({
    method, table, primaryKey, column: rawColumn.trim(), value: rawValue ?? null,
  });
}


/** CURRENT error messages are stable, machine-readable API error codes. */
export function validateSpreadsheetInputValues(
  ctx: SpreadsheetWriteValidationContext,
  row: Record<string, string | null>,
): void {
  for (const key of Object.keys(row)) {
    if (!ctx.columnNames.includes(key)) throw new Error("unknown_column");
    if (!isSpreadsheetColumnEditable(ctx.def, key)) {
      throw new Error("column_not_editable");
    }
    const value = row[key];
    // A NUL in a JS string is silently truncated by node:sqlite TEXT bind.
    // Never validate/audit one value and store another (also applies to PKs).
    if (typeof value === "string" && value.includes("\0")) throw new Error("invalid_row");
    const meta = ctx.columns.find((column) => column.name === key)!;
    if (value == null && meta.notNull) throw new Error("not_null_violation");
    const policy = getSpreadsheetColumnPolicy(ctx.def.table, key, meta.enumValues);
    if (value != null && String(value).length > (policy?.maxLength ?? SPREADSHEET_DEFAULT_MAX_CELL_CHARS)) {
      throw new Error("value_too_long");
    }
    if (policy?.enum && value != null && !policy.enum.includes(String(value))) {
      throw new Error("invalid_enum");
    }
    if (policy?.json && value != null) {
      try { JSON.parse(String(value)); } catch { throw new Error("invalid_json_value"); }
    }
    if (policy?.url && value != null) {
      try {
        const url = new URL(String(value));
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
      } catch { throw new Error("invalid_url"); }
    }
    if (value != null && meta.type.toUpperCase().includes("INT") && !/^-?\d+$/.test(String(value))) {
      throw new Error("invalid_integer");
    }
    if (value != null && /REAL|FLOA|DOUB|NUMERIC|DECIMAL/i.test(meta.type) && !/^-?\d+(?:\.\d+)?$/.test(String(value))) {
      throw new Error("invalid_number");
    }
  }
}


/** CURRENT validation.ts#resolveSpreadsheetDefaultValue parity for SQLite defaults. */
export function resolveSpreadsheetDefaultValue(
  column: { defaultValue?: string | null },
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

/**
 * CURRENT query.ts#prepareCompleteInsertRow parity.
 * This is a pure row builder only: guarded Hono INSERT/audit/Queue integration
 * remains unimplemented and must not be inferred from this export.
 */
export function prepareCompleteInsertRow(
  ctx: SpreadsheetWriteValidationContext,
  rowInput: Record<string, string | null>,
): Record<string, string | number | null> {
  const row = rowInput;
  validateSpreadsheetInputValues(ctx, row);
  const complete: Array<[string, string | number | null]> = [];
  for (const column of ctx.columns) {
    if (column.generated) continue;
    // Reading inherited properties (e.g. "constructor") would incorrectly
    // treat a missing input as a supplied value. Store "__proto__" as a data
    // column instead of invoking Object.prototype's legacy setter.
    const provided = Object.hasOwn(row, column.name) && row[column.name] !== undefined;
    if (provided) {
      const value = row[column.name]!;
      if (value == null && column.notNull) throw new Error("not_null_violation");
      complete.push([column.name, value === "" ? null : value]);
    } else if (column.defaultValue != null) {
      complete.push([column.name, resolveSpreadsheetDefaultValue(column)]);
    } else if (column.notNull) {
      throw new Error("missing_required_column");
    } else {
      complete.push([column.name, null]);
    }
  }
  return Object.fromEntries(complete);
}


/** CURRENT validation.ts#getPrimaryKeyIssue and normalizePrimaryKeyRecord parity. */
export function normalizeSpreadsheetPrimaryKey(
  primaryKeys: readonly string[],
  pk: Record<string, string>,
): Record<string, string> {
  if (primaryKeys.length === 0) throw new Error("missing_primary_key");
  const normalized: Array<[string, string]> = [];
  for (const key of primaryKeys) {
    // Object.prototype names are valid SQL identifiers, but inherited JS
    // properties must never stand in for absent JSON primary-key components.
    if (!Object.hasOwn(pk, key)) throw new Error("missing_primary_key");
    const value = pk[key];
    if (value === undefined) throw new Error("missing_primary_key");
    const text = String(value);
    if (text.trim() === "") throw new Error("missing_primary_key");
    // Some SQLite bindings truncate embedded NUL bytes at write/read time.
    if (text.includes("\0")) throw new Error("invalid_row");
    normalized.push([key, text]);
  }
  return Object.fromEntries(normalized);
}

/** CURRENT validation.ts#primaryKeyFromRowValues parity. */
export function primaryKeyFromSpreadsheetRow(
  row: Record<string, string | null>,
  primaryKeys: readonly string[],
): Record<string, string> {
  const raw = Object.fromEntries(primaryKeys.map((key) => {
    const value = Object.hasOwn(row, key) ? row[key] : undefined;
    return [key, value == null ? "" : String(value)];
  }));
  return normalizeSpreadsheetPrimaryKey(primaryKeys, raw);
}


/**
 * CURRENT query.ts#buildUpdateMutation pure portion: editable non-PK column
 * selection and optimistic after-image construction.
 * No SQL, authorization, audit or Queue side effects occur here.
 */
export function prepareSpreadsheetUpdate(
  ctx: SpreadsheetSqlTableContext,
  before: Record<string, unknown>,
  values: Record<string, string | null>,
): { setColumns: string[]; after: Record<string, unknown> } {
  validateSpreadsheetInputValues(ctx, values);
  const setColumns = ctx.columns
    .filter((column) =>
      column.pk === 0 &&
      isSpreadsheetColumnEditable(ctx.def, column.name) &&
      Object.hasOwn(values, column.name) && values[column.name] !== undefined,
    )
    .map((column) => column.name);
  if (setColumns.length === 0) throw new Error("empty_row");
  const after = Object.fromEntries([
    ...Object.entries(before),
    ...setColumns.map((column) => [column, values[column] === "" ? null : values[column]]),
  ]);
  return { setColumns, after };
}


/**
 * MIG-0638 U01b: unmounted D1 mutation SQL plans.
 * Bound parameters, rather than interpolation, represent all row values.
 * Callers MUST still enforce write authorization and use a single atomic
 * audit/queue transaction with an exactly-one-row CAS assertion.
 */
export interface SpreadsheetSqlPlan {
  statement: string;
  binds: readonly (string | number | null)[];
}

/** D1's per-statement bind ceiling applies to write SQL AND pre-read SQL. */
export const SPREADSHEET_SQL_MAX_BINDS = 100;

function boundedSpreadsheetSqlPlan<T extends SpreadsheetSqlPlan>(plan: T): T {
  if (plan.binds.length > SPREADSHEET_SQL_MAX_BINDS) {
    throw new Error("batch_too_large");
  }
  return plan;
}
export interface SpreadsheetSqlTableContext extends SpreadsheetWriteValidationContext {
  primaryKeys: readonly string[];
  columns: readonly (SpreadsheetWriteValidationContext["columns"][number] & { pk: number })[];
}
function quoteSpreadsheetIdentifier(name: string): string {
  // Column/table identifiers originate from the checked DB catalog, never request input.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("unknown_column");
  return '"' + name.replace(/"/g, '""') + '"';
}
function spreadsheetTableIdentifier(ctx: SpreadsheetSqlTableContext): string {
  return quoteSpreadsheetIdentifier(ctx.def.table);
}
/**
 * MIG-0638 U01b: bridge a catalog-validated, parametrized CRUD plan into the
 * Drizzle SQL wrapper required by mutateWithAudit's D1 batch API.
 *
 * The caller must supply a plan from buildSpreadsheetAuditedInsert/Update/Delete,
 * not user SQL. This helper is deliberately UNMOUNTED: it neither authorizes a
 * write nor supplies the required audit, Queue and exact-one CAS transaction.
 * Its additional shape checks make forged/ill-formed plans fail closed.
 */
export function spreadsheetMutationToBoundSql(
  ctx: SpreadsheetSqlTableContext,
  plan: SpreadsheetSqlPlan,
): SQL {
  if (ctx.def.mode !== "editable") throw new Error("table_readonly");
  const table = spreadsheetTableIdentifier(ctx);
  if (!plan || typeof plan.statement !== "string" || !Array.isArray(plan.binds)) {
    throw new Error("invalid_row");
  }
  const statement = plan.statement;
  // All source planners emit one canonical SQL shape for this catalog table.
  // Prefix-only validation is insufficient: a forged "UPDATE ... WHERE 1=1"
  // would otherwise be accepted as a valid atomic-batch input.
  if (/[;'\x00]/.test(statement) || statement.includes("--") ||
      statement.includes("/*") || statement.includes("*/")) {
    throw new Error("invalid_row");
  }
  const pieces = statement.split("?");
  if (pieces.length !== plan.binds.length + 1 ||
      plan.binds.length > SPREADSHEET_SQL_MAX_BINDS) {
    throw new Error("batch_too_large");
  }
  const cols = ctx.columns.map(col => col.name);
  if (new Set(cols).size !== cols.length ||
      !ctx.primaryKeys.length || new Set(ctx.primaryKeys).size !== ctx.primaryKeys.length ||
      ctx.primaryKeys.some(key => !cols.includes(key))) {
    throw new Error("invalid_row");
  }
  const snapshotWhere = ctx.columns.map(col => quoteSpreadsheetIdentifier(col.name) + " IS ?").join(" AND ");
  const pkWhere = ctx.primaryKeys.map(key => quoteSpreadsheetIdentifier(key) + " = ?").join(" AND ");
  const where = pkWhere + " AND " + snapshotWhere;
  const insertColumns = ctx.columns.filter(col => !col.generated).map(col => quoteSpreadsheetIdentifier(col.name));
  const canonicalInsert = insertColumns.length > 0
    ? "INSERT INTO " + table + " (" + insertColumns.join(", ") + ") VALUES (" +
      insertColumns.map(() => "?").join(", ") + ")"
    : "";
  const canonicalDelete = "DELETE FROM " + table + " WHERE " + where;
  const updatePrefix = "UPDATE " + table + " SET ";
  let canonical = statement === canonicalInsert ||
    (statement === canonicalDelete && !isSpreadsheetPhysicalDeleteBlocked(ctx.def.table));
  if (statement.startsWith(updatePrefix)) {
    const whereSuffix = " WHERE " + where;
    if (statement.endsWith(whereSuffix)) {
      const setText = statement.slice(updatePrefix.length, -whereSuffix.length);
      const assignments = setText.split(", ");
      const selected = assignments.map(part =>
        /^"([A-Za-z_][A-Za-z0-9_]*)" = \?$/.exec(part)?.[1] ?? "",
      );
      const allowed = ctx.columns.filter(col =>
        col.pk === 0 && isSpreadsheetColumnEditable(ctx.def, col.name),
      ).map(col => col.name);
      canonical = selected.length > 0 &&
        selected.every(name => allowed.includes(name)) &&
        // Each selected column appears exactly once, in catalog order.
        JSON.stringify(selected) === JSON.stringify(
          ctx.columns.filter(col => selected.includes(col.name)).map(col => col.name),
        );
    }
  }
  if (!canonical) throw new Error("invalid_row");
  const queryChunks: SQL[] = [];
  for (let index = 0; index < plan.binds.length; index += 1) {
    const value = plan.binds[index];
    if (value !== null && typeof value !== "string" && typeof value !== "number") {
      throw new Error("invalid_row");
    }
    if ((typeof value === "number" && !Number.isFinite(value)) ||
        (typeof value === "string" && value.includes("\0"))) {
      throw new Error("invalid_row");
    }
    queryChunks.push(sql.raw(pieces[index]), sql`${value}`);
  }
  queryChunks.push(sql.raw(pieces[pieces.length - 1]));
  return sql.join(queryChunks, sql.raw(""));
}

function spreadsheetPkCondition(ctx: SpreadsheetSqlTableContext, pk: Record<string, string>): SpreadsheetSqlPlan {
  const normalized = normalizeSpreadsheetPrimaryKey(ctx.primaryKeys, pk);
  return {
    statement: ctx.primaryKeys.map(k => quoteSpreadsheetIdentifier(k) + " = ?").join(" AND "),
    binds: ctx.primaryKeys.map(k => normalized[k]),
  };
}
/** A caller-provided before-image must belong to the exact requested row. */
function assertSpreadsheetSnapshotPrimaryKey(
  ctx: SpreadsheetSqlTableContext,
  pk: Record<string, string>,
  before: Record<string, unknown>,
): void {
  const normalized = normalizeSpreadsheetPrimaryKey(ctx.primaryKeys, pk);
  for (const key of ctx.primaryKeys) {
    const value = before[key];
    if (value == null || String(value) !== normalized[key]) throw new Error("invalid_snapshot");
  }
}

function spreadsheetSnapshotCondition(ctx: SpreadsheetSqlTableContext, before: Record<string, unknown>): SpreadsheetSqlPlan {
  const binds: (string | number | null)[] = [];
  const clauses = ctx.columns.map(column => {
    // A partial/undefined before-image must not silently become SQL NULL.
    // Full-row CAS requires a fresh DB snapshot containing every column.
    if (!Object.prototype.hasOwnProperty.call(before, column.name)) throw new Error("invalid_snapshot");
    const raw = before[column.name];
    if (raw === undefined || (raw != null && typeof raw !== "string" && typeof raw !== "number")) {
      throw new Error("invalid_snapshot");
    }
    binds.push(raw ?? null);
    return quoteSpreadsheetIdentifier(column.name) + " IS ?";
  });
  return { statement: clauses.join(" AND "), binds };
}
export function buildSpreadsheetInsertSql(
  ctx: SpreadsheetSqlTableContext,
  rowInput: Record<string, string | null>,
): SpreadsheetSqlPlan & { row: Record<string, string | number | null> } {
  if (ctx.def.mode !== "editable") throw new Error("table_readonly");
  const row = prepareCompleteInsertRow(ctx, rowInput);
  normalizeSpreadsheetPrimaryKey(
    ctx.primaryKeys,
    Object.fromEntries(ctx.primaryKeys.map(key => [key, String(row[key] ?? "")])),
  );
  const keys = Object.keys(row);
  if (keys.length === 0) throw new Error("empty_row");
  return boundedSpreadsheetSqlPlan({
    statement: "INSERT INTO " + spreadsheetTableIdentifier(ctx) +
      " (" + keys.map(quoteSpreadsheetIdentifier).join(", ") + ") VALUES (" + keys.map(() => "?").join(", ") + ")",
    binds: keys.map(key => row[key]),
    row,
  });
}
export function buildSpreadsheetUpdateSql(
  ctx: SpreadsheetSqlTableContext,
  pk: Record<string, string>,
  before: Record<string, unknown>,
  values: Record<string, string | null>,
): SpreadsheetSqlPlan & { after: Record<string, unknown> } {
  if (ctx.def.mode !== "editable") throw new Error("table_readonly");
  assertSpreadsheetSnapshotPrimaryKey(ctx, pk, before);
  const { setColumns, after } = prepareSpreadsheetUpdate(ctx, before, values);
  const key = spreadsheetPkCondition(ctx, pk);
  const snapshot = spreadsheetSnapshotCondition(ctx, before);
  return boundedSpreadsheetSqlPlan({
    statement: "UPDATE " + spreadsheetTableIdentifier(ctx) + " SET " +
      setColumns.map(column => quoteSpreadsheetIdentifier(column) + " = ?").join(", ") +
      " WHERE " + key.statement + " AND " + snapshot.statement,
    binds: [...setColumns.map(column => values[column] === "" ? null : (values[column] ?? null)), ...key.binds, ...snapshot.binds],
    after,
  });
}
export function buildSpreadsheetDeleteSql(
  ctx: SpreadsheetSqlTableContext,
  pk: Record<string, string>,
  before: Record<string, unknown>,
): SpreadsheetSqlPlan {
  if (ctx.def.mode !== "editable") throw new Error("table_readonly");
  if (isSpreadsheetPhysicalDeleteBlocked(ctx.def.table)) throw new Error("physical_delete_requires_visibility_status");
  assertSpreadsheetSnapshotPrimaryKey(ctx, pk, before);
  const key = spreadsheetPkCondition(ctx, pk);
  const snapshot = spreadsheetSnapshotCondition(ctx, before);
  return boundedSpreadsheetSqlPlan({
    statement: "DELETE FROM " + spreadsheetTableIdentifier(ctx) +
      " WHERE " + key.statement + " AND " + snapshot.statement,
    binds: [...key.binds, ...snapshot.binds],
  });
}


/** CURRENT query.ts foreign-key validation: plan 99-bound-value D1 lookups. */
export interface SpreadsheetForeignKey {
  column: string;
  referencedTable: string;
  referencedColumn: string;
}
/** S3 permits at most three D1 pre-read statements total. This cap only bounds FK lookups;
 * the caller must still include its other pre-reads in the request-wide budget. */
export const SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES = 3;
/** 99 distinct bound FK values plus one schema-drift sentinel row. */
export const MAX_SPREADSHEET_FK_LOOKUP_ROWS = 100;
export interface SpreadsheetForeignKeyLookup extends SpreadsheetSqlPlan {
  values: readonly string[];
}
export function buildSpreadsheetForeignKeyLookups(
  foreignKeys: readonly SpreadsheetForeignKey[],
  rows: readonly Record<string, string | null>[],
  remainingReadBudget = SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES,
): SpreadsheetForeignKeyLookup[] {
  if (!Number.isInteger(remainingReadBudget) || remainingReadBudget < 0 || remainingReadBudget > SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES) {
    throw new Error("batch_too_large");
  }
  const lookups: SpreadsheetForeignKeyLookup[] = [];
  for (const foreignKey of foreignKeys) {
    // SQL identifiers originate from PRAGMA foreign_key_list, never request JSON.
    const reference = quoteSpreadsheetIdentifier(foreignKey.referencedColumn);
    const table = quoteSpreadsheetIdentifier(foreignKey.referencedTable);
    // Collect at most the remaining statement capacity; reject on the first
    // distinct value above that ceiling instead of materializing all inputs.
    const remainingValues = (remainingReadBudget - lookups.length) * 99;
    const seen = new Set<string>();
    for (const row of rows) {
      // This planner is exported and may be called without the body parser.
      // An inherited SQL column (e.g. "constructor") is NOT a supplied FK.
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error("invalid_row");
      }
      const supplied = Object.hasOwn(row, foreignKey.column);
      const value = supplied ? row[foreignKey.column] : undefined;
      // A supplied undefined is not valid JSON; unlike an omitted optional
      // FK, it must not silently skip the referential-integrity preflight.
      if (supplied && value === undefined) throw new Error("invalid_row");
      // Never coerce an object, number, or boolean into a different D1 bind
      // and potentially authorize a different row than the user's JSON.
      if (value != null && typeof value !== "string") throw new Error("invalid_row");
      // SQLite TEXT bindings may truncate NUL; forbid that ambiguity.
      if (typeof value === "string" && value.includes("\0")) throw new Error("invalid_row");
      if (value == null || value === "" || seen.has(value)) continue;
      if (seen.size >= remainingValues) throw new Error("batch_too_large");
      seen.add(value);
    }
    const values = [...seen];
    for (let start = 0; start < values.length; start += 99) {
      const chunk = values.slice(start, start + 99);
      const placeholders = chunk.map(() => "?").join(", ");
      lookups.push({
        // ZERO_1102 §4 requires a literal row limit on every D1 SELECT.
        // A valid referenced UNIQUE/PK yields <=chunk.length rows; one extra
        // sentinel exposes an unexpectedly non-unique referenced key.
        statement: "SELECT " + reference + " AS value FROM " + table + " WHERE " + reference + " IN (" +
          placeholders + ") LIMIT " + Math.min(chunk.length + 1, MAX_SPREADSHEET_FK_LOOKUP_ROWS),
        binds: chunk,
        values: chunk,
      });
    }
  }
  return lookups;
}

/** Reject any missing FK in a lookup's result, before a write is submitted. */
export function assertSpreadsheetForeignKeyLookup(
  lookup: SpreadsheetForeignKeyLookup,
  returned: readonly { value: string | number | null }[],
): void {
  if (!Array.isArray(returned) || returned.length > lookup.values.length) {
    // A non-unique referenced key or malformed D1 adapter result must never
    // authorize writes under a false assumption of FK uniqueness.
    throw new Error("invalid_snapshot");
  }
  const requested = new Set(lookup.values);
  const found = new Set<string>();
  for (const row of returned) {
    // An incomplete adapter row must never stringify missing "value" as
    // "undefined" (which might itself be a valid bound FK string).
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        !Object.hasOwn(row, "value")) {
      throw new Error("invalid_snapshot");
    }
    const cell = row.value;
    if (cell === null ||
        (typeof cell !== "string" && typeof cell !== "number") ||
        (typeof cell === "number" && !Number.isFinite(cell))) {
      throw new Error("invalid_snapshot");
    }
    // D1 exposes SQLite numeric values as IEEE-754 JS numbers. Distinct
    // INTEGER keys beyond 2^53-1 may collapse to the same rounded number,
    // creating a false positive for an FK preflight and a misleading audit.
    // Fail closed instead of comparing rounded decimal strings.
    if (typeof cell === "number" && Number.isInteger(cell) &&
        !Number.isSafeInteger(cell)) throw new Error("invalid_snapshot");
    const value = String(cell);
    if (value.includes("\0") || !requested.has(value) || found.has(value)) {
      // The SQL WHERE clause cannot return unrequested or duplicate values
      // under the referenced-key uniqueness assumption.
      throw new Error("invalid_snapshot");
    }
    found.add(value);
  }
  if (lookup.values.some(value => !found.has(value))) {
    throw new Error("foreign_key_violation");
  }
}


/**
 * D1 read-only FK preflight. A caller must execute this AFTER the admin write
 * guard and BEFORE planning the mutation+audit+Queue atomic D1 batch.
 */
export async function validateSpreadsheetForeignKeys(
  db: {
    prepare(sql: string): {
      bind(...values: (string | number | null)[]): {
        all<T>(): Promise<{ results?: T[] }>;
      };
    };
  },
  foreignKeys: readonly SpreadsheetForeignKey[],
  rows: readonly Record<string, string | null>[],
  remainingReadBudget: number,
): Promise<void> {
  // Reject omitted runtime arguments even though the TS signature requires them.
  if (!Number.isInteger(remainingReadBudget) || remainingReadBudget < 0 || remainingReadBudget > SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES) {
    throw new Error("batch_too_large");
  }
  for (const lookup of buildSpreadsheetForeignKeyLookups(foreignKeys, rows, remainingReadBudget)) {
    const result = await db.prepare(lookup.statement).bind(...lookup.binds).all<{ value: string | number | null }>();
    assertSpreadsheetForeignKeyLookup(lookup, result.results ?? []);
  }
}


/** One row plus a sentinel to detect a broken/nonunique SQL PK before CAS. */
export const MAX_SPREADSHEET_CRUD_SNAPSHOT_ROWS = 2;

/**
 * CURRENT query.ts#fetchRowByPkRaw equivalent. Only a bound SELECT and no
 * caching: the caller must fetch a fresh row after the write guard.
 * One D1 pre-read is consumed; the route must deduct it from S3's total.
 */
export async function fetchSpreadsheetRawSnapshot(
  db: {
    prepare(sql: string): {
      bind(...values: (string | number | null)[]): {
        all<T>(): Promise<{ results?: T[] }>;
      };
    };
  },
  ctx: SpreadsheetSqlTableContext,
  pk: Record<string, string>,
  remainingReadBudget: number,
): Promise<Record<string, unknown>> {
  if (!Number.isInteger(remainingReadBudget) || remainingReadBudget < 1 ||
      remainingReadBudget > SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES) {
    throw new Error("batch_too_large");
  }
  const normalized = normalizeSpreadsheetPrimaryKey(ctx.primaryKeys, pk);
  // PK values identify a row; they are not editable cell mutations. CURRENT
  // fetchRowByPkRaw/buildPkWhere applies the PK presence/NUL guard, but NOT
  // isSpreadsheetColumnEditable (which can reject a secret/readonly PK).
  // Actual mutation fields are validated by the downstream write planner.
  const key = spreadsheetPkCondition(ctx, normalized);
  // A SELECT ... LIMIT 1 hides duplicate matching PK rows under a corrupt
  // schema. Read one sentinel row in the same (single-budgeted) SELECT,
  // rejecting ambiguity before building CAS binds and audit before_json.
  const statement = "SELECT * FROM " + spreadsheetTableIdentifier(ctx) +
    " WHERE " + key.statement + " LIMIT " + MAX_SPREADSHEET_CRUD_SNAPSHOT_ROWS;
  if (key.binds.length > SPREADSHEET_SQL_MAX_BINDS) throw new Error("batch_too_large");
  const result = await db.prepare(statement).bind(...key.binds).all<Record<string, unknown>>();
  if (!result || !Array.isArray(result.results) ||
      result.results.length > 1) throw new Error("invalid_snapshot");
  if (result.results.length === 0) throw new Error("row_not_found");
  const row = result.results[0];
  // U01b: return a *single* immutable before-image. A hostile/mock D1
  // accessor cannot substitute a different PK or cell between this SELECT,
  // the optimistic CAS WHERE clause, and the strict audit before_json.
  // Preserve "__proto__" as an own data column rather than invoking a setter.
  let snapshot: Record<string, unknown>;
  try {
    if (typeof row !== "object" || Array.isArray(row)) throw new Error("invalid_snapshot");
    const cells: Array<[string, string | number | null]> = [];
    for (const column of ctx.columns) {
      if (!Object.hasOwn(row, column.name)) throw new Error("invalid_snapshot");
      const value = row[column.name];
      if (value !== null && typeof value !== "string" && typeof value !== "number") {
        throw new Error("invalid_snapshot");
      }
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new Error("invalid_snapshot");
      }
      cells.push([column.name, value]);
    }
    snapshot = Object.freeze(Object.fromEntries(cells));
    for (const key of ctx.primaryKeys) {
      const value = snapshot[key];
      // D1 returns SQLite INTEGER values as JS numbers. Above the safe
      // integer range, two distinct DB keys can collapse to one JS value;
      // comparing their rounded decimal string would misattribute audit.
      if (typeof value === "number" && Number.isInteger(value) &&
          !Number.isSafeInteger(value)) throw new Error("invalid_snapshot");
      if (value === null || String(value) !== normalized[key]) throw new Error("invalid_snapshot");
    }
  } catch {
    throw new Error("invalid_snapshot");
  }
  return snapshot;
}


/** CURRENT query.ts#recordIdFromPk and mutation audit envelope.
 * This prepares metadata only; callers MUST write the mutation, strict audit and
 * rebuild Queue in one atomic D1 transaction with exact-row assertions.
 */
export interface SpreadsheetAuditEntry {
  table_name: string;
  target_id: string;
  operation: "CREATE" | "UPDATE" | "DELETE";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor_user_id: string;
  retention_class: "long_audit";
  strict: true;
  context: "admin_spreadsheet";
}
export interface SpreadsheetAuditedSqlPlan extends SpreadsheetSqlPlan {
  audit: SpreadsheetAuditEntry;
}
export function spreadsheetRecordIdFromPk(pk: Record<string, string>): string {
  return Object.entries(pk)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value)
    .join(":");
}
function spreadsheetAuditEntry(
  ctx: SpreadsheetSqlTableContext,
  pk: Record<string, string>,
  operation: SpreadsheetAuditEntry["operation"],
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  operatorId: string,
): SpreadsheetAuditEntry {
  const normalized = normalizeSpreadsheetPrimaryKey(ctx.primaryKeys, pk);
  if (!operatorId.trim()) throw new Error("missing_operator");
  return {
    table_name: ctx.def.table,
    target_id: spreadsheetRecordIdFromPk(normalized),
    operation,
    before,
    after,
    actor_user_id: operatorId,
    retention_class: "long_audit",
    strict: true,
    context: "admin_spreadsheet",
  };
}
export function buildSpreadsheetAuditedInsert(
  ctx: SpreadsheetSqlTableContext,
  row: Record<string, string | null>,
  operatorId: string,
): SpreadsheetAuditedSqlPlan {
  const planned = buildSpreadsheetInsertSql(ctx, row);
  const pk = Object.fromEntries(ctx.primaryKeys.map(key => [key, String(planned.row[key] ?? "")]));
  return {
    statement: planned.statement,
    binds: planned.binds,
    audit: spreadsheetAuditEntry(ctx, pk, "CREATE", null, planned.row, operatorId),
  };
}
export function buildSpreadsheetAuditedUpdate(
  ctx: SpreadsheetSqlTableContext,
  pk: Record<string, string>,
  before: Record<string, unknown>,
  values: Record<string, string | null>,
  operatorId: string,
): SpreadsheetAuditedSqlPlan {
  const planned = buildSpreadsheetUpdateSql(ctx, pk, before, values);
  return {
    statement: planned.statement,
    binds: planned.binds,
    audit: spreadsheetAuditEntry(ctx, pk, "UPDATE", before, planned.after, operatorId),
  };
}
export function buildSpreadsheetAuditedDelete(
  ctx: SpreadsheetSqlTableContext,
  pk: Record<string, string>,
  before: Record<string, unknown>,
  operatorId: string,
): SpreadsheetAuditedSqlPlan {
  const planned = buildSpreadsheetDeleteSql(ctx, pk, before);
  return {
    statement: planned.statement,
    binds: planned.binds,
    audit: spreadsheetAuditEntry(ctx, pk, "DELETE", before, null, operatorId),
  };
}


/**
 * MIG-0638 U01b (UNMOUNTED): prepare one durable D1 transaction for a
 * previously authorized and snapshot-checked spreadsheet CRUD request.
 *
 * A missing queue is never silently treated as "no public effect": caller
 * must supply explicit, validated static rebuild targets. The batch contains
 * the single exact-one CRUD/CAS statement, all queue UPSERTs and a strict
 * audit; it must be executed with mutateWithAudit(db, input, loadWakeHost).
 * This function does no D1 read or write, no Queue send and no R2 operation.
 * Origin/session/write-identity, CostGuard, visibility fence and target
 * mapping MUST be checked separately before this is ever mounted.
 */
export const SPREADSHEET_ATOMIC_MAX_REBUILD_TARGETS = 8;

export async function planSpreadsheetAtomicAuditedCrud(
  db: ServerCoreDb,
  ctx: SpreadsheetSqlTableContext,
  plan: SpreadsheetAuditedSqlPlan,
  options: {
    authorizedActorId: string;
    callerQueryCount: number;
    queueTargets: readonly EnqueueStaticRebuildInput[];
    preloaded?: PreloadedAuditContext;
  },
): Promise<AtomicAuditMutationInput> {
  const audit = plan?.audit;
  if (!audit || audit.table_name !== ctx.def.table ||
      typeof options?.authorizedActorId !== "string" ||
      !options.authorizedActorId.trim() ||
      audit.actor_user_id !== options.authorizedActorId ||
      audit.context !== "admin_spreadsheet" ||
      audit.retention_class !== "long_audit" ||
      audit.strict !== true ||
      !["CREATE", "UPDATE", "DELETE"].includes(audit.operation) ||
      !Number.isSafeInteger(options.callerQueryCount) ||
      options.callerQueryCount < 1 || options.callerQueryCount > 50) {
    throw new Error("invalid_row");
  }
  if (!Array.isArray(options.queueTargets) ||
      options.queueTargets.length < 1 ||
      options.queueTargets.length > SPREADSHEET_ATOMIC_MAX_REBUILD_TARGETS ||
      options.queueTargets.some(target =>
        !target || !isStaticRebuildTargetType(target.targetType) ||
        typeof target.targetId !== "string" || !target.targetId.trim() ||
        typeof target.reason !== "string" || !target.reason.trim() ||
        target.targetId.includes("\0") || target.reason.includes("\0") ||
        target.targetId.length > 256 || target.reason.length > 128 ||
        // Queued work must be attributed to the *same* authorized actor
        // whose identity is recorded by the strict audit. Never trust a
        // different requestedByUserId supplied by a future HTTP caller.
        (target.requestedByUserId != null &&
          target.requestedByUserId !== options.authorizedActorId))) {
    throw new Error("invalid_row");
  }
  // Keep the legacy writer identity until Issue #674's versioned-history
  // policy has been independently approved. Never accept an audit target
  // unrelated to the mutation's PK, even if its SQL itself is canonical.
  const primary = audit.operation === "DELETE" ? audit.before : audit.after;
  if (!primary || typeof primary !== "object") throw new Error("invalid_row");
  const normalizeSnapshotPk = (row: Record<string, unknown>): Record<string, string> => {
    const entries = ctx.primaryKeys.map(key => {
      if (!Object.hasOwn(row, key)) throw new Error("invalid_row");
      const value = row[key];
      if (value === null || value === undefined ||
          (typeof value !== "string" && typeof value !== "number") ||
          (typeof value === "number" && !Number.isSafeInteger(value))) {
        throw new Error("invalid_row");
      }
      return [key, String(value)] as const;
    });
    return normalizeSpreadsheetPrimaryKey(ctx.primaryKeys, Object.fromEntries(entries));
  };
  const pk = normalizeSnapshotPk(primary);
  if (audit.target_id !== spreadsheetRecordIdFromPk(pk)) throw new Error("invalid_row");
  if (audit.operation === "CREATE") {
    if (audit.before !== null || audit.after === null ||
        !plan.statement.startsWith("INSERT INTO ")) throw new Error("invalid_row");
  } else if (audit.operation === "DELETE") {
    if (audit.after !== null || audit.before === null ||
        !plan.statement.startsWith("DELETE FROM ")) throw new Error("invalid_row");
  } else {
    if (!audit.before || !audit.after ||
        JSON.stringify(normalizeSnapshotPk(audit.before)) !== JSON.stringify(pk) ||
        !plan.statement.startsWith("UPDATE ")) throw new Error("invalid_row");
  }
  // Compile a non-executing D1 RunnableQuery, not a separately awaited DML.
  const mutation = db.run(spreadsheetMutationToBoundSql(ctx, plan));
  const queue = await buildStaticRebuildQueueBatch(db, options.queueTargets.map(target => ({
    ...target,
    requestedByUserId: options.authorizedActorId,
  })));
  if (queue.acceptedTargetCount < 1 ||
      queue.statements.length === 0 ||
      queue.statements.length !== queue.expectedChanges.length) {
    throw new Error("invalid_row");
  }
  const input: AtomicAuditMutationInput = {
    mutationStatements: [mutation, ...queue.statements],
    expectedMutationChanges: [1, ...queue.expectedChanges],
    audits: [{ ...audit }],
    callerQueryCount: options.callerQueryCount,
    preloaded: options.preloaded,
    staticRebuildWakeSource: "admin",
  };
  if (!planAtomicAuditMutationBudget(input).withinLimit) {
    throw new Error("batch_too_large");
  }
  assertAtomicAuditMutationBindLimits(db, input);
  return input;
}

/**
 * MIG-0638 U01b: guarded RH-004/005/006 pre-write orchestration.
 *
 * A future Hono route MUST run origin -> session -> admin write/identity and
 * CostGuard BEFORE calling this helper. This function is deliberately NOT
 * mounted and NEVER issues a mutation: it produces the SQL+audit plan for a
 * later, separately verified, atomic exact-one CAS + strict audit + Queue
 * executor. Reads are counted across FK preflight and the CRUD snapshot.
 */
export interface SpreadsheetCrudReadDatabase {
  prepare(sql: string): {
    bind(...values: (string | number | null)[]): {
      all<T>(): Promise<{ results?: T[] }>;
    };
  };
}

export async function planSpreadsheetGuardedCrud(
  db: SpreadsheetCrudReadDatabase,
  ctx: SpreadsheetSqlTableContext,
  body: SpreadsheetCrudBody,
  foreignKeys: readonly SpreadsheetForeignKey[],
  operatorId: string,
  remainingReadBudget: number,
): Promise<SpreadsheetAuditedSqlPlan> {
  if (ctx.def.table !== body.table) throw new Error("unknown_table");
  if (ctx.def.mode !== "editable") throw new Error("table_readonly");
  if (!operatorId.trim()) throw new Error("missing_operator");
  if (!Number.isInteger(remainingReadBudget) || remainingReadBudget < 0 ||
      remainingReadBudget > SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES) {
    throw new Error("batch_too_large");
  }

  if (body.method === "POST") {
    // Complete INSERT defaults before FK preflight. Inspecting only the
    // caller-supplied fields could silently bypass the lookup for a non-null
    // defaulted FK that will actually be persisted and audited.
    const plan = buildSpreadsheetAuditedInsert(ctx, body.row, operatorId);
    const inserted = plan.audit.after;
    if (!inserted) throw new Error("invalid_snapshot");
    const fkCells: Array<[string, string | null]> = [];
    for (const foreignKey of foreignKeys) {
      if (!Object.hasOwn(inserted, foreignKey.column)) {
        throw new Error("invalid_snapshot");
      }
      const value = inserted[foreignKey.column];
      if (value == null || value === "") {
        fkCells.push([foreignKey.column, null]);
      } else if (typeof value === "string") {
        fkCells.push([foreignKey.column, value]);
      } else if (typeof value === "number" && Number.isFinite(value)) {
        // Resolved SQLite numeric defaults are bound as numbers in INSERT;
        // normalize to text only for FK identity comparisons and pre-read.
        fkCells.push([foreignKey.column, String(value)]);
      } else {
        throw new Error("invalid_snapshot");
      }
    }
    // A projection of the actual INSERT/audit after-image prevents a
    // pre-default FK check from approving different persisted values.
    const fkRow = Object.freeze(Object.fromEntries(fkCells));
    const lookups = buildSpreadsheetForeignKeyLookups(foreignKeys, [fkRow], remainingReadBudget);
    if (lookups.length > 0) {
      await validateSpreadsheetForeignKeys(db, foreignKeys, [fkRow], remainingReadBudget);
    }
    return plan;
  }

  // Both UPDATE and DELETE require one fresh, complete, PK-matching before
  // snapshot; reserve that D1 statement from the shared S3 read budget.
  if (remainingReadBudget < 1) throw new Error("batch_too_large");
  const pk = normalizeSpreadsheetPrimaryKey(ctx.primaryKeys, body.primaryKey);
  if (body.method === "DELETE") {
    // Reject blocked physical deletion before any database read.
    if (isSpreadsheetPhysicalDeleteBlocked(ctx.def.table)) {
      throw new Error("physical_delete_requires_visibility_status");
    }
    const before = await fetchSpreadsheetRawSnapshot(db, ctx, pk, 1);
    return buildSpreadsheetAuditedDelete(ctx, pk, before, operatorId);
  }

  const values = Object.freeze(Object.fromEntries([[body.column, body.value]]));
  validateSpreadsheetInputValues(ctx, values);
  if (!ctx.columns.some(column => column.name === body.column && column.pk === 0 &&
      isSpreadsheetColumnEditable(ctx.def, column.name))) {
    throw new Error("empty_row");
  }
  // Fail on an excessive FK plan before incurring any D1 reads. The FK
  // preflight may use at most the remaining S3 budget minus the PK SELECT.
  const fkReadBudget = remainingReadBudget - 1;
  const lookups = buildSpreadsheetForeignKeyLookups(foreignKeys, [values], fkReadBudget);
  const before = await fetchSpreadsheetRawSnapshot(db, ctx, pk, 1);
  if (lookups.length > 0) {
    await validateSpreadsheetForeignKeys(db, foreignKeys, [values], fkReadBudget);
  }
  return buildSpreadsheetAuditedUpdate(ctx, pk, before, values, operatorId);
}


/**
 * MIG-0638 U02: CURRENT applySpreadsheetImport pure row preflight.
 * This does not verify preview tokens, read FK targets/existing rows,
 * consume nonces or run any D1 transaction.
 */
export const SPREADSHEET_IMPORT_PREVIEW_MAX_ROWS = 500;
export const SPREADSHEET_IMPORT_APPLY_MAX_ROWS = 7;
// Fetch one extra row to detect schema/PK cardinality drift without reading
// an unbounded D1 result before the strict audit+CAS planner can reject it.
export const MAX_SPREADSHEET_IMPORT_EXISTING_RESULT_ROWS = SPREADSHEET_IMPORT_APPLY_MAX_ROWS + 1;

/**
 * Composite primary keys may contain NUL bytes: concatenating components
 * with "\\0" is ambiguous (["a\\0b","c"] and ["a","b\\0c"] collide).
 * Encode sorted [column, value] pairs instead so duplicate detection, D1
 * snapshot lookup and UPSERT planning share one unambiguous identity.
 */
export function spreadsheetImportPrimaryKeyFingerprint(pk: Record<string, string>): string {
  // Use code-unit order: localeCompare can equate distinct Unicode column names.
  return JSON.stringify(Object.entries(pk).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export interface PreparedSpreadsheetImportRow {
  row: Record<string, string | null>;
  pk: Record<string, string>;
  fingerprint: string;
}
export interface SpreadsheetImportRowValidation {
  preparedRows: PreparedSpreadsheetImportRow[];
  errors: Array<{ index: number; message: string }>;
}

/**
 * Both U02 D1 pre-reads and mutation planning must bind the same verified PK.
 * A caller may replace an entry in the preparedRows array after preflight;
 * a stale, forged or swapped fingerprint must never select another before-row.
 * This is a pure, unmounted guard and does not authorize an import.
 */
function verifySpreadsheetPreparedImportIdentity(
  ctx: SpreadsheetSqlTableContext,
  entry: PreparedSpreadsheetImportRow,
): { pk: Record<string, string>; fingerprint: string } {
  try {
    if (!entry || typeof entry !== "object" || !entry.row || !entry.pk ||
        typeof entry.row !== "object" || typeof entry.pk !== "object") {
      throw new Error("invalid_row");
    }
    const pk = normalizeSpreadsheetPrimaryKey(ctx.primaryKeys, entry.pk);
    const rowPk = primaryKeyFromSpreadsheetRow(entry.row, ctx.primaryKeys);
    const fingerprint = spreadsheetImportPrimaryKeyFingerprint(pk);
    if (entry.fingerprint !== fingerprint ||
        spreadsheetImportPrimaryKeyFingerprint(rowPk) !== fingerprint) {
      throw new Error("invalid_row");
    }
    return { pk, fingerprint };
  } catch {
    throw new Error("invalid_row");
  }
}
export function prepareSpreadsheetImportMutationRows(
  ctx: SpreadsheetSqlTableContext,
  rows: readonly Record<string, string | null>[],
): SpreadsheetImportRowValidation {
  if (ctx.def.mode !== "editable") throw new Error("table_readonly");
  if (rows.length > SPREADSHEET_IMPORT_PREVIEW_MAX_ROWS) throw new Error("too_many_rows");
  if (rows.length < 1 || rows.length > SPREADSHEET_IMPORT_APPLY_MAX_ROWS) throw new Error("batch_too_large");
  const errors: SpreadsheetImportRowValidation["errors"] = [];
  const preparedRows: PreparedSpreadsheetImportRow[] = [];
  const seenPks = new Set<string>();
  for (let index = 0; index < rows.length; index++) {
    try {
      // Capture each supplied cell once, within per-row error handling. A
      // malformed row/getter must be reported at its index, not abort all.
      // Subsequent async preview/D1 reads cannot alter validated PK or audit.
      const row = Object.freeze(Object.fromEntries(Object.entries(rows[index]!))) as Record<string, string | null>;
      for (const key of Object.keys(row)) {
        if (!ctx.columnNames.includes(key)) throw new Error("unknown_column");
        if (!isSpreadsheetColumnEditable(ctx.def, key)) throw new Error("column_not_editable");
      }
      const pk = primaryKeyFromSpreadsheetRow(row, ctx.primaryKeys);
      const fingerprint = spreadsheetImportPrimaryKeyFingerprint(pk);
      if (seenPks.has(fingerprint)) throw new Error("duplicate_primary_key");
      seenPks.add(fingerprint);
      if (Object.keys(row).length === 0) throw new Error("empty_row");
      validateSpreadsheetInputValues(ctx, row);
      preparedRows.push(Object.freeze({ row, pk: Object.freeze(pk), fingerprint }));
    } catch (error) {
      errors.push({ index, message: error instanceof Error ? error.message : "invalid_row" });
    }
  }
  return { preparedRows, errors };
}


export interface SpreadsheetImportMutationPlan {
  mutations: SpreadsheetAuditedSqlPlan[];
  inserted: number;
  updated: number;
  skipped: number;
}
/**
 * CURRENT planUpsertSpreadsheetRow + applySpreadsheetImport planning stage.
 * Caller MUST verify signed preview claims and actor before planning, provide
 * fresh PK-keyed existing rows, then validate BOTH supplied and effective
 * defaulted FKs with validateSpreadsheetPlannedImportForeignKeys BEFORE any
 * nonce consumption, mutation, audit or Queue write in an atomic D1 batch.
 * This pure planner itself executes no D1.
 */
export function planSpreadsheetImportMutations(
  ctx: SpreadsheetSqlTableContext,
  prepared: SpreadsheetImportRowValidation,
  mode: "insert" | "upsert",
  existingRowsByPk: ReadonlyMap<string, Record<string, unknown>> | null,
  operatorId: string,
): SpreadsheetImportMutationPlan {
  if (ctx.def.mode !== "editable") throw new Error("table_readonly");
  if (prepared.errors.length > 0) throw new Error("invalid_row");
  if (prepared.preparedRows.length < 1 || prepared.preparedRows.length > SPREADSHEET_IMPORT_APPLY_MAX_ROWS) {
    throw new Error("batch_too_large");
  }
  if (mode !== "insert" && mode !== "upsert") throw new Error("invalid_row");
  if (mode === "upsert" && !existingRowsByPk) throw new Error("invalid_snapshot");
  if (!operatorId.trim()) throw new Error("missing_operator");
  const mutations: SpreadsheetAuditedSqlPlan[] = [];
  const seenPks = new Set<string>();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const preparedRow of prepared.preparedRows) {
    const verified = verifySpreadsheetPreparedImportIdentity(ctx, preparedRow);
    if (seenPks.has(verified.fingerprint)) throw new Error("duplicate_primary_key");
    seenPks.add(verified.fingerprint);
    if (mode === "insert") {
      mutations.push(buildSpreadsheetAuditedInsert(ctx, preparedRow.row, operatorId));
      inserted++;
      continue;
    }
    const existing = existingRowsByPk?.get(verified.fingerprint) ?? null;
    if (!existing) {
      mutations.push(buildSpreadsheetAuditedInsert(ctx, preparedRow.row, operatorId));
      inserted++;
      continue;
    }
    const editableColumns = ctx.columns.filter(column =>
      column.pk === 0 &&
      isSpreadsheetColumnEditable(ctx.def, column.name) &&
      Object.hasOwn(preparedRow.row, column.name) &&
      preparedRow.row[column.name] !== undefined,
    );
    if (editableColumns.length === 0) {
      skipped++;
      continue;
    }
    mutations.push(buildSpreadsheetAuditedUpdate(ctx, verified.pk, existing, preparedRow.row, operatorId));
    updated++;
  }
  return { mutations, inserted, updated, skipped };
}


/**
 * MIG-0638 U02: preflight all explicitly provided import FKs AND the
 * *effective* FK values of planned INSERTs, including SQL column defaults.
 *
 * The future guarded RH-008 route must resolve the existing PK snapshots,
 * create the complete import mutation plan, THEN invoke this function before
 * any nonce consumption, data mutation, strict audit or static rebuild Queue
 * write in the eventual atomic D1 batch. No changes occur here.
 */
export async function validateSpreadsheetPlannedImportForeignKeys(
  db: {
    prepare(sql: string): {
      bind(...values: (string | number | null)[]): {
        all<T>(): Promise<{ results?: T[] }>;
      };
    };
  },
  ctx: SpreadsheetSqlTableContext,
  foreignKeys: readonly SpreadsheetForeignKey[],
  prepared: SpreadsheetImportRowValidation,
  planned: SpreadsheetImportMutationPlan,
  remainingReadBudget: number,
): Promise<void> {
  if (ctx.def.mode !== "editable") throw new Error("table_readonly");
  if (prepared.errors.length > 0) throw new Error("invalid_row");
  if (prepared.preparedRows.length < 1 ||
      prepared.preparedRows.length > SPREADSHEET_IMPORT_APPLY_MAX_ROWS) {
    throw new Error("batch_too_large");
  }
  if (!Number.isInteger(remainingReadBudget) || remainingReadBudget < 0 ||
      remainingReadBudget > SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES) {
    throw new Error("batch_too_large");
  }
  if (planned.inserted < 0 || planned.updated < 0 || planned.skipped < 0 ||
      !Number.isInteger(planned.inserted) || !Number.isInteger(planned.updated) ||
      !Number.isInteger(planned.skipped) ||
      planned.inserted + planned.updated + planned.skipped !== prepared.preparedRows.length ||
      planned.mutations.length !== planned.inserted + planned.updated) {
    throw new Error("invalid_snapshot");
  }
  const seen = new Set<string>();
  const rows: Record<string, string | null>[] = [];
  for (const entry of prepared.preparedRows) {
    const identity = verifySpreadsheetPreparedImportIdentity(ctx, entry);
    if (seen.has(identity.fingerprint)) throw new Error("duplicate_primary_key");
    seen.add(identity.fingerprint);
    rows.push(entry.row);
  }
  for (const mutation of planned.mutations) {
    if (mutation.audit.table_name !== ctx.def.table ||
        (mutation.audit.operation !== "CREATE" && mutation.audit.operation !== "UPDATE") ||
        !mutation.audit.after) {
      throw new Error("invalid_snapshot");
    }
    if (mutation.audit.operation !== "CREATE") continue;
    const cells: Array<[string, string | null]> = [];
    for (const foreignKey of foreignKeys) {
      if (!Object.hasOwn(mutation.audit.after, foreignKey.column)) {
        throw new Error("invalid_snapshot");
      }
      const value = mutation.audit.after[foreignKey.column];
      if (value === null || value === "") {
        cells.push([foreignKey.column, null]);
      } else if (typeof value === "string") {
        cells.push([foreignKey.column, value]);
      } else if (typeof value === "number" && Number.isFinite(value)) {
        cells.push([foreignKey.column, String(value)]);
      } else {
        throw new Error("invalid_snapshot");
      }
    }
    rows.push(Object.freeze(Object.fromEntries(cells)));
  }
  // Existing UPDATEs retain CURRENT's supplied-field-only FK semantics.
  // New INSERTs additionally validate defaulted FKs actually persisted and
  // audited. Deduplication ensures both use the same S3 bounded SELECTs.
  await validateSpreadsheetForeignKeys(db, foreignKeys, rows, remainingReadBudget);
}


/** CURRENT buildPreviewRunConsumptionMutation parity, UNMOUNTED.
 * The exact-one affected-row assertion and this SQL + data writes + strict audit
 * MUST run in the same atomic D1 batch; a zero-change replay must abort all.
 */
export function buildSpreadsheetPreviewNonceConsumeSql(
  claims: import("./importPreviewToken.ts").SpreadsheetImportPreviewClaims,
  consumedAt: number,
): SpreadsheetAuditedSqlPlan {
  if (!Number.isSafeInteger(consumedAt) || consumedAt < claims.issuedAt) throw new Error("preview_required");
  const before = {
    nonce: claims.nonce,
    operator_user_id: claims.operatorUserId,
    table_name: claims.table,
    mode: claims.mode,
    payload_hash: claims.payloadHash,
    schema_fingerprint: claims.schemaFingerprint,
    expires_at: claims.expiresAt,
    consumed_at: null,
    created_at: claims.issuedAt,
  };
  const after = { ...before, consumed_at: consumedAt };
  return {
    statement: 'UPDATE "spreadsheet_import_runs" SET "consumed_at" = ?' +
      ' WHERE "nonce" = ? AND "operator_user_id" = ? AND "table_name" = ? AND "mode" = ?' +
      ' AND "payload_hash" = ? AND "schema_fingerprint" = ?' +
      ' AND "expires_at" = ? AND "created_at" = ? AND "consumed_at" IS NULL AND "expires_at" >= ?',
    binds: [consumedAt, claims.nonce, claims.operatorUserId, claims.table, claims.mode,
      claims.payloadHash, claims.schemaFingerprint, claims.expiresAt, claims.issuedAt, consumedAt],
    audit: {
      table_name: "spreadsheet_import_runs",
      target_id: claims.nonce,
      operation: "UPDATE",
      before,
      after,
      actor_user_id: claims.operatorUserId,
      retention_class: "long_audit",
      strict: true,
      context: "admin_spreadsheet",
    },
  };
}


/**
 * U02 strict audit byte parity: a canonical SQL shape does not prove that its
 * *bind values* describe the before/after images persisted in audit_logs.
 * Keep this pure and fail closed before constructing any D1 batch.
 */
function assertSpreadsheetImportAuditMatchesBinds(
  ctx: SpreadsheetSqlTableContext,
  plan: SpreadsheetAuditedSqlPlan,
): void {
  const after = plan.audit.after;
  if (!after || typeof after !== "object" || Array.isArray(after) ||
      !Array.isArray(plan.binds)) throw new Error("invalid_row");
  const nonGenerated = ctx.columns.filter(column => !column.generated).map(column => column.name);
  const exactKeys = (row: Record<string, unknown>, columns: readonly string[]): boolean =>
    Object.keys(row).length === columns.length &&
    columns.every(name => Object.hasOwn(row, name) && (
      row[name] === null || typeof row[name] === "string" ||
      (typeof row[name] === "number" && Number.isFinite(row[name]))
    ));
  const equalsBinds = (expected: readonly (string | number | null)[]): boolean =>
    expected.length === plan.binds.length &&
    expected.every((value, i) => Object.is(value, plan.binds[i]));

  if (plan.audit.operation === "CREATE") {
    if (!exactKeys(after, nonGenerated) ||
        !equalsBinds(nonGenerated.map(name => after[name] as string | number | null))) {
      throw new Error("invalid_row");
    }
    return;
  }
  const before = plan.audit.before;
  const columns = ctx.columns.map(column => column.name);
  if (plan.audit.operation !== "UPDATE" ||
      !before || typeof before !== "object" || Array.isArray(before) ||
      !exactKeys(before, columns) || !exactKeys(after, columns)) {
    throw new Error("invalid_row");
  }
  const prefix = "UPDATE " + spreadsheetTableIdentifier(ctx) + " SET ";
  const whereIndex = plan.statement.indexOf(" WHERE ", prefix.length);
  if (!plan.statement.startsWith(prefix) || whereIndex < 0) throw new Error("invalid_row");
  const setText = plan.statement.slice(prefix.length, whereIndex);
  const setColumns = setText.split(", ").map(part =>
    /^"([A-Za-z_][A-Za-z0-9_]*)" = \?$/.exec(part)?.[1] ?? "",
  );
  const validSet = setColumns.length > 0 &&
    setColumns.every(name => columns.includes(name) && !ctx.primaryKeys.includes(name)) &&
    new Set(setColumns).size === setColumns.length;
  if (!validSet) throw new Error("invalid_row");

  // For an UPDATE, SQL SET binds = after-image changed cells; WHERE binds =
  // requested primary key plus the complete fresh before-image. Every other
  // after-image cell must remain byte/type identical to the before-image.
  if (columns.some(name => !setColumns.includes(name) &&
      !Object.is(after[name], before[name]))) throw new Error("invalid_row");
  const expected = [
    ...setColumns.map(name => after[name] as string | number | null),
    ...ctx.primaryKeys.map(name => String(after[name])),
    ...columns.map(name => before[name] as string | number | null),
  ];
  if (!equalsBinds(expected)) throw new Error("invalid_row");
}

/**
 * U02: UNMOUNTED importer transaction composer. No HTTP auth, token
 * verification, table-to-public-target derivation or D1 write occurs here.
 *
 * The future RH-008 route MUST first verify the signed preview and actor,
 * obtain immutable existing-row snapshots, plan mutations, validate effective
 * foreign keys and derive authoritative Queue targets. Only then call this
 * composer and execute its result once via mutateWithAudit in a D1 batch.
 */
export async function planSpreadsheetAtomicAuditedImport(
  db: ServerCoreDb,
  ctx: SpreadsheetSqlTableContext,
  planned: SpreadsheetImportMutationPlan,
  claims: import("./importPreviewToken.ts").SpreadsheetImportPreviewClaims,
  options: {
    authorizedActorId: string;
    consumedAt: number;
    callerQueryCount: number;
    queueTargets: readonly EnqueueStaticRebuildInput[];
    preloaded?: PreloadedAuditContext;
  },
): Promise<AtomicAuditMutationInput> {
  if (ctx.def.mode !== "editable") throw new Error("table_readonly");
  if (!planned || !Array.isArray(planned.mutations) ||
      ![planned.inserted, planned.updated, planned.skipped].every(
        x => Number.isSafeInteger(x) && x >= 0,
      ) ||
      planned.inserted + planned.updated + planned.skipped < 1 ||
      planned.inserted + planned.updated + planned.skipped > SPREADSHEET_IMPORT_APPLY_MAX_ROWS ||
      planned.inserted + planned.updated !== planned.mutations.length) {
    throw new Error("invalid_row");
  }
  if (!claims || !options ||
      claims.table !== ctx.def.table ||
      claims.operatorUserId !== options.authorizedActorId ||
      // CURRENT applySpreadsheetImport verifies the *entire* preview schema
      // binding, not only actor/table/mode. A signed preview from before a
      // schema or primary-key change must never authorize a new D1 plan.
      JSON.stringify(claims.columns) !== JSON.stringify(ctx.columnNames) ||
      JSON.stringify(claims.primaryKeys) !== JSON.stringify(ctx.primaryKeys) ||
      !options.authorizedActorId?.trim() ||
      (claims.mode !== "insert" && claims.mode !== "upsert") ||
      !Number.isSafeInteger(options.callerQueryCount) ||
      options.callerQueryCount < 1 || options.callerQueryCount > 50 ||
      !Number.isSafeInteger(options.consumedAt) ||
      options.consumedAt > claims.expiresAt) {
    throw new Error("preview_required");
  }
  if (claims.mode === "insert" && (planned.updated > 0 || planned.skipped > 0)) {
    throw new Error("invalid_row");
  }

  const nonce = buildSpreadsheetPreviewNonceConsumeSql(claims, options.consumedAt);
  const statement = db.run(sql`
    UPDATE "spreadsheet_import_runs" SET "consumed_at" = ${options.consumedAt}
    WHERE "nonce" = ${claims.nonce}
      AND "operator_user_id" = ${claims.operatorUserId}
      AND "table_name" = ${claims.table}
      AND "mode" = ${claims.mode}
      AND "payload_hash" = ${claims.payloadHash}
      AND "schema_fingerprint" = ${claims.schemaFingerprint}
      AND "expires_at" = ${claims.expiresAt}
      AND "created_at" = ${claims.issuedAt}
      AND "consumed_at" IS NULL
      AND "expires_at" >= ${options.consumedAt}
  `);
  const seen = new Set<string>();
  const mutations = [statement];
  for (const plan of planned.mutations) {
    const audit = plan?.audit;
    if (!audit || audit.table_name !== ctx.def.table ||
        audit.actor_user_id !== options.authorizedActorId ||
        audit.context !== "admin_spreadsheet" ||
        audit.strict !== true || audit.retention_class !== "long_audit" ||
        (audit.operation !== "CREATE" && audit.operation !== "UPDATE") ||
        // The SQL DML verb must describe the same mutation as the strict
        // audit. Canonical SQL-shape validation alone also allows DELETE,
        // and without this check a forged plan could audit an INSERT as an
        // UPDATE (or vice versa) when wired into the future RH-008 handler.
        typeof plan.statement !== "string" ||
        (audit.operation === "CREATE"
          ? !plan.statement.startsWith("INSERT INTO ")
          : !plan.statement.startsWith("UPDATE ")) ||
        (audit.operation === "CREATE" ? audit.before !== null : !audit.before) ||
        !audit.after || typeof audit.after !== "object") {
      throw new Error("invalid_row");
    }
    const rawPk = Object.fromEntries(ctx.primaryKeys.map(key => {
      if (!Object.hasOwn(audit.after!, key)) throw new Error("invalid_row");
      const value = audit.after![key];
      if ((typeof value !== "string" && typeof value !== "number") ||
          (typeof value === "number" && !Number.isSafeInteger(value))) {
        throw new Error("invalid_row");
      }
      return [key, String(value)];
    }));
    const pk = normalizeSpreadsheetPrimaryKey(ctx.primaryKeys, rawPk);
    const fingerprint = spreadsheetImportPrimaryKeyFingerprint(pk);
    if (seen.has(fingerprint) || audit.target_id !== spreadsheetRecordIdFromPk(pk)) {
      throw new Error("invalid_row");
    }
    seen.add(fingerprint);
    if (audit.operation === "UPDATE") {
      const beforePk = Object.fromEntries(ctx.primaryKeys.map(key => {
        if (!Object.hasOwn(audit.before!, key)) throw new Error("invalid_row");
        const value = audit.before![key];
        if ((typeof value !== "string" && typeof value !== "number") ||
            (typeof value === "number" && !Number.isSafeInteger(value))) {
          throw new Error("invalid_row");
        }
        return [key, String(value)];
      }));
      if (spreadsheetImportPrimaryKeyFingerprint(
        normalizeSpreadsheetPrimaryKey(ctx.primaryKeys, beforePk),
      ) !== fingerprint) throw new Error("invalid_row");
    }
    // Prove every SQL bind matches the audit before/after image; only then
    // allow the canonical SQL compiler to construct a runnable D1 statement.
    assertSpreadsheetImportAuditMatchesBinds(ctx, plan);
    // Converts only canonical table-specific INSERT/UPDATE SQL into lazy D1
    // RunnableQueries. All changes=1 assertions remain inside one batch.
    mutations.push(db.run(spreadsheetMutationToBoundSql(ctx, plan)));
  }
  if (planned.mutations.filter(m => m.audit.operation === "CREATE").length !== planned.inserted ||
      planned.mutations.filter(m => m.audit.operation === "UPDATE").length !== planned.updated) {
    throw new Error("invalid_row");
  }

  // A changed import with unknown public effects cannot silently omit
  // durable invalidation. An all-skipped UPSERT only consumes its nonce.
  if (!Array.isArray(options.queueTargets) ||
      (mutations.length > 1
        ? options.queueTargets.length < 1 ||
          options.queueTargets.length > SPREADSHEET_ATOMIC_MAX_REBUILD_TARGETS
        : options.queueTargets.length !== 0) ||
      options.queueTargets.some(target =>
        !target || !isStaticRebuildTargetType(target.targetType) ||
        typeof target.targetId !== "string" || !target.targetId.trim() ||
        typeof target.reason !== "string" || !target.reason.trim() ||
        target.targetId.includes("\0") || target.reason.includes("\0") ||
        target.targetId.length > 256 || target.reason.length > 128 ||
        (target.requestedByUserId != null &&
          target.requestedByUserId !== options.authorizedActorId))) {
    throw new Error("invalid_row");
  }
  const queue = await buildStaticRebuildQueueBatch(db, options.queueTargets.map(
    target => ({ ...target, requestedByUserId: options.authorizedActorId }),
  ));
  if ((mutations.length > 1 && (queue.acceptedTargetCount < 1 ||
      queue.statements.length < 1)) ||
      queue.statements.length !== queue.expectedChanges.length) {
    throw new Error("invalid_row");
  }

  const input: AtomicAuditMutationInput = {
    mutationStatements: [...mutations, ...queue.statements],
    expectedMutationChanges: [
      ...mutations.map(() => 1), ...queue.expectedChanges,
    ],
    audits: [nonce.audit, ...planned.mutations.map(m => ({ ...m.audit }))],
    callerQueryCount: options.callerQueryCount,
    preloaded: options.preloaded,
    staticRebuildWakeSource: queue.statements.length > 0 ? "admin" : undefined,
  };
  if (!planAtomicAuditMutationBudget(input).withinLimit) {
    throw new Error("batch_too_large");
  }
  assertAtomicAuditMutationBindLimits(db, input);
  return input;
}

/**
 * U02: UNMOUNTED verified commit preflight for future RH-008.
 *
 * This is intentionally NOT an HTTP handler and never writes by itself:
 * request origin, authenticated admin identity, operation-mode CostGuard,
 * authoritative FK catalog and public Queue targets MUST be obtained in the
 * guarded route before calling this function. It verifies the HMAC preview
 * against the *validated immutable payload*, then performs bounded D1 reads,
 * checks effective FKs, and composes one atomic nonce + DML + audit + Queue
 * transaction. The HTTP route must call mutateWithAudit once on the result.
 */
export async function planSpreadsheetVerifiedImportCommit(
  args: {
    db: ServerCoreDb;
    rawDb: Parameters<typeof fetchSpreadsheetExistingImportRows>[0];
    ctx: SpreadsheetSqlTableContext;
    actorUserId: string;
    mode: "insert" | "upsert";
    rows: readonly Record<string, string | null>[];
    previewToken: string;
    previewSecret: string;
    nowSeconds: number;
    remainingReadQueries: number;
    callerQueryCount: number;
    foreignKeys: readonly SpreadsheetForeignKey[];
    queueTargets: readonly EnqueueStaticRebuildInput[];
    preloaded?: PreloadedAuditContext;
  },
): Promise<{ atomic: AtomicAuditMutationInput; result: {
  inserted: number; updated: number; skipped: number;
} }> {
  if (!args || !args.ctx || !args.db || !args.rawDb ||
      typeof args.actorUserId !== "string" || !args.actorUserId.trim() ||
      (args.mode !== "insert" && args.mode !== "upsert") ||
      typeof args.previewToken !== "string" || !args.previewToken ||
      !Number.isSafeInteger(args.nowSeconds) || args.nowSeconds < 0 ||
      !Number.isSafeInteger(args.remainingReadQueries) ||
      args.remainingReadQueries < 0 ||
      args.remainingReadQueries > SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES ||
      !Number.isSafeInteger(args.callerQueryCount) ||
      args.callerQueryCount < 1 || args.callerQueryCount > 50 ||
      !Array.isArray(args.foreignKeys) || !Array.isArray(args.rows)) {
    throw new Error("preview_required");
  }
  if (args.ctx.def.mode !== "editable") throw new Error("table_readonly");
  const prepared = prepareSpreadsheetImportMutationRows(args.ctx, args.rows);
  if (prepared.errors.length > 0) throw new Error("invalid_row");
  // Binding against frozen, validated rows prevents caller-side mutation
  // between verification and SQL/audit construction (TOCTOU).
  const binding = await buildSpreadsheetImportPreviewBinding({
    operatorUserId: args.actorUserId,
    table: args.ctx.def.table,
    mode: args.mode,
    columns: [...args.ctx.columnNames],
    primaryKeys: [...args.ctx.primaryKeys],
    schemaColumns: args.ctx.columns.map(column => ({
      name: column.name,
      type: column.type,
      notNull: column.notNull,
      pk: column.pk,
      defaultValue: column.defaultValue,
      generated: column.generated,
      enumValues: column.enumValues,
    })),
    rows: prepared.preparedRows.map(entry => entry.row),
  });
  const claims = await verifySpreadsheetImportPreviewToken(
    args.previewToken, args.previewSecret, binding, { now: args.nowSeconds },
  );
  if (!claims) throw new Error("preview_required");

  // A signed UPSERT always spends one bounded row-snapshot SELECT, even when
  // every row is later skipped. Reject over-budget BEFORE any D1 read.
  const upsertReads = args.mode === "upsert" ? 1 : 0;
  if (args.remainingReadQueries < upsertReads) throw new Error("batch_too_large");
  const existing = upsertReads > 0
    ? await fetchSpreadsheetExistingImportRows(
      args.rawDb, args.ctx, prepared, args.remainingReadQueries,
    )
    : null;
  const planned = planSpreadsheetImportMutations(
    args.ctx, prepared, args.mode, existing, args.actorUserId,
  );
  await validateSpreadsheetPlannedImportForeignKeys(
    args.rawDb, args.ctx, args.foreignKeys, prepared, planned,
    args.remainingReadQueries - upsertReads,
  );
  const atomic = await planSpreadsheetAtomicAuditedImport(
    args.db, args.ctx, planned, claims, {
      authorizedActorId: args.actorUserId,
      consumedAt: args.nowSeconds,
      callerQueryCount: args.callerQueryCount,
      queueTargets: args.queueTargets,
      preloaded: args.preloaded,
    },
  );
  return {
    atomic,
    result: {
      inserted: planned.inserted, updated: planned.updated, skipped: planned.skipped,
    },
  };
}

/**
 * CURRENT query.ts#fetchExistingRowsByImportPk, bounded to U02's 7-row
 * apply limit and a single request-budgeted D1 SELECT. UNMOUNTED.
 *
 * The caller MUST validate the signed preview and guard authorization before
 * invoking this function, and subtract this SELECT from S3's total budget.
 */
export async function fetchSpreadsheetExistingImportRows(
  db: {
    prepare(sql: string): {
      bind(...values: (string | number | null)[]): {
        all<T>(): Promise<{ results?: T[] }>;
      };
    };
  },
  ctx: SpreadsheetSqlTableContext,
  prepared: SpreadsheetImportRowValidation,
  remainingReadBudget: number,
): Promise<Map<string, Record<string, unknown>>> {
  if (ctx.def.mode !== "editable") throw new Error("table_readonly");
  if (prepared.errors.length > 0) throw new Error("invalid_row");
  if (prepared.preparedRows.length < 1 || prepared.preparedRows.length > SPREADSHEET_IMPORT_APPLY_MAX_ROWS) {
    throw new Error("batch_too_large");
  }
  if (!Number.isInteger(remainingReadBudget) || remainingReadBudget < 1 ||
      remainingReadBudget > SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES) {
    throw new Error("batch_too_large");
  }
  const seen = new Set<string>();
  const keys: Record<string, string>[] = [];
  for (const entry of prepared.preparedRows) {
    const verified = verifySpreadsheetPreparedImportIdentity(ctx, entry);
    if (seen.has(verified.fingerprint)) throw new Error("duplicate_primary_key");
    seen.add(verified.fingerprint);
    keys.push(verified.pk);
  }
  // One statement; all requested primary-key components are positional binds.
  const binds: string[] = [];
  const clauses = keys.map(pk => {
    const cond = spreadsheetPkCondition(ctx, pk);
    binds.push(...cond.binds as string[]);
    return "(" + cond.statement + ")";
  });
  // This is one D1 statement: 7 import rows times PK width can exceed the
  // 100-bind ceiling. Reject before preparing any SQL or using a partial map.
  if (binds.length > SPREADSHEET_SQL_MAX_BINDS) throw new Error("batch_too_large");
  // ZERO_1102 §4: request-time D1 reads require an explicit SQL LIMIT. A
  // valid composite PK lookup can match at most one row per imported key.
  // Fetch one extra sentinel row only to detect non-unique/schema-drift data.
  const sql = "SELECT * FROM " + spreadsheetTableIdentifier(ctx) + " WHERE " +
    clauses.join(" OR ") + " LIMIT " + MAX_SPREADSHEET_IMPORT_EXISTING_RESULT_ROWS;
  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>();
  // Missing/malformed D1 data is NOT an empty table: treating it as [] can
  // turn a UPSERT into an INSERT and lose the correct audit before-image.
  if (!result || !Array.isArray(result.results) ||
      result.results.length > SPREADSHEET_IMPORT_APPLY_MAX_ROWS) {
    throw new Error("invalid_snapshot");
  }
  const rows = result.results;
  const out = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    // Materialize each database field exactly once BEFORE matching its PK.
    // Never let a mutable/mock D1 object or accessor change the audited
    // before-image between identity checks, CAS planning and audit metadata.
    // Object.fromEntries preserves SQL columns named "__proto__" as data.
    let snapshot: Record<string, unknown>;
    try {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("invalid_snapshot");
      const cells: Array<[string, string | number | null]> = [];
      for (const column of ctx.columns) {
        if (!Object.hasOwn(row, column.name)) throw new Error("invalid_snapshot");
        const value = row[column.name];
        // A complete D1 before-image contains SQLite scalar values only.
        // Never serialize objects, booleans or non-finite values into an
        // import audit, or invoke a hostile PK object's toString().
        if (value !== null && typeof value !== "string" && typeof value !== "number") {
          throw new Error("invalid_snapshot");
        }
        if (typeof value === "number" && !Number.isFinite(value)) {
          throw new Error("invalid_snapshot");
        }
        cells.push([column.name, value]);
      }
      snapshot = Object.freeze(Object.fromEntries(cells));
    } catch {
      // A malformed D1 adapter row or throwing getter is not an auditable
      // complete-row snapshot. Do not attribute it to any requested PK.
      throw new Error("invalid_snapshot");
    }
    const pkParts: Array<[string, string]> = [];
    for (const key of ctx.primaryKeys) {
      const value = snapshot[key];
      if (typeof value === "number" && Number.isInteger(value) &&
          !Number.isSafeInteger(value)) {
        // A lossy INTEGER conversion cannot prove the requested PK identity,
        // even if its rounded decimal text happens to match a request key.
        throw new Error("invalid_snapshot");
      }
      if (value == null || String(value).trim() === "" || String(value).includes("\0")) {
        throw new Error("invalid_snapshot");
      }
      pkParts.push([key, String(value)]);
    }
    const rawPk = Object.fromEntries(pkParts);
    const fingerprint = spreadsheetImportPrimaryKeyFingerprint(rawPk);
    if (!seen.has(fingerprint) || out.has(fingerprint)) throw new Error("invalid_snapshot");
    out.set(fingerprint, snapshot);
  }
  return out;
}
