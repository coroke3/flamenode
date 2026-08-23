/**
 * content-jobs: 静的 JSON 再生成 Queue Consumer と Recovery Cron。
 * - Queue Consumer: wake 受信時に最大1 target を処理（Cron lease なし）
 * - Recovery Cron: 軽量修復 + Queue wake。Queue無効/失敗時だけpendingを直接処理、cleanupは日次
 */
import {
  createCronWorker,
  type CronRunContext,
} from "../shared/createCronWorker.ts";
import {
  processStaticRebuildQueue,
  reconcileStaleQueue,
} from "../json-generator/queue.ts";
import { ensureTopSlotStatsOnR2 } from "../json-generator/topSlotStatsEnqueue.ts";
import { ensureTopSectionsOnR2 } from "../json-generator/topSectionsEnqueue.ts";
import { ensureUsersSharedInputsOnR2 } from "../json-generator/usersSharedInputsEnqueue.ts";
import { ensureDeployGlobalRebuilds } from "../json-generator/deployGlobalRebuildEnqueue.ts";
import { ensureDailyTopNostalgicShuffle } from "../json-generator/rebuild.ts";
import {
  ensureEventPlaylistBackfill,
  EVENT_PLAYLIST_BACKFILL_MAX_STATEMENTS,
} from "../json-generator/eventPlaylistBackfill.ts";
import { ensureYoutubeRelatedSharedInputsOnR2 } from "../json-generator/youtubeRelatedSharedInputsEnqueue.ts";
import { runCleanupWithRetry } from "../cleanup/index.ts";
import { withCronLease } from "../shared/cronLease.ts";
import {
  combineJobCounters,
  runJob,
  throwIfJobFailed,
} from "../shared/runJob.ts";
import {
  D1_QUERY_SOFT_LIMIT,
  isD1BudgetExhausted,
} from "../shared/d1Budget.ts";
import { rebuildEnvironment } from "../shared/rebuildEnvironment.ts";
import { rejectUnauthorizedWorkerRequest } from "../shared/workerAdminAuth.ts";
import {
  sendWorkerQueueWakeBestEffort,
  type QueueWakeKind,
} from "../shared/queueWake.ts";
import { handleStaticRebuildWakeQueue } from "./staticRebuildWakeQueue.ts";
import { reconcilePendingXIdSlotBinds } from "./xIdSlotBindRecovery.ts";

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
/** Queueが利用できないRecovery Cronだけが1回で排水する static rebuild 上限。 */
export const CONTENT_JOBS_RECOVERY_MAX_TARGETS = 3;
/** lease 競合で processed=0 が続くときの無限ループ防止。 */
export const CONTENT_JOBS_RECOVERY_MAX_CONSECUTIVE_EMPTY_PROCESSED = 3;

type QueueResult = {
  processed: number;
  failed: number;
  skipped?: number;
  hasMore?: boolean;
};
type QueueRunner = (env: ReturnType<typeof rebuildEnvironment>, signal?: AbortSignal) => Promise<QueueResult>;

