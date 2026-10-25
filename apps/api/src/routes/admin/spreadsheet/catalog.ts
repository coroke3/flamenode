/**
 * MIG-0605 U02: D1 discovery for the admin spreadsheet READ routes.
 * CURRENT: src/lib/admin/spreadsheet/{discovery,tableContext,d1Access}.ts.
 *
 * Runtime S2: one table's definition + columns come from ONE statement (CURRENT used sqlite_master + PRAGMA
 * table_xinfo + PRAGMA foreign_key_list = 3; foreign keys are only used by writes and are not read here).
 * Both caches keep CURRENT's 30 s isolate TTL.
 */
import type { AdminSpreadsheetColumnMeta } from "@flamenode/contracts";
import {
  buildSpreadsheetTableDefs,
  isSpreadsheetColumnEditable,
  isValidSqliteTableName,
  primaryKeysFromColumns,
  type SpreadsheetTableDef,
} from "./registry.ts";
import { SPREADSHEET_COLUMN_ENUMS, SPREADSHEET_SCHEMA_TABLES } from "./schemaCatalog.ts";

export const SPREADSHEET_ERROR = {
  DB_UNAVAILABLE: "db_unavailable",
  UNKNOWN_TABLE: "unknown_table",
} as const;

export class SpreadsheetError extends Error {
  readonly code: (typeof SPREADSHEET_ERROR)[keyof typeof SPREADSHEET_ERROR];
  constructor(code: (typeof SPREADSHEET_ERROR)[keyof typeof SPREADSHEET_ERROR]) {
    super(code);
    this.code = code;
  }
}

const CACHE_TTL_MS = 30_000;

export interface SpreadsheetTableContext {
  def: SpreadsheetTableDef;
  columns: AdminSpreadsheetColumnMeta[];
  primaryKeys: string[];
  quotedTable: string;
  orderColumn: string;
}

type Catalog = {
  tables: SpreadsheetTableDef[];
  notInSchema: string[];
  inSchemaNotInDb: string[];
  cachedAt: number;
};

let catalog: Catalog | null = null;
const contextCache = new Map<string, { ctx: SpreadsheetTableContext; cachedAt: number }>();

