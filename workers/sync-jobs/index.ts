/**
 * sync-jobs: 15分毎の外部API・集計ジョブ。
 * - 7・22・37分: YouTubeメタデータ同期、スコア差分再計算、ランキング再生成予約
 * - 52分: 設定済みイベントのYouTube再生リスト差分同期
 *
 * 重い外部API同期を同一invocationで重ねず、Workers FreeのCPU・subrequest枠を守る。
 */
import {
  createCronWorker,
  type CronRunContext,
} from "../shared/createCronWorker.ts";
import { recalcScoreBatch } from "../score-recalc/index.ts";
import { withCronLease } from "../shared/cronLease.ts";
import {
  combineJobCounters,
  runJob,
  throwIfJobFailed,
} from "../shared/runJob.ts";
import { syncBatch } from "../youtube-sync/index.ts";
import { syncEventPlaylists } from "../youtube-playlist-sync/index.ts";

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  YOUTUBE_API_KEY?: string;
  YOUTUBE_DAILY_QUOTA_LIMIT?: string;
  YOUTUBE_OAUTH_CLIENT_ID?: string;
  YOUTUBE_OAUTH_CLIENT_SECRET?: string;
  YOUTUBE_OAUTH_REFRESH_TOKEN?: string;
  BUILD_COMMIT_SHA?: string;
}

const SYNC_JOBS_LEASE_SEC = 14 * 60;
const SYNC_JOBS_HEARTBEAT_SEC = 4 * 60;
const SYNC_JOBS_WALL_CLOCK_DEADLINE_MS = 13 * 60 * 1_000;

/** Cronは7,22,37,52分。UTC分が52の時だけを再生リスト専用枠にする。 */
export function isPlaylistSyncSlot(now = new Date()): boolean {
  if (Number.isNaN(now.getTime())) {
    throw new Error("invalid playlist sync schedule");
  }
  return now.getUTCMinutes() === 52;
}

async function enqueueScoreDependentRebuilds(
  env: Env,
  signal?: AbortSignal,
): Promise<{
  processed: number;
  failed: number;
  skipped: number;
  external_api_calls: number;
  d1_changes: number;
  retry_count: number;
  quota_stopped: boolean;
}> {
  signal?.throwIfAborted();
  const now = Math.floor(Date.now() / 1000);
  const targets = ["top", "list_popular", "recommend"] as const;
  const statements = targets.map((targetType) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO static_rebuild_queue (
         id, target_type, target_id, reason, priority, status,
         attempt_count, created_at, updated_at
       ) VALUES (?, ?, 'global', 'score_recalc', 'normal', 'pending', 0, ?, ?)`,
    ).bind(`srb:${targetType}:${crypto.randomUUID()}`, targetType, now, now),
  );
  const results = await env.DB.batch(statements);
  signal?.throwIfAborted();
  const processed = results.reduce(
    (sum, result) =>
      sum + Math.max(0, Number(result.meta?.changes ?? 0)),
    0,
  );
  return processed > 0
    ? {
        processed,
        failed: 0,
        skipped: 0,
        external_api_calls: 0,
        d1_changes: processed,
        retry_count: 0,
        quota_stopped: false,
      }
    : {
        processed: 0,
        failed: 0,
        skipped: 1,
        external_api_calls: 0,
        d1_changes: 0,
        retry_count: 0,
        quota_stopped: false,
      };
}

export async function runSyncJobs(
  env: Env,
  execution: CronRunContext,
): Promise<void> {
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
          signal: execution.signal,
        },
        async (signal) => {
          signal?.throwIfAborted();
          if (isPlaylistSyncSlot(new Date(execution.scheduledTime))) {
            const playlist = await runJob(
              "sync-jobs",
              "youtube-playlist-sync",
              async () => {
                signal?.throwIfAborted();
                const result = await syncEventPlaylists(env, signal);
                signal?.throwIfAborted();
                return result;
              },
              { commitSha: env.BUILD_COMMIT_SHA },
            );
            return throwIfJobFailed(
              "sync-jobs",
              "cron",
              playlist,
            );
          }

          const youtube = await runJob(
            "sync-jobs",
            "youtube-sync",
            async () => {
              signal?.throwIfAborted();
              const result = await syncBatch(env, undefined, signal);
              signal?.throwIfAborted();
              return result;
            },
            { commitSha: env.BUILD_COMMIT_SHA },
          );
          const score = await runJob(
            "sync-jobs",
            "score-recalc",
            async () => {
              signal?.throwIfAborted();
              const result = await recalcScoreBatch(env, signal);
              signal?.throwIfAborted();
              return result;
            },
            { commitSha: env.BUILD_COMMIT_SHA },
          );
          const rankingRebuild =
            score.processed > 0
              ? await runJob(
                  "sync-jobs",
                  "ranking-rebuild-enqueue",
                  () => enqueueScoreDependentRebuilds(env, signal),
                  { commitSha: env.BUILD_COMMIT_SHA },
                )
              : { skipped: 1 };
          return throwIfJobFailed(
            "sync-jobs",
            "cron",
            combineJobCounters(youtube, score, rankingRebuild),
          );
        },
      );
      return leased.acquired
        ? (leased.value ?? { skipped: 1 })
        : { skipped: 1 };
    },
    { rethrow: true, commitSha: env.BUILD_COMMIT_SHA },
  );
}

export default createCronWorker<Env>({
  service: "flamenode-sync-jobs",
  run: runSyncJobs,
  wallClockDeadlineMs: SYNC_JOBS_WALL_CLOCK_DEADLINE_MS,
});
