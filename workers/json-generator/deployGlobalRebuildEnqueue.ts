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

/**
 * 前回 deploy 時の generator 識別子を保持する KV key。
 * key 名は互換のため "commit" のままだが、値は STATIC_GENERATOR_HASH（64桁 hex）が
 * 有効ならそのハッシュ、無効/未設定なら正規化済み commit SHA（40桁 hex）。
 */
export const STATIC_LAST_GENERATOR_COMMIT_KV_KEY =
  "static:last_generator_commit";

const DEPLOY_GLOBAL_REBUILD_REASON = "deploy_generator_change";
/**
 * 同commitで failed 行を1回だけ再試行する enqueue の reason。
 * failed 検出クエリは DEPLOY_GLOBAL_REBUILD_REASON のみを数えるため、
 * この reason の行が再度 failed になっても自動再 enqueue はされない（無限ループ防止）。
 */
export const DEPLOY_GLOBAL_REBUILD_RETRY_REASON =
  "deploy_generator_change_retry";
/** 再試行へ移した failed 行の reason。以後 failed 検出クエリの対象外になる。 */
const DEPLOY_GLOBAL_REBUILD_RETRIED_REASON = "deploy_generator_change_retried";
/**
 * 同commit時は failed DISTINCT SELECT 1 + batch(failed行reason退避 1 + JSON1 enqueue 2)
 * + coverage COUNT 2 = 最大6。commit変更直後は4だが、Recovery側はworst-case 6を予約する。
 */
export const DEPLOY_GLOBAL_REBUILD_MAX_D1_STATEMENTS = 6;

type EnqueueEnv = { DB: D1Database; KV: KVNamespace };

function normalizeCommitSha(commitSha: string | undefined): string | null {
  const trimmed = commitSha?.trim() ?? "";
  if (!trimmed || trimmed === "unknown" || !/^[0-9a-f]{40}$/i.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

function normalizeGeneratorHash(generatorHash: string | undefined): string | null {
  const trimmed = generatorHash?.trim() ?? "";
  return /^[0-9a-f]{64}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

function buildDeployGlobalRebuildEnqueueStatements(
  env: EnqueueEnv,
  targets: readonly string[],
  reason: string,
  priority: "high" | "low",
): D1PreparedStatement[] {

  const now = Math.floor(Date.now() / 1000);
  // The target list is fixed and small, but expanding it into one UPDATE and
  // one INSERT per target consumes 2*N D1 statements during a deploy. Keep
  // the batch atomic while using JSON1 for the target set so recovery still
  // has room for its bounded reads and the first rebuild.
  const targetRows = targets.map((targetType) => ({
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

  return [activeUpdate, insert];
}

async function enqueueDeployGlobalRebuildTargets(
  env: EnqueueEnv,
  targets: readonly string[],
  reason: string,
  priority: "high" | "low",
  signal?: AbortSignal,
  /** enqueue と同一 batch で先に実行する statement（failed 行の reason 退避など）。 */
  leadingStatements: D1PreparedStatement[] = [],
): Promise<number> {
  signal?.throwIfAborted();

  const enqueueStatements = buildDeployGlobalRebuildEnqueueStatements(
    env,
    targets,
    reason,
    priority,
  );
  const statements = [...leadingStatements, ...enqueueStatements];

  const results = await env.DB.batch(statements);
  signal?.throwIfAborted();

  // leading statement の changes は enqueue 件数に含めない。
  return results
    .slice(leadingStatements.length)
    .reduce(
      (sum, result) => sum + Math.max(0, Number(result.meta?.changes ?? 0)),
      0,
    );
}

async function listFailedDeployGlobalTargets(
  env: EnqueueEnv,
): Promise<string[]> {
  const placeholders = DEPLOY_GLOBAL_REBUILD_TARGETS.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `SELECT DISTINCT target_type
       FROM static_rebuild_queue
      WHERE target_id = 'global'
        AND target_type IN (${placeholders})
        AND reason = ?
        AND status = 'failed'`,
  )
    .bind(...DEPLOY_GLOBAL_REBUILD_TARGETS, DEPLOY_GLOBAL_REBUILD_REASON)
    .all<{ target_type: string }>();

  const failed = new Set(
    (result.results ?? []).map((row) => String(row.target_type)),
  );
  // 固定 target 定義の順序を保ち、想定外の値は enqueue しない。
  return DEPLOY_GLOBAL_REBUILD_TARGETS.filter((target) => failed.has(target));
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

/**
 * deploy 後の generator 変更時に共有 global target を high で enqueue する。
 * 変更判定は generatorHash（静的 rebuild 経路ソースの推移 hash）が有効ならそれで、
 * 無効/未設定なら commit SHA で行う。docs/UI だけの deploy で全 global を再生成しない。
 */
export async function ensureDeployGlobalRebuilds(
  env: EnqueueEnv,
  options: {
    commitSha?: string;
    generatorHash?: string;
    signal?: AbortSignal;
  },
): Promise<number> {
  const commitSha = normalizeCommitSha(options.commitSha);
  if (!commitSha) {
    return 0;
  }
  const generatorKey = normalizeGeneratorHash(options.generatorHash) ?? commitSha;

  options.signal?.throwIfAborted();

  const stored = await env.KV.get(STATIC_LAST_GENERATOR_COMMIT_KV_KEY);
  let targets: readonly string[] = DEPLOY_GLOBAL_REBUILD_TARGETS;
  let reason = DEPLOY_GLOBAL_REBUILD_REASON;
  let leadingStatements: D1PreparedStatement[] = [];
  if (stored === generatorKey) {
    // 同一 generator: 永続 failed になった target だけを1回だけ再試行する。
    // failed 行は reason を退避して二度と数えず、再試行行は別 reason にして
    // 再度 failed になっても自動再 enqueue しない（hourly cron の暴走防止）。
    const failedTargets = await listFailedDeployGlobalTargets(env);
    if (failedTargets.length === 0) {
      return 0;
    }
    targets = failedTargets;
    reason = DEPLOY_GLOBAL_REBUILD_RETRY_REASON;
    const targetPlaceholders = failedTargets.map(() => "?").join(", ");
    leadingStatements = [
      env.DB.prepare(
        `UPDATE static_rebuild_queue
            SET reason = ?
          WHERE target_id = 'global'
            AND target_type IN (${targetPlaceholders})
            AND reason = ?
            AND status = 'failed'`,
      ).bind(
        DEPLOY_GLOBAL_REBUILD_RETRIED_REASON,
        ...failedTargets,
        DEPLOY_GLOBAL_REBUILD_REASON,
      ),
    ];
  }

  const enqueued = await enqueueDeployGlobalRebuildTargets(
    env,
    targets,
    reason,
    "high",
    options.signal,
    leadingStatements,
  );

  const allCovered = await allDeployTargetsPendingOrProcessing(env);
  const pending = await countPendingDeployGlobalsWithReason(env);

  if (enqueued === 0 && !allCovered) {
    return 0;
  }

  if (enqueued > 0 || allCovered) {
    await env.KV.put(STATIC_LAST_GENERATOR_COMMIT_KV_KEY, generatorKey);
    options.signal?.throwIfAborted();
  }

  return enqueued > 0 ? enqueued : pending;
}
