/**
 * fast-jobs: 通知 Recovery Cron + Queue Consumer。
 * - scheduled: 期限切れ lease 回復、リマインダー enqueue、Queue wake（Queue無効/失敗時だけ直接drain）
 * - queue: wake 受信時の bounded notification dispatch
 */
import {
  createCronWorker,
  type CronRunContext,
} from "../shared/createCronWorker.ts";
import {
  hasDuePendingNotifications,
  MAX_NOTIFICATION_BATCH,
  processNotificationQueue,
  recoverNotificationOutboxExpiredLeases,
} from "../notification-dispatcher/dispatch.ts";
import { enqueueSlotDeadlineReminders } from "../notification-dispatcher/reminders.ts";
import { withCronLease } from "../shared/cronLease.ts";
import {
  D1_QUERY_HARD_LIMIT,
  withD1Budget,
} from "../shared/d1Budget.ts";
import { withBoundedRetry } from "../shared/queue.ts";
import {
  sendWorkerQueueWakeBestEffort,
  type QueueWakeKind,
} from "../shared/queueWake.ts";
import {
  combineJobCounters,
  runJob,
  throwIfJobFailed,
} from "../shared/runJob.ts";
import { handleNotificationWakeQueue } from "./notificationQueueConsumer.ts";

export interface Env {
  DB: D1Database;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_WEBHOOK_URL_FORUM_ACCOUNT?: string;
  DISCORD_WEBHOOK_URL_FORUM_EVENT?: string;
  DISCORD_WEBHOOK_URL_FORUM_SYSTEM?: string;
  DISCORD_BOT_TOKEN?: string;
  NEXT_PUBLIC_SITE_URL?: string;
  KV: KVNamespace;
  BUILD_COMMIT_SHA?: string;
  NOTIFICATION_WAKE_QUEUE?: {
    send: (body: unknown) => Promise<void>;
  };
  QUEUE_DISPATCH_ENABLED?: string;
  QUEUE_CONTINUATION_ENABLED?: string;
}

const REMINDER_INTERVAL_SEC = 3600;
const FAST_JOBS_LEASE_SEC = 4 * 60;
const REMINDER_LEASE_SEC = 4 * 60;
const FAST_JOBS_WALL_CLOCK_DEADLINE_MS = 3 * 60 * 1_000;
/** orphan cleanup + pending SELECT。 */
const NOTIFICATION_FALLBACK_BASE_D1_STATEMENTS = 2;
/** claim + markSent最大3回 + suppress-redelivery。failure/dead-letter経路もこれ以下。 */
const NOTIFICATION_FALLBACK_MAX_D1_STATEMENTS_PER_ROW = 5;
/** outer lease成功/解放2本 + 3分deadline中に発生し得るheartbeat最大2本を残す。 */
const FAST_JOBS_OUTER_LEASE_D1_RESERVE = 4;

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Discord送信後のmarkSentをD1 hard limitで失敗させると、lease切れ後に同じ通知を
 * 再配送し得る。Cron fallbackでは「送信前」に後処理worst-caseまで入る行数へ縮める。
 */
export function notificationFallbackLimitForD1Budget(
  currentStatements: number,
): number {
  const available =
    D1_QUERY_HARD_LIMIT -
    Math.max(0, Math.floor(currentStatements)) -
    FAST_JOBS_OUTER_LEASE_D1_RESERVE -
    NOTIFICATION_FALLBACK_BASE_D1_STATEMENTS;
  if (available < NOTIFICATION_FALLBACK_MAX_D1_STATEMENTS_PER_ROW) return 0;
  return Math.min(
    MAX_NOTIFICATION_BATCH,
    Math.floor(available / NOTIFICATION_FALLBACK_MAX_D1_STATEMENTS_PER_ROW),
  );
}

async function maybeResendNotificationWake(
  env: Env,
  sentKinds?: Set<QueueWakeKind>,
): Promise<void> {
  if (!(await hasDuePendingNotifications(env))) return;
  await sendWorkerQueueWakeBestEffort({
    queue: env.NOTIFICATION_WAKE_QUEUE ?? null,
    kind: "notification_available",
    source: "recovery",
    envFlags: env,
    kv: env.KV,
    sentKinds,
  });
}

