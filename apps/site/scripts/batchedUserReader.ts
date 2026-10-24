/**
 * Batched, read-only reader for the per-creator objects (MIG-0509 / lead decision C').
 * CURRENT's `rebuildUser` (workers/json-generator/rebuild.ts) issues 3 statements per creator and stays the
 * parity oracle; this reader fetches the same rows for many creators with set-based queries (window functions
 * partitioned by creator) and assembles byte-identical objects (`users/ID.json`, `users/ID/works|collabs/N.json`).
 * Only SELECT statements are issued, so it can run through a read-only D1 reader. The SELECT column lists and
 * predicates are copied from CURRENT (they are not exported); the parity test fails if they drift.
 */
import { COUNTABLE_PUBLIC_VIDEO_SQL } from "../../../src/lib/publicData/countablePublicVideoSql.ts";
import { PUBLIC_LISTABLE_X_APPROVAL_SQL_IN } from "../../../src/lib/utils/publicXUser.ts";
import {
  STATIC_USER_COLLABS_PAGE_SIZE,
  STATIC_USER_MAX_PAGES,
  STATIC_USER_MAX_STATIC_ITEMS,
  STATIC_USER_WORKS_PAGE_SIZE,
} from "../../../src/lib/publicData/staticUserProfileCore.ts";
import { assertNoForbiddenPublicKeys } from "../../../workers/json-generator/sanitize.ts";

export interface ReadOnlyDb {
  prepare(sql: string): { bind(...values: unknown[]): unknown };
}

/** Creators per set-based query. 25 creators x at most 120 rows keeps a response near 1 MB. */
export const DEFAULT_CREATORS_PER_QUERY = 25;
const PROFILE_CHUNK = 90;

// Copied from workers/json-generator/rebuild.ts (STATIC_USER_PROFILE_VIDEO_SELECT / STATIC_USER_COLLAB_VIDEO_SELECT).
const PROFILE_VIDEO_SELECT = `
  v.id, v.title, v.youtube_video_id,
  v.creator_display_name AS display_name,
  v.creator_display_name,
  v.creator_x_user_id,
  v.creator_icon_url AS icon_url,
  v.creator_icon_url,
  CASE WHEN EXISTS (
    SELECT 1 FROM events AS primary_event
    WHERE primary_event.id = v.primary_event_id
      AND primary_event.visibility_status = 'public'
  ) THEN v.primary_event_id ELSE NULL END AS primary_event_id,
  v.scheduled_time,
  v.visibility_status AS status,
  v.part
`;
const COLLAB_VIDEO_SELECT = `
  v.id, v.title, v.youtube_video_id,
  COALESCE(v.creator_display_name, v.creator_x_user_id) AS display_name,
  v.creator_display_name,
  v.creator_x_user_id,
  v.creator_icon_url AS icon_url,
  v.creator_icon_url,
  CASE WHEN EXISTS (
    SELECT 1 FROM events AS primary_event
    WHERE primary_event.id = v.primary_event_id
      AND primary_event.visibility_status = 'public'
  ) THEN v.primary_event_id ELSE NULL END AS primary_event_id,
  v.scheduled_time,
  v.visibility_status AS status,
  v.part
`;

type Row = Record<string, unknown>;

async function all(db: ReadOnlyDb, sql: string, ...values: unknown[]): Promise<Row[]> {
  const statement = db.prepare(sql).bind(...values) as { all(): Promise<{ results?: Row[] }> };
  return (await statement.all()).results ?? [];
}

const placeholders = (n: number): string => Array.from({ length: n }, () => "?").join(",");

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Section = { total: number; items: Row[] };

