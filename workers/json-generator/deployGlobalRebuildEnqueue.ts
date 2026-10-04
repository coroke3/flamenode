import {
  d1Changes,
  globalTargets,
  prepareStaticRebuildEnqueue,
} from "./staticRebuildEnqueue.ts";

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
 * 同commit時は failed DISTINCT SELECT 1 + batch(failed行reason退避 1 + JSON1 upsert 1)
 * + coverage COUNT 2 = 最大5。commit変更直後は3だが、Recovery側はworst-case 5を予約する。
 */
export const DEPLOY_GLOBAL_REBUILD_MAX_D1_STATEMENTS = 5;

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

async function enqueueDeployGlobalRebuildTargets(
  env: EnqueueEnv,
  targets: readonly string[],
  reason: string,
  signal?: AbortSignal,
  /** enqueue と同一 batch で先に実行する statement（failed 行の reason 退避など）。 */
  leadingStatement?: D1PreparedStatement,
): Promise<number> {
  signal?.throwIfAborted();
  const enqueue = prepareStaticRebuildEnqueue(
    env.DB,
    globalTargets(targets),
    reason,
    "high",
  );
  if (!enqueue) return 0;
  // 固定 target 群を JSON1 upsert 1 statement にまとめ、Recovery の bounded read と
  // 最初の rebuild に D1 statement 予算を残す。
  const results = leadingStatement
    ? await env.DB.batch([leadingStatement, enqueue])
    : [await enqueue.run()];
  signal?.throwIfAborted();
  // leading statement の changes は enqueue 件数に含めない。
  return d1Changes(results[results.length - 1]);
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
  let leadingStatement: D1PreparedStatement | undefined;
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
    leadingStatement = env.DB.prepare(
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
    );
  }

  const enqueued = await enqueueDeployGlobalRebuildTargets(
    env,
    targets,
    reason,
    options.signal,
    leadingStatement,
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
