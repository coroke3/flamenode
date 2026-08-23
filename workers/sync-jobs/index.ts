/**
 * sync-jobs: 外部API・集計ジョブ。
 * - 7分: 開催中・期限到達の YouTube メタデータ同期 + score（pending 即時は Queue）
 *        + GA4 trending 同期（YouTube と独立。失敗は相互に伝播しない）
 * - 52分: 設定済みイベントの YouTube 再生リスト差分同期
 *
 * YouTube pending / playlist manual wake は Queue consumer が処理し、
 * Cron lease は Queue 経路では使わない。D1 の pending/due 状態が常に正本。
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
import {
  runJob,
  throwIfJobFailed,
} from "../shared/runJob.ts";
import { resolveQueueFeatureFlags } from "../shared/queueWake.ts";
import {
  ackAll,
  parseQueueWakeMessage,
  retryAll,
  sendWorkerQueueWakeBestEffort,
  type QueueConsumerResult,
  type WorkerQueueSendBinding,
} from "../shared/queueWake.ts";
import { syncBatch, countPendingSyncRows, type SyncBatchResult } from "../youtube-sync/index.ts";
import {
  syncEventPlaylists,
  type PlaylistSyncBatchResult,
} from "../youtube-playlist-sync/index.ts";
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

/**
 * playlist workerはquota枯渇時に対象eventをD1上でdeferredへ移す。
 * その状態をQueue/Cronの「失敗」にすると即時retryしてquotaとQueue readを浪費するため、
 * 実行境界ではfailedをskippedへ正規化する。OAuth/DB等の実障害はそのままfailedにする。
 */
export function normalizePlaylistQuotaStop(
  result: PlaylistSyncBatchResult,
): PlaylistSyncBatchResult {
  if (!result.quota_stopped || result.failed <= 0) return result;
  return {
    ...result,
    skipped: result.skipped + result.failed,
    failed: 0,
  };
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

/** pending recoveryはドアベルなので、D1 read失敗で成功済みjobを再試行しない。 */
async function maybeResendYoutubePendingWake(
  env: Env,
  source: "recovery" | "continuation" = "recovery",
): Promise<boolean> {
  const flags = resolveQueueFeatureFlags(env);
  if (!flags.dispatchEnabled || !flags.youtubeSyncEnabled) return false;
  if (source === "continuation" && !flags.continuationEnabled) return false;

  let pending = 0;
  try {
    pending = await countPendingSyncRows(env);
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: "sync-jobs",
        job: "youtube-pending-recovery-check",
        result: "deferred_to_recovery",
        error_name: error instanceof Error ? error.name : undefined,
      }),
    );
    return false;
  }
  if (pending <= 0) return false;

  return sendWorkerQueueWakeBestEffort({
    queue: env.YOUTUBE_SYNC_WAKE_QUEUE ?? null,
    kind: "youtube_sync_pending",
    source,
    envFlags: env,
    requireYoutubeFlag: true,
    kv: env.KV,
  });
}

/**
 * 1 invocationで再生リストは最大1イベントだけ処理するため、処理後にまだdue行が
 * 残っていれば同じQueueへ continuation doorbellを1件だけ送る。
 * 状態正本はD1なので、判定/送信失敗時も52分Cronが回収できる。
 */
async function maybeContinueYoutubePlaylistSync(
  env: Env,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted();
  const flags = resolveQueueFeatureFlags(env);
  if (
    !flags.dispatchEnabled ||
    !flags.youtubeSyncEnabled ||
    !flags.continuationEnabled
  ) {
    return false;
  }

  let due = false;
  try {
    const now = Math.floor(Date.now() / 1_000);
    const row = await env.DB.prepare(
      `SELECT 1 AS due
         FROM event_youtube_playlist_sync
        WHERE enabled = 1
          AND playlist_id IS NOT NULL
          AND playlist_id <> ''
          AND sync_mode IN ('append_only', 'mirror')
          AND COALESCE(next_sync_at, 0) <= ?1
        LIMIT 1`,
    )
      .bind(now)
      .first<{ due: number }>();
    signal?.throwIfAborted();
    due = row?.due === 1;
  } catch (error) {
    signal?.throwIfAborted();
    console.warn(
      JSON.stringify({
        service: "sync-jobs",
        job: "youtube-playlist-continuation-check",
        result: "deferred_to_recovery",
        error_name: error instanceof Error ? error.name : undefined,
      }),
    );
    return false;
  }
  if (!due) return false;

  return sendWorkerQueueWakeBestEffort({
    queue: env.YOUTUBE_SYNC_WAKE_QUEUE ?? null,
    kind: "youtube_playlist_sync",
    source: "continuation",
    envFlags: env,
    requireYoutubeFlag: true,
    kv: env.KV,
  });
}

