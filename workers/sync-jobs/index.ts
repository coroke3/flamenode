/**
 * sync-jobs: 12時間毎の外部API同期ジョブ。
 * - YouTube メタデータ同期
 * - スコア再計算
 *
 * 既存の youtube-sync と score-recalc を統合。
 */
import { recalcScoreBatch } from "../score-recalc/index.ts";
import { withCronLease } from "../shared/cronLease.ts";
import { withBoundedRetry } from "../shared/queue.ts";
import { runJob } from "../shared/runJob.ts";
import { syncBatch } from "../youtube-sync/index.ts";

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  YOUTUBE_API_KEY?: string;
  BUILD_COMMIT_SHA?: string;
}

const SYNC_JOBS_LEASE_SEC = 11 * 60 * 60;

export async function runSyncJobs(env: Env): Promise<void> {
  await runJob("sync-jobs", "cron", async () => {
    const leased = await withCronLease(
      env,
      { jobName: "sync-jobs", leaseSeconds: SYNC_JOBS_LEASE_SEC },
      async () => {
        const youtube = await runJob("sync-jobs", "youtube-sync", () =>
          withBoundedRetry(() => syncBatch(env), { attempts: 2, delayMs: 250 }),
        );
        const score = await runJob("sync-jobs", "score-recalc", () =>
          withBoundedRetry(() => recalcScoreBatch(env), { attempts: 2, delayMs: 100 }),
        );
        return {
          processed: youtube.processed + score.processed,
          skipped: youtube.skipped + score.skipped,
          failed: youtube.failed + score.failed,
        };
      },
    );
    return leased.acquired ? (leased.value ?? { skipped: 1 }) : { skipped: 1 };
  });
}

export default {
  async scheduled(_evt: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSyncJobs(env));
  },

  async fetch(
    req: Request,
    env: Env,
  ): Promise<Response> {
    if (new URL(req.url).pathname === "/health") {
      return Response.json({
        ok: true,
        service: "sync-jobs",
        commit:
          env.BUILD_COMMIT_SHA ?? "unknown",
      });
    }
    return new Response("Not Found", { status: 404 });
  },
};
