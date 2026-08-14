import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
export {
  summarizeMergeImpact,
  totalMergeImpact,
  type XIdMergeImpactItem,
} from "./xIdMergeImpactCore";
import type { XIdMergeImpactItem } from "./xIdMergeImpactCore";

type AnyDb = LibSQLDatabase<any>;

type MergeImpactCounts = {
  creatorVideos: number;
  members: number;
  chapters: number;
  interactions: number;
  accountLinks: number;
  staff: number;
  aliasesOwned: number;
  aliasesPointing: number;
  slotRows: number;
};

type BatchImpactRow = {
  source_x_id: string;
  impact_key: string;
  impact_count: number | string | null;
};

type BatchImpactSpec = {
  table: string;
  column: string;
  countColumn: string;
  key: string;
  label: string;
};

// These identifiers are trusted compile-time constants. Values supplied by callers
// are still bound as SQL parameters below.
const BATCH_IMPACT_SPECS: readonly BatchImpactSpec[] = [
  {
    table: "videos",
    column: "creator_x_user_id",
    countColumn: "id",
    key: "videos.creator_x_user_id",
    label: "\u4f5c\u54c1\u6295\u7a3f\u8005",
  },
  {
    table: "video_members",
    column: "x_user_id",
    countColumn: "id",
    key: "video_members.x_user_id",
    label: "\u5408\u4f5c\u30e1\u30f3\u30d0\u30fc",
  },
  {
    table: "video_chapters",
    column: "x_user_id",
    countColumn: "id",
    key: "video_chapters.x_user_id",
    label: "\u30c1\u30e3\u30d7\u30bf\u30fc",
  },
  {
    table: "video_interactions",
    column: "x_user_id",
    countColumn: "video_id",
    key: "video_interactions.x_user_id",
    label: "\u3044\u3044\u306d/\u4fdd\u5b58",
  },
  {
    table: "x_user_account_links",
    column: "x_user_id",
    countColumn: "auth_user_id",
    key: "x_user_account_links.x_user_id",
    label: "\u8a8d\u8a3c\u30e6\u30fc\u30b6\u30fc\u7d10\u4ed8\u3051",
  },
  {
    table: "event_staff",
    column: "x_user_id",
    countColumn: "id",
    key: "event_staff.x_user_id",
    label: "\u30a4\u30d9\u30f3\u30c8\u30b9\u30bf\u30c3\u30d5",
  },
  {
    table: "x_user_aliases",
    column: "x_user_id",
    countColumn: "alias_x_id",
    key: "x_user_aliases.x_user_id",
    label: "alias\u6240\u6709",
  },
  {
    table: "x_user_aliases",
    column: "alias_x_id",
    countColumn: "alias_x_id",
    key: "x_user_aliases.alias_x_id",
    label: "alias\u53c2\u7167",
  },
  {
    table: "slots",
    column: "x_user_id",
    countColumn: "id",
    key: "slots.x_user_id",
    label: "\u4e88\u7d04\u67a0",
  },
];

function count(value: unknown): number {
  return Number(value ?? 0);
}

