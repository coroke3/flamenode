import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { videos, xUsers, xUserIcons } from "./schema";
import type { DB } from "./client";

const FALLBACK_CHUNK_SIZE = 25;
const FALLBACK_QUERY_CONCURRENCY = 4;

type SnapshotRow = {
  x_id: string | null;
  icon_url: string | null;
  display_name: string | null;
  collaboration_type: "individual" | "collab";
  icon_rank: number;
  name_rank: number;
};

/**
 * X ID・投稿種別ごとに、最新の非NULLアイコンと最新の表示名だけをDB側で選ぶ。
 * アイコンがない最新作品によって、より古い有効なアイコンが隠れないよう
 * icon_rankとname_rankを独立させる。従来の個人作→合作、created_at DESCを維持する。
 */
async function fetchLatestCreatorSnapshots(
  db: DB,
  xIds: string[],
): Promise<SnapshotRow[]> {
  const chunks: string[][] = [];
  for (let offset = 0; offset < xIds.length; offset += FALLBACK_CHUNK_SIZE) {
    chunks.push(xIds.slice(offset, offset + FALLBACK_CHUNK_SIZE));
  }

  const output: SnapshotRow[] = [];
  for (
    let offset = 0;
    offset < chunks.length;
    offset += FALLBACK_QUERY_CONCURRENCY
  ) {
    const rowsByChunk = await Promise.all(
      chunks
        .slice(offset, offset + FALLBACK_QUERY_CONCURRENCY)
        .map(async (chunk) => {
          const ranked = db
            .select({
              x_id: videos.creator_x_user_id,
              icon_url: videos.creator_icon_url,
              display_name: videos.creator_display_name,
              collaboration_type: videos.collaboration_type,
              icon_rank:
                sql<number>`ROW_NUMBER() OVER (
                  PARTITION BY ${videos.creator_x_user_id}, ${videos.collaboration_type}
                  ORDER BY
                    CASE WHEN ${videos.creator_icon_url} IS NULL THEN 1 ELSE 0 END,
                    ${videos.created_at} DESC
                )`.as("icon_rank"),
              name_rank:
                sql<number>`ROW_NUMBER() OVER (
                  PARTITION BY ${videos.creator_x_user_id}, ${videos.collaboration_type}
                  ORDER BY
                    CASE WHEN ${videos.creator_display_name} IS NULL THEN 1 ELSE 0 END,
                    ${videos.created_at} DESC
                )`.as("name_rank"),
            })
            .from(videos)
            .where(
              and(
                inArray(videos.creator_x_user_id, chunk),
                or(
                  isNotNull(videos.creator_icon_url),
                  isNotNull(videos.creator_display_name),
                ),
                sql`${videos.visibility_status} NOT IN ('archived', 'voided')`,
              )!,
            )
            .as("ranked_creator_snapshots");

          return db
            .select({
              x_id: ranked.x_id,
              icon_url: ranked.icon_url,
              display_name: ranked.display_name,
              collaboration_type: ranked.collaboration_type,
              icon_rank: ranked.icon_rank,
              name_rank: ranked.name_rank,
            })
            .from(ranked)
            .where(or(eq(ranked.icon_rank, 1), eq(ranked.name_rank, 1))!);
        }),
    );
    for (const rows of rowsByChunk) output.push(...rows);
  }
  return output;
}

function snapshotMaps(rows: SnapshotRow[]): {
  individualIcons: Map<string, string>;
  collabIcons: Map<string, string>;
  individualNames: Map<string, string>;
  collabNames: Map<string, string>;
} {
  const individualIcons = new Map<string, string>();
  const collabIcons = new Map<string, string>();
  const individualNames = new Map<string, string>();
  const collabNames = new Map<string, string>();

  for (const row of rows) {
    if (!row.x_id) continue;
    const iconMap =
      row.collaboration_type === "individual"
        ? individualIcons
        : collabIcons;
    const nameMap =
      row.collaboration_type === "individual"
        ? individualNames
        : collabNames;
    if (row.icon_rank === 1 && row.icon_url) {
      iconMap.set(row.x_id, row.icon_url);
    }
    if (row.name_rank === 1 && row.display_name) {
      nameMap.set(row.x_id, row.display_name);
    }
  }
  return { individualIcons, collabIcons, individualNames, collabNames };
}

