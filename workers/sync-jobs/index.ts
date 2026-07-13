/**
 * sync-jobs: 15分毎の外部API・集計ジョブ。
 * - 毎時52分台: 設定済みイベントのYouTube再生リスト差分同期
 * - それ以外: YouTubeメタデータ同期、スコア差分再計算、ランキング再生成予約
 *
 * 重い外部API同期を同一invocationで重ねず、Workers FreeのCPU・subrequest枠を守る。
 */
import { createCronWorker } from "../shared/createCronWorker.ts";
import { recalcScoreBatch } from "../score-recalc/index.ts";
import { withCronLease } from "../shared/cronLease.ts";
import { runJob } from "../shared/runJob.ts";
import { syncBatch } from "../youtube-sync/index.ts";
import { syncEventPlaylists } from "../youtube-playlist-sync/index.ts";

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  YOUTUBE_API_KEY?: string;
  YOUTUBE_OAUTH_CLIENT_ID?: string;
  YOUTUBE_OAUTH_CLIENT_SECRET?: string;
  YOUTUBE_OAUTH_REFRESH_TOKEN?: string;
  YOUTUBE_PLAYLIST_DAILY_QUOTA_UNITS?: string;
  BUILD_COMMIT_SHA?: string;
}

const SYNC_JOBS_LEASE_SEC = 14 * 60;
const SYNC_JOBS_HEARTBEAT_SEC = 4 * 60;

/** Cronは7,22,37,52分。52分台だけを再生リスト専用枠にする。 */
export function isPlaylistSyncSlot(now = new Date()): boolean {
  return now.getUTCMinutes() >= 50;
}

async function enqueueScoreDependentRebuilds(
  env: Env,
): Promise<{ processed: number; failed: number; skipped: number }> {
  const now = Math.floor(Date.now() / 1000);
  const targets = ["top", "list_popular"] as const;
  const statements = targets.map((targetType) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO static_rebuild_queue (
         id, target_type, target_id, reason, priority, status,
         attempt_count, created_at, updated_at
       ) VALUES (?, ?, 'global', 'score_recalc', 'normal', 'pending', 0, ?, ?)`,
    ).bind(`srb:${targetType}:${crypto.randomUUID()}`, targetType, now, now),
  );
  const results = await env.DB.batch(statements);
  const processed = results.reduce(
    (sum, result) => sum + Math.max(0, Number(result.meta?.changes ?? 0)),
    0,
  );
  return processed > 0
    ? { processed, failed: 0, skipped: 0 }
    : { processed: 0, failed: 0, skipped: 1 };
}

export async function runSyncJobs(env: Env): Promise<void> {
  await runJob(
    "sync-jobs",
    "cron",
    async () => {
      const leased = await withCronLease(
        env,
        {
          jobName: "sync-jobs",
          leaseSeconds: SYNC_JOBS_LEASE_SEC,
          heartbeatSeconds: SYNC_JOBS_HEARTBEAT_SEC,
        },
        async () => {
          if (isPlaylistSyncSlot()) {
            // playlistItems.insertは重複追加を避けるためWorker境界で再試行しない。
            return runJob(
              "sync-jobs",
              "youtube-playlist-sync",
              () => syncEventPlaylists(env),
            );
          }

          const youtube = await runJob(
            "sync-jobs",
            "youtube-sync",
            () => syncBatch(env),
          );
          const score = await runJob(
            "sync-jobs",
            "score-recalc",
            () => recalcScoreBatch(env),
          );
          const rankingRebuild = score.processed > 0
            ? await runJob(
                "sync-jobs",
                "ranking-rebuild-enqueue",
                () => enqueueScoreDependentRebuilds(env),
              )
            : { succeeded: true, processed: 0, skipped: 1, failed: 0 };
          return {
            processed: youtube.processed + score.processed + rankingRebuild.processed,
            skipped: youtube.skipped + score.skipped + rankingRebuild.skipped,
            failed: youtube.failed + score.failed + rankingRebuild.failed,
          };
        },
      );
      return leased.acquired
        ? (leased.value ?? { skipped: 1 })
        : { skipped: 1 };
    },
    { rethrow: true },
  );
}

export default createCronWorker<Env>({
  service: "sync-jobs",
  run: runSyncJobs,
});
