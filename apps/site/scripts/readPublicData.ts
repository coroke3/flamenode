import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const EVENTS_INDEX_MAX_ROWS = 200;
export const EVENT_GROUP_MAX_ROWS = 50;
export const EVENT_GROUP_EVENT_MAX_PER_GROUP = 20;
export const EVENT_GROUP_EVENT_MAX_ROWS =
  EVENT_GROUP_MAX_ROWS * EVENT_GROUP_EVENT_MAX_PER_GROUP;
export const PUBLIC_STAFF_MAX_PER_EVENT = 20;
export const PUBLIC_STAFF_EVENT_ID_CHUNK_SIZE = 90;

export interface D1PreparedStatementLike {
  bind(...args: unknown[]): D1PreparedStatementLike;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}

export interface D1Like {
  prepare(sql: string): D1PreparedStatementLike;
}

export interface PublicEventItem {
  id: string;
  title: string;
  explanation: string | null;
  icon_url: string | null;
  img_url: string | null;
  accent_color: string | null;
  event_type: string;
  slot_type: string;
  slot_visibility_mode: string;
  max_slots_per_video: number;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
  visibility_status: string;
  created_at: number;
  public_operator_names?: string[];
  [key: string]: unknown;
}

export interface PublicEventGroupSection {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  group_type: string;
  icon_url: string | null;
  accent_color: string | null;
  sort_order: number;
  latest_event_start_time: number | null;
  events: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface EventsIndexPayload {
  generated_at: number;
  items: PublicEventItem[];
  group_sections: PublicEventGroupSection[];
}

const EVENT_INDEX_COLUMNS = [
  "id",
  "title",
  "explanation",
  "icon_url",
  "img_url",
  "accent_color",
  "event_type",
  "slot_type",
  "slot_visibility_mode",
  "max_slots_per_video",
  "start_time",
  "end_time",
  "entry_start_time",
  "entry_end_time",
  "visibility_status",
  "created_at",
];

const NON_POINT_EVENT_PERIOD_SQL = `(
  (start_time IS NULL AND end_time IS NULL)
  OR (start_time IS NOT NULL AND end_time IS NOT NULL)
)`;

function normalizeNumber(value: unknown): number | null {
  // Match CURRENT rebuild.ts for group sort_order and latest event times.
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.floor(number) : null;
}

function latestEventStart(events: readonly Record<string, unknown>[]): number | null {
  let latest: number | null = null;
  for (const event of events) {
    const startTime = normalizeNumber(event.start_time);
    if (startTime === null) continue;
    if (latest === null || startTime > latest) {
      latest = startTime;
    }
  }
  return latest;
}

export async function attachPublicOperatorNames(
  db: D1Like,
  rows: readonly Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const eventIds = Array.from(
    new Set(
      rows
        .map((row) => String(row.id ?? "").trim())
        .filter(Boolean),
    ),
  );

  if (eventIds.length === 0) {
    return rows.map((row) => ({
      ...row,
      public_operator_names: [],
    }));
  }

  const namesByEvent = new Map<string, string[]>();

  for (let offset = 0; offset < eventIds.length; offset += PUBLIC_STAFF_EVENT_ID_CHUNK_SIZE) {
    const chunk = eventIds.slice(offset, offset + PUBLIC_STAFF_EVENT_ID_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");

    const result = await db
      .prepare(
        `WITH ranked_public_staff AS (
           SELECT event_id, display_name,
                  ROW_NUMBER() OVER (
                    PARTITION BY event_id
                    ORDER BY created_at ASC, id ASC
                  ) AS staff_rank
           FROM event_staff
           WHERE is_public = 1
             AND event_id IN (${placeholders})
         )
         SELECT event_id, display_name
         FROM ranked_public_staff
         WHERE staff_rank <= ?
         ORDER BY event_id ASC, staff_rank ASC`,
      )
      .bind(...chunk, PUBLIC_STAFF_MAX_PER_EVENT)
      .all<{ event_id: string; display_name: string }>();

    for (const staff of result.results ?? []) {
      const eventId = String(staff.event_id ?? "").trim();
      const displayName = String(staff.display_name ?? "").trim();
      if (!eventId || !displayName) continue;
      const current = namesByEvent.get(eventId) ?? [];
      if (!current.includes(displayName)) {
        current.push(displayName);
        namesByEvent.set(eventId, current);
      }
    }
  }

  return rows.map((row) => ({
    ...row,
    public_operator_names: namesByEvent.get(String(row.id ?? "").trim()) ?? [],
  }));
}

export async function readEventGroupSections(db: D1Like): Promise<PublicEventGroupSection[]> {
  const groups = await db
    .prepare(
      `SELECT id, slug, name, description, group_type, icon_url, accent_color, sort_order
       FROM event_groups
       WHERE visibility_status = 'public'
       ORDER BY sort_order ASC, name ASC
       LIMIT ?`,
    )
    .bind(EVENT_GROUP_MAX_ROWS)
    .all<Record<string, unknown>>();

  const groupRows = groups.results ?? [];
  if (groupRows.length === 0) return [];

  const groupIds = groupRows
    .map((group) => String(group.id ?? "").trim())
    .filter(Boolean);
  if (groupIds.length === 0) return [];

  const placeholders = groupIds.map(() => "?").join(",");
  const eventsByGroup = new Map<string, Record<string, unknown>[]>();

  const junctionRows = await db
    .prepare(
      `WITH ranked_group_events AS (
         SELECT ege.event_group_id AS group_id,
                ${EVENT_INDEX_COLUMNS.map((col) => `e.${col} AS ${col}`).join(", ")},
                ROW_NUMBER() OVER (
                  PARTITION BY ege.event_group_id
                  ORDER BY e.start_time DESC, e.created_at DESC, e.id ASC
                ) AS group_rank
         FROM event_group_events ege
         INNER JOIN events e ON e.id = ege.event_id
         WHERE ege.event_group_id IN (${placeholders})
           AND e.visibility_status = 'public'
           AND ${NON_POINT_EVENT_PERIOD_SQL}
       )
       SELECT group_id, ${EVENT_INDEX_COLUMNS.join(", ")}
       FROM ranked_group_events
       WHERE group_rank <= ?
       ORDER BY group_id ASC, start_time DESC, created_at DESC, id ASC
       LIMIT ?`,
    )
    .bind(
      ...groupIds,
      EVENT_GROUP_EVENT_MAX_PER_GROUP,
      EVENT_GROUP_EVENT_MAX_ROWS,
    )
    .all<Record<string, unknown>>();

  const enrichedRows = await attachPublicOperatorNames(db, junctionRows.results ?? []);

  for (const row of enrichedRows) {
    const groupId = String(row.group_id ?? "").trim();
    const eventId = String(row.id ?? "").trim();
    if (!groupId || !eventId) continue;

    const current = eventsByGroup.get(groupId) ?? [];
    if (!current.some((e) => e.id === eventId)) {
      const { group_id: _, ...rest } = row;
      current.push(rest);
      eventsByGroup.set(groupId, current);
    }
  }

  return groupRows.map((group) => {
    const id = String(group.id ?? "");
    const events = eventsByGroup.get(id) ?? [];
    // Same shape as CURRENT rebuildEventGroupSections: the selected row as-is
    // (no string coercion), then the three derived fields.
    return {
      ...group,
      sort_order: normalizeNumber(group.sort_order) ?? 0,
      latest_event_start_time: latestEventStart(events),
      events,
    } as PublicEventGroupSection;
  });
}

export async function buildEventsIndexData(
  db: D1Like,
  options?: { generatedAt?: number; rowLimit?: number },
): Promise<EventsIndexPayload> {
  const rowLimit = options?.rowLimit ?? EVENTS_INDEX_MAX_ROWS;
  // A negative SQLite LIMIT means "unlimited". Reject invalid overrides before
  // touching D1 so this build-time reader always stays within its fixed budget.
  if (!Number.isSafeInteger(rowLimit) || rowLimit < 1 || rowLimit > EVENTS_INDEX_MAX_ROWS) {
    throw new RangeError(`Invalid events index rowLimit: expected integer 1..${EVENTS_INDEX_MAX_ROWS}`);
  }

  const countResult = await db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM events
       WHERE visibility_status = 'public'
         AND ${NON_POINT_EVENT_PERIOD_SQL}`,
    )
    .all<{ total: number }>();

  const totalCount = countResult.results?.[0]?.total ?? 0;
  if (totalCount > rowLimit) {
    throw new Error(
      `Events index row count exceeds limit: ${totalCount} > ${rowLimit}`,
    );
  }

  const [rowsResult, groupSections] = await Promise.all([
    db
      .prepare(
        `SELECT ${EVENT_INDEX_COLUMNS.join(", ")}
         FROM events
         WHERE visibility_status = 'public'
           AND ${NON_POINT_EVENT_PERIOD_SQL}
         -- Match CURRENT workers/json-generator/rebuild.ts::rebuildEventsIndex.
         -- Do not impose additional tie-breakers here: they change legacy ordering.
         ORDER BY start_time DESC
         LIMIT ?`,
      )
      .bind(rowLimit)
      .all<Record<string, unknown>>(),
    readEventGroupSections(db),
  ]);

  const rawItems = rowsResult.results ?? [];
  const enrichedItems = (await attachPublicOperatorNames(
    db,
    rawItems,
  )) as PublicEventItem[];

  return {
    generated_at: options?.generatedAt ?? Math.floor(Date.now() / 1000),
    items: enrichedItems,
    group_sections: groupSections,
  };
}

/** Stable JSON for build artifacts: sort object keys recursively, never filter fields. */
export function deterministicStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, nested: unknown) => {
      if (nested === null || typeof nested !== "object" || Array.isArray(nested)) {
        return nested;
      }
      // A replacer *array* would whitelist keys at every nesting level and discard
      // event details. A replacer function sorts each object without losing fields.
      return Object.fromEntries(
        Object.entries(nested).sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        ),
      );
    },
    2,
  );
}

/**
 * Read-only D1Like over a local SQLite file (a `wrangler d1 export` snapshot or a
 * local D1 fixture). Build time only: nothing here runs in a Worker request.
 */
export async function openLocalSqliteD1(file: string): Promise<{ db: D1Like; close: () => void }> {
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(file, { readOnly: true });
  const statement = (sql: string, args: unknown[] = []): D1PreparedStatementLike => ({
    bind: (...next: unknown[]) => statement(sql, next),
    async all<T>() {
      return { results: sqlite.prepare(sql).all(...(args as never[])) as T[] };
    },
  });
  return { db: { prepare: (sql) => statement(sql) }, close: () => sqlite.close() };
}

/**
 * Option A (approved 2026-10-18): read D1 over the Cloudflare REST API with a token that
 * has only the "D1 Read" permission on this account. Build time only. Every statement
 * must be a single read (SELECT / WITH); anything else is refused before any request,
 * so a mis-scoped token can still not be used to write. At most MAX_D1_HTTP_STATEMENTS
 * requests per run; the token is never logged or put in an error message.
 */
export const MAX_D1_HTTP_STATEMENTS = 19;
export const D1_HTTP_TIMEOUT_MS = 15_000;
export const D1_HTTP_ENV = {
  accountId: "CLOUDFLARE_ACCOUNT_ID",
  databaseId: "FLAMENODE_D1_DATABASE_ID",
  token: "FLAMENODE_D1_READ_TOKEN",
} as const;

const READ_ONLY_SQL = /^\s*(SELECT|WITH)\b/i;
const D1_ID = /^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isReadOnlyStatement(sql: string): boolean {
  // One statement only: no `;` except a trailing one.
  return READ_ONLY_SQL.test(sql) && !/;\s*\S/.test(sql);
}

export function openD1HttpReader(options: {
  accountId: string;
  databaseId: string;
  token: string;
  fetchFn?: typeof fetch;
  maxStatements?: number;
}): { db: D1Like; statements: () => number } {
  const { accountId, databaseId, token } = options;
  if (!/^[0-9a-f]{32}$/i.test(accountId) || !D1_ID.test(databaseId) || !token) {
    throw new Error(
      `D1 API mode needs ${D1_HTTP_ENV.accountId}, ${D1_HTTP_ENV.databaseId} and ${D1_HTTP_ENV.token}`,
    );
  }
  const fetchFn = options.fetchFn ?? fetch;
  const max = options.maxStatements ?? MAX_D1_HTTP_STATEMENTS;
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  let count = 0;
  const statement = (sql: string, params: unknown[] = []): D1PreparedStatementLike => ({
    bind: (...next: unknown[]) => statement(sql, next),
    async all<T>() {
      if (!isReadOnlyStatement(sql)) throw new Error("D1 API mode refuses a non-read statement");
      if (++count > max) throw new Error(`D1 API mode exceeded ${max} statements`);
      let response: Response;
      try {
        response = await fetchFn(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ sql, params }),
          signal: AbortSignal.timeout(D1_HTTP_TIMEOUT_MS),
        });
      } catch {
        throw new Error("D1 API request failed (network or timeout)");
      }
      const body = (await response.json().catch(() => null)) as {
        success?: boolean;
        result?: { success?: boolean; results?: T[] }[];
        errors?: { code?: number; message?: string }[];
      } | null;
      const first = body?.result?.[0];
      if (!response.ok || !body?.success || !first?.success || !Array.isArray(first.results)) {
        const codes = (body?.errors ?? []).map((e) => e.code).filter((c) => c !== undefined).join(",");
        throw new Error(`D1 API query failed (status=${response.status}${codes ? `, codes=${codes}` : ""})`);
      }
      return { results: first.results };
    },
  });
  return { db: { prepare: (sql) => statement(sql) }, statements: () => count };
}

export const READ_PUBLIC_DATA_USAGE =
  "usage: node --experimental-strip-types apps/site/scripts/readPublicData.ts " +
  "(--sqlite <snapshot.sqlite> | --d1-api) --out <events-index.json> [--generated-at <unix seconds>]; " +
  `--d1-api reads ${D1_HTTP_ENV.accountId}, ${D1_HTTP_ENV.databaseId}, ${D1_HTTP_ENV.token} from the environment`;

type CliArgs = { sqlite?: string; d1Api: boolean; out: string; generatedAt?: number };

function parseCliArgs(argv: readonly string[]): CliArgs {
  const values = new Map<string, string>();
  let d1Api = false;
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (flag === "--d1-api" && !d1Api) {
      d1Api = true;
      i -= 1;
      continue;
    }
    const value = argv[i + 1];
    if (!["--sqlite", "--out", "--generated-at"].includes(flag) || value === undefined || values.has(flag)) {
      throw new Error(READ_PUBLIC_DATA_USAGE);
    }
    values.set(flag, value);
  }
  const sqlite = values.get("--sqlite");
  const out = values.get("--out");
  // Exactly one source.
  if (!out || Boolean(sqlite) === d1Api) throw new Error(READ_PUBLIC_DATA_USAGE);
  const rawGeneratedAt = values.get("--generated-at");
  if (rawGeneratedAt === undefined) return { sqlite, d1Api, out };
  const generatedAt = Number(rawGeneratedAt);
  if (!Number.isSafeInteger(generatedAt) || generatedAt < 0) throw new Error(READ_PUBLIC_DATA_USAGE);
  return { sqlite, d1Api, out, generatedAt };
}

async function openCliSource(
  args: CliArgs,
  env: Record<string, string | undefined>,
  fetchFn?: typeof fetch,
): Promise<{ db: D1Like; close: () => void }> {
  if (args.d1Api) {
    const { db } = openD1HttpReader({
      accountId: env[D1_HTTP_ENV.accountId]?.trim() ?? "",
      databaseId: env[D1_HTTP_ENV.databaseId]?.trim() ?? "",
      token: env[D1_HTTP_ENV.token]?.trim() ?? "",
      fetchFn,
    });
    return { db, close: () => undefined };
  }
  const file = args.sqlite as string;
  if (!fs.existsSync(file)) throw new Error(`SQLite snapshot not found: ${file}`);
  return openLocalSqliteD1(file);
}

/**
 * CLI: local SQLite snapshot (option B/C) or the D1 REST API with a read-only token
 * (option A) -> `events/index.json` (deterministic bytes for a fixed --generated-at).
 */
export async function runReadPublicDataCli(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
  fetchFn?: typeof fetch,
): Promise<void> {
  const args = parseCliArgs(argv);
  const { db, close } = await openCliSource(args, env, fetchFn);
  try {
    const payload = await buildEventsIndexData(db, { generatedAt: args.generatedAt });
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, `${deterministicStringify(payload)}\n`);
  } finally {
    close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReadPublicDataCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`[readPublicData] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
