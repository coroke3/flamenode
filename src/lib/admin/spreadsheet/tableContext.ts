import "server-only";

import { getSpreadsheetD1 } from "./d1Access";
import { getSpreadsheetTableDef } from "./discovery";
import { isValidSqliteTableName } from "./registry";
import {
  isSpreadsheetColumnEditable,
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
}

const COLUMN_CACHE_TTL_MS = 30_000;
const columnCache = new Map<
  string,
  { columns: SpreadsheetColumnMeta[]; primaryKeys: string[]; cachedAt: number }
>();

export function invalidateSpreadsheetColumnCache(): void {
  columnCache.clear();
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function primaryKeysFromColumns(
  columns: SpreadsheetColumnMeta[],
): string[] {
  const pks = columns
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
  if (pks.length > 0) return pks;
  if (columns[0]) return [columns[0].name];
  return [];
}

async function loadTableColumnsFromDb(
  table: string,
): Promise<SpreadsheetColumnMeta[]> {
  const db = await getSpreadsheetD1();
  const result = await db
    .prepare(`PRAGMA table_info(${quoteIdent(table)})`)
    .all<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>();

  return (result.results ?? []).map((r) => ({
    name: r.name,
    type: r.type ?? "TEXT",
    notNull: Boolean(r.notnull),
    pk: Number(r.pk ?? 0),
    editable: true,
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
): Promise<{ columns: SpreadsheetColumnMeta[]; primaryKeys: string[] }> {
  const now = Date.now();
  const hit = columnCache.get(table);
  if (hit && now - hit.cachedAt < COLUMN_CACHE_TTL_MS) {
    return { columns: hit.columns, primaryKeys: hit.primaryKeys };
  }

  const columns = await loadTableColumnsFromDb(table);
  const primaryKeys = primaryKeysFromColumns(columns);
  columnCache.set(table, { columns, primaryKeys, cachedAt: now });
  return { columns, primaryKeys };
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

  const { columns, primaryKeys } = await getCachedTableColumns(def.table);
  if (columns.length === 0) {
    throw new Error("unknown_table");
  }
  return {
    def,
    columns,
    primaryKeys,
    quotedTable: quoteIdent(def.table),
    orderColumn: quoteIdent(primaryKeys[0] ?? columns[0]?.name ?? "rowid"),
    columnNames: columns.map((c) => c.name),
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
