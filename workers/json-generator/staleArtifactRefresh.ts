import { STATIC_ARTIFACT_REFRESH_AFTER_SEC } from "./r2Dedup.ts";
import {
  DEPLOY_GLOBAL_REBUILD_TARGETS,
} from "./deployGlobalRebuildEnqueue.ts";
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
 * 上限: 1 run あたり detail {@link STALE_ARTIFACT_REFRESH_MAX_TARGETS} target + global 最大約19 target
 * （R2 HEAD は {@link STALE_ARTIFACT_REFRESH_MAX_HEADS} 回まで）。lease の最小間隔
 * {@link STALE_ARTIFACT_REFRESH_INTERVAL_SEC}(6h) により 1 日最大 4 run = 400 target。
 * 60日 → 90日の猶予 30 日で 12,000 target まで追従できる。
 */
export const STALE_ARTIFACT_REFRESH_MAX_TARGETS = 100;
export const STALE_ARTIFACT_REFRESH_INTERVAL_SEC = 6 * 3600;
export const STALE_ARTIFACT_REFRESH_LEASE_SEC = 5 * 60;
export const STALE_ARTIFACT_REFRESH_LEASE_JOB = "content-jobs:artifact-refresh";
export const STALE_ARTIFACT_REFRESH_REASON = "artifact_slo_refresh";
/** lease 取得(1) + SELECT 2 + enqueue(1) + lease 成功/解放(2)。 */
export const STALE_ARTIFACT_REFRESH_MAX_D1_STATEMENTS = 6;

/** video/event 詳細: SLO は static_artifacts.generated_at の最古値で判定される。 */
const DETAIL_TARGET_TYPES = ["video", "event"] as const;
/**
 * global artifact: SLO は R2 本文 generated_at で判定され、rebuild が走っても dedup 中は
 * tracking 行だけが進む。行ではなく R2 の最終 PUT(uploaded) で判定するため HEAD する。
 */
const GLOBAL_TARGET_TYPES = [
  "top",
  "recommend",
  "rules",
  ...DEPLOY_GLOBAL_REBUILD_TARGETS,
] as const;
/** 1 run の HEAD 上限（global 行は約25件。subrequest を使い切らない）。 */
export const STALE_ARTIFACT_REFRESH_MAX_HEADS = 32;

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
             AND q.status IN ('pending', 'processing')
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
  const placeholders = GLOBAL_TARGET_TYPES.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `SELECT a.target_type AS target_type, a.object_key AS object_key
       FROM static_artifacts AS a
      WHERE a.deleted_at IS NULL
        AND a.target_id = 'global'
        AND a.target_type IN (${placeholders})
        AND NOT EXISTS (
          SELECT 1 FROM static_rebuild_queue AS q
           WHERE q.target_type = a.target_type
             AND q.target_id = 'global'
             AND q.status IN ('pending', 'processing')
        )
      ORDER BY a.generated_at ASC
      LIMIT ?`,
  )
    .bind(...GLOBAL_TARGET_TYPES, STALE_ARTIFACT_REFRESH_MAX_HEADS)
    .all<{ target_type: string; object_key: string }>();
  const stale = new Set<string>();
  for (const row of result.results ?? []) {
    signal?.throwIfAborted();
    const targetType = String(row.target_type);
    if (stale.has(targetType)) continue;
    const object = await env.R2.head(String(row.object_key));
    const uploadedMs =
      object?.uploaded instanceof Date ? object.uploaded.getTime() : Number.NaN;
    if (Number.isFinite(uploadedMs) && uploadedMs < cutoffMs) {
      stale.add(targetType);
    }
  }
  return [...stale].map((targetType) => ({ targetType, targetId: "global" }));
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
