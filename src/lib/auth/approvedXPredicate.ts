import { inArray, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export const APPROVED_X_IDS_IN_ARRAY_MAX = 80;

function uniqueXIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)));
}

/** JSON membership is materialized once, so the outer column can use its index. */
export function approvedXIdsWhere(column: AnySQLiteColumn, ids: readonly string[]): SQL {
  const unique = uniqueXIds(ids);
  if (unique.length === 0) return sql`false`;
  if (unique.length <= APPROVED_X_IDS_IN_ARRAY_MAX) return inArray(column, unique);
  return sql`${column} IN (
    SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(unique)})
    WHERE value IS NOT NULL
  )`;
}

export function approvedXIdsNotWhere(column: AnySQLiteColumn, ids: readonly string[]): SQL {
  const unique = uniqueXIds(ids);
  if (unique.length === 0) return sql`true`;
  if (unique.length <= APPROVED_X_IDS_IN_ARRAY_MAX) return sql`NOT (${inArray(column, unique)})`;
  return sql`${column} IS NOT NULL AND ${column} NOT IN (
    SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(unique)})
    WHERE value IS NOT NULL
  )`;
}
