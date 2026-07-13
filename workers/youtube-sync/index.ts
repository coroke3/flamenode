/**
 * sync-jobs から利用する YouTube メタデータ同期モジュール。
 * Worker entry point は持たず、Cron 統合 Worker だけが実行する。
 */

import {
  fetchYoutubeJsonWithFailover,
  recordConfiguredYoutubeApiKeys,
  resolveYoutubeApiKeys,
  type FetchLike,
  type YoutubeApiKeyEnv,
} from "./apiKeyFailover.ts";

export interface Env extends YoutubeApiKeyEnv {
  DB: D1Database;
}

export interface SyncBatchResult {
  processed: number;
  failed: number;
  skipped: number;
}

type SyncRow = { id: string; youtube_video_id: string };
type YoutubeItem = {
  id: string;
  statistics?: { viewCount?: string };
  status?: { privacyStatus?: string };
  contentDetails?: { duration?: string };
};

type MetadataWrite = {
  videoId: string;
  youtubeVideoId: string;
  privacyStatus: string | null;
  availabilityStatus: string | null;
  durationSeconds: number;
  viewCount: number;
  syncStatus: "synced" | "failed";
  syncError: string | null;
};

export const YOUTUBE_SYNC_BATCH_SIZE = 50;

const ACTIVE_SYNC_INTERVAL_SEC = 60 * 60;
const DEFAULT_SYNC_INTERVAL_SEC = 24 * 60 * 60;
const ACTIVE_EVENT_GRACE_SEC = 24 * 60 * 60;
const BULK_UPSERT_ROWS = 8;

function appendUniqueRows(target: Map<string, SyncRow>, rows: readonly SyncRow[]): void {
  for (const row of rows) {
    if (!row.youtube_video_id || target.has(row.id)) continue;
    target.set(row.id, row);
  }
}

async function querySyncRows(
  env: Env,
  sql: string,
  bindings: readonly (string | number | null)[],
): Promise<SyncRow[]> {
  const result = await env.DB.prepare(sql)
    .bind(...bindings)
    .all<SyncRow>();
  return result.results ?? [];
}

/**
 * 未同期・開催中・通常期限を別queryに分け、既存indexを利用する。
 * OR条件を含む単一queryでvideos全体を走査せず、最大3 query・50件に固定する。
 */
async function selectSyncRows(env: Env, now: number): Promise<SyncRow[]> {
  const selected = new Map<string, SyncRow>();

  appendUniqueRows(
    selected,
    await querySyncRows(
      env,
      `SELECT v.id, v.youtube_video_id
         FROM video_youtube_metadata ym
         INNER JOIN videos v ON v.id = ym.video_id
        WHERE ym.sync_status = 'pending'
          AND v.youtube_video_id IS NOT NULL
          AND v.youtube_video_id <> ''
          AND v.visibility_status NOT IN ('archived', 'voided')
        ORDER BY COALESCE(ym.synced_at, 0) ASC, v.id ASC
        LIMIT ?1`,
      [YOUTUBE_SYNC_BATCH_SIZE],
    ),
  );

  let remaining = YOUTUBE_SYNC_BATCH_SIZE - selected.size;
  if (remaining > 0) {
    appendUniqueRows(
      selected,
      await querySyncRows(
        env,
        `SELECT v.id, v.youtube_video_id
           FROM events e
           INNER JOIN videos v ON v.primary_event_id = e.id
           INNER JOIN video_youtube_metadata ym ON ym.video_id = v.id
          WHERE e.visibility_status = 'public'
            AND (e.start_time IS NOT NULL OR e.end_time IS NOT NULL)
            AND (e.start_time IS NULL OR e.start_time <= ?1 + ?3)
            AND (e.end_time IS NULL OR e.end_time >= ?1 - ?3)
            AND v.youtube_video_id IS NOT NULL
            AND v.youtube_video_id <> ''
            AND v.visibility_status NOT IN ('archived', 'voided')
            AND ym.sync_status IN ('synced', 'failed')
            AND ym.youtube_video_id IS v.youtube_video_id
            AND ym.synced_at IS NOT NULL
            AND ym.synced_at <= ?1 - ?2
          ORDER BY ym.synced_at ASC, v.id ASC
          LIMIT ?4`,
        [now, ACTIVE_SYNC_INTERVAL_SEC, ACTIVE_EVENT_GRACE_SEC, remaining],
      ),
    );
  }

  remaining = YOUTUBE_SYNC_BATCH_SIZE - selected.size;
  if (remaining > 0) {
    appendUniqueRows(
      selected,
      await querySyncRows(
        env,
        `SELECT v.id, v.youtube_video_id
           FROM video_youtube_metadata ym
           INNER JOIN videos v ON v.id = ym.video_id
          WHERE ym.sync_status IN ('synced', 'failed')
            AND ym.synced_at IS NOT NULL
            AND ym.synced_at <= ?1 - ?2
            AND ym.youtube_video_id IS v.youtube_video_id
            AND v.youtube_video_id IS NOT NULL
            AND v.youtube_video_id <> ''
            AND v.visibility_status NOT IN ('archived', 'voided')
          ORDER BY ym.synced_at ASC, v.id ASC
          LIMIT ?3`,
        [now, DEFAULT_SYNC_INTERVAL_SEC, remaining],
      ),
    );
  }

  return [...selected.values()];
}

