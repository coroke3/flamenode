import { PUBLIC_LISTABLE_X_APPROVAL_SQL_IN } from "../utils/publicXUser.ts";
import {
  isPickupCreatorEligible,
  sortPickupCreators,
} from "../utils/pickupCreators.ts";
import { COUNTABLE_PUBLIC_VIDEO_SQL } from "./countablePublicVideoSql.ts";

/**
 * Phase 0 メモ:
 * - rebuildUsersIndex: x_users 行ごとに表示名・アイコン×2・personal/collab/total/updated_at の相関サブクエリ
 * - rebuildTop / rebuildRecommend: x_users 行ごとに personal/collab の相関 COUNT
 * いずれも O(作者数×作品走査) になりやすい。本モジュールは一括 GROUP BY + ROW_NUMBER で置換する。
 */

export interface PublicCreatorRegisteredUser {
  id: string;
  x_name: string | null;
  icon_url: string | null;
  profile_text: string | null;
  youtube_channel_url: string | null;
}

export interface PublicCreatorOrphanRow {
  x_id: string;
  personal_count: number;
  updated_at: number;
}

export interface PublicCreatorProjectionSources {
  registeredUsers: PublicCreatorRegisteredUser[];
  orphans: PublicCreatorOrphanRow[];
  personalCounts: Map<string, number>;
  collabCounts: Map<string, number>;
  totalWorks: Map<string, number>;
  updatedAts: Map<string, number>;
  displayNames: Map<string, string>;
  iconUrls: Map<string, string>;
}

export interface PublicUsersIndexItem {
  x_id: string;
  x_name: string;
  icon_url: string | null;
  profile_text: string | null;
  youtube_channel_url: string | null;
  personal_count: number;
  collab_count: number;
  total_works: number;
  sort_score: number;
  updated_at: number;
}

export interface PublicPickupCreatorRow {
  id: string;
  x_name: string;
  icon_url: string | null;
  video_count: number;
  collab_count: number;
}

type D1Queryable = Pick<D1Database, "prepare">;

function normalizeCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function trimNullable(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function trimString(value: unknown): string {
  return String(value ?? "").trim();
}

function mapCountRows(
  rows: Array<Record<string, unknown>> | undefined,
  keyField: string,
  valueField: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows ?? []) {
    const key = trimString(row[keyField]);
    if (!key) continue;
    map.set(key, normalizeCount(row[valueField]));
  }
  return map;
}

function mapStringRows(
  rows: Array<Record<string, unknown>> | undefined,
  keyField: string,
  valueField: string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows ?? []) {
    const key = trimString(row[keyField]);
    const value = trimNullable(row[valueField]);
    if (!key || !value) continue;
    map.set(key, value);
  }
  return map;
}

function resolveRegisteredDisplayName(
  user: PublicCreatorRegisteredUser,
  sources: PublicCreatorProjectionSources,
): string {
  return (
    trimNullable(user.x_name) ??
    sources.displayNames.get(user.id) ??
    user.id
  );
}

function resolveRegisteredIcon(
  user: PublicCreatorRegisteredUser,
  sources: PublicCreatorProjectionSources,
): string | null {
  return trimNullable(user.icon_url) ?? sources.iconUrls.get(user.id) ?? null;
}

