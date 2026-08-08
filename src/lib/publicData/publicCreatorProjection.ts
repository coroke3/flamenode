import { PUBLIC_LISTABLE_X_APPROVAL_SQL_IN } from "../utils/publicXUser.ts";
import {
  isPickupCreatorEligible,
  sortPickupCreators,
} from "../utils/pickupCreators.ts";
import { COUNTABLE_PUBLIC_VIDEO_SQL } from "./countablePublicVideoSql.ts";

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

type CreatorAggregateRow = Record<string, unknown> & {
  x_id?: unknown;
  personal_count?: unknown;
  collab_count?: unknown;
  total_works?: unknown;
  updated_at?: unknown;
  personal_updated_at?: unknown;
  x_user_exists?: unknown;
};

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
  return trimNullable(user.x_name) ?? sources.displayNames.get(user.id) ?? user.id;
}

function resolveRegisteredIcon(
  user: PublicCreatorRegisteredUser,
  sources: PublicCreatorProjectionSources,
): string | null {
  return trimNullable(user.icon_url) ?? sources.iconUrls.get(user.id) ?? null;
}

/**
 * 公開クリエイター projection のD1入力を3 set-level queryで構築する。
 *
 * 1. 公開対象 x_users
 * 2. personal/collab/total/updated_at と x_users 存在判定を1集計
 * 3. 動画snapshot由来の表示名/icon fallbackを1 window query
 *
 * orphan は従来どおり「x_users自体に存在しない primary creator」のみを対象にし、
 * collab参加は orphan の件数・updated_at に加えない。
 */
export async function loadPublicCreatorProjectionSources(
  db: D1Queryable,
  now: number,
): Promise<PublicCreatorProjectionSources> {
  const [registeredUsersResult, aggregateResult, profileFallbackResult] = await Promise.all([
    db
      .prepare(
        `SELECT id, x_name, icon_url, profile_text, youtube_channel_url
         FROM x_users
         WHERE approval_status IN (${PUBLIC_LISTABLE_X_APPROVAL_SQL_IN})`,
      )
      .all<PublicCreatorRegisteredUser>(),
    db
      .prepare(
        `WITH creator_video_relations AS (
           SELECT
             v.creator_x_user_id AS x_id,
             v.id AS video_id,
             1 AS is_personal,
             0 AS is_collab,
             v.updated_at AS updated_at,
             v.updated_at AS personal_updated_at
           FROM videos AS v
           WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}

           UNION ALL

           SELECT
             vm.x_user_id AS x_id,
             vm.video_id AS video_id,
             0 AS is_personal,
             1 AS is_collab,
             v.updated_at AS updated_at,
             NULL AS personal_updated_at
           FROM video_members AS vm
           INNER JOIN videos AS v ON v.id = vm.video_id
           WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         ), creator_aggregates AS (
           SELECT
             x_id,
             COUNT(DISTINCT CASE WHEN is_personal = 1 THEN video_id END) AS personal_count,
             COUNT(DISTINCT CASE WHEN is_collab = 1 THEN video_id END) AS collab_count,
             COUNT(DISTINCT video_id) AS total_works,
             MAX(updated_at) AS updated_at,
             MAX(personal_updated_at) AS personal_updated_at
           FROM creator_video_relations
           WHERE COALESCE(x_id, '') <> ''
           GROUP BY x_id
         )
         SELECT
           ca.x_id,
           ca.personal_count,
           ca.collab_count,
           ca.total_works,
           ca.updated_at,
           ca.personal_updated_at,
           CASE WHEN xu.id IS NULL THEN 0 ELSE 1 END AS x_user_exists
         FROM creator_aggregates AS ca
         LEFT JOIN x_users AS xu ON xu.id = ca.x_id`,
      )
      .all<CreatorAggregateRow>(),
    db
      .prepare(
        `WITH ranked AS (
           SELECT
             v.creator_x_user_id AS x_id,
             v.creator_display_name AS x_name,
             v.creator_icon_url AS icon_url,
             ROW_NUMBER() OVER (
               PARTITION BY v.creator_x_user_id
               ORDER BY
                 CASE WHEN v.creator_display_name IS NULL THEN 1 ELSE 0 END,
                 v.scheduled_time DESC,
                 v.created_at DESC
             ) AS display_rank,
             ROW_NUMBER() OVER (
               PARTITION BY v.creator_x_user_id
               ORDER BY
                 CASE WHEN v.creator_icon_url IS NULL THEN 1 ELSE 0 END,
                 CASE WHEN v.collaboration_type = 'individual' THEN 0 ELSE 1 END,
                 v.scheduled_time DESC,
                 v.created_at DESC,
                 v.id DESC
             ) AS icon_rank
           FROM videos AS v
           WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         )
         SELECT
           x_id,
           MAX(CASE WHEN display_rank = 1 THEN x_name END) AS x_name,
           MAX(CASE WHEN icon_rank = 1 THEN icon_url END) AS icon_url
         FROM ranked
         GROUP BY x_id`,
      )
      .all<Record<string, unknown>>(),
  ]);

  const personalCounts = new Map<string, number>();
  const collabCounts = new Map<string, number>();
  const totalWorks = new Map<string, number>();
  const updatedAts = new Map<string, number>();
  const orphans: PublicCreatorOrphanRow[] = [];

  for (const row of aggregateResult.results ?? []) {
    const xId = trimString(row.x_id);
    if (!xId) continue;
    const personalCount = normalizeCount(row.personal_count);
    const collabCount = normalizeCount(row.collab_count);
    const totalWorkCount = normalizeCount(row.total_works);
    const updatedAt = normalizeCount(row.updated_at);
    personalCounts.set(xId, personalCount);
    collabCounts.set(xId, collabCount);
    totalWorks.set(xId, totalWorkCount);
    updatedAts.set(xId, updatedAt);

    if (
      xId !== "anonymous" &&
      normalizeCount(row.x_user_exists) === 0 &&
      personalCount > 0
    ) {
      orphans.push({
        x_id: xId,
        personal_count: personalCount,
        updated_at: normalizeCount(row.personal_updated_at) || now,
      });
    }
  }

  return {
    registeredUsers: registeredUsersResult.results ?? [],
    orphans,
    personalCounts,
    collabCounts,
    totalWorks,
    updatedAts,
    displayNames: mapStringRows(profileFallbackResult.results, "x_id", "x_name"),
    iconUrls: mapStringRows(profileFallbackResult.results, "x_id", "icon_url"),
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
        b.sort_score - a.sort_score || a.x_name.localeCompare(b.x_name, "ja"),
    );
}