export function invalidateSpreadsheetCaches(): void {
  catalog = null;
  contextCache.clear();
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * CURRENT discovery.ts loadTableNamesFromD1 with the table-function argument qualified: CURRENT writes
 * `pragma_table_info(name)`, which SQLite 3.50 resolves to the function's own `name` column (empty catalog).
 * `sqlite_master.name` is what CURRENT means and is unambiguous on every SQLite version.
 */
const TABLE_NAMES_SQL = `SELECT name FROM sqlite_master
       WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
       AND substr(name, 1, 1) != '_'
       AND EXISTS (
         SELECT 1 FROM pragma_table_info(sqlite_master.name) WHERE pk > 0
       )
       ORDER BY name COLLATE NOCASE`;

/** CURRENT catalog existence rule (sqlite_master + pk > 0) joined with PRAGMA table_xinfo columns. */
const TABLE_COLUMNS_SQL = `SELECT x.name AS name, x.type AS type, x."notnull" AS not_null, x.pk AS pk,
       x.dflt_value AS dflt_value, x.hidden AS hidden
FROM pragma_table_xinfo(?) AS x
WHERE EXISTS (
  SELECT 1 FROM sqlite_master m
  WHERE m.type = 'table'
  AND m.name = ?
  AND m.name NOT LIKE 'sqlite_%'
  AND substr(m.name, 1, 1) != '_'
  AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) WHERE pk > 0)
)
ORDER BY x.cid`;

type ColumnRow = {
  name: string;
  type: string | null;
  not_null: number;
  pk: number | null;
  dflt_value: string | null;
  hidden: number | null;
};

export function getSpreadsheetDb(db: D1Database | undefined): D1Database {
  if (db && typeof db.prepare === "function") return db;
  throw new SpreadsheetError(SPREADSHEET_ERROR.DB_UNAVAILABLE);
}

/** 1 statement. Cached (CURRENT discovery.ts CACHE_TTL_MS). */
export async function listSpreadsheetCatalog(
  db: D1Database | undefined,
  now = Date.now(),
): Promise<Catalog> {
  if (catalog && now - catalog.cachedAt < CACHE_TTL_MS) return catalog;
  const result = await getSpreadsheetDb(db).prepare(TABLE_NAMES_SQL).all<{ name: string }>();
  const dbNames = (result.results ?? []).map((r) => r.name);
  const tables = buildSpreadsheetTableDefs(dbNames, SPREADSHEET_SCHEMA_TABLES);
  const dbSet = new Set(dbNames);
  catalog = {
    tables,
    notInSchema: tables.filter((t) => !t.inSchema).map((t) => t.table),
    inSchemaNotInDb: [...new Set(SPREADSHEET_SCHEMA_TABLES)].filter((n) => !dbSet.has(n)).sort(),
    cachedAt: now,
  };
  return catalog;
}

/**
 * CURRENT resolveSpreadsheetTableContext without the write-only parts (foreign keys, policies).
 * Unknown / blocklisted / not-in-schema / pk-less / generated-column tables are all `unknown_table`.
 */
export async function resolveSpreadsheetTableContext(
  db: D1Database | undefined,
  table: string,
  now = Date.now(),
): Promise<SpreadsheetTableContext> {
  const trimmed = table.trim();
  if (!trimmed || !isValidSqliteTableName(trimmed)) {
    throw new SpreadsheetError(SPREADSHEET_ERROR.UNKNOWN_TABLE);
  }
  // Definition rules (override list, blocklist, schema) are static: no D1 read for a table that can never exist.
  const def = buildSpreadsheetTableDefs([trimmed], SPREADSHEET_SCHEMA_TABLES)[0];
  if (!def) throw new SpreadsheetError(SPREADSHEET_ERROR.UNKNOWN_TABLE);

  const hit = contextCache.get(def.table);
  if (hit && now - hit.cachedAt < CACHE_TTL_MS) return hit.ctx;

  const result = await getSpreadsheetDb(db)
    .prepare(TABLE_COLUMNS_SQL)
    .bind(def.table, def.table)
    .all<ColumnRow>();
  const rows = result.results ?? [];
  const raw = rows.map((row) => ({
    name: row.name,
    type: row.type ?? "TEXT",
    notNull: Boolean(row.not_null),
    pk: Number(row.pk ?? 0),
    generated: Number(row.hidden ?? 0) !== 0,
    defaultValue: row.dflt_value ?? null,
    enumValues: SPREADSHEET_COLUMN_ENUMS[`${def.table}.${row.name}`],
  }));
  const primaryKeys = primaryKeysFromColumns(raw);
  if (raw.length === 0 || primaryKeys.length === 0 || raw.some((column) => column.generated)) {
    throw new SpreadsheetError(SPREADSHEET_ERROR.UNKNOWN_TABLE);
  }
  // Key order matches CURRENT (name, type, notNull, pk, editable, defaultValue, generated, enumValues).
  const columns: AdminSpreadsheetColumnMeta[] = raw.map((column) => ({
    name: column.name,
    type: column.type,
    notNull: column.notNull,
    pk: column.pk,
    editable: isSpreadsheetColumnEditable(def, column.name),
    defaultValue: column.defaultValue,
    generated: column.generated,
    enumValues: column.enumValues ? [...column.enumValues] : undefined,
  }));
  const ctx: SpreadsheetTableContext = {
    def,
    columns,
    primaryKeys,
    quotedTable: quoteIdent(def.table),
    orderColumn: quoteIdent(primaryKeys[0] ?? columns[0]?.name ?? "rowid"),
  };
  contextCache.set(def.table, { ctx, cachedAt: now });
  return ctx;
}
