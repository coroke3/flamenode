import { RANDOM_VIDEO_POOL_OBJECT_KEY } from "../../src/lib/publicData/randomVideoPoolCore.ts";
import { YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY } from "../../src/lib/publicData/staticYoutubeRelatedBlocklistCore.ts";

type EnqueueEnv = { DB: D1Database; R2: R2Bucket };

export const YOUTUBE_RELATED_PROJECTION_TARGETS = [
  "youtube_related_blocklist",
  "random_video_pool",
  "top_recommended",
  "top_latest",
  "top_nostalgic",
  "top_stats",
  "recommend_core",
] as const;

/** 固定7 targetをJSON1でまとめるため、enqueueのD1消費は常に2 statements。 */
export const YOUTUBE_RELATED_REBUILD_MAX_D1_STATEMENTS = 2;

export async function enqueueYoutubeRelatedProjectionRebuilds(
  env: EnqueueEnv,
  reason: string,
  priority: "high" | "low",
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();

  const now = Math.floor(Date.now() / 1000);
  const targetRows = YOUTUBE_RELATED_PROJECTION_TARGETS.map((targetType) => ({
    id: `srb:${targetType}:${crypto.randomUUID()}`,
    target_type: targetType,
  }));
  const targetJson = JSON.stringify(targetRows);

  // targetごとにUPDATE+INSERTを発行すると7*2=14 statementsになる。
  // D1 Freeの50 queries/invocationを圧迫するため、deploy globalと同じJSON1集合演算へ寄せる。
  const activeUpdate = env.DB.prepare(
    `UPDATE static_rebuild_queue
        SET reason = ?,
            priority = CASE
              WHEN priority = 'high' OR ? = 'high' THEN 'high'
              ELSE priority
            END,
            updated_at = MAX(updated_at + 1, ?)
      WHERE target_id = 'global'
        AND status IN ('pending', 'processing')
        AND target_type IN (
          SELECT CAST(json_extract(value, '$.target_type') AS TEXT)
          FROM json_each(?)
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
       'global', ?, ?, 'pending', 0, ?, ?
     FROM json_each(?)`,
  ).bind(reason, priority, now, now, targetJson);

  const results = await env.DB.batch([activeUpdate, insert]);
  signal?.throwIfAborted();

  return results.reduce(
    (sum, result) =>
      sum + Math.max(0, Number(result.meta?.changes ?? 0)),
    0,
  );
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
