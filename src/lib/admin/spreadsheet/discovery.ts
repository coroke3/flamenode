import "server-only";

import { getSpreadsheetD1 } from "./d1Access";
import {
  buildSpreadsheetTableDefs,
  type SpreadsheetTableDef,
} from "./registry";
import { getDrizzleSchemaTableNames } from "./schemaTables";

const CACHE_TTL_MS = 30_000;

type SpreadsheetCatalog = {
  tables: SpreadsheetTableDef[];
  byName: Map<string, SpreadsheetTableDef>;
  notInSchema: string[];
  inSchemaNotInDb: string[];
  cachedAt: number;
};

let catalog: SpreadsheetCatalog | null = null;
let catalogRefresh: Promise<SpreadsheetCatalog> | null = null;
let cacheGeneration = 0;

export function invalidateSpreadsheetTableCache(): void {
  catalog = null;
  catalogRefresh = null;
  cacheGeneration++;
}

export function getSpreadsheetSyncWarnings(): {
  notInSchema: string[];
  inSchemaNotInDb: string[];
} {
  return {
    notInSchema: catalog?.notInSchema ?? [],
    inSchemaNotInDb: catalog?.inSchemaNotInDb ?? [],
  };
}

async function loadTableNamesFromD1(): Promise<string[]> {
  const db = await getSpreadsheetD1();
  const result = await db.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
       AND substr(name, 1, 1) != '_'
       AND EXISTS (
         SELECT 1 FROM pragma_table_info(name) WHERE pk > 0
       )
       ORDER BY name COLLATE NOCASE`,
    )
    .all<{ name: string }>();

  return (result.results ?? []).map((r) => r.name);
}

async function refreshCatalog(generation: number): Promise<SpreadsheetCatalog> {
  const schemaNames = getDrizzleSchemaTableNames();
  const dbNames = await loadTableNamesFromD1();
  const tables = buildSpreadsheetTableDefs(dbNames, schemaNames);
  const dbSet = new Set(dbNames);
  const nextCatalog = {
    tables,
    byName: new Map(tables.map((t) => [t.table, t])),
    notInSchema: tables.filter((t) => !t.inSchema).map((t) => t.table),
    inSchemaNotInDb: [...schemaNames].filter((n) => !dbSet.has(n)).sort(),
    cachedAt: Date.now(),
  } satisfies SpreadsheetCatalog;

  if (generation === cacheGeneration) {
    catalog = nextCatalog;
  }
  return nextCatalog;
}

async function getCatalog(): Promise<SpreadsheetCatalog> {
  const now = Date.now();
  if (catalog && now - catalog.cachedAt < CACHE_TTL_MS) {
    return catalog;
  }
  if (catalogRefresh) {
    return catalogRefresh;
  }

  const generation = cacheGeneration;
  const refresh = refreshCatalog(generation).finally(() => {
    if (catalogRefresh === refresh) {
      catalogRefresh = null;
    }
  });
  catalogRefresh = refresh;
  return refresh;
}

/** D1 + Drizzle スキーマからテーブル一覧（短時間キャッシュ） */
export async function listSpreadsheetTables(): Promise<SpreadsheetTableDef[]> {
  return (await getCatalog()).tables;
}

export async function getSpreadsheetTableDef(
  table: string,
): Promise<SpreadsheetTableDef | undefined> {
  const trimmed = table.trim();
  if (!trimmed) return undefined;
  return (await getCatalog()).byName.get(trimmed);
}
