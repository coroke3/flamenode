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
    return {
      id,
      slug: String(group.slug ?? ""),
      name: String(group.name ?? ""),
      description: group.description != null ? String(group.description) : null,
      group_type: String(group.group_type ?? ""),
      icon_url: group.icon_url != null ? String(group.icon_url) : null,
      accent_color: group.accent_color != null ? String(group.accent_color) : null,
      sort_order: normalizeNumber(group.sort_order) ?? 0,
      latest_event_start_time: latestEventStart(events),
      events,
    };
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log("[readPublicData] CLI entry point ready for build time execution");
}