export async function loadPublicCreatorProjectionSources(
  db: D1Queryable,
  now: number,
): Promise<PublicCreatorProjectionSources> {
  const [
    registeredUsers,
    personalCounts,
    collabCounts,
    totalWorks,
    updatedAts,
    displayNames,
    iconUrls,
    orphans,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT id, x_name, icon_url, profile_text, youtube_channel_url
         FROM x_users
         WHERE approval_status IN (${PUBLIC_LISTABLE_X_APPROVAL_SQL_IN})`,
      )
      .all<PublicCreatorRegisteredUser>(),
    db
      .prepare(
        `SELECT v.creator_x_user_id AS x_id, COUNT(DISTINCT v.id) AS personal_count
         FROM videos AS v
         WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         GROUP BY v.creator_x_user_id`,
      )
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT vm.x_user_id AS x_id, COUNT(DISTINCT vm.video_id) AS collab_count
         FROM video_members AS vm
         INNER JOIN videos AS v ON v.id = vm.video_id
         WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         GROUP BY vm.x_user_id`,
      )
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT x_id, COUNT(DISTINCT video_id) AS total_works
         FROM (
           SELECT v.creator_x_user_id AS x_id, v.id AS video_id
           FROM videos AS v
           WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
           UNION
           SELECT vm.x_user_id AS x_id, vm.video_id AS video_id
           FROM video_members AS vm
           INNER JOIN videos AS v ON v.id = vm.video_id
           WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         )
         GROUP BY x_id`,
      )
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT x_id, MAX(updated_at) AS updated_at
         FROM (
           SELECT v.creator_x_user_id AS x_id, v.updated_at
           FROM videos AS v
           WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
           UNION ALL
           SELECT vm.x_user_id AS x_id, v.updated_at
           FROM video_members AS vm
           INNER JOIN videos AS v ON v.id = vm.video_id
           WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         )
         GROUP BY x_id`,
      )
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT x_id, x_name
         FROM (
           SELECT
             v.creator_x_user_id AS x_id,
             v.creator_display_name AS x_name,
             ROW_NUMBER() OVER (
               PARTITION BY v.creator_x_user_id
               ORDER BY v.scheduled_time DESC, v.created_at DESC
             ) AS row_num
           FROM videos AS v
           WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
             AND v.creator_display_name IS NOT NULL
         )
         WHERE row_num = 1`,
      )
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT x_id, icon_url
         FROM (
           SELECT
             v.creator_x_user_id AS x_id,
             v.creator_icon_url AS icon_url,
             ROW_NUMBER() OVER (
               PARTITION BY v.creator_x_user_id
               ORDER BY CASE WHEN v.collaboration_type = 'individual' THEN 0 ELSE 1 END,
                        v.scheduled_time DESC,
                        v.created_at DESC
             ) AS row_num
           FROM videos AS v
           WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
             AND v.creator_icon_url IS NOT NULL
         )
         WHERE row_num = 1`,
      )
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT
           v.creator_x_user_id AS x_id,
           COUNT(DISTINCT v.id) AS personal_count,
           MAX(v.updated_at) AS updated_at
         FROM videos AS v
         LEFT JOIN x_users AS xu ON xu.id = v.creator_x_user_id
         WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
           AND v.creator_x_user_id <> 'anonymous'
           AND xu.id IS NULL
         GROUP BY v.creator_x_user_id`,
      )
      .all<Record<string, unknown>>(),
  ]);

  return {
    registeredUsers: registeredUsers.results ?? [],
    orphans: (orphans.results ?? []).map((row) => ({
      x_id: trimString(row.x_id),
      personal_count: normalizeCount(row.personal_count),
      updated_at: normalizeCount(row.updated_at) || now,
    })),
    personalCounts: mapCountRows(personalCounts.results, "x_id", "personal_count"),
    collabCounts: mapCountRows(collabCounts.results, "x_id", "collab_count"),
    totalWorks: mapCountRows(totalWorks.results, "x_id", "total_works"),
    updatedAts: mapCountRows(updatedAts.results, "x_id", "updated_at"),
    displayNames: mapStringRows(displayNames.results, "x_id", "x_name"),
    iconUrls: mapStringRows(iconUrls.results, "x_id", "icon_url"),
  };
}

export function buildPublicUsersIndexItems(
  sources: PublicCreatorProjectionSources,
  now: number,
): PublicUsersIndexItem[] {
  const items: PublicUsersIndexItem[] = [];

  for (const user of sources.registeredUsers) {
    const xId = trimString(user.id);
    if (!xId) continue;

    const personalCount = sources.personalCounts.get(xId) ?? 0;
    const collabCount = sources.collabCounts.get(xId) ?? 0;
    const totalWorks = sources.totalWorks.get(xId) ?? 0;
    const profileText = trimNullable(user.profile_text);
    const youtubeChannelUrl = trimNullable(user.youtube_channel_url);
    if (totalWorks <= 0 && !profileText && !youtubeChannelUrl) continue;

    const xName = resolveRegisteredDisplayName(user, sources);
    if (!xName) continue;

    items.push({
      x_id: xId,
      x_name: xName,
      icon_url: resolveRegisteredIcon(user, sources),
      profile_text: profileText,
      youtube_channel_url: youtubeChannelUrl,
      personal_count: personalCount,
      collab_count: collabCount,
      total_works: totalWorks,
      sort_score: totalWorks * 2 + personalCount,
      updated_at: sources.updatedAts.get(xId) ?? now,
    });
  }

  for (const orphan of sources.orphans) {
    const xId = trimString(orphan.x_id);
    if (!xId) continue;

    const personalCount = orphan.personal_count;
    const totalWorks = personalCount;
    if (totalWorks <= 0) continue;

    const xName = sources.displayNames.get(xId) ?? xId;
    items.push({
      x_id: xId,
      x_name: xName,
      icon_url: sources.iconUrls.get(xId) ?? null,
      profile_text: null,
      youtube_channel_url: null,
      personal_count: personalCount,
      collab_count: 0,
      total_works: totalWorks,
      sort_score: totalWorks * 2 + personalCount,
      updated_at: orphan.updated_at || now,
    });
  }

  return items
    .filter((row) => row.x_id && row.x_name)
    .sort(
      (a, b) =>
        b.sort_score - a.sort_score ||
        a.x_name.localeCompare(b.x_name, "ja"),
    );
}

export function buildPickupCreatorsFromProjection(
  sources: PublicCreatorProjectionSources,
  limit: number,
): PublicPickupCreatorRow[] {
  const rows: PublicPickupCreatorRow[] = [];
  for (const user of sources.registeredUsers) {
    const id = trimString(user.id);
    if (!id) continue;
    const video_count = sources.personalCounts.get(id) ?? 0;
    const collab_count = sources.collabCounts.get(id) ?? 0;
    if (!isPickupCreatorEligible({ video_count, collab_count })) continue;
    rows.push({
      id,
      x_name: trimNullable(user.x_name) ?? id,
      icon_url: trimNullable(user.icon_url),
      video_count,
      collab_count,
    });
  }
  return sortPickupCreators(rows).slice(0, Math.max(0, limit));
}

export const USERS_INDEX_OBJECT_KEY = "users/index.json";
export const USERS_INDEX_MAX_OBJECT_BYTES = 8 * 1024 * 1024;
