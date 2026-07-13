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
}

export const SCORE_RECALC_BATCH_SIZE = 500;
export const SCORE_FORCE_REFRESH_SEC = 24 * 60 * 60;

/** 旧cursor値を読むテスト・移行コード向けの互換関数。再計算本体はcursorを使用しない。 */
export function normalizeScoreCursor(value: string | null): string {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as { last_video_id?: unknown };
    return typeof parsed.last_video_id === "string" ? parsed.last_video_id.trim() : "";
  } catch {
    return "";
  }
}

/**
 * 変更された作品と24時間以上未更新の作品を優先し、1 SQLで最大500件更新する。
 * score更新ではvideos.updated_atを変更しない。自己更新で再びdirtyになる循環を防ぐ。
 */
export async function recalcScoreBatch(env: Env): Promise<ScoreBatchResult> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const result = await env.DB.prepare(
      `UPDATE videos
          SET score =
                COALESCE((
                  SELECT ym.view_count
                    FROM video_youtube_metadata ym
                   WHERE ym.video_id = videos.id
                ), 0) * 1.0
                + COALESCE(app_like_count, 0) * 5.0
                + COALESCE(trending_view_count_24h, 0) * 0.5
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

    const processed = Math.max(0, Number(result.meta?.changes ?? 0));
    return processed > 0
      ? { processed, failed: 0, skipped: 0 }
      : { processed: 0, failed: 0, skipped: 1 };
  } catch (error) {
    void safeErrorSummary(error);
    return { processed: 0, failed: 1, skipped: 0 };
  }
}
