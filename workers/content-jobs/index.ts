/**
 * content-jobs: 静的 JSON 再生成 Queue Consumer と Recovery Cron。
 * - Queue Consumer: wake 受信時に最大1 target を処理（Cron lease なし）
 * - Recovery Cron: 1時間ごとに failed/expired 回復 + pending 処理、cleanup は日次
 */
import {
  createCronWorker,
  type CronRunContext,
} from "../shared/createCronWorker.ts";
import {
  processStaticRebuildQueue,
  reconcileStaleQueue,
} from "../json-generator/queue.ts";
import { ensureUsersSharedInputsOnR2 } from "../json-generator/usersSharedInputsEnqueue.ts";
import { ensureDeployGlobalRebuilds } from "../json-generator/deployGlobalRebuildEnqueue.ts";
import { ensureDailyTopNostalgicShuffle } from "../json-generator/rebuild.ts";
import { ensureYoutubeRelatedSharedInputsOnR2 } from "../json-generator/youtubeRelatedSharedInputsEnqueue.ts";
import { withDeduplicatingR2 } from "../json-generator/r2Dedup.ts";
import { runCleanupWithRetry } from "../cleanup/index.ts";
import { withCronLease } from "../shared/cronLease.ts";
import {
  combineJobCounters,
  runJob,
  throwIfJobFailed,
} from "../shared/runJob.ts";
import { withSerializedD1 } from "../shared/serializedD1.ts";
import { rejectUnauthorizedWorkerRequest } from "../shared/workerAdminAuth.ts";
import { sendWorkerQueueWakeBestEffort } from "../shared/queueWake.ts";
import { handleStaticRebuildWakeQueue } from "./staticRebuildWakeQueue.ts";

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
  STATIC_REBUILD_WAKE_QUEUE?: {
    send: (body: unknown) => Promise<void>;
  };
  WORKER_ADMIN_TOKEN?: string;
  BUILD_COMMIT_SHA?: string;
  QUEUE_DISPATCH_ENABLED?: string;
  QUEUE_CONTINUATION_ENABLED?: string;
  QUEUE_YOUTUBE_SYNC_ENABLED?: string;
}

const CLEANUP_INTERVAL_SEC = 24 * 3600;
const CONTENT_JOBS_LEASE_SEC = 55 * 60;
const CLEANUP_LEASE_SEC = 10 * 60;
/** Recovery Cron が1回で排水できる static rebuild 上限（MAX_QUEUE_ITEMS_PER_RUN=1 のまま複数回呼ぶ）。 */
export const CONTENT_JOBS_RECOVERY_MAX_TARGETS = 30;
/** lease 競合で processed=0 が続くときの無限ループ防止。 */
export const CONTENT_JOBS_RECOVERY_MAX_CONSECUTIVE_EMPTY_PROCESSED = 3;

type QueueResult = {
  processed: number;
  failed: number;
  skipped?: number;
  hasMore?: boolean;
};
type QueueRunner = (env: Env) => Promise<QueueResult>;

function rebuildEnvironment(env: Env): Env {
  return withDeduplicatingR2(withSerializedD1(env));
}

