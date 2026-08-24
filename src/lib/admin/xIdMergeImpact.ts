import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
export {
  summarizeMergeImpact,
  totalMergeImpact,
  type XIdMergeImpactItem,
} from "./xIdMergeImpactCore";
import type { XIdMergeImpactItem } from "./xIdMergeImpactCore";

type AnyDb = LibSQLDatabase<any>;

export type XIdMergePreviewRow = {
  id: string;
  title: string;
  visibility_status: string;
  primary_event_id: string | null;
  creator_change: number;
  member_rows: number;
  chapter_rows: number;
  slot_rows: number;
  interaction_rows: number;
  moderation_rows: number;
};

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
  slotReservationGroups: number;
  slotSnapshots: number;
  moderationCases: number;
  activeUsers: number;
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
  {
    table: "slot_reservation_groups",
    column: "x_user_id",
    countColumn: "id",
    key: "slot_reservation_groups.x_user_id",
    label: "\u9023\u7d9a\u67a0\u30b0\u30eb\u30fc\u30d7",
  },
  {
    table: "video_moderation_cases",
    column: "related_x_user_id",
    countColumn: "id",
    key: "video_moderation_cases.related_x_user_id",
    label: "\u5be9\u67fb\u30fb\u30e2\u30c7\u30ec\u30fc\u30b7\u30e7\u30f3\u6848\u4ef6",
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
      slotReservationGroups: sql<number>`(SELECT COUNT(*) FROM slot_reservation_groups WHERE x_user_id = ${fromXId})`,
      slotSnapshots: sql<number>`(SELECT COUNT(*) FROM slots WHERE lower(trim(ltrim(trim(reserved_x_id_snapshot), '@'))) = lower(${fromXId}))`,
      moderationCases: sql<number>`(SELECT COUNT(*) FROM video_moderation_cases WHERE related_x_user_id = ${fromXId})`,
      activeUsers: sql<number>`(SELECT COUNT(*) FROM "user" WHERE lower(trim(ltrim(trim(active_x_user_id), '@'))) = lower(${fromXId}))`,
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
    { key: "slot_reservation_groups.x_user_id", label: "連続枠グループ", count: count(counts.slotReservationGroups) },
    { key: "slots.reserved_x_id_snapshot", label: "予約主体スナップショット", count: count(counts.slotSnapshots) },
    { key: "video_moderation_cases.related_x_user_id", label: "審査・モデレーション案件", count: count(counts.moderationCases) },
    { key: "user.active_x_user_id", label: "利用中のActive X", count: count(counts.activeUsers) },
  ];
}

/**
 * Return a bounded, human-readable work list for the selected request.
 * One query covers creator/member/chapter/slot/interaction/moderation references so the admin page can
 * explain exactly which works will be rewritten without an N+1 lookup.
 */
export async function fetchXIdMergePreview(
  db: AnyDb,
  fromXId: string,
  limit = 51,
): Promise<XIdMergePreviewRow[]> {
  // The admin page passes a literal, but this helper is also exported for
  // future tooling.  A runtime NaN would otherwise flow into the SQL LIMIT
  // expression and make D1 reject the query instead of returning a bounded
  // preview.  Treat every non-finite value as the safe default.
  const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 51;
  const boundedLimit = Math.min(51, Math.max(1, requestedLimit));
  const rows = await db.all<{
    id: string;
    title: string;
    visibility_status: string;
    primary_event_id: string | null;
    creator_change: number | string | null;
    member_rows: number | string | null;
    chapter_rows: number | string | null;
    slot_rows: number | string | null;
    interaction_rows: number | string | null;
    moderation_rows: number | string | null;
  }>(sql`
    WITH affected_video_ids(video_id, creator_change) AS (
      SELECT id, 1 FROM videos WHERE creator_x_user_id = ${fromXId}
      UNION
      SELECT video_id, 0 FROM video_members WHERE x_user_id = ${fromXId}
      UNION
      SELECT video_id, 0 FROM video_chapters WHERE x_user_id = ${fromXId}
      UNION
      SELECT video_id, 0 FROM slots
       WHERE video_id IS NOT NULL
         AND (
           x_user_id = ${fromXId}
           OR lower(trim(ltrim(trim(reserved_x_id_snapshot), '@'))) = lower(${fromXId})
         )
      UNION
      SELECT video_id, 0 FROM video_interactions WHERE x_user_id = ${fromXId}
      UNION
      SELECT video_id, 0 FROM video_moderation_cases WHERE related_x_user_id = ${fromXId}
    )
    SELECT
      v.id,
      v.title,
      v.visibility_status,
      v.primary_event_id,
      MAX(affected_video_ids.creator_change) AS creator_change,
      (SELECT COUNT(*) FROM video_members vm WHERE vm.video_id = v.id AND vm.x_user_id = ${fromXId}) AS member_rows,
      (SELECT COUNT(*) FROM video_chapters vc WHERE vc.video_id = v.id AND vc.x_user_id = ${fromXId}) AS chapter_rows,
      (SELECT COUNT(*) FROM slots s WHERE s.video_id = v.id AND (
        s.x_user_id = ${fromXId}
        OR lower(trim(ltrim(trim(s.reserved_x_id_snapshot), '@'))) = lower(${fromXId})
      )) AS slot_rows,
      (SELECT COUNT(*) FROM video_interactions vi WHERE vi.video_id = v.id AND vi.x_user_id = ${fromXId}) AS interaction_rows,
      (SELECT COUNT(*) FROM video_moderation_cases vmc WHERE vmc.video_id = v.id AND vmc.related_x_user_id = ${fromXId}) AS moderation_rows
    FROM affected_video_ids
    INNER JOIN videos v ON v.id = affected_video_ids.video_id
    GROUP BY v.id, v.title, v.visibility_status, v.primary_event_id
    ORDER BY v.title COLLATE NOCASE, v.id
    LIMIT ${boundedLimit}
  `);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    visibility_status: row.visibility_status,
    primary_event_id: row.primary_event_id,
    creator_change: count(row.creator_change),
    member_rows: count(row.member_rows),
    chapter_rows: count(row.chapter_rows),
    slot_rows: count(row.slot_rows),
    interaction_rows: count(row.interaction_rows),
    moderation_rows: count(row.moderation_rows),
  }));
}

/**
 * Fetch impact counts for several source IDs in one bounded D1 statement.
 *
 * The single-ID helper is the default path for the admin list: it is called only
 * after one request is selected. Keep this bounded batch helper for future
 * explicit multi-request tooling, but do not call it during an initial page view.
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
