import { MAX_JSON_COLUMN_BYTES } from "../context.ts";

// MIG-0623: every Entry page reads its page data with ONE D1 statement (ZERO_1102 S2: session + context + data = 3).
// The statement is a UNION ALL of arms; each arm yields rows `(k, j)` where `j` is ONE json_object (<= 64 KiB) and
// `k` names the arm. Row-per-item (not json_group_array) keeps every JSON.parse input small even for 120 event rows.

/** Rows one list arm returns per request (ZERO_1102 S2: every LIMIT is a named constant <= 100). */
export const ENTRY_PAGE_ROWS = 100;
/** Largest `?offset=` honoured on the paged event lists (rows beyond it are not reachable; same clamp style as manage). */
export const MAX_ENTRY_OFFSET = 900;
/** Whole-response JSON bound (ZERO_1102 S2). */
export const MAX_RESPONSE_BYTES = 64 * 1024;
/** Upper bound on the rows of one data statement: every arm is bounded (largest sums: slotted ~ 570, unslotted ~ 460). */
export const MAX_DATA_ROWS = 800;

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

/** `?offset=` of a paged list: a non-negative safe integer, clamped to MAX_ENTRY_OFFSET; anything else is 0. */
export function parseOffset(value: string | undefined): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, MAX_ENTRY_OFFSET) : 0;
}

/** Rows of a per-event nested arm (`{event_id, rows:[...]}` per event), flattened in event order. */
export function nestedRows<T>(arms: ArmRows, key: string): T[] {
  return armOf<{ rows?: unknown }>(arms, key).flatMap((entry) => (Array.isArray(entry.rows) ? (entry.rows as T[]) : []));
}

const encoder = new TextEncoder();
export const jsonBytes = (value: unknown): number => encoder.encode(JSON.stringify(value)).length;

/**
 * Longest prefix of `items` whose JSON fits in `budgetBytes` (the response minus its fixed part). `cut` is true when a
 * later item was dropped; the caller then reports `truncated` and the offset to continue from. At least one item is
 * kept only if it fits: an item that alone exceeds the budget fails closed (the response bound is never exceeded).
 */
export function takeWithinBytes<T>(items: readonly T[], budgetBytes: number): { items: T[]; cut: boolean } {
  const out: T[] = [];
  let used = 2;
  for (const item of items) {
    used += jsonBytes(item) + 1;
    if (used > budgetBytes) {
      if (out.length === 0) throw new Error("entry_response_too_large");
      return { items: out, cut: true };
    }
    out.push(item);
  }
  return { items: out, cut: false };
}

/** Fail closed instead of sending a response above the 64 KiB bound (ZERO_1102 S2). */
export function assertResponseBytes(body: unknown): void {
  if (jsonBytes(body) > MAX_RESPONSE_BYTES) throw new Error("entry_response_too_large");
}

/**
 * `nextOffset` to report: null once it is beyond what `parseOffset` can honour (a request for it would be clamped to
 * MAX_ENTRY_OFFSET and return the same page again). The response then keeps `truncated: true` so the cut is visible.
 */
export function nextOffsetOf(next: number): number | null {
  return next > MAX_ENTRY_OFFSET ? null : next;
}
