import { RANDOM_VIDEO_POOL_OBJECT_KEY } from "../../src/lib/publicData/randomVideoPoolCore.ts";
import { YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY } from "../../src/lib/publicData/staticYoutubeRelatedBlocklistCore.ts";

type EnqueueEnv = { DB: D1Database; R2: R2Bucket };

export const YOUTUBE_RELATED_PROJECTION_TARGETS = [
  "youtube_related_blocklist",
  "random_video_pool",
  "top_nostalgic",
] as const;

/** global-only enqueueは2 statements。video source targetsも250 IDs/chunkでbounded化する。 */
export const YOUTUBE_RELATED_REBUILD_MAX_D1_STATEMENTS = 2;
export const YOUTUBE_RELATED_SOURCE_VIDEO_BATCH_SIZE = 250;
export const YOUTUBE_RELATED_SOURCE_VIDEO_MAX_IDS = 2000;

export async function enqueueYoutubeRelatedProjectionRebuilds(
  env: EnqueueEnv,
  reason: string,
  priority: "high" | "low",
  signal?: AbortSignal,
  sourceVideoIds: readonly string[] = [],
): Promise<number> {
  signal?.throwIfAborted();

  const videoIds = Array.from(
    new Set(sourceVideoIds.map((id) => id.trim()).filter(Boolean)),
  );
  if (videoIds.length > YOUTUBE_RELATED_SOURCE_VIDEO_MAX_IDS) {
    throw new Error("youtube_related_video_source_target_limit_exceeded");
  }
  const chunks: string[][] = [];
  for (
    let offset = 0;
    offset < videoIds.length;
    offset += YOUTUBE_RELATED_SOURCE_VIDEO_BATCH_SIZE
  ) {
    chunks.push(videoIds.slice(offset, offset + YOUTUBE_RELATED_SOURCE_VIDEO_BATCH_SIZE));
  }
  if (chunks.length === 0) chunks.push([]);

  let changes = 0;
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    signal?.throwIfAborted();
    const now = Math.floor(Date.now() / 1000);
    const targetRows = [
      ...(chunkIndex === 0
        ? YOUTUBE_RELATED_PROJECTION_TARGETS.map((targetType) => ({
            id: `srb:${targetType}:${crypto.randomUUID()}`,
            target_type: targetType,
            target_id: "global",
          }))
        : []),
      ...chunks[chunkIndex].map((targetId) => ({
        id: `srb:video:${crypto.randomUUID()}`,
        target_type: "video",
        target_id: targetId,
      })),
    ];
    const targetJson = JSON.stringify(targetRows);

    // eligibility依存の固定global targetsと、source用video targetsだけを予約する。
    const activeUpdate = env.DB.prepare(
      `UPDATE static_rebuild_queue
          SET reason = ?,
              priority = CASE
                WHEN priority = 'high' OR ? = 'high' THEN 'high'
                ELSE priority
              END,
              updated_at = MAX(updated_at + 1, ?)
        WHERE status IN ('pending', 'processing')
          AND EXISTS (
            SELECT 1
            FROM json_each(?) AS incoming
            WHERE CAST(json_extract(incoming.value, '$.target_type') AS TEXT) = static_rebuild_queue.target_type
              AND CAST(json_extract(incoming.value, '$.target_id') AS TEXT) = static_rebuild_queue.target_id
          )`,
    ).bind(reason, priority, now, targetJson);

    const insert = env.DB.prepare(
      `INSERT OR IGNORE INTO static_rebuild_queue (
         id, target_type, target_id, reason, priority, status,
         attempt_count, created_at, updated_at
       )
       SELECT
         CAST(json_extract(value, '$.id') AS TEXT),
         CAST(json_extract(value, '$.target_type') AS TEXT),
         CAST(json_extract(value, '$.target_id') AS TEXT), ?, ?, 'pending', 0, ?, ?
       FROM json_each(?)`,
    ).bind(reason, priority, now, now, targetJson);
    const results = await env.DB.batch([activeUpdate, insert]);
    changes += results.reduce(
      (sum, result) => sum + Math.max(0, Number(result.meta?.changes ?? 0)),
      0,
    );
  }
  signal?.throwIfAborted();
  return changes;
}

/** R2上の共有JSONが欠けていれば blocklist と random pool をまとめて enqueue する。 */
export async function ensureYoutubeRelatedSharedInputsOnR2(
  env: EnqueueEnv,
  options: {
    reason: string;
    priority: "high" | "low";
    signal?: AbortSignal;
  },
): Promise<number> {
  options.signal?.throwIfAborted();
  const [blocklistHead, poolHead] = await Promise.all([
    env.R2.head(YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY),
    env.R2.head(RANDOM_VIDEO_POOL_OBJECT_KEY),
  ]);
  if (blocklistHead && poolHead) {
    return 0;
  }
  return enqueueYoutubeRelatedProjectionRebuilds(
    env,
    options.reason,
    options.priority,
    options.signal,
  );
}
