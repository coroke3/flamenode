/**
 * sync-jobs: 外部API・集計ジョブ。
 * - 7分: 開催中・期限到達の YouTube メタデータ同期 + score（pending 即時は Queue）
 *        + GA4 trending 同期（YouTube と独立。失敗は相互に伝播しない）
 * - 52分: 設定済みイベントの YouTube 再生リスト差分同期
 *
 * YouTube pending は Queue consumer が処理し、Cron lease は Queue 経路では使わない。
 */
import {
  createCronWorker,
  type CronRunContext,
} from "../shared/createCronWorker.ts";
import {
  recalcScoreBatch,
  recalcScoreForVideoIds,
} from "../score-recalc/index.ts";
import { withCronLease } from "../shared/cronLease.ts";
import { withD1Budget } from "../shared/d1Budget.ts";
import {
  runJob,
  throwIfJobFailed,
} from "../shared/runJob.ts";
import { resolveQueueFeatureFlags } from "../shared/queueWake.ts";
import {
  ackAll,
  extractValidatedWakeFromBatch,
  retryAll,
  sendWorkerQueueWakeBestEffort,
  type QueueConsumerResult,
  type WorkerQueueSendBinding,
} from "../shared/queueWake.ts";
import { syncBatch, countPendingSyncRows, type SyncBatchResult } from "../youtube-sync/index.ts";
import { syncEventPlaylists } from "../youtube-playlist-sync/index.ts";
import { enqueueYoutubeRelatedProjectionRebuilds } from "../json-generator/youtubeRelatedSharedInputsEnqueue.ts";
import { syncGa4Trending } from "../ga-analytics/sync.ts";
import { enqueueScoreDependentRebuilds } from "./scoreRankingRebuildThrottle.ts";

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
  YOUTUBE_API_KEY?: string;
  YOUTUBE_DAILY_QUOTA_LIMIT?: string;
  YOUTUBE_OAUTH_CLIENT_ID?: string;
  YOUTUBE_OAUTH_CLIENT_SECRET?: string;
  YOUTUBE_OAUTH_REFRESH_TOKEN?: string;
  BUILD_COMMIT_SHA?: string;
  YOUTUBE_SYNC_WAKE_QUEUE?: WorkerQueueSendBinding;
  STATIC_REBUILD_WAKE_QUEUE?: WorkerQueueSendBinding;
  QUEUE_DISPATCH_ENABLED?: string;
  QUEUE_CONTINUATION_ENABLED?: string;
  QUEUE_YOUTUBE_SYNC_ENABLED?: string;
  GA4_SYNC_ENABLED?: string;
  GA4_PROPERTY_ID?: string;
  GA4_SERVICE_ACCOUNT_EMAIL?: string;
  GA4_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
}

const SYNC_JOBS_LEASE_SEC = 14 * 60;
const SYNC_JOBS_HEARTBEAT_SEC = 4 * 60;
const SYNC_JOBS_WALL_CLOCK_DEADLINE_MS = 13 * 60 * 1_000;
/** UTC 03:00台で blocked 復旧確認と blocklist 日次整合を1回走らせる。 */
const DAILY_YOUTUBE_RELATED_SLOT_UTC_HOUR = 3;

/** Cronは7,52分。UTC分が52の時だけを再生リスト専用枠にする。 */
export function isPlaylistSyncSlot(now = new Date()): boolean {
  if (Number.isNaN(now.getTime())) {
    throw new Error("invalid playlist sync schedule");
  }
  return now.getUTCMinutes() === 52;
}

async function wakeStaticRebuildAfterScoreEnqueue(
  env: Env,
  enqueued: number,
): Promise<void> {
  if (enqueued <= 0) return;
  await sendWorkerQueueWakeBestEffort({
    queue: env.STATIC_REBUILD_WAKE_QUEUE ?? null,
    kind: "static_rebuild_available",
    source: "sync",
    envFlags: env,
    kv: env.KV,
  });
}

export function isDailyYoutubeRelatedSlot(now = new Date()): boolean {
  if (Number.isNaN(now.getTime())) {
    throw new Error("invalid youtube related schedule");
  }
  return now.getUTCHours() === DAILY_YOUTUBE_RELATED_SLOT_UTC_HOUR;
}

