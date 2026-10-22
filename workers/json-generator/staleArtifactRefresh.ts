import { STATIC_ARTIFACT_REFRESH_AFTER_SEC } from "./r2Dedup.ts";
import {
  enqueueStaticRebuildTargets,
  type StaticRebuildEnqueueTarget,
} from "./staticRebuildEnqueue.ts";

/**
 * 内容不変の artifact は dedup で再PUTされず generated_at が進まない。Artifact SLO(90日)
 * を割る前に、REFRESH_AFTER を過ぎた tracked target を古い順に低優先度で再 enqueue する。
 * rebuild は recordStaticArtifacts で tracking 行の generated_at を必ず更新し、R2 本体も
 * r2Dedup の REFRESH_AFTER 判定で書き直される。
 *
 * 上限: 1 run あたり detail {@link STALE_ARTIFACT_REFRESH_MAX_TARGETS} target + global 最大 11 target
 * （R2 HEAD は固定 11 回）。lease の最小間隔
 * {@link STALE_ARTIFACT_REFRESH_INTERVAL_SEC}(6h) により 1 日最大 4 run = 400 target。
 * 60日 → 90日の猶予 30 日で 12,000 target まで追従できる。
 */
export const STALE_ARTIFACT_REFRESH_MAX_TARGETS = 100;
export const STALE_ARTIFACT_REFRESH_INTERVAL_SEC = 6 * 3600;
export const STALE_ARTIFACT_REFRESH_LEASE_SEC = 5 * 60;
export const STALE_ARTIFACT_REFRESH_LEASE_JOB = "content-jobs:artifact-refresh";
export const STALE_ARTIFACT_REFRESH_REASON = "artifact_slo_refresh";
/** lease 取得(1) + detail SELECT(1) + global blocked SELECT(1) + enqueue(1) + lease 成功/解放(2)。 */
export const STALE_ARTIFACT_REFRESH_MAX_D1_STATEMENTS = 6;

/** video/event 詳細: SLO は static_artifacts.generated_at の最古値で判定される。 */
const DETAIL_TARGET_TYPES = ["video", "event"] as const;
/**
 * global artifact: SLO は R2 本文 generated_at で判定され、rebuild が走っても dedup 中は
 * tracking 行だけが進む。行ではなく R2 の最終 PUT(uploaded) で判定するため、SLO probe の
 * 固定 key だけを HEAD する（tracking 行を並べると search posting 行等が枠を占有する）。
 * visibility manifest は別経路で再生成されるため対象外。
 * 各 key は「その key を書く rebuild target」へ明示的に対応づける。
 */
export const STALE_ARTIFACT_REFRESH_GLOBAL_TARGETS: Readonly<
  Record<string, string>
> = Object.freeze({
  "top.json": "top",
  "list/recent.json": "list_recent",
  "list/popular.json": "list_popular",
  "search-index-lite.json": "search_index",
  "events/index.json": "events_index",
  "users/index.json": "users_index",
  "recommend/core.v1.json": "recommend_core",
  "recommend.json": "recommend",
  "rules/current.json": "rules",
  "youtube/related-blocklist.v1.json": "youtube_related_blocklist",
  "videos/random-pool.v1.json": "random_video_pool",
});

type RefreshEnv = { DB: D1Database; R2: Pick<R2Bucket, "head"> };

async function listStaleDetailTargets(
  env: RefreshEnv,
  cutoff: number,
): Promise<StaticRebuildEnqueueTarget[]> {
  const placeholders = DETAIL_TARGET_TYPES.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `SELECT a.target_type AS target_type, a.target_id AS target_id
       FROM static_artifacts AS a
      WHERE a.deleted_at IS NULL
        AND a.target_type IN (${placeholders})
      GROUP BY a.target_type, a.target_id
     HAVING MIN(a.generated_at) < ?
        AND NOT EXISTS (
          SELECT 1 FROM static_rebuild_queue AS q
           WHERE q.target_type = a.target_type
             AND q.target_id = a.target_id
             AND q.status IN ('pending', 'processing', 'failed')
        )
      ORDER BY MIN(a.generated_at) ASC
      LIMIT ?`,
  )
    .bind(...DETAIL_TARGET_TYPES, cutoff, STALE_ARTIFACT_REFRESH_MAX_TARGETS)
    .all<{ target_type: string; target_id: string }>();
  return (result.results ?? []).map((row) => ({
    targetType: String(row.target_type),
    targetId: String(row.target_id),
  }));
}

async function listStaleGlobalTargets(
  env: RefreshEnv,
  cutoffMs: number,
  signal?: AbortSignal,
): Promise<StaticRebuildEnqueueTarget[]> {
  const entries = Object.entries(STALE_ARTIFACT_REFRESH_GLOBAL_TARGETS);
  const targetTypes = entries.map(([, targetType]) => targetType);
  // active（重複防止）と failed（無限再試行の防止）の global target は対象外。
  const blocked = await env.DB.prepare(
    `SELECT DISTINCT target_type
       FROM static_rebuild_queue
      WHERE target_id = 'global'
        AND target_type IN (${targetTypes.map(() => "?").join(", ")})
        AND status IN ('pending', 'processing', 'failed')`,
  )
    .bind(...targetTypes)
    .all<{ target_type: string }>();
  const skip = new Set(
    (blocked.results ?? []).map((row) => String(row.target_type)),
  );
  const stale: StaticRebuildEnqueueTarget[] = [];
  for (const [objectKey, targetType] of entries) {
    signal?.throwIfAborted();
    if (skip.has(targetType)) continue;
    const object = await env.R2.head(objectKey);
    const uploadedMs =
      object?.uploaded instanceof Date ? object.uploaded.getTime() : Number.NaN;
    if (
      Number.isFinite(uploadedMs) &&
      uploadedMs < cutoffMs &&
      !stale.some((target) => target.targetType === targetType)
    ) {
      stale.push({ targetType, targetId: "global" });
    }
  }
  return stale;
}

/** 戻り値は enqueue した target 数（既に active な target は含めない）。 */
export async function ensureStaleArtifactRefresh(
  env: RefreshEnv,
  options: { now?: number; signal?: AbortSignal } = {},
): Promise<number> {
  options.signal?.throwIfAborted();
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const cutoff = now - STATIC_ARTIFACT_REFRESH_AFTER_SEC;
  const detail = await listStaleDetailTargets(env, cutoff);
  options.signal?.throwIfAborted();
  const globals = await listStaleGlobalTargets(
    env,
    cutoff * 1000,
    options.signal,
  );
  return enqueueStaticRebuildTargets(
    env,
    [...detail, ...globals],
    STALE_ARTIFACT_REFRESH_REASON,
    "low",
    options.signal,
  );
}
