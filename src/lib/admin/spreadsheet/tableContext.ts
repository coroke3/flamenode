import "server-only";

import { getSpreadsheetD1 } from "./d1Access";
import { getSpreadsheetTableDef } from "./discovery";
import { getDrizzleColumnEnumValues } from "./schemaTables";
import {
  getSpreadsheetColumnPolicy,
  isSpreadsheetColumnEditable,
  isValidSqliteTableName,
  primaryKeysFromColumns,
  type SpreadsheetColumnPolicy,
  type SpreadsheetTableDef,
} from "./registry";

export type { SpreadsheetColumnMeta } from "./apiTypes";
import type { SpreadsheetColumnMeta } from "./apiTypes";

/** Array互換を維持しつつ、既存のcolumnNames.includesをSet参照へ置き換える。 */
class IndexedStringArray extends Array<string> {
  readonly #lookup: ReadonlySet<string>;

  constructor(values: readonly string[]) {
    super(...values);
    Object.setPrototypeOf(this, new.target.prototype);
    this.#lookup = new Set(values);
  }

  override includes(searchElement: string, fromIndex = 0): boolean {
    return fromIndex === 0
      ? this.#lookup.has(searchElement)
      : super.includes(searchElement, fromIndex);
  }
}

export interface SpreadsheetTableContext {
  def: SpreadsheetTableDef;
  columns: SpreadsheetColumnMeta[];
  primaryKeys: string[];
  quotedTable: string;
  orderColumn: string;
  columnNames: string[];
  /** セル単位検証で線形探索を繰り返さないための参照。 */
  columnNameSet: ReadonlySet<string>;
  columnByName: ReadonlyMap<string, SpreadsheetColumnMeta>;
  columnPolicyByName: ReadonlyMap<string, SpreadsheetColumnPolicy>;
  foreignKeys: Array<{
    column: string;
    referencedTable: string;
    referencedColumn: string;
  }>;
}

const COLUMN_CACHE_TTL_MS = 30_000;
const columnCache = new Map<
  string,
  {
    columns: SpreadsheetColumnMeta[];
    primaryKeys: string[];
    foreignKeys: Array<{
      column: string;
      referencedTable: string;
      referencedColumn: string;
    }>;
    cachedAt: number;
  }
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

  return (result.results ?? []).map((row) => ({
    name: row.name,
    type: row.type ?? "TEXT",
    notNull: Boolean(row.notnull),
    pk: Number(row.pk ?? 0),
    editable: true,
    defaultValue: row.dflt_value ?? null,
    generated: Number(row.hidden ?? 0) !== 0,
    enumValues: getDrizzleColumnEnumValues(table, row.name),
  }));
}

async function loadForeignKeysFromDb(
  table: string,
): Promise<
  Array<{
    column: string;
    referencedTable: string;
    referencedColumn: string;
  }>
> {
  const db = await getSpreadsheetD1();
  const result = await db
    .prepare(`PRAGMA foreign_key_list(${quoteIdent(table)})`)
    .all<{
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

/** API返却用に編集可否をテーブル定義から付与。 */
export function enrichSpreadsheetColumns(
  def: SpreadsheetTableDef,
  columns: SpreadsheetColumnMeta[],
): SpreadsheetColumnMeta[] {
  return columns.map((column) => ({
    ...column,
    editable: isSpreadsheetColumnEditable(def, column.name),
  }));
}

export async function getCachedTableColumns(table: string): Promise<{
  columns: SpreadsheetColumnMeta[];
  primaryKeys: string[];
  foreignKeys: Array<{
    column: string;
    referencedTable: string;
    referencedColumn: string;
  }>;
}> {
  const now = Date.now();
  const hit = columnCache.get(table);
  if (hit && now - hit.cachedAt < COLUMN_CACHE_TTL_MS) {
    return {
      columns: hit.columns,
      primaryKeys: hit.primaryKeys,
      foreignKeys: hit.foreignKeys,
    };
  }

  const [columns, foreignKeys] = await Promise.all([
    loadTableColumnsFromDb(table),
    loadForeignKeysFromDb(table),
  ]);
  const primaryKeys = primaryKeysFromColumns(columns);
  columnCache.set(table, {
    columns,
    primaryKeys,
    foreignKeys,
    cachedAt: now,
  });
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

  const { columns, primaryKeys, foreignKeys } =
    await getCachedTableColumns(def.table);
  if (
    columns.length === 0 ||
    primaryKeys.length === 0 ||
    columns.some((column) => column.generated)
  ) {
    throw new Error("unknown_table");
  }

  const columnNames = new IndexedStringArray(
    columns.map((column) => column.name),
  );
  const columnNameSet = new Set(columnNames);
  const columnByName = new Map(
    columns.map((column) => [column.name, column] as const),
  );
  const columnPolicyByName = new Map(
    columns.map(
      (column) =>
        [
          column.name,
          getSpreadsheetColumnPolicy(
            def.table,
            column.name,
            column.enumValues,
          ),
        ] as const,
    ),
  );

  return {
    def,
    columns,
    primaryKeys,
    quotedTable: quoteIdent(def.table),
    orderColumn: quoteIdent(primaryKeys[0] ?? columns[0]?.name ?? "rowid"),
    columnNames,
    columnNameSet,
    columnByName,
    columnPolicyByName,
    foreignKeys,
  };
}

export function assertColumnEditable(
  ctx: SpreadsheetTableContext,
  column: string,
): void {
  if (!ctx.columnNameSet.has(column)) {
    throw new Error("unknown_column");
  }
  if (!isSpreadsheetColumnEditable(ctx.def, column)) {
    throw new Error("column_not_editable");
  }
}

export function assertTableEditable(ctx: SpreadsheetTableContext): void {
  if (ctx.def.mode !== "editable") throw new Error("table_readonly");
}
