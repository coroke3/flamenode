import "server-only";

import { getTableName, isTable } from "drizzle-orm";
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