export async function handleYoutubeSyncWakeQueue(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<QueueConsumerResult> {
  const metadataMessages: Message<unknown>[] = [];
  const playlistMessages: Message<unknown>[] = [];
  const invalidMessages: Message<unknown>[] = [];

  // 同じQueueをmetadataとplaylistで共有する。外部APIの重い2 jobを同一invocationで
  // 実行すると最大8+12 requestが重なるため、mixed batchではplaylistを優先し、
  // metadataはD1正本を確認して1件のcontinuation doorbellへcoalesceする。
  for (const message of batch.messages) {
    const wake = parseQueueWakeMessage(message.body);
    if (wake?.kind === "youtube_sync_pending") {
      metadataMessages.push(message);
    } else if (wake?.kind === "youtube_playlist_sync") {
      playlistMessages.push(message);
    } else {
      invalidMessages.push(message);
    }
  }
  ackAll(invalidMessages);

  const mixedYoutubeKinds =
    metadataMessages.length > 0 && playlistMessages.length > 0;
  let retryBatch = false;
  let continued = false;
  let processed = 0;
  let skipped = invalidMessages.length;
  let failed = 0;

  if (metadataMessages.length > 0 && !mixedYoutubeKinds) {
    try {
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

      ackAll(metadataMessages);
      processed += metadataJob.processed;
      skipped += metadataJob.skipped;
      failed += metadataJob.failed;
    } catch {
      retryAll(metadataMessages);
      retryBatch = true;
      failed += metadataMessages.length;
    }
  }

  if (playlistMessages.length > 0) {
    let playlistReturned = false;
    try {
      const playlistJob = await runJob(
        "sync-jobs",
        "youtube-playlist-sync",
        async () => {
          const result = normalizePlaylistQuotaStop(
            await syncEventPlaylists(env),
          );
          playlistReturned = true;
          return result;
        },
        { commitSha: env.BUILD_COMMIT_SHA },
      );
      // syncEventPlaylistsが結果を返した場合、event error/deferredはD1へ保存済みで
      // next_sync_atも更新済み。doorbellを即retryしてもno-opになるためACKする。
      // 関数自体がthrowした場合だけ、D1/Worker障害としてQueue retryする。
      if (!playlistJob.succeeded && !playlistReturned) {
        throw new Error("youtube_playlist_sync_failed");
      }
      if (playlistJob.succeeded && !playlistJob.quota_stopped) {
        const playlistContinued = await maybeContinueYoutubePlaylistSync(env);
        continued ||= playlistContinued;
      }
      ackAll(playlistMessages);
      processed += playlistJob.processed;
      skipped += playlistJob.skipped;
      failed += playlistJob.failed;
    } catch {
      retryAll(playlistMessages);
      retryBatch = true;
      failed += playlistMessages.length;
    }
  }

  if (mixedYoutubeKinds) {
    // metadata doorbell自体に業務データは無いのでACKして重複を捨てる。
    // D1 pendingが残っている場合だけ1件を再送し、送信失敗時は7分Cronが回収する。
    ackAll(metadataMessages);
    skipped += metadataMessages.length;
    const metadataContinued = await maybeResendYoutubePendingWake(
      env,
      "continuation",
    );
    continued ||= metadataContinued;
  }

  return {
    retryBatch,
    continued,
    processed,
    skipped,
    failed,
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
                const result = normalizePlaylistQuotaStop(
                  await syncEventPlaylists(env, signal),
                );
                signal?.throwIfAborted();
                return result;
              },
              { commitSha: env.BUILD_COMMIT_SHA },
            );
            const playlistCounters = throwIfJobFailed(
              "sync-jobs",
              "cron",
              playlist,
            );
            if (!playlistCounters.quota_stopped) {
              await maybeContinueYoutubePlaylistSync(env, signal);
            }
            return playlistCounters;
          }

          await runJob(
            "sync-jobs",
            "ga4-trending-sync",
            async () => {
              signal?.throwIfAborted();
              const result = await syncGa4Trending(env, signal);
              signal?.throwIfAborted();
              return result;
            },
            { rethrow: false, commitSha: env.BUILD_COMMIT_SHA },
          );

          const queueFlags = resolveQueueFeatureFlags(env);
          const includePending = !queueFlags.youtubeSyncEnabled;
          let youtube: SyncBatchResult | null = null;
          const metadataJob = await runJob(
            "sync-jobs",
            "youtube-sync-metadata",
            async () => {
              signal?.throwIfAborted();
              youtube = await syncBatch(env, undefined, signal, {
                mode: "scheduled_only",
                includePending,
              });
              signal?.throwIfAborted();
              return youtube;
            },
            { commitSha: env.BUILD_COMMIT_SHA },
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
          await runYoutubeSyncPostCommit(env, youtube, {
            signal,
            useScoreBatchFallback: true,
            commitSha: env.BUILD_COMMIT_SHA,
          });

          const now = new Date(execution.scheduledTime);
          if (isDailyYoutubeRelatedSlot(now) && !youtube.quota_stopped) {
            let blockedYoutube: SyncBatchResult | null = null;
            const blockedRecheck = await runJob(
              "sync-jobs",
              "youtube-blocked-recheck",
              async () => {
                signal?.throwIfAborted();
                blockedYoutube = await syncBatch(env, undefined, signal, {
                  mode: "blocked_recheck_only",
                });
                signal?.throwIfAborted();
                return blockedYoutube;
              },
              { rethrow: false, commitSha: env.BUILD_COMMIT_SHA },
            );
            if (blockedRecheck.succeeded && blockedYoutube) {
              await runYoutubeSyncPostCommit(env, blockedYoutube, {
                signal,
                commitSha: env.BUILD_COMMIT_SHA,
              });
            }

            const reconciled = await enqueueYoutubeRelatedProjectionRebuilds(
              env,
              "youtube_related_blocklist_daily_reconcile",
              "low",
              signal,
            );
            await wakeStaticRebuildAfterScoreEnqueue(env, reconciled);
          }

          if (queueFlags.youtubeSyncEnabled) {
            await maybeResendYoutubePendingWake(env);
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
    { rethrow: true, commitSha: env.BUILD_COMMIT_SHA },
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
    await handleYoutubeSyncWakeQueue(batch, env);
  },
};
