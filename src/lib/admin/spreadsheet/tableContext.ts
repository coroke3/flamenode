import "server-only";

import { getSpreadsheetD1 } from "./d1Access";
import { getSpreadsheetTableDef } from "./discovery";
import { isValidSqliteTableName } from "./registry";
import {
  isSpreadsheetColumnEditable,
  primaryKeysFromColumns,
  type SpreadsheetTableDef,
} from "./registry";

export type { SpreadsheetColumnMeta } from "./apiTypes";
import type { SpreadsheetColumnMeta } from "./apiTypes";

export interface SpreadsheetTableContext {
  def: SpreadsheetTableDef;
  columns: SpreadsheetColumnMeta[];
  primaryKeys: string[];
  quotedTable: string;
  orderColumn: string;
  columnNames: string[];
  foreignKeys: Array<{ column: string; referencedTable: string; referencedColumn: string }>;
}

const COLUMN_CACHE_TTL_MS = 30_000;
const columnCache = new Map<
  string,
  { columns: SpreadsheetColumnMeta[]; primaryKeys: string[]; foreignKeys: Array<{ column: string; referencedTable: string; referencedColumn: string }>; cachedAt: number }
>();

export function invalidateSpreadsheetColumnCache(): void {
  columnCache.clear();
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function loadTableColumnsFromDb(
  table: string,
): Promise<SpreadsheetColumnMeta[]> {
  const db = await getSpreadsheetD1();
  const result = await db
    .prepare(`PRAGMA table_xinfo(${quoteIdent(table)})`)
    .all<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
      dflt_value: string | null;
      hidden: number;
    }>();

  return (result.results ?? []).map((r) => ({
    name: r.name,
    type: r.type ?? "TEXT",
    notNull: Boolean(r.notnull),
    pk: Number(r.pk ?? 0),
    editable: true,
    defaultValue: r.dflt_value ?? null,
    generated: Number(r.hidden ?? 0) !== 0,
  }));
}

async function loadForeignKeysFromDb(
  table: string,
): Promise<Array<{ column: string; referencedTable: string; referencedColumn: string }>> {
  const db = await getSpreadsheetD1();
  const result = await db.prepare(`PRAGMA foreign_key_list(${quoteIdent(table)})`).all<{
    from: string;
    table: string;
    to: string;
  }>();
  return (result.results ?? []).map((row) => ({
    column: row.from,
    referencedTable: row.table,
    referencedColumn: row.to,
  }));
}

/** API 返却用に編集可否をテーブル定義から付与 */
export function enrichSpreadsheetColumns(
  def: SpreadsheetTableDef,
  columns: SpreadsheetColumnMeta[],
): SpreadsheetColumnMeta[] {
  return columns.map((c) => ({
    ...c,
    editable: isSpreadsheetColumnEditable(def, c.name),
  }));
}

export async function getCachedTableColumns(
  table: string,
): Promise<{ columns: SpreadsheetColumnMeta[]; primaryKeys: string[]; foreignKeys: Array<{ column: string; referencedTable: string; referencedColumn: string }> }> {
  const now = Date.now();
  const hit = columnCache.get(table);
  if (hit && now - hit.cachedAt < COLUMN_CACHE_TTL_MS) {
    return { columns: hit.columns, primaryKeys: hit.primaryKeys, foreignKeys: hit.foreignKeys };
  }

  const columns = await loadTableColumnsFromDb(table);
  const primaryKeys = primaryKeysFromColumns(columns);
  const foreignKeys = await loadForeignKeysFromDb(table);
  columnCache.set(table, { columns, primaryKeys, foreignKeys, cachedAt: now });
  return { columns, primaryKeys, foreignKeys };
}

export async function resolveSpreadsheetTableContext(
  table: string,
): Promise<SpreadsheetTableContext> {
  const trimmed = table.trim();
  if (!trimmed || !isValidSqliteTableName(trimmed)) {
    throw new Error("unknown_table");
  }
  const def = await getSpreadsheetTableDef(trimmed);
  if (!def) throw new Error("unknown_table");

  const { columns, primaryKeys, foreignKeys } = await getCachedTableColumns(def.table);
  if (columns.length === 0 || primaryKeys.length === 0 || columns.some((column) => column.generated)) {
    throw new Error("unknown_table");
  }
  return {
    def,
    columns,
    primaryKeys,
    quotedTable: quoteIdent(def.table),
    orderColumn: quoteIdent(primaryKeys[0] ?? columns[0]?.name ?? "rowid"),
    columnNames: columns.map((c) => c.name),
    foreignKeys,
  };
}

export function assertColumnEditable(
  ctx: SpreadsheetTableContext,
  column: string,
): void {
  if (!ctx.columns.some((c) => c.name === column)) {
    throw new Error("unknown_column");
  }
  if (!isSpreadsheetColumnEditable(ctx.def, column)) {
    throw new Error("column_not_editable");
  }
}

export function assertTableEditable(ctx: SpreadsheetTableContext): void {
  if (ctx.def.mode !== "editable") throw new Error("table_readonly");
}
