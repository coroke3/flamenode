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

type ScoreRow = { id: string };

export const SCORE_RECALC_BATCH_SIZE = 25;
const CURSOR_KEY = "sync-jobs:score:last-video-id";

export function normalizeScoreCursor(value: string | null): string {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as { last_video_id?: unknown };
    return typeof parsed.last_video_id === "string" ? parsed.last_video_id.trim() : "";
  } catch {
    return "";
  }
}

async function selectScoreRows(env: Env, cursor: string): Promise<ScoreRow[]> {
  const select = async (afterId: string) => {
    const result = await env.DB.prepare(
      `SELECT id
         FROM videos
        WHERE visibility_status = 'public'
          AND id > ?1
        ORDER BY id ASC
        LIMIT ?2`,
    )
      .bind(afterId, SCORE_RECALC_BATCH_SIZE)
      .all<ScoreRow>();
    return result.results ?? [];
  };

  const continued = await select(cursor);
  if (continued.length > 0 || !cursor) return continued;
  return select("");
}

async function updateScore(env: Env, videoId: string, now: number): Promise<void> {
  await env.DB.prepare(
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
            score_updated_at = ?1,
            updated_at = ?1
      WHERE id = ?2 AND visibility_status = 'public'`,
  )
    .bind(now, videoId)
    .run();
}

/** 1回の実行で最大25件だけを再計算し、続き位置をKVへ保存する。 */
export async function recalcScoreBatch(env: Env): Promise<ScoreBatchResult> {
  const cursor = normalizeScoreCursor(await env.KV.get(CURSOR_KEY));
  const rows = await selectScoreRows(env, cursor);
  if (rows.length === 0) {
    await env.KV.put(CURSOR_KEY, JSON.stringify({ last_video_id: "" }), {
      expirationTtl: 30 * 24 * 60 * 60,
    });
    return { processed: 0, failed: 0, skipped: 1 };
  }

  const now = Math.floor(Date.now() / 1000);
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await updateScore(env, row.id, now);
      processed += 1;
    } catch (error) {
      failed += 1;
      // score は次のサイクルで再試行する。個別IDや生の例外をログへ残さない。
      void safeErrorSummary(error);
    }
  }

  const lastVideoId = rows[rows.length - 1]?.id ?? "";
  await env.KV.put(CURSOR_KEY, JSON.stringify({ last_video_id: lastVideoId }), {
    expirationTtl: 30 * 24 * 60 * 60,
  });
  return { processed, failed, skipped: 0 };
}