/**
 * 単一 X ID のアイコンを解決する。
 *
 * 優先順位:
 *   1. x_users.icon_url
 *   2. 同 X ID の非削除・非 voided な作品の videos.creator_icon_url
 *      (個人作 → 合作、新しい順)
 *   3. null
 */
export async function resolveXUserIcon(
  db: DB,
  xId: string,
): Promise<string | null> {
  if (!xId) return null;
  const xRow = (
    await db
      .select({ icon_url: xUsers.icon_url })
      .from(xUsers)
      .where(eq(xUsers.id, xId))
      .limit(1)
  )[0];
  if (xRow?.icon_url) return xRow.icon_url;

  const rows = await fetchLatestCreatorSnapshots(db, [xId]);
  const maps = snapshotMaps(rows);
  return maps.individualIcons.get(xId) ?? maps.collabIcons.get(xId) ?? null;
}

/**
 * 合作メンバー行の `icon_url` を解決する。
 * 入力順・入力オブジェクト・優先順位は従来どおり維持する。
 */
export async function resolveMemberIcons<
  T extends { x_user_id: string | null; icon_url: string | null },
>(db: DB, members: T[]): Promise<T[]> {
  const xIds = Array.from(
    new Set(
      members
        .filter((member) => !member.icon_url)
        .map((member) => member.x_user_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  if (xIds.length === 0) return members;

  const maps = snapshotMaps(await fetchLatestCreatorSnapshots(db, xIds));
  return members.map((member) => {
    if (member.icon_url || !member.x_user_id) return member;
    const icon =
      maps.individualIcons.get(member.x_user_id) ??
      maps.collabIcons.get(member.x_user_id);
    return icon ? { ...member, icon_url: icon } : member;
  });
}

/** 投稿フォームと設定画面で使う X ID のアイコン候補リスト。 */
export async function getXIconCandidates(
  db: DB,
  xId: string,
  limit = 24,
): Promise<string[]> {
  if (!xId || limit <= 0) return [];
  const candidates: string[] = [];
  const seen = new Set<string>();

  const xRow = (
    await db
      .select({ icon_url: xUsers.icon_url })
      .from(xUsers)
      .where(eq(xUsers.id, xId))
      .limit(1)
  )[0];
  if (xRow?.icon_url) {
    candidates.push(xRow.icon_url);
    seen.add(xRow.icon_url);
    if (candidates.length >= limit) return candidates;
  }

  const iconRows = await db
    .select({ icon_url: xUserIcons.icon_url })
    .from(xUserIcons)
    .where(eq(xUserIcons.x_user_id, xId))
    .orderBy(desc(xUserIcons.created_at))
    .limit(limit * 2);
  for (const row of iconRows) {
    if (row.icon_url && !seen.has(row.icon_url)) {
      candidates.push(row.icon_url);
      seen.add(row.icon_url);
      if (candidates.length >= limit) return candidates;
    }
  }

  const videoRows = await db
    .select({ icon_url: videos.creator_icon_url })
    .from(videos)
    .where(
      and(
        eq(videos.creator_x_user_id, xId),
        isNotNull(videos.creator_icon_url),
      )!,
    )
    .orderBy(desc(videos.created_at))
    .limit(limit * 2);
  for (const row of videoRows) {
    if (row.icon_url && !seen.has(row.icon_url)) {
      candidates.push(row.icon_url);
      seen.add(row.icon_url);
      if (candidates.length >= limit) return candidates;
    }
  }

  return candidates;
}

/**
 * 合作メンバーの表示名を解決する。
 * 実装上の従来優先順位を維持する:
 * x_users.x_name → 個人作名 → 合作名 → 登録名 → X ID。
 */
export async function resolveMemberNames<
  T extends {
    x_user_id: string | null;
    name: string | null;
    x_name: string | null;
  },
>(db: DB, members: T[]): Promise<T[]> {
  const xIds = Array.from(
    new Set(
      members
        .filter((member) => !member.x_name)
        .map((member) => member.x_user_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  if (xIds.length === 0) return members;

  const maps = snapshotMaps(await fetchLatestCreatorSnapshots(db, xIds));
  return members.map((member) => {
    if (member.x_name || !member.x_user_id) return member;
    const resolved =
      maps.individualNames.get(member.x_user_id) ??
      maps.collabNames.get(member.x_user_id);
    if (resolved) return { ...member, x_name: resolved };
    if (member.name) return { ...member, x_name: member.name };
    return { ...member, x_name: member.x_user_id };
  });
}