/** Groups by `keyColumn` and removes the helper columns; the remaining key order is the SELECT order, as in CURRENT. */
function groupBy(rows: Row[], keyColumn: string): Map<string, Section> {
  const groups = new Map<string, Section>();
  for (const row of rows) {
    const key = String(row[keyColumn]);
    const item: Row = {};
    for (const [column, value] of Object.entries(row)) {
      if (column === "fn_rank" || column === "total_count" || column === "fn_member") continue;
      item[column] = value;
    }
    const group = groups.get(key) ?? { total: Number(row.total_count ?? 0), items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return groups;
}

/**
 * Objects CURRENT's `rebuildUser` would write for each creator that is publicly listable, keyed by R2 key.
 * `ids` are normalized (lowercase) X IDs. `generatedAt` is the unix second recorded in every object.
 */
export async function readUserObjects(
  db: ReadOnlyDb,
  ids: readonly string[],
  generatedAt: number,
  creatorsPerQuery: number = DEFAULT_CREATORS_PER_QUERY,
): Promise<Map<string, unknown>> {
  const objects = new Map<string, unknown>();

  const profiles = new Map<string, Row>();
  for (const chunk of chunks(ids, PROFILE_CHUNK)) {
    const rows = await all(
      db,
      `SELECT id, x_name, icon_url, profile_text, portfolio_contact,
              youtube_channel_url, other_social_links
       FROM x_users WHERE id IN (${placeholders(chunk.length)}) AND approval_status IN (${PUBLIC_LISTABLE_X_APPROVAL_SQL_IN})`,
      ...chunk,
    );
    for (const row of rows) profiles.set(String(row.id), row);
  }
  const listable = ids.filter((id) => profiles.has(id));

  for (const chunk of chunks(listable, creatorsPerQuery)) {
    const own = groupBy(
      await all(
        db,
        `SELECT * FROM (
           SELECT ${PROFILE_VIDEO_SELECT},
                  ROW_NUMBER() OVER (PARTITION BY v.creator_x_user_id ORDER BY v.scheduled_time DESC, v.created_at DESC) AS fn_rank,
                  COUNT(*) OVER (PARTITION BY v.creator_x_user_id) AS total_count
           FROM videos AS v
           WHERE v.creator_x_user_id IN (${placeholders(chunk.length)})
             AND ${COUNTABLE_PUBLIC_VIDEO_SQL}
         ) WHERE fn_rank <= ?
         ORDER BY creator_x_user_id ASC, fn_rank ASC`,
        ...chunk,
        STATIC_USER_MAX_STATIC_ITEMS,
      ),
      "creator_x_user_id",
    );
    const collabs = groupBy(
      await all(
        db,
        `SELECT * FROM (
           SELECT ${COLLAB_VIDEO_SELECT},
                  ROW_NUMBER() OVER (PARTITION BY vm.member_id ORDER BY v.scheduled_time DESC, v.created_at DESC) AS fn_rank,
                  COUNT(*) OVER (PARTITION BY vm.member_id) AS total_count,
                  vm.member_id AS fn_member
           FROM videos AS v
           INNER JOIN (
             SELECT DISTINCT video_id, LOWER(x_user_id) AS member_id
             FROM video_members
             WHERE is_public_member = 1 AND LOWER(x_user_id) IN (${placeholders(chunk.length)})
           ) AS vm ON vm.video_id = v.id
           WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
             AND LOWER(COALESCE(v.creator_x_user_id, '')) <> vm.member_id
         ) WHERE fn_rank <= ?
         ORDER BY fn_member ASC, fn_rank ASC`,
        ...chunk.map((id) => id.toLowerCase()),
        STATIC_USER_MAX_STATIC_ITEMS,
      ),
      "fn_member",
    );

    for (const id of chunk) {
      const user = profiles.get(id)!;
      const ownSection = own.get(id) ?? { total: 0, items: [] };
      const collabSection = collabs.get(id.toLowerCase()) ?? { total: 0, items: [] };
      const put = (key: string, body: unknown): void => {
        assertNoForbiddenPublicKeys(body);
        objects.set(key, body);
      };
      put(`users/${id}.json`, {
        generated_at: generatedAt,
        user,
        page_size: STATIC_USER_WORKS_PAGE_SIZE,
        works: { total: ownSection.total, items: ownSection.items.slice(0, STATIC_USER_WORKS_PAGE_SIZE) },
        collabs: { total: collabSection.total, items: collabSection.items.slice(0, STATIC_USER_COLLABS_PAGE_SIZE) },
      });
      const sections: [string, Section, number][] = [
        ["works", ownSection, STATIC_USER_WORKS_PAGE_SIZE],
        ["collabs", collabSection, STATIC_USER_COLLABS_PAGE_SIZE],
      ];
      for (const [name, section, size] of sections) {
        const pageCount = Math.min(STATIC_USER_MAX_PAGES, Math.max(1, Math.ceil(section.items.length / size)));
        for (let page = 2; page <= pageCount; page += 1) {
          put(`users/${id}/${name}/${page}.json`, {
            generated_at: generatedAt,
            page,
            page_size: size,
            total: section.total,
            items: section.items.slice((page - 1) * size, page * size),
          });
        }
      }
    }
  }
  return objects;
}
