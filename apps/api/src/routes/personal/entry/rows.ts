import { MAX_JSON_COLUMN_BYTES } from "../context.ts";

// MIG-0623: every Entry page reads its page data with ONE D1 statement (ZERO_1102 S2: session + context + data = 3).
// The statement is a UNION ALL of arms; each arm yields rows `(k, j)` where `j` is ONE json_object (<= 64 KiB) and
// `k` names the arm. Row-per-item (not json_group_array) keeps every JSON.parse input small even for 120 event rows.

/** Upper bound on the rows of one data statement (sum of every arm LIMIT below). */
export const MAX_DATA_ROWS = 6000;

export type ArmRows = Map<string, Array<Record<string, unknown>>>;

export async function loadArmRows(statement: D1PreparedStatement): Promise<ArmRows> {
  const { results } = await statement.all<{ k: string; j: string | null }>();
  if (results.length > MAX_DATA_ROWS) throw new Error("entry_rows_exceeded");
  const arms: ArmRows = new Map();
  for (const row of results) {
    if (typeof row.j !== "string" || row.j.length > MAX_JSON_COLUMN_BYTES) {
      throw new Error("json_column_invalid");
    }
    const list = arms.get(row.k) ?? [];
    list.push(JSON.parse(row.j) as Record<string, unknown>);
    arms.set(row.k, list);
  }
  return arms;
}

export function armOf<T = Record<string, unknown>>(arms: ArmRows, key: string): T[] {
  return (arms.get(key) ?? []) as T[];
}

/** First row of an arm, or null. */
export function armOne<T = Record<string, unknown>>(arms: ArmRows, key: string): T | null {
  return ((arms.get(key) ?? [])[0] ?? null) as T | null;
}
