/** background-jobs から利用する差分スコア再計算モジュール。 */

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
}

export interface ScoreBatchResult {
  processed: number;
  failed: number;
  skipped: number;
}

export interface ScoreBatchOptions {
  limit?: number;
  now?: number;
}

export const SCORE_RECALC_BATCH_SIZE = 50;
const SCORE_INTEGRITY_INTERVAL_SEC = 7 * 24 * 60 * 60;

function boundedLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return SCORE_RECALC_BATCH_SIZE;
  return Math.min(
    SCORE_RECALC_BATCH_SIZE,
    Math.max(1, Math.floor(value ?? SCORE_RECALC_BATCH_SIZE)),
  );
}

/**
 * dirty作品を優先し、未計算または7日以上古い作品を整合性確認として補完する。
 * 候補抽出と更新は1 SQLで行い、作品数に比例してD1 query数を増やさない。
 */
export async function recalcScoreBatch(
  env: Env,
  options: ScoreBatchOptions = {},
): Promise<ScoreBatchResult> {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  try {
    const result = await env.DB.prepare(
      `WITH candidates AS (
         SELECT id
         FROM videos
         WHERE visibility_status = 'public'
           AND (
             score_dirty_at IS NOT NULL
             OR score_updated_at IS NULL
             OR score_updated_at <= ?1
           )
         ORDER BY
           CASE WHEN score_dirty_at IS NOT NULL THEN 0 ELSE 1 END,
           COALESCE(score_dirty_at, score_updated_at, 0) ASC,
           id ASC
         LIMIT ?2
       )
       UPDATE videos
       SET score =
             COALESCE((
               SELECT ym.view_count
               FROM video_youtube_metadata ym
               WHERE ym.video_id = videos.id
             ), 0) * 1.0
             + COALESCE(app_like_count, 0) * 5.0
             + COALESCE(trending_view_count_24h, 0) * 0.5
             - MAX(0, (?3 - COALESCE(scheduled_time, ?3))) / 86400.0 * 0.1,
           score_updated_at = ?3,
           score_dirty_at = NULL,
           updated_at = ?3
       WHERE id IN (SELECT id FROM candidates)
         AND visibility_status = 'public'`,
    )
      .bind(
        now - SCORE_INTEGRITY_INTERVAL_SEC,
        boundedLimit(options.limit),
        now,
      )
      .run();
    const processed = Math.max(0, result.meta?.changes ?? 0);
    return processed > 0
      ? { processed, failed: 0, skipped: 0 }
      : { processed: 0, failed: 0, skipped: 1 };
  } catch {
    return { processed: 0, failed: 1, skipped: 0 };
  }
}