export async function runContentJobsRecovery(
  env: Env,
  context: Pick<CronRunContext, "signal"> = { signal: new AbortController().signal },
): Promise<void> {
  await runJob(
    "content-jobs",
    "cron",
    async () => {
      // Cron lease / cleanup / static rebuildを同じbudget wrapperへ通す。
      // cleanupだけraw DBで実行してD1 50queryを飛び越える経路を作らない。
      const rebuildEnv = rebuildEnvironment(env);
      const leased = await withCronLease(
        rebuildEnv,
        {
          jobName: "content-jobs",
          leaseSeconds: CONTENT_JOBS_LEASE_SEC,
          signal: context.signal,
        },
        async (signal) => {
          const wakeSentKinds = new Set<QueueWakeKind>();
          // 日次cleanupを先に処理する。cleanup後の通常処理はsoft limit 40で止まるため、
          // cleanup retryとlease lifecycleを含めてもhard limit 50を同じguardで共有する。
          const cleanupLease = await withCronLease(
            rebuildEnv,
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
                () => runCleanupWithRetry(rebuildEnv, cleanupSignal),
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
          const missingTopSlotStats = await ensureTopSlotStatsOnR2(rebuildEnv, {
            reason: "top_slot_stats_missing_on_r2",
            priority: "high",
            signal,
          });
          const missingTopSections = await ensureTopSectionsOnR2(rebuildEnv, {
            reason: "top_sections_missing_on_r2",
            priority: "high",
            signal,
          });
          await reconcileStaleQueue(rebuildEnv, now, signal);
          let xIdSlotBindRecovery = { processed: 0, completed: 0, bound: 0, failed: 0, hasMore: false };
          try {
            xIdSlotBindRecovery = await reconcilePendingXIdSlotBinds(
              rebuildEnv,
              signal,
              rebuildEnv.d1Budget,
            );
          } catch (error) {
            console.error("[content-jobs] X ID slot bind recovery failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          let eventPlaylistBackfill = 0;
          if (
            rebuildEnv.d1Budget.statements +
              EVENT_PLAYLIST_BACKFILL_MAX_STATEMENTS <=
            D1_QUERY_SOFT_LIMIT
          ) {
            try {
              eventPlaylistBackfill = await ensureEventPlaylistBackfill(
                rebuildEnv,
                signal,
              );
            } catch (error) {
              console.error("[content-jobs] event playlist projection repair failed", {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          let nostalgicDailyShuffle = 0;
          try {
            nostalgicDailyShuffle = await ensureDailyTopNostalgicShuffle(
              rebuildEnv,
              signal,
            );
          } catch (error) {
            console.error("[content-jobs] daily top nostalgic enqueue failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          if (
            deployGlobalRebuilds > 0 ||
            missingYoutubeSharedInputs > 0 ||
            missingUsersSharedInputs > 0 ||
            missingTopSlotStats > 0 ||
            missingTopSections > 0 ||
            eventPlaylistBackfill > 0 ||
            xIdSlotBindRecovery.bound > 0 ||
            nostalgicDailyShuffle > 0
          ) {
            await sendWorkerQueueWakeBestEffort({
              queue: env.STATIC_REBUILD_WAKE_QUEUE ?? null,
              kind: "static_rebuild_available",
              source: "recovery",
              envFlags: env,
              kv: env.KV,
              sentKinds: wakeSentKinds,
            });
          }

          // Queue有効時はRecovery Cronをドアベルに限定し、重いR2/JSON再生成は
          // Queue consumerの長いCPU枠へ委譲する。無効・binding欠落・send失敗時だけ
          // 従来のCron直処理へfallbackするため、Queue未構築環境も壊さない。
          const alreadyDelegated = wakeSentKinds.has("static_rebuild_available");
          const delegatedToQueue =
            alreadyDelegated ||
            (await sendWorkerQueueWakeBestEffort({
              queue: env.STATIC_REBUILD_WAKE_QUEUE ?? null,
              kind: "static_rebuild_available",
              source: "recovery",
              envFlags: env,
              kv: env.KV,
              sentKinds: wakeSentKinds,
            }));

          let staticRebuildHasMore = delegatedToQueue;
          const rebuild = delegatedToQueue
            ? await runJob(
                "content-jobs",
                "static-rebuild-queue",
                async () => ({
                  processed: 0,
                  failed: 0,
                  skipped: 1,
                  hasMore: true,
                  d1_statements: rebuildEnv.d1Budget.statements,
                  d1_rows_read: rebuildEnv.d1Budget.rowsRead,
                  d1_rows_written: rebuildEnv.d1Budget.rowsWritten,
                }),
                { commitSha: env.BUILD_COMMIT_SHA },
              )
            : await runJob(
                "content-jobs",
                "static-rebuild-queue",
                async () => {
                  let aggregated = combineJobCounters();
                  let consecutiveEmptyProcessed = 0;
                  for (let i = 0; i < CONTENT_JOBS_RECOVERY_MAX_TARGETS; i += 1) {
                    signal.throwIfAborted();
                    if (isD1BudgetExhausted(rebuildEnv.d1Budget)) {
                      staticRebuildHasMore = true;
                      break;
                    }
                    const result = await processStaticRebuildQueue(
                      rebuildEnv,
                      signal,
                      { staleQueueAlreadyReconciled: true },
                    );
                    aggregated = combineJobCounters(aggregated, result);
                    staticRebuildHasMore ||= Boolean(result.hasMore);
                    if (!result.hasMore) break;
                    if (result.processed === 0) {
                      if ((result.skipped ?? 0) === 0) break;
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
                  return {
                    ...aggregated,
                    hasMore: staticRebuildHasMore,
                    d1_statements: rebuildEnv.d1Budget.statements,
                    d1_rows_read: rebuildEnv.d1Budget.rowsRead,
                    d1_rows_written: rebuildEnv.d1Budget.rowsWritten,
                  };
                },
                { commitSha: env.BUILD_COMMIT_SHA },
              );

          if (!delegatedToQueue && staticRebuildHasMore) {
            await sendWorkerQueueWakeBestEffort({
              queue: env.STATIC_REBUILD_WAKE_QUEUE ?? null,
              kind: "static_rebuild_available",
              source: "recovery",
              envFlags: env,
              kv: env.KV,
              sentKinds: wakeSentKinds,
            });
          }
          return throwIfJobFailed(
            "content-jobs",
            "cron",
            combineJobCounters(cleanup, rebuild),
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
    const rebuildEnv = rebuildEnvironment(env);
    leaseResult = await withCronLease(
      rebuildEnv,
      { jobName: "content-jobs", leaseSeconds: CONTENT_JOBS_LEASE_SEC },
      async () => {
        await runJob(
          "content-jobs",
          "manual-static-rebuild",
          async () => {
            queueResult = await runQueue(rebuildEnv);
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
