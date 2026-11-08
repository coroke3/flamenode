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
function spreadsheetSnapshotCondition(ctx: SpreadsheetSqlTableContext, before: Record<string, unknown>): SpreadsheetSqlPlan {
  const binds: (string | number | null)[] = [];
  const clauses = ctx.columns.map(column => {
    const raw = before[column.name];
    if (raw != null && typeof raw !== "string" && typeof raw !== "number") throw new Error("invalid_snapshot");
    binds.push(raw ?? null);
    return quoteSpreadsheetIdentifier(column.name) + " IS ?";
  });
  return { statement: clauses.join(" AND "), binds };
}
export function buildSpreadsheetInsertSql(
  ctx: SpreadsheetSqlTableContext,
  rowInput: Record<string, string | null>,
): SpreadsheetSqlPlan & { row: Record<string, string | number | null> } {
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
  if (isSpreadsheetPhysicalDeleteBlocked(ctx.def.table)) throw new Error("physical_delete_forbidden");
  const key = spreadsheetPkCondition(ctx, pk);
  const snapshot = spreadsheetSnapshotCondition(ctx, before);
  return {
    statement: "DELETE FROM " + spreadsheetTableIdentifier(ctx) +
      " WHERE " + key.statement + " AND " + snapshot.statement,
    binds: [...key.binds, ...snapshot.binds],
  };
}
