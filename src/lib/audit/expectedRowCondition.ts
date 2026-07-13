import { sql, type SQL } from "drizzle-orm";

/** Preflightで読んだ全scalar列をmutation時に再照合し、stale writeをfail-closedにする。 */
export function expectedRowCondition(
  options: {
    forceOverwrite?: boolean;
    expectedCurrent?: Record<string, unknown> | null;
  },
): SQL {
  if (options.forceOverwrite) return sql`1 = 1`;
  const expected = options.expectedCurrent;
  if (!expected) return sql`0 = 1`;

  const predicates: SQL[] = [];
  for (const [key, value] of Object.entries(expected)) {
    const column = sql.raw(`"${key.replaceAll('"', '""')}"`);
    if (value === null) {
      predicates.push(sql`${column} IS NULL`);
    } else if (value instanceof Date && Number.isFinite(value.getTime())) {
      // timestamp_ms列はDrizzle selectでDateになるが、SQLite上はepoch ms整数。
      predicates.push(sql`${column} = ${value.getTime()}`);
    } else if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "bigint" ||
      typeof value === "boolean"
    ) {
      predicates.push(sql`${column} = ${value}`);
    } else {
      return sql`0 = 1`;
    }
  }
  return predicates.length > 0 ? sql.join(predicates, sql` AND `) : sql`0 = 1`;
}