export async function runContentJobsRecovery(
  env: Env,
  context: Pick<CronRunContext, "signal"> = { signal: new AbortController().signal },
): Promise<void> {
  await runJob(
    "content-jobs",
    "cron",
    async () => {
      const leased = await withCronLease(
        env,
        {
          jobName: "content-jobs",
          leaseSeconds: CONTENT_JOBS_LEASE_SEC,
          signal: context.signal,
        },
        async (signal) => {
          const rebuildEnv = rebuildEnvironment(env);
          const now = Math.floor(Date.now() / 1000);
          const deployGlobalRebuilds = await ensureDeployGlobalRebuilds(
            rebuildEnv,
            {
              commitSha: env.BUILD_COMMIT_SHA,
              signal,
            },
          );
          const missingYoutubeSharedInputs =
            await ensureYoutubeRelatedSharedInputsOnR2(rebuildEnv, {
              reason: "shared_related_inputs_missing_on_r2",
              priority: "high",
              signal,
            });
          const missingUsersSharedInputs = await ensureUsersSharedInputsOnR2(
            rebuildEnv,
            {
              reason: "shared_users_inputs_missing_on_r2",
              priority: "high",
              signal,
            },
          );
          const nostalgicDailyShuffle = await ensureDailyTopNostalgicShuffle(
            rebuildEnv,
            signal,
          );
          if (
            deployGlobalRebuilds > 0 ||
            missingYoutubeSharedInputs > 0 ||
            missingUsersSharedInputs > 0 ||
            nostalgicDailyShuffle > 0
          ) {
            await sendWorkerQueueWakeBestEffort({
              queue: env.STATIC_REBUILD_WAKE_QUEUE ?? null,
              kind: "static_rebuild_available",
              source: "recovery",
              envFlags: env,
              kv: env.KV,
            });
          }
          await reconcileStaleQueue(rebuildEnv, now, signal);
          let staticRebuildHasMore = false;
          const rebuild = await runJob(
            "content-jobs",
            "static-rebuild-queue",
            async () => {
              let aggregated = combineJobCounters();
              let consecutiveEmptyProcessed = 0;
              for (let i = 0; i < CONTENT_JOBS_RECOVERY_MAX_TARGETS; i += 1) {
                signal.throwIfAborted();
                const result = await processStaticRebuildQueue(rebuildEnv, signal);
                aggregated = combineJobCounters(aggregated, result);
                staticRebuildHasMore ||= Boolean(result.hasMore);
                if (!result.hasMore) {
                  break;
                }
                if (result.processed === 0) {
                  if ((result.skipped ?? 0) === 0) {
                    break;
                  }
                  consecutiveEmptyProcessed += 1;
                  if (
                    consecutiveEmptyProcessed >=
                    CONTENT_JOBS_RECOVERY_MAX_CONSECUTIVE_EMPTY_PROCESSED
                  ) {
                    break;
                  }
                  continue;
                }
                consecutiveEmptyProcessed = 0;
              }
              return { ...aggregated, hasMore: staticRebuildHasMore };
            },
            { commitSha: env.BUILD_COMMIT_SHA },
          );
          if (staticRebuildHasMore) {
            await sendWorkerQueueWakeBestEffort({
              queue: env.STATIC_REBUILD_WAKE_QUEUE ?? null,
              kind: "static_rebuild_available",
              source: "recovery",
              envFlags: env,
              kv: env.KV,
            });
          }
          const cleanupLease = await withCronLease(
            env,
            {
              jobName: "content-jobs:cleanup",
              leaseSeconds: CLEANUP_LEASE_SEC,
              minimumIntervalSeconds: CLEANUP_INTERVAL_SEC,
              signal,
            },
            (cleanupSignal) =>
              runJob(
                "content-jobs",
                "cleanup",
                () => runCleanupWithRetry(env, cleanupSignal),
                { rethrow: true, commitSha: env.BUILD_COMMIT_SHA },
              ),
          );
          const cleanup = cleanupLease.acquired
            ? (cleanupLease.value ?? {})
            : await runJob(
                "content-jobs",
                "cleanup",
                async () => ({ skipped: 1 }),
                { commitSha: env.BUILD_COMMIT_SHA },
              );
          return throwIfJobFailed(
            "content-jobs",
            "cron",
            combineJobCounters(rebuild, cleanup),
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

/** @deprecated use runContentJobsRecovery */
export const runContentJobs = runContentJobsRecovery;

export async function handleContentJobsFetch(
  req: Request,
  env: Env,
  runQueue: QueueRunner = processStaticRebuildQueue,
): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== "/rebuild" && url.pathname !== "/process-queue") {
    return new Response("Not Found", { status: 404 });
  }
  const rejected = rejectUnauthorizedWorkerRequest(req, env);
  if (rejected) return rejected;

  let queueResult: QueueResult | undefined;
  let leaseResult: { acquired: boolean; value?: QueueResult };
  try {
    leaseResult = await withCronLease(
      env,
      { jobName: "content-jobs", leaseSeconds: CONTENT_JOBS_LEASE_SEC },
      async () => {
        await runJob(
          "content-jobs",
          "manual-static-rebuild",
          async () => {
            queueResult = await runQueue(rebuildEnvironment(env));
            return queueResult;
          },
          { rethrow: true, commitSha: env.BUILD_COMMIT_SHA },
        );
        return queueResult;
      },
    );
  } catch {
    return Response.json(
      { ok: false, error: "rebuild_failed" },
      { status: 500 },
    );
  }
  if (!leaseResult.acquired) {
    return Response.json(
      { ok: false, error: "job_already_running" },
      { status: 409 },
    );
  }
  if (!leaseResult.value) {
    return Response.json(
      { ok: false, error: "rebuild_failed" },
      { status: 500 },
    );
  }
  return Response.json({ ok: true, ...leaseResult.value });
}

const cronWorker = createCronWorker<Env>({
  service: "flamenode-content-jobs",
  run: runContentJobsRecovery,
  fetch: handleContentJobsFetch,
});

export default {
  ...cronWorker,
  async queue(
    batch: MessageBatch<unknown>,
    env: Env,
  ): Promise<void> {
    await handleStaticRebuildWakeQueue(batch, env);
  },
};
