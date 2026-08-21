import {
  PICKUP_CREATORS_OBJECT_KEY,
  USERS_INDEX_OBJECT_KEY,
} from "../../src/lib/publicData/publicCreatorProjection.ts";
import { PUBLIC_X_ICON_MAP_OBJECT_KEY } from "../../src/lib/publicData/publicIconProjection.ts";
import { USERS_INDEX_V2_MANIFEST_OBJECT_KEY } from "../../src/lib/publicData/staticUsersIndexV2Core.ts";

type EnqueueEnv = { DB: D1Database; R2: R2Bucket };

export async function enqueueUsersIndexRebuild(
  env: EnqueueEnv,
  reason: string,
  priority: "high" | "low",
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();

  const now = Math.floor(Date.now() / 1000);
  const activeUpdate = env.DB.prepare(
    `UPDATE static_rebuild_queue
        SET reason = ?,
            priority = CASE
              WHEN priority = 'high' OR ? = 'high' THEN 'high'
              ELSE priority
            END,
            updated_at = MAX(updated_at + 1, ?)
      WHERE target_type = 'users_index'
        AND target_id = 'global'
        AND status IN ('pending', 'processing')`,
  ).bind(reason, priority, now);

  const insert = env.DB.prepare(
    `INSERT OR IGNORE INTO static_rebuild_queue (
       id, target_type, target_id, reason, priority, status,
       attempt_count, created_at, updated_at
     ) VALUES (
       ?, 'users_index', 'global', ?, ?, 'pending', 0, ?, ?
     )`,
  ).bind(`srb:users_index:${crypto.randomUUID()}`, reason, priority, now, now);

  const results = await env.DB.batch([activeUpdate, insert]);
  signal?.throwIfAborted();

  return results.reduce(
    (sum, result) => sum + Math.max(0, Number(result.meta?.changes ?? 0)),
    0,
  );
}

/** R2上の users 共有JSONが欠けていれば users_index:global を enqueue する。 */
export async function ensureUsersSharedInputsOnR2(
  env: EnqueueEnv,
  options: {
    reason: string;
    priority: "high" | "low";
    signal?: AbortSignal;
  },
): Promise<number> {
  options.signal?.throwIfAborted();
  const [indexHead, v2ManifestHead, iconMapHead, pickupHead] = await Promise.all([
    env.R2.head(USERS_INDEX_OBJECT_KEY),
    env.R2.head(USERS_INDEX_V2_MANIFEST_OBJECT_KEY),
    env.R2.head(PUBLIC_X_ICON_MAP_OBJECT_KEY),
    env.R2.head(PICKUP_CREATORS_OBJECT_KEY),
  ]);
  if (indexHead && v2ManifestHead && iconMapHead && pickupHead) {
    return 0;
  }
  return enqueueUsersIndexRebuild(
    env,
    options.reason,
    options.priority,
    options.signal,
  );
}
