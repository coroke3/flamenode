/**
 * sync-jobs: 15分毎の外部API・集計ジョブ。
 * - YouTube メタデータ同期（最大50件）
 * - スコア差分再計算（最大250件、1 SQL）
 *
 * Workers FreeのCPU 10msと1実行50 subrequestsを前提に、全体retryと無制限loopを持たない。
 */
import { createCronWorker } from "../shared/createCronWorker.ts";
import { recalcScoreBatch } from "../score-recalc/index.ts";
import { withCronLease } from "../shared/cronLease.ts";
import { runJob } from "../shared/runJob.ts";
import { syncBatch } from "../youtube-sync/index.ts";

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  YOUTUBE_API_KEY?: string;
  BUILD_COMMIT_SHA?: string;
}

const SYNC_JOBS_LEASE_SEC = 14 * 60;
const SYNC_JOBS_HEARTBEAT_SEC = 4 * 60;

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
          return {
            processed: youtube.processed + score.processed,
            skipped: youtube.skipped + score.skipped,
            failed: youtube.failed + score.failed,
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
