/**
 * MIG-0638 U01b: pure CURRENT spreadsheet cell validation for RH-004..006.
 * Derived from src/lib/admin/spreadsheet/query.ts#validateSpreadsheetInputValues.
 * Keep error codes and validation order identical; this module performs no D1
 * calls and must only run AFTER the admin write guard and table resolution.
 */
import {
  getSpreadsheetColumnPolicy,
  isSpreadsheetColumnEditable,
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
