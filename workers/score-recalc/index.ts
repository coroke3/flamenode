/** sync-jobs から利用する bounded score 再計算モジュール。 */

import { safeErrorSummary } from "../shared/safeLog.ts";

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
}

export interface ScoreBatchResult {
  processed: number;
  failed: number;
  skipped: number;
  external_api_calls: number;
  d1_changes: number;
  retry_count: number;
  quota_stopped: boolean;
  quota_stop_reason: string | null;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(signal.reason === undefined ? "score recalculation aborted" : String(signal.reason));
}

/**
 * D1 Freeの100,000 rows written/dayにはtable rowだけでなくindex entryも含まれる。
 * scoreとscore_updated_atは2本のindexを更新するため、毎時7分の sync-jobs Cron で最大150件に固定する。
 * 最大3,600動画更新/dayとして、YouTube同期・通知・静的queueの書込み余地を残す。
 */
export const SCORE_RECALC_BATCH_SIZE = 150;
/** nowを含めてもD1の1 statement最大100 bindings未満に収める。 */
export const SCORE_RECALC_BIND_CHUNK_SIZE = 90;
/** age-only 強制 refresh。metadata/video dirty は従来どおり優先。 */
export const SCORE_FORCE_REFRESH_SEC = 72 * 60 * 60;

/**
 * 変更された作品と72時間以上未更新の作品を優先し、1 SQLで最大150件更新する。
 * score更新ではvideos.updated_atを変更しない。自己更新で再びdirtyになる循環を防ぐ。
 */
export async function recalcScoreForVideoIds(
  env: Env,
  videoIds: readonly string[],
  signal?: AbortSignal,
): Promise<ScoreBatchResult> {
  throwIfAborted(signal);
  const uniqueIds = [...new Set(videoIds.filter(Boolean))].slice(
    0,
    SCORE_RECALC_BATCH_SIZE,
  );
  if (uniqueIds.length === 0) {
    return {
      processed: 0,
      failed: 0,
      skipped: 1,
      external_api_calls: 0,
      d1_changes: 0,
      retry_count: 0,
      quota_stopped: false,
      quota_stop_reason: null,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  try {
    let processed = 0;
    for (
      let offset = 0;
      offset < uniqueIds.length;
      offset += SCORE_RECALC_BIND_CHUNK_SIZE
    ) {
      throwIfAborted(signal);
      const chunk = uniqueIds.slice(
        offset,
        offset + SCORE_RECALC_BIND_CHUNK_SIZE,
      );
      const placeholders = chunk.map(() => "?").join(", ");
      const result = await env.DB.prepare(
        `UPDATE videos
            SET score =
                  COALESCE((
                    SELECT ym.view_count
                      FROM video_youtube_metadata ym
                     WHERE ym.video_id = videos.id
                  ), 0) * 1.0
                  + COALESCE(app_like_count, 0) * 5.0
                  - MAX(0, (?1 - COALESCE(scheduled_time, ?1))) / 86400.0 * 0.1,
                score_updated_at = ?1
          WHERE id IN (${placeholders})
            AND visibility_status = 'public'`,
      )
        .bind(now, ...chunk)
        .run();
      throwIfAborted(signal);
      processed += Math.max(0, Number(result.meta?.changes ?? 0));
    }

    return processed > 0
      ? {
          processed,
          failed: 0,
          skipped: 0,
          external_api_calls: 0,
          d1_changes: processed,
          retry_count: 0,
          quota_stopped: false,
          quota_stop_reason: null,
        }
      : {
          processed: 0,
          failed: 0,
          skipped: 1,
          external_api_calls: 0,
          d1_changes: 0,
          retry_count: 0,
          quota_stopped: false,
          quota_stop_reason: null,
        };
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
    console.error(
      JSON.stringify({
        worker: "sync-jobs",
        job: "score-recalc-targeted",
        result: "failed",
        error: safeErrorSummary(error),
      }),
    );
    return {
      processed: 0,
      failed: 1,
      skipped: 0,
      external_api_calls: 0,
      d1_changes: 0,
      retry_count: 0,
      quota_stopped: false,
      quota_stop_reason: null,
    };
  }
}

export async function recalcScoreBatch(
  env: Env,
  signal?: AbortSignal,
): Promise<ScoreBatchResult> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  try {
    throwIfAborted(signal);
    const result = await env.DB.prepare(
      `UPDATE videos
          SET score =
                COALESCE((
                  SELECT ym.view_count
                    FROM video_youtube_metadata ym
                   WHERE ym.video_id = videos.id
                ), 0) * 1.0
                + COALESCE(app_like_count, 0) * 5.0
                - MAX(0, (?1 - COALESCE(scheduled_time, ?1))) / 86400.0 * 0.1,
              score_updated_at = ?1
        WHERE id IN (
          SELECT v.id
            FROM videos v
            LEFT JOIN video_youtube_metadata ym ON ym.video_id = v.id
           WHERE v.visibility_status = 'public'
             AND (
               v.score_updated_at IS NULL
               OR v.score_updated_at < v.updated_at
               OR v.score_updated_at < COALESCE(ym.updated_at, 0)
               OR v.score_updated_at <= ?1 - ?2
             )
           ORDER BY
             CASE WHEN v.score_updated_at IS NULL THEN 0 ELSE 1 END,
             MAX(v.updated_at, COALESCE(ym.updated_at, 0)) DESC,
             v.score_updated_at ASC,
             v.id ASC
           LIMIT ?3
        )`,
    )
      .bind(now, SCORE_FORCE_REFRESH_SEC, SCORE_RECALC_BATCH_SIZE)
      .run();
    throwIfAborted(signal);

    const processed = Math.max(0, Number(result.meta?.changes ?? 0));
    return processed > 0
      ? { processed, failed: 0, skipped: 0, external_api_calls: 0, d1_changes: processed, retry_count: 0, quota_stopped: false, quota_stop_reason: null }
      : { processed: 0, failed: 0, skipped: 1, external_api_calls: 0, d1_changes: 0, retry_count: 0, quota_stopped: false, quota_stop_reason: null };
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
    console.error(
      JSON.stringify({
        worker: "sync-jobs",
        job: "score-recalc",
        result: "failed",
        error: safeErrorSummary(error),
      }),
    );
    return { processed: 0, failed: 1, skipped: 0, external_api_calls: 0, d1_changes: 0, retry_count: 0, quota_stopped: false, quota_stop_reason: null };
  }
}
