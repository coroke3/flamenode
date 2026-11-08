/**
 * MIG-0638 U01b: pure CURRENT spreadsheet cell validation for RH-004..006.
 * Derived from src/lib/admin/spreadsheet/query.ts#validateSpreadsheetInputValues.
 * Keep error codes and validation order identical; this module performs no D1
 * calls and must only run AFTER the admin write guard and table resolution.
 */
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
  const complete: Record<string, string | number | null> = {};
  for (const column of ctx.columns) {
    if (column.generated) continue;
    if (row[column.name] !== undefined) {
      if (row[column.name] == null && column.notNull) throw new Error("not_null_violation");
      complete[column.name] = row[column.name] === "" ? null : row[column.name]!;
    } else if (column.defaultValue != null) {
      complete[column.name] = resolveSpreadsheetDefaultValue(column);
    } else if (column.notNull) {
      throw new Error("missing_required_column");
    } else {
      complete[column.name] = null;
    }
  }
  return complete;
}


/** CURRENT validation.ts#getPrimaryKeyIssue and normalizePrimaryKeyRecord parity. */
export function normalizeSpreadsheetPrimaryKey(
  primaryKeys: readonly string[],
  pk: Record<string, string>,
): Record<string, string> {
  if (primaryKeys.length === 0) throw new Error("missing_primary_key");
  for (const key of primaryKeys) {
    const value = pk[key];
    if (value === undefined || String(value).trim() === "") {
      throw new Error("missing_primary_key");
    }
  }
  const normalized: Record<string, string> = {};
  for (const key of primaryKeys) normalized[key] = String(pk[key]);
  return normalized;
}

/** CURRENT validation.ts#primaryKeyFromRowValues parity. */
export function primaryKeyFromSpreadsheetRow(
  row: Record<string, string | null>,
  primaryKeys: readonly string[],
): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const key of primaryKeys) {
    const value = row[key];
    raw[key] = value == null ? "" : String(value);
  }
  return normalizeSpreadsheetPrimaryKey(primaryKeys, raw);
}


/**
 * CURRENT query.ts#buildUpdateMutation pure portion: editable non-PK column
 * selection and optimistic after-image construction.
 * No SQL, authorization, audit or Queue side effects occur here.
 */