function buildMetadataWrites(rows: SyncRow[], items: Map<string, YoutubeItem>): MetadataWrite[] {
  return rows.map((row) => {
    const item = items.get(row.youtube_video_id);
    if (!item) {
      return {
        videoId: row.id,
        youtubeVideoId: row.youtube_video_id,
        privacyStatus: null,
        availabilityStatus: null,
        durationSeconds: 0,
        viewCount: 0,
        syncStatus: "failed" as const,
        syncError: "permanent:youtube_video_missing_or_private",
      };
    }
    return {
      videoId: row.id,
      youtubeVideoId: row.youtube_video_id,
      privacyStatus: item.status?.privacyStatus ?? null,
      availabilityStatus: item.status?.privacyStatus ?? null,
      durationSeconds: parseDuration(item.contentDetails?.duration ?? ""),
      viewCount: Number(item.statistics?.viewCount ?? 0),
      syncStatus: "synced" as const,
      syncError: null,
    };
  });
}

async function persistMetadataBatch(env: Env, writes: MetadataWrite[], now: number): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < writes.length; offset += BULK_UPSERT_ROWS) {
    const chunk = writes.slice(offset, offset + BULK_UPSERT_ROWS);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const values = chunk.flatMap((row) => [
      row.videoId,
      row.youtubeVideoId,
      row.privacyStatus,
      row.availabilityStatus,
      row.durationSeconds,
      row.viewCount,
      now,
      row.syncStatus,
      row.syncError,
      now,
    ]);
    statements.push(
      env.DB.prepare(
        `INSERT INTO video_youtube_metadata (
           video_id, youtube_video_id, youtube_privacy_status,
           youtube_availability_status, duration_seconds, view_count,
           synced_at, sync_status, sync_error, updated_at
         ) VALUES ${placeholders}
         ON CONFLICT(video_id) DO UPDATE SET
           youtube_video_id = excluded.youtube_video_id,
           youtube_privacy_status = CASE WHEN excluded.sync_status = 'synced'
             THEN excluded.youtube_privacy_status ELSE video_youtube_metadata.youtube_privacy_status END,
           youtube_availability_status = CASE WHEN excluded.sync_status = 'synced'
             THEN excluded.youtube_availability_status ELSE video_youtube_metadata.youtube_availability_status END,
           duration_seconds = CASE WHEN excluded.sync_status = 'synced'
             THEN excluded.duration_seconds ELSE video_youtube_metadata.duration_seconds END,
           view_count = CASE WHEN excluded.sync_status = 'synced'
             THEN excluded.view_count ELSE video_youtube_metadata.view_count END,
           synced_at = excluded.synced_at,
           sync_status = excluded.sync_status,
           sync_error = excluded.sync_error,
           updated_at = excluded.updated_at`,
      ).bind(...values),
    );
  }
  if (statements.length > 0) await env.DB.batch(statements);
}

export async function syncBatch(
  env: Env,
  fetchImpl: FetchLike = fetch,
): Promise<SyncBatchResult> {
  const apiKeys = resolveYoutubeApiKeys(env);
  if (apiKeys.length === 0) return { processed: 0, failed: 0, skipped: 1 };

  const now = Math.floor(Date.now() / 1000);
  const rows = await selectSyncRows(env, now);
  if (rows.length === 0) {
    await recordConfiguredYoutubeApiKeys(env, apiKeys, now);
    return { processed: 0, failed: 0, skipped: 1 };
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "statistics,status,contentDetails");
  url.searchParams.set("id", rows.map((row) => row.youtube_video_id).join(","));
  const data = await fetchYoutubeJsonWithFailover<{ items?: YoutubeItem[] }>(
    env,
    url,
    apiKeys,
    fetchImpl,
    now,
  );
  const writes = buildMetadataWrites(
    rows,
    new Map((data.items ?? []).map((item) => [item.id, item])),
  );
  await persistMetadataBatch(env, writes, now);
  return { processed: writes.length, failed: 0, skipped: 0 };
}

export function parseDuration(iso: string): number {
  if (!iso) return 0;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  return Number.parseInt(match[1] ?? "0", 10) * 3600
    + Number.parseInt(match[2] ?? "0", 10) * 60
    + Number.parseInt(match[3] ?? "0", 10);
}
