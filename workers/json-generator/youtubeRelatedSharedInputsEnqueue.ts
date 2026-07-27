import { RANDOM_VIDEO_POOL_OBJECT_KEY } from "../../src/lib/publicData/randomVideoPoolCore.ts";
import { YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY } from "../../src/lib/publicData/staticYoutubeRelatedBlocklistCore.ts";

type EnqueueEnv = { DB: D1Database; R2: R2Bucket };

export const YOUTUBE_RELATED_PROJECTION_TARGETS = [
  "youtube_related_blocklist",
  "random_video_pool",
] as const;

export async function enqueueYoutubeRelatedProjectionRebuilds(
  env: EnqueueEnv,
  reason: string,
  priority: "high" | "low",
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();

  const now = Math.floor(Date.now() / 1000);
  const statements = YOUTUBE_RELATED_PROJECTION_TARGETS.flatMap(
    (targetType) => {
      const activeUpdate = env.DB.prepare(
        `UPDATE static_rebuild_queue
            SET reason = ?,
                priority = CASE
                  WHEN priority = 'high' OR ? = 'high' THEN 'high'
                  ELSE priority
                END,
                updated_at = MAX(updated_at + 1, ?)
          WHERE target_type = ?
            AND target_id = 'global'
            AND status IN ('pending', 'processing')`,
      ).bind(
        reason,
        priority,
        now,
        targetType,
      );

      const insert = env.DB.prepare(
        `INSERT OR IGNORE INTO static_rebuild_queue (
           id, target_type, target_id, reason, priority, status,
           attempt_count, created_at, updated_at
         ) VALUES (
           ?, ?, 'global', ?, ?, 'pending', 0, ?, ?
         )`,
      ).bind(
        `srb:${targetType}:${crypto.randomUUID()}`,
        targetType,
        reason,
        priority,
        now,
        now,
      );

      return [activeUpdate, insert];
    },
  );

  const results = await env.DB.batch(statements);
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