export function prepareSpreadsheetUpdate(
  ctx: SpreadsheetWriteValidationContext & { columns: readonly (SpreadsheetWriteValidationContext["columns"][number] & { pk: number })[] },
  before: Record<string, unknown>,
  values: Record<string, string | null>,
): { setColumns: string[]; after: Record<string, unknown> } {
  validateSpreadsheetInputValues(ctx, values);
  const setColumns = ctx.columns
    .filter((column) =>
      column.pk === 0 &&
      isSpreadsheetColumnEditable(ctx.def, column.name) &&
      values[column.name] !== undefined,
    )
    .map((column) => column.name);
  if (setColumns.length === 0) throw new Error("empty_row");
  const after = { ...before };
  for (const column of setColumns) {
    after[column] = values[column] === "" ? null : values[column];
  }
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
  return {
    statement: "INSERT INTO " + spreadsheetTableIdentifier(ctx) +
      " (" + keys.map(quoteSpreadsheetIdentifier).join(", ") + ") VALUES (" + keys.map(() => "?").join(", ") + ")",
    binds: keys.map(key => row[key]),
    row,
  };
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
  return {
    statement: "UPDATE " + spreadsheetTableIdentifier(ctx) + " SET " +
      setColumns.map(column => quoteSpreadsheetIdentifier(column) + " = ?").join(", ") +
      " WHERE " + key.statement + " AND " + snapshot.statement,
    binds: [...setColumns.map(column => values[column] === "" ? null : (values[column] ?? null)), ...key.binds, ...snapshot.binds],
    after,
  };
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
  return {
    statement: "DELETE FROM " + spreadsheetTableIdentifier(ctx) +
      " WHERE " + key.statement + " AND " + snapshot.statement,
    binds: [...key.binds, ...snapshot.binds],
  };
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
      const value = row[foreignKey.column];
      if (value == null || value === "" || seen.has(value)) continue;
      if (seen.size >= remainingValues) throw new Error("batch_too_large");
      seen.add(value);
    }
    const values = [...seen];
    for (let start = 0; start < values.length; start += 99) {
      const chunk = values.slice(start, start + 99);
      const placeholders = chunk.map(() => "?").join(", ");
      lookups.push({
        statement: "SELECT " + reference + " AS value FROM " + table + " WHERE " + reference + " IN (" + placeholders + ")",
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
  const found = new Set(returned.map(row => String(row.value)));
  if (lookup.values.some(value => !found.has(String(value)))) {
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


/**
 * CURRENT query.ts#fetchRowByPkRaw equivalent. Only a bound SELECT and no
 * caching: the caller must fetch a fresh row after the write guard.
 * One D1 pre-read is consumed; the route must deduct it from S3's total.
 */
export async function fetchSpreadsheetRawSnapshot(
  db: {
    prepare(sql: string): {
      bind(...values: (string | number | null)[]): {
        first<T>(): Promise<T | null>;
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
  validateSpreadsheetInputValues(ctx, normalized);
  const key = spreadsheetPkCondition(ctx, normalized);
  const statement = "SELECT * FROM " + spreadsheetTableIdentifier(ctx) +
    " WHERE " + key.statement + " LIMIT 1";
  const row = await db.prepare(statement).bind(...key.binds).first<Record<string, unknown>>();
  if (!row) throw new Error("row_not_found");
  // Never allow an incomplete pre-read to be reinterpreted as a NULL in CAS.
  for (const column of ctx.columns) {
    if (!Object.prototype.hasOwnProperty.call(row, column.name) || row[column.name] === undefined) {
      throw new Error("invalid_snapshot");
    }
  }
  return row;
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
 * MIG-0638 U02: CURRENT applySpreadsheetImport pure row preflight.
 * This does not verify preview tokens, read FK targets/existing rows,
 * consume nonces or run any D1 transaction.
 */
export const SPREADSHEET_IMPORT_PREVIEW_MAX_ROWS = 500;
export const SPREADSHEET_IMPORT_APPLY_MAX_ROWS = 7;
export interface PreparedSpreadsheetImportRow {
  row: Record<string, string | null>;
  pk: Record<string, string>;
  fingerprint: string;
}
export interface SpreadsheetImportRowValidation {
  preparedRows: PreparedSpreadsheetImportRow[];
  errors: Array<{ index: number; message: string }>;
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
    const row = rows[index]!;
    try {
      for (const key of Object.keys(row)) {
        if (!ctx.columnNames.includes(key)) throw new Error("unknown_column");
        if (!isSpreadsheetColumnEditable(ctx.def, key)) throw new Error("column_not_editable");
      }
      const pk = primaryKeyFromSpreadsheetRow(row, ctx.primaryKeys);
      const fingerprint = Object.entries(pk).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v).join("\0");
      if (seenPks.has(fingerprint)) throw new Error("duplicate_primary_key");
      seenPks.add(fingerprint);
      if (Object.keys(row).length === 0) throw new Error("empty_row");
      validateSpreadsheetInputValues(ctx, row);
      preparedRows.push({ row, pk, fingerprint });
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
 * The caller MUST first verify preview token/nonce and preflight foreign keys,
 * then provide DB-derived, PK-keyed current rows; this function executes no D1.
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
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const preparedRow of prepared.preparedRows) {
    if (mode === "insert") {
      mutations.push(buildSpreadsheetAuditedInsert(ctx, preparedRow.row, operatorId));
      inserted++;
      continue;
    }
    const existing = existingRowsByPk?.get(preparedRow.fingerprint) ?? null;
    if (!existing) {
      mutations.push(buildSpreadsheetAuditedInsert(ctx, preparedRow.row, operatorId));
      inserted++;
      continue;
    }
    const editableColumns = ctx.columns.filter(column =>
      column.pk === 0 &&
      isSpreadsheetColumnEditable(ctx.def, column.name) &&
      preparedRow.row[column.name] !== undefined,
    );
    if (editableColumns.length === 0) {
      skipped++;
      continue;
    }
    mutations.push(buildSpreadsheetAuditedUpdate(ctx, preparedRow.pk, existing, preparedRow.row, operatorId));
    updated++;
  }
  return { mutations, inserted, updated, skipped };
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
    const pk = normalizeSpreadsheetPrimaryKey(ctx.primaryKeys, entry.pk);
    const fingerprint = Object.entries(pk).sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => value).join("\0");
    if (seen.has(fingerprint)) throw new Error("duplicate_primary_key");
    seen.add(fingerprint);
    keys.push(pk);
  }
  // One statement; all requested primary-key components are positional binds.
  const binds: string[] = [];
  const clauses = keys.map(pk => {
    const cond = spreadsheetPkCondition(ctx, pk);
    binds.push(...cond.binds as string[]);
    return "(" + cond.statement + ")";
  });
  const sql = "SELECT * FROM " + spreadsheetTableIdentifier(ctx) + " WHERE " + clauses.join(" OR ");
  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>();
  const out = new Map<string, Record<string, unknown>>();
  for (const row of result.results ?? []) {
    const rawPk: Record<string, string> = {};
    for (const key of ctx.primaryKeys) {
      const value = row[key];
      if (value == null || String(value).trim() === "") throw new Error("invalid_snapshot");
      rawPk[key] = String(value);
    }
    const fingerprint = Object.entries(rawPk).sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => value).join("\0");
    if (!seen.has(fingerprint) || out.has(fingerprint)) throw new Error("invalid_snapshot");
    for (const column of ctx.columns) {
      if (!Object.prototype.hasOwnProperty.call(row, column.name) || row[column.name] === undefined) {
        throw new Error("invalid_snapshot");
      }
    }
    out.set(fingerprint, row);
  }
  return out;
}
