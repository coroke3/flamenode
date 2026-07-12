import "server-only";

import { getTableColumns, getTableName, isTable } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

/** Drizzle schema.ts に定義されている SQLite テーブル名 */
export function getDrizzleSchemaTableNames(): Set<string> {
  const names = new Set<string>();
  for (const value of Object.values(schema)) {
    if (isTable(value)) {
      names.add(getTableName(value));
    }
  }
  return names;
}

export function getDrizzleColumnEnumValues(
  tableName: string,
  columnName: string,
): readonly string[] | undefined {
  for (const value of Object.values(schema)) {
    if (!isTable(value) || getTableName(value) !== tableName) continue;
    const column = (getTableColumns(value) as Record<string, unknown>)[columnName] as
      | { enumValues?: readonly string[] }
      | undefined;
    return column?.enumValues;
  }
  return undefined;
}