export async function fetchXIdMergeImpact(
  db: AnyDb,
  fromXId: string,
): Promise<XIdMergeImpactItem[]> {
  const rows = await db
    .select({
      creatorVideos: sql<number>`(SELECT COUNT(*) FROM videos WHERE creator_x_user_id = ${fromXId})`,
      members: sql<number>`(SELECT COUNT(*) FROM video_members WHERE x_user_id = ${fromXId})`,
      chapters: sql<number>`(SELECT COUNT(*) FROM video_chapters WHERE x_user_id = ${fromXId})`,
      interactions: sql<number>`(SELECT COUNT(*) FROM video_interactions WHERE x_user_id = ${fromXId})`,
      accountLinks: sql<number>`(SELECT COUNT(*) FROM x_user_account_links WHERE x_user_id = ${fromXId})`,
      staff: sql<number>`(SELECT COUNT(*) FROM event_staff WHERE x_user_id = ${fromXId})`,
      aliasesOwned: sql<number>`(SELECT COUNT(*) FROM x_user_aliases WHERE x_user_id = ${fromXId})`,
      aliasesPointing: sql<number>`(SELECT COUNT(*) FROM x_user_aliases WHERE alias_x_id = ${fromXId})`,
      slotRows: sql<number>`(SELECT COUNT(*) FROM slots WHERE x_user_id = ${fromXId})`,
    })
    .from(sql`(SELECT 1) AS impact_source`);
  const counts = (rows[0] ?? {}) as Partial<MergeImpactCounts>;

  return [
    { key: "videos.creator_x_user_id", label: "作品投稿者", count: count(counts.creatorVideos) },
    { key: "video_members.x_user_id", label: "合作メンバー", count: count(counts.members) },
    { key: "video_chapters.x_user_id", label: "チャプター", count: count(counts.chapters) },
    { key: "video_interactions.x_user_id", label: "いいね/保存", count: count(counts.interactions) },
    { key: "x_user_account_links.x_user_id", label: "認証ユーザー紐付け", count: count(counts.accountLinks) },
    { key: "event_staff.x_user_id", label: "イベントスタッフ", count: count(counts.staff) },
    { key: "x_user_aliases.x_user_id", label: "alias所有", count: count(counts.aliasesOwned) },
    { key: "x_user_aliases.alias_x_id", label: "alias参照", count: count(counts.aliasesPointing) },
    { key: "slots.x_user_id", label: "予約枠", count: count(counts.slotRows) },
  ];
}

/**
 * Fetch impact counts for several source IDs in one bounded D1 statement.
 *
 * The old single-ID helper remains the compatibility path for callers that only
 * need one source. This batch path is used by the admin list, where up to 20
 * rows can otherwise cause 20 repeated scans of each impact table.
 */
export async function fetchXIdMergeImpacts(
  db: AnyDb,
  fromXIds: readonly string[],
): Promise<Map<string, XIdMergeImpactItem[]>> {
  const sourceIds = Array.from(
    new Set(fromXIds.filter((value): value is string => Boolean(value))),
  );
  const result = new Map<string, XIdMergeImpactItem[]>(
    sourceIds.map((sourceId) => [sourceId, []]),
  );
  if (sourceIds.length === 0) return result;

  const sourceValues = sql.join(
    sourceIds.map((sourceId) => sql`(${sourceId})`),
    sql`, `,
  );
  const branches = BATCH_IMPACT_SPECS.map((spec) => {
    const table = sql.raw(spec.table);
    const column = sql.raw(`target.${spec.column}`);
    const countColumn = sql.raw(`target.${spec.countColumn}`);
    return sql`
      SELECT source_ids.x_id AS source_x_id,
             ${sql.raw(`'${spec.key}'`)} AS impact_key,
             COALESCE(impact_counts.impact_count, 0) AS impact_count
      FROM source_ids
      LEFT JOIN (
        SELECT ${column} AS x_id,
               COUNT(${countColumn}) AS impact_count
        FROM ${table} AS target
        WHERE ${column} IN (SELECT x_id FROM source_ids)
        GROUP BY ${column}
      ) AS impact_counts
        ON impact_counts.x_id = source_ids.x_id
    `;
  });
  const query = sql`
    WITH source_ids(x_id) AS (VALUES ${sourceValues})
    ${sql.join(branches, sql` UNION ALL `)}
  `;
  const rows = await db.all<BatchImpactRow>(query);
  const labels = new Map(BATCH_IMPACT_SPECS.map((spec) => [spec.key, spec.label]));
  const order = new Map(BATCH_IMPACT_SPECS.map((spec, index) => [spec.key, index]));

  for (const row of rows) {
    const items = result.get(row.source_x_id);
    const label = labels.get(row.impact_key);
    if (!items || !label) continue;
    items.push({
      key: row.impact_key,
      label,
      count: count(row.impact_count),
    });
  }
  for (const items of result.values()) {
    items.sort(
      (left, right) =>
        (order.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.key) ?? Number.MAX_SAFE_INTEGER),
    );
  }
  return result;
}
