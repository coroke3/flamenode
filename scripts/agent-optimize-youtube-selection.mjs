#!/usr/bin/env node
import fs from "node:fs";

const path = "workers/youtube-sync/index.ts";
let source = fs.readFileSync(path, "utf8");

const before = `/**
 * 未同期を最優先、開催中イベントを次点、その後は最終同期が古い順に取得する。
 * SQLのLIMITとindexで全件走査を避け、件数が増えても1実行を固定する。
 */
async function selectSyncRows(env: Env, now: number): Promise<SyncRow[]> {
  const result = await env.DB.prepare(
    \`SELECT v.id,
            v.youtube_video_id,
            ym.synced_at,
            CASE
              WHEN e.id IS NOT NULL
               AND e.visibility_status = 'public'
               AND e.start_time IS NOT NULL
               AND e.start_time <= ?1
               AND (e.end_time IS NULL OR e.end_time >= ?1)
              THEN 1 ELSE 0
            END AS active_event
       FROM videos v
       LEFT JOIN video_youtube_metadata ym ON ym.video_id = v.id
       LEFT JOIN events e ON e.id = v.primary_event_id
      WHERE v.youtube_video_id IS NOT NULL
        AND v.youtube_video_id <> ''
        AND v.visibility_status NOT IN ('archived', 'voided')
        AND (
          ym.video_id IS NULL
          OR ym.synced_at IS NULL
          OR ym.youtube_video_id IS NOT v.youtube_video_id
          OR (
            e.id IS NOT NULL
            AND e.visibility_status = 'public'
            AND e.start_time IS NOT NULL
            AND e.start_time <= ?1
            AND (e.end_time IS NULL OR e.end_time >= ?1)
            AND ym.synced_at <= ?1 - ?2
          )
          OR ym.synced_at <= ?1 - ?3
        )
      ORDER BY
        CASE WHEN ym.video_id IS NULL OR ym.synced_at IS NULL THEN 0 ELSE 1 END,
        active_event DESC,
        COALESCE(ym.synced_at, 0) ASC,
        v.id ASC
      LIMIT ?4\`,
  )
    .bind(
      now,
      ACTIVE_EVENT_SYNC_INTERVAL_SEC,
      NORMAL_SYNC_INTERVAL_SEC,
      YOUTUBE_SYNC_BATCH_SIZE,
    )
    .all<SyncRow>();
  return (result.results ?? []).filter((row) => Boolean(row.youtube_video_id));
}`;

const after = `function appendUniqueRows(
  target: Map<string, SyncRow>,
  rows: readonly SyncRow[],
): void {
  for (const row of rows) {
    if (!row.youtube_video_id || target.has(row.id)) continue;
    target.set(row.id, row);
  }
}

async function querySyncRows(
  env: Env,
  sql: string,
  bindings: readonly unknown[],
): Promise<SyncRow[]> {
  const result = await env.DB.prepare(sql)
    .bind(...bindings)
    .all<SyncRow>();
  return result.results ?? [];
}

/**
 * metadataのsync index、開催中event index、synced_at indexを順番に利用する。
 * OR条件を含む単一queryでvideos全体を走査せず、最大3 query・50件に固定する。
 */
async function selectSyncRows(env: Env, now: number): Promise<SyncRow[]> {
  const selected = new Map<string, SyncRow>();

  appendUniqueRows(
    selected,
    await querySyncRows(
      env,
      \`SELECT v.id,
              v.youtube_video_id,
              ym.synced_at,
              CASE
                WHEN e.id IS NOT NULL
                 AND e.visibility_status = 'public'
                 AND e.start_time IS NOT NULL
                 AND e.start_time <= ?1
                 AND (e.end_time IS NULL OR e.end_time >= ?1)
                THEN 1 ELSE 0
              END AS active_event
         FROM video_youtube_metadata ym
         INNER JOIN videos v ON v.id = ym.video_id
         LEFT JOIN events e ON e.id = v.primary_event_id
        WHERE ym.sync_status = 'pending'
          AND v.youtube_video_id IS NOT NULL
          AND v.youtube_video_id <> ''
          AND v.visibility_status NOT IN ('archived', 'voided')
        ORDER BY COALESCE(ym.synced_at, 0) ASC, v.id ASC
        LIMIT ?2\`,
      [now, YOUTUBE_SYNC_BATCH_SIZE],
    ),
  );

  let remaining = YOUTUBE_SYNC_BATCH_SIZE - selected.size;
  if (remaining > 0) {
    appendUniqueRows(
      selected,
      await querySyncRows(
        env,
        \`SELECT v.id,
                v.youtube_video_id,
                ym.synced_at,
                1 AS active_event
           FROM events e
           INNER JOIN videos v ON v.primary_event_id = e.id
           INNER JOIN video_youtube_metadata ym ON ym.video_id = v.id
          WHERE e.visibility_status = 'public'
            AND e.start_time IS NOT NULL
            AND e.start_time <= ?1
            AND (e.end_time IS NULL OR e.end_time >= ?1)
            AND v.youtube_video_id IS NOT NULL
            AND v.youtube_video_id <> ''
            AND v.visibility_status NOT IN ('archived', 'voided')
            AND ym.sync_status IN ('synced', 'failed')
            AND ym.youtube_video_id IS v.youtube_video_id
            AND ym.synced_at IS NOT NULL
            AND ym.synced_at <= ?1 - ?2
          ORDER BY ym.synced_at ASC, v.id ASC
          LIMIT ?3\`,
        [now, ACTIVE_EVENT_SYNC_INTERVAL_SEC, remaining],
      ),
    );
  }

  remaining = YOUTUBE_SYNC_BATCH_SIZE - selected.size;
  if (remaining > 0) {
    appendUniqueRows(
      selected,
      await querySyncRows(
        env,
        \`SELECT v.id,
                v.youtube_video_id,
                ym.synced_at,
                0 AS active_event
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
          LIMIT ?3\`,
        [now, NORMAL_SYNC_INTERVAL_SEC, remaining],
      ),
    );
  }

  return [...selected.values()];
}`;

const count = source.split(before).length - 1;
if (count !== 1) {
  throw new Error(`selectSyncRows replacement target count=${count}`);
}
source = source.replace(before, after);
fs.writeFileSync(path, source);
fs.rmSync("scripts/agent-optimize-youtube-selection.mjs");
fs.rmSync(".github/workflows/agent-optimize-youtube-selection.yml");
console.log("YouTube selection optimized");