/** metadata commit 後の score 更新と静的 rebuild 予約。失敗しても metadata は巻き戻さない。 */
export async function runYoutubeSyncPostCommit(
  env: Env,
  youtube: Pick<
    SyncBatchResult,
    "changed_video_ids" | "related_eligibility_changed_video_ids"
  >,
  options: {
    signal?: AbortSignal;
    useScoreBatchFallback?: boolean;
    commitSha?: string;
  } = {},
): Promise<void> {
  const { signal, useScoreBatchFallback = false, commitSha } = options;

  if (youtube.related_eligibility_changed_video_ids.length > 0) {
    const enqueued = await enqueueYoutubeRelatedProjectionRebuilds(
      env,
      "youtube_related_eligibility_changed",
      "high",
      signal,
    );
    await wakeStaticRebuildAfterScoreEnqueue(env, enqueued);
  }

  const score = await runJob(
    "sync-jobs",
    "score-recalc",
    async () => {
      signal?.throwIfAborted();
      if (youtube.changed_video_ids.length > 0) {
        const result = await recalcScoreForVideoIds(
          env,
          youtube.changed_video_ids,
          signal,
        );
        signal?.throwIfAborted();
        return result;
      }
      if (useScoreBatchFallback) {
        const result = await recalcScoreBatch(env, signal);
        signal?.throwIfAborted();
        return result;
      }
      return {
        processed: 0,
        failed: 0,
        skipped: 1,
        external_api_calls: 0,
        d1_changes: 0,
        retry_count: 0,
        quota_stopped: false,
        quota_stop_reason: null,
      };
    },
    { rethrow: false, commitSha },
  );

  if ((score.processed ?? 0) <= 0) return;

  const rankingRebuild = await runJob(
    "sync-jobs",
    "ranking-rebuild-enqueue",
    () => enqueueScoreDependentRebuilds(env, signal),
    { rethrow: false, commitSha },
  );
  if ((rankingRebuild.processed ?? 0) > 0) {
    await wakeStaticRebuildAfterScoreEnqueue(
      env,
      rankingRebuild.processed ?? 0,
    );
  }
}

async function maybeResendYoutubePendingWake(env: Env): Promise<void> {
  const flags = resolveQueueFeatureFlags(env);
  if (!flags.dispatchEnabled || !flags.youtubeSyncEnabled) return;
  const pending = await countPendingSyncRows(env);
  if (pending <= 0) return;
  await sendWorkerQueueWakeBestEffort({
    queue: env.YOUTUBE_SYNC_WAKE_QUEUE ?? null,
    kind: "youtube_sync_pending",
    source: "recovery",
    envFlags: env,
    requireYoutubeFlag: true,
    kv: env.KV,
  });
}