export async function runNotificationRecovery(
  env: Env,
  execution: CronRunContext,
): Promise<void> {
  // Cron lease・reminder・fallback dispatchを同一D1 hard-limit guardへ通す。
  const budgetEnv = withD1Budget(env);
  await runJob(
    "fast-jobs",
    "cron",
    async () => {
      const leased = await withCronLease(
        budgetEnv,
        {
          jobName: "fast-jobs",
          leaseSeconds: FAST_JOBS_LEASE_SEC,
          signal: execution.signal,
        },
        async (signal) => {
          const wakeSentKinds = new Set<QueueWakeKind>();
          signal?.throwIfAborted();
          await recoverNotificationOutboxExpiredLeases(budgetEnv, {
            limit: MAX_NOTIFICATION_BATCH,
            signal,
          });

          let reminders: unknown;
          try {
            const reminderLease = await withCronLease(
              budgetEnv,
              {
                jobName: "fast-jobs:slot-deadline-reminders",
                leaseSeconds: REMINDER_LEASE_SEC,
                minimumIntervalSeconds: REMINDER_INTERVAL_SEC,
                signal,
              },
              (reminderSignal) =>
                runJob(
                  "fast-jobs",
                  "slot-deadline-reminders",
                  () =>
                    withBoundedRetry(
                      async (attempt) => {
                        reminderSignal?.throwIfAborted();
                        const processed = await enqueueSlotDeadlineReminders(
                          budgetEnv,
                          undefined,
                          reminderSignal,
                        );
                        if (processed > 0) {
                          await sendWorkerQueueWakeBestEffort({
                            queue: budgetEnv.NOTIFICATION_WAKE_QUEUE ?? null,
                            kind: "notification_available",
                            source: "sync",
                            envFlags: budgetEnv,
                            kv: budgetEnv.KV,
                            sentKinds: wakeSentKinds,
                          });
                        }
                        return {
                          processed,
                          d1_changes: processed,
                          retry_count: attempt - 1,
                          external_api_calls: 0,
                          quota_stopped: false,
                        };
                      },
                      {
                        attempts: 2,
                        delayMs: 100,
                      },
                    ),
                  { rethrow: true, commitSha: budgetEnv.BUILD_COMMIT_SHA },
                ),
            );
            reminders = reminderLease.acquired
              ? (reminderLease.value ?? {})
              : await runJob(
                  "fast-jobs",
                  "slot-deadline-reminders",
                  async () => ({ skipped: 1 }),
                  { commitSha: budgetEnv.BUILD_COMMIT_SHA },
                );
          } catch (error) {
            if (signal?.aborted) throw error;
            reminders = { failed: 1 };
          }

          signal?.throwIfAborted();
          if (!(await hasDuePendingNotifications(budgetEnv, signal))) {
            return combineJobCounters(reminders, { skipped: 1 });
          }

          // Queue wake成功時は配送を別invocationへ分離し、CronのCPU/D1予算と共有しない。
          // FreeではQueue consumerにもプラン側CPU上限が適用されるため、長時間CPUを前提にしない。
          // feature flag無効・binding欠落・send失敗なら従来通りCronで直接drainして可用性を維持する。
          const alreadyDelegated = wakeSentKinds.has("notification_available");
          const delegatedToQueue =
            alreadyDelegated ||
            (await sendWorkerQueueWakeBestEffort({
              queue: budgetEnv.NOTIFICATION_WAKE_QUEUE ?? null,
              kind: "notification_available",
              source: "recovery",
              envFlags: budgetEnv,
              kv: budgetEnv.KV,
              sentKinds: wakeSentKinds,
            }));
          if (delegatedToQueue) {
            return combineJobCounters(reminders, {
              processed: 0,
              failed: 0,
              skipped: 1,
            });
          }

          const fallbackLimit = notificationFallbackLimitForD1Budget(
            budgetEnv.d1Budget.statements,
          );
          if (fallbackLimit <= 0) {
            // pending rowはD1正本に残るため、危険な半端配送をせず次回Recoveryへ繰り越す。
            return combineJobCounters(reminders, { skipped: 1 });
          }

          let notificationAbortError: Error | undefined;
          const notifications = await runJob(
            "fast-jobs",
            "notification-dispatch",
            async () => {
              try {
                return await processNotificationQueue(budgetEnv, {
                  limit: fallbackLimit,
                  signal,
                  skipLeaseRecovery: true,
                });
              } catch (error) {
                if (isAbortError(error)) notificationAbortError = error;
                throw error;
              }
            },
            { commitSha: budgetEnv.BUILD_COMMIT_SHA },
          );
          if (notificationAbortError) throw notificationAbortError;
          signal?.throwIfAborted();
          await maybeResendNotificationWake(budgetEnv, wakeSentKinds);
          return throwIfJobFailed(
            "fast-jobs",
            "cron",
            combineJobCounters(reminders, notifications),
          );
        },
      );
      return leased.acquired ? (leased.value ?? { skipped: 1 }) : { skipped: 1 };
    },
    { rethrow: true, commitSha: budgetEnv.BUILD_COMMIT_SHA },
  );
}

/** 既存テスト互換の別名。 */
export const runFastJobs = runNotificationRecovery;

const cronWorker = createCronWorker<Env>({
  service: "flamenode-fast-jobs",
  run: runNotificationRecovery,
  wallClockDeadlineMs: FAST_JOBS_WALL_CLOCK_DEADLINE_MS,
});

export default {
  scheduled: cronWorker.scheduled,
  fetch: cronWorker.fetch,
  async queue(
    batch: MessageBatch<unknown>,
    env: Env,
  ): Promise<void> {
    await handleNotificationWakeQueue(batch, withD1Budget(env));
  },
};
