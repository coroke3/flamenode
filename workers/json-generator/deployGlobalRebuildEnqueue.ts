export const DEPLOY_GLOBAL_REBUILD_TARGETS = [
  "list_recent",
  "list_popular",
  "search_index",
  "users_index",
  "top_recommended",
  "top_latest",
  "top_nostalgic",
  "top_events",
  "top_announcements",
  "top_stats",
  "top_slot_stats",
  "recommend_core",
  "events_index",
  "youtube_related_blocklist",
  "random_video_pool",
  "member_suggestions",
] as const;

export const STATIC_LAST_GENERATOR_COMMIT_KV_KEY =
  "static:last_generator_commit";

const DEPLOY_GLOBAL_REBUILD_REASON = "deploy_generator_change";

type EnqueueEnv = { DB: D1Database; KV: KVNamespace };

function normalizeCommitSha(commitSha: string | undefined): string | null {
  const trimmed = commitSha?.trim() ?? "";
  if (!trimmed || trimmed === "unknown" || !/^[0-9a-f]{40}$/i.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

async function enqueueDeployGlobalRebuildTargets(
  env: EnqueueEnv,
  reason: string,
  priority: "high" | "low",
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();

  const now = Math.floor(Date.now() / 1000);
  // The target list is fixed and small, but expanding it into one UPDATE and
  // one INSERT per target consumes 2*N D1 statements during a deploy. Keep
  // the batch atomic while using JSON1 for the target set so recovery still
  // has room for its bounded reads and the first rebuild.
  const targetRows = DEPLOY_GLOBAL_REBUILD_TARGETS.map((targetType) => ({
    id: `srb:${targetType}:${crypto.randomUUID()}`,
    target_type: targetType,
  }));
  const targetJson = JSON.stringify(targetRows);
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

  const statements = [activeUpdate, insert];

  const results = await env.DB.batch(statements);
  signal?.throwIfAborted();

  return results.reduce(
    (sum, result) => sum + Math.max(0, Number(result.meta?.changes ?? 0)),
    0,
  );
}

async function countFailedDeployGlobals(env: EnqueueEnv): Promise<number> {
  const placeholders = DEPLOY_GLOBAL_REBUILD_TARGETS.map(() => "?").join(", ");
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count
       FROM static_rebuild_queue
      WHERE target_id = 'global'
        AND target_type IN (${placeholders})
        AND reason = ?
        AND status = 'failed'`,
  )
    .bind(...DEPLOY_GLOBAL_REBUILD_TARGETS, DEPLOY_GLOBAL_REBUILD_REASON)
    .first<{ count: number }>();

  return Math.max(0, Number(row?.count ?? 0));
}

async function countPendingDeployGlobalsWithReason(env: EnqueueEnv): Promise<number> {
  const placeholders = DEPLOY_GLOBAL_REBUILD_TARGETS.map(() => "?").join(", ");
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count
       FROM static_rebuild_queue
      WHERE target_id = 'global'
        AND target_type IN (${placeholders})
        AND reason = ?
        AND status IN ('pending', 'processing')`,
  )
    .bind(...DEPLOY_GLOBAL_REBUILD_TARGETS, DEPLOY_GLOBAL_REBUILD_REASON)
    .first<{ count: number }>();

  return Math.max(0, Number(row?.count ?? 0));
}

async function allDeployTargetsPendingOrProcessing(env: EnqueueEnv): Promise<boolean> {
  const placeholders = DEPLOY_GLOBAL_REBUILD_TARGETS.map(() => "?").join(", ");
  const row = await env.DB.prepare(
    `SELECT COUNT(DISTINCT target_type) AS count
       FROM static_rebuild_queue
      WHERE target_id = 'global'
        AND target_type IN (${placeholders})
        AND status IN ('pending', 'processing')`,
  )
    .bind(...DEPLOY_GLOBAL_REBUILD_TARGETS)
    .first<{ count: number }>();

  return Number(row?.count ?? 0) >= DEPLOY_GLOBAL_REBUILD_TARGETS.length;
}

/** deploy 後の generator 変更時に共有 global target を high で enqueue する。 */
export async function ensureDeployGlobalRebuilds(
  env: EnqueueEnv,
  options: {
    commitSha?: string;
    signal?: AbortSignal;
  },
): Promise<number> {
  const commitSha = normalizeCommitSha(options.commitSha);
  if (!commitSha) {
    return 0;
  }

  options.signal?.throwIfAborted();

  const stored = await env.KV.get(STATIC_LAST_GENERATOR_COMMIT_KV_KEY);
  if (stored === commitSha) {
    const failed = await countFailedDeployGlobals(env);
    if (failed === 0) {
      return 0;
    }
  }

  const enqueued = await enqueueDeployGlobalRebuildTargets(
    env,
    DEPLOY_GLOBAL_REBUILD_REASON,
    "high",
    options.signal,
  );

  const allCovered = await allDeployTargetsPendingOrProcessing(env);
  const pending = await countPendingDeployGlobalsWithReason(env);

  if (enqueued === 0 && !allCovered) {
    return 0;
  }

  if (enqueued > 0 || allCovered) {
    await env.KV.put(STATIC_LAST_GENERATOR_COMMIT_KV_KEY, commitSha);
    options.signal?.throwIfAborted();
  }

  return enqueued > 0 ? enqueued : pending;
}
