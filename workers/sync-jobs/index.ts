/**
 * sync-jobs: 1時間毎の外部API同期ジョブ。
 * - イベント別 YouTube 再生リスト差分同期（イベント設定の間隔で実行）
 * - YouTube メタデータ同期（12時間間隔をD1 leaseで維持）
 * - スコア再計算（12時間間隔をD1 leaseで維持）
 *
 * Worker数を増やさず、既存の sync-jobs に統合する。
 */
import { createCronWorker } from "../shared/createCronWorker.ts";
import { recalcScoreBatch } from "../score-recalc/index.ts";
import { withCronLease } from "../shared/cronLease.ts";
import { withBoundedRetry } from "../shared/queue.ts";
import { runJob, type JobRunResult } from "../shared/runJob.ts";
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

const SYNC_JOBS_LEASE_SEC = 10 * 60;
const SYNC_JOBS_HEARTBEAT_SEC = 3 * 60;
const SLOW_JOB_INTERVAL_SEC = 12 * 60 * 60;
const SUB_JOB_LEASE_SEC = 10 * 60;

async function runSlowJob(
  env: Env,
  jobName: string,
  task: () => Promise<unknown>,
): Promise<JobRunResult> {
  try {
    const leased = await withCronLease(
      env,
      {
        jobName: `sync-jobs:${jobName}`,
        leaseSeconds: SUB_JOB_LEASE_SEC,
        minimumIntervalSeconds: SLOW_JOB_INTERVAL_SEC,
      },
      () => runJob("sync-jobs", jobName, task, { rethrow: true }),
    );
    if (leased.acquired) {
      return leased.value ?? {
        succeeded: true,
        processed: 0,
        skipped: 1,
        failed: 0,
      };
    }
  } catch {
    return {
      succeeded: false,
      processed: 0,
      skipped: 0,
      failed: 1,
    };
  }

  return runJob("sync-jobs", jobName, async () => ({ skipped: 1 }));
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
          // 書き込みAPIは不確実な再試行で重複追加し得るため、Worker境界では再試行しない。
          const playlists = await runJob(
            "sync-jobs",
            "youtube-playlist-sync",
            () => syncEventPlaylists(env),
          );

          const youtube = await runSlowJob(env, "youtube-sync", () =>
            withBoundedRetry(() => syncBatch(env), {
              attempts: 2,
              delayMs: 250,
            }),
          );
          const score = await runSlowJob(env, "score-recalc", () =>
            withBoundedRetry(() => recalcScoreBatch(env), {
              attempts: 2,
              delayMs: 100,
            }),
          );

          return {
            processed:
              playlists.processed + youtube.processed + score.processed,
            skipped: playlists.skipped + youtube.skipped + score.skipped,
            failed: playlists.failed + youtube.failed + score.failed,
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
