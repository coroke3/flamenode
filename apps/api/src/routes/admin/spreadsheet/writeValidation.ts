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