export const PICKUP_CREATORS_OBJECT_KEY = "users/pickup-creators.v1.json";
export const PICKUP_CREATORS_SCHEMA_VERSION = 1 as const;
/** recommend の上限。top は先頭 30 件を slice する。 */
export const PICKUP_CREATORS_STORE_LIMIT = 60;
export const PICKUP_CREATORS_MAX_OBJECT_BYTES = 1024 * 1024;

export interface PickupCreatorsArtifact {
  schema_version: 1;
  generated_at: number;
  creators: PublicPickupCreatorRow[];
}

function normalizePickupCreatorRow(value: unknown): PublicPickupCreatorRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = trimString(row.id);
  if (!id) return null;
  const x_name = trimNullable(row.x_name) ?? id;
  if (!x_name) return null;
  return {
    id,
    x_name,
    icon_url: trimNullable(row.icon_url),
    video_count: normalizeCount(row.video_count),
    collab_count: normalizeCount(row.collab_count),
  };
}

export function buildPickupCreatorsArtifactFromProjection(
  sources: PublicCreatorProjectionSources,
  generatedAt: number,
): PickupCreatorsArtifact {
  return {
    schema_version: PICKUP_CREATORS_SCHEMA_VERSION,
    generated_at: generatedAt,
    creators: buildPickupCreatorsFromProjection(sources, PICKUP_CREATORS_STORE_LIMIT),
  };
}

export function normalizePickupCreatorsArtifact(
  value: unknown,
): PickupCreatorsArtifact | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as {
    schema_version?: unknown;
    generated_at?: unknown;
    creators?: unknown;
  };
  if (Number(payload.schema_version) !== PICKUP_CREATORS_SCHEMA_VERSION) return null;
  if (!Array.isArray(payload.creators)) return null;

  const creators: PublicPickupCreatorRow[] = [];
  for (const raw of payload.creators) {
    const row = normalizePickupCreatorRow(raw);
    if (!row) return null;
    creators.push(row);
  }

  const generated = Number(payload.generated_at);
  return {
    schema_version: PICKUP_CREATORS_SCHEMA_VERSION,
    generated_at: Number.isFinite(generated) ? Math.floor(generated) : 0,
    creators,
  };
}

export function pickupCreatorsArtifactByteLength(
  payload: PickupCreatorsArtifact,
): number {
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
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