export async function handleYoutubeSyncWakeQueue(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<QueueConsumerResult> {
  const { messages, wake } = extractValidatedWakeFromBatch(
    batch,
    "youtube_sync_pending",
  );
  if (!wake) {
    ackAll(messages);
    return {
      retryBatch: false,
      continued: false,
      processed: 0,
      skipped: messages.length,
      failed: 0,
    };
  }

  try {
    let continued = false;
    let youtube: SyncBatchResult | null = null;
    const metadataJob = await runJob(
      "sync-jobs",
      "youtube-sync-metadata",
      async () => {
        youtube = await syncBatch(env, undefined, undefined, {
          mode: "pending_only",
        });
        return youtube;
      },
      { commitSha: env.BUILD_COMMIT_SHA },
    );
    if (!metadataJob.succeeded) {
      throw new Error("youtube_metadata_commit_failed");
    }
    if (!youtube) {
      throw new Error("youtube_sync_result_missing");
    }

    await runYoutubeSyncPostCommit(env, youtube, {
      commitSha: env.BUILD_COMMIT_SHA,
    });

    if (youtube.has_more_pending && !youtube.quota_stopped) {
      continued = await sendWorkerQueueWakeBestEffort({
        queue: env.YOUTUBE_SYNC_WAKE_QUEUE,
        kind: "youtube_sync_pending",
        source: "continuation",
        envFlags: env,
        requireYoutubeFlag: true,
        kv: env.KV,
      });
    }

    ackAll(messages);
    return {
      retryBatch: false,
      continued,
      processed: metadataJob.processed,
      skipped: metadataJob.skipped,
      failed: metadataJob.failed,
    };
  } catch {
    retryAll(messages);
    return {
      retryBatch: true,
      continued: false,
      processed: 0,
      skipped: 0,
      failed: messages.length,
    };
  }
}

export async function runSyncJobs(
  env: Env,
  execution: CronRunContext,
): Promise<void> {
  // Cloudflare D1 Freeの50 queries/invocationは個別jobではなくCron全体へ適用される。
  // lease heartbeat・GA4・YouTube・score・日次blocked再確認まで同じhard guardを共有する。
  const budgetEnv = withD1Budget(env);
  await runJob(
    "sync-jobs",
    "cron",
    async () => {
      const leased = await withCronLease(
        budgetEnv,
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
                const result = await syncEventPlaylists(budgetEnv, signal);
                signal?.throwIfAborted();
                return result;
              },
              { commitSha: budgetEnv.BUILD_COMMIT_SHA },
            );
            return throwIfJobFailed(
              "sync-jobs",
              "cron",
              playlist,
            );
          }

          await runJob(
            "sync-jobs",
            "ga4-trending-sync",
            async () => {
              signal?.throwIfAborted();
              const result = await syncGa4Trending(budgetEnv, signal);
              signal?.throwIfAborted();
              return result;
            },
            { rethrow: false, commitSha: budgetEnv.BUILD_COMMIT_SHA },
          );

          const queueFlags = resolveQueueFeatureFlags(budgetEnv);
          const includePending = !queueFlags.youtubeSyncEnabled;
          let youtube: SyncBatchResult | null = null;
          const metadataJob = await runJob(
            "sync-jobs",
            "youtube-sync-metadata",
            async () => {
              signal?.throwIfAborted();
              youtube = await syncBatch(budgetEnv, undefined, signal, {
                mode: "scheduled_only",
                includePending,
              });
              signal?.throwIfAborted();
              return youtube;
            },
            { commitSha: budgetEnv.BUILD_COMMIT_SHA },
          );
          if (!metadataJob.succeeded) {
            return throwIfJobFailed(
              "sync-jobs",
              "youtube-sync-metadata",
              metadataJob,
            );
          }
          if (!youtube) {
            throw new Error("youtube_sync_result_missing");
          }
          await runYoutubeSyncPostCommit(budgetEnv, youtube, {
            signal,
            useScoreBatchFallback: true,
            commitSha: budgetEnv.BUILD_COMMIT_SHA,
          });

          const now = new Date(execution.scheduledTime);
          if (isDailyYoutubeRelatedSlot(now) && !youtube.quota_stopped) {
            let blockedYoutube: SyncBatchResult | null = null;
            const blockedRecheck = await runJob(
              "sync-jobs",
              "youtube-blocked-recheck",
              async () => {
                signal?.throwIfAborted();
                blockedYoutube = await syncBatch(budgetEnv, undefined, signal, {
                  mode: "blocked_recheck_only",
                });
                signal?.throwIfAborted();
                return blockedYoutube;
              },
              { rethrow: false, commitSha: budgetEnv.BUILD_COMMIT_SHA },
            );
            if (blockedRecheck.succeeded && blockedYoutube) {
              await runYoutubeSyncPostCommit(budgetEnv, blockedYoutube, {
                signal,
                commitSha: budgetEnv.BUILD_COMMIT_SHA,
              });
            }

            const reconciled = await enqueueYoutubeRelatedProjectionRebuilds(
              budgetEnv,
              "youtube_related_blocklist_daily_reconcile",
              "low",
              signal,
            );
            await wakeStaticRebuildAfterScoreEnqueue(budgetEnv, reconciled);
          }

          if (queueFlags.youtubeSyncEnabled) {
            await maybeResendYoutubePendingWake(budgetEnv);
          }

          return throwIfJobFailed(
            "sync-jobs",
            "cron",
            metadataJob,
          );
        },
      );
      return leased.acquired
        ? (leased.value ?? { skipped: 1 })
        : { skipped: 1 };
    },
    { rethrow: true, commitSha: budgetEnv.BUILD_COMMIT_SHA },
  );
}

const cronWorker = createCronWorker<Env>({
  service: "flamenode-sync-jobs",
  run: runSyncJobs,
  wallClockDeadlineMs: SYNC_JOBS_WALL_CLOCK_DEADLINE_MS,
});

export default {
  scheduled: cronWorker.scheduled,
  fetch: cronWorker.fetch,
  async queue(
    batch: MessageBatch<unknown>,
    env: Env,
  ): Promise<void> {
    // pending consumerもmetadata/score/continuationを同一invocation budgetで計測する。
    await handleYoutubeSyncWakeQueue(batch, withD1Budget(env));
  },
};
