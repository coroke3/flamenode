/**
 * fast-jobs: 通知 Recovery Cron + Queue Consumer。
 * - scheduled: 期限切れ lease 回復、リマインダー enqueue、due pending の drain
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
import { withBoundedRetry } from "../shared/queue.ts";
import { sendWorkerQueueWakeBestEffort } from "../shared/queueWake.ts";
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

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

async function maybeResendNotificationWake(env: Env): Promise<void> {
  if (!(await hasDuePendingNotifications(env))) return;
  await sendWorkerQueueWakeBestEffort({
    queue: env.NOTIFICATION_WAKE_QUEUE ?? null,
    kind: "notification_available",
    source: "recovery",
    envFlags: env,
    kv: env.KV,
  });
}

export async function runNotificationRecovery(
  env: Env,
  execution: CronRunContext,
): Promise<void> {
  await runJob(
    "fast-jobs",
    "cron",
    async () => {
      const leased = await withCronLease(
        env,
        {
          jobName: "fast-jobs",
          leaseSeconds: FAST_JOBS_LEASE_SEC,
          signal: execution.signal,
        },
        async (signal) => {
          signal?.throwIfAborted();
          await recoverNotificationOutboxExpiredLeases(env, {
            limit: MAX_NOTIFICATION_BATCH,
            signal,
          });

          let reminders: unknown;
          try {
            const reminderLease = await withCronLease(
              env,
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
                          env,
                          undefined,
                          reminderSignal,
                        );
                        if (processed > 0) {
                          await sendWorkerQueueWakeBestEffort({
                            queue: env.NOTIFICATION_WAKE_QUEUE ?? null,
                            kind: "notification_available",
                            source: "sync",
                            envFlags: env,
                            kv: env.KV,
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
                  { rethrow: true, commitSha: env.BUILD_COMMIT_SHA },
                ),
            );
            reminders = reminderLease.acquired
              ? (reminderLease.value ?? {})
              : await runJob(
                  "fast-jobs",
                  "slot-deadline-reminders",
                  async () => ({ skipped: 1 }),
                  { commitSha: env.BUILD_COMMIT_SHA },
                );
          } catch (error) {
            if (signal?.aborted) throw error;
            reminders = { failed: 1 };
          }

          signal?.throwIfAborted();
          if (!(await hasDuePendingNotifications(env, signal))) {
            return combineJobCounters(reminders, { skipped: 1 });
          }

          let notificationAbortError: Error | undefined;
          const notifications = await runJob(
            "fast-jobs",
            "notification-dispatch",
            async () => {
              try {
                return await processNotificationQueue(env, {
                  limit: MAX_NOTIFICATION_BATCH,
                  signal,
                  skipLeaseRecovery: true,
                });
              } catch (error) {
                if (isAbortError(error)) notificationAbortError = error;
                throw error;
              }
            },
            { commitSha: env.BUILD_COMMIT_SHA },
          );
          if (notificationAbortError) throw notificationAbortError;
          signal?.throwIfAborted();
          await maybeResendNotificationWake(env);
          return throwIfJobFailed(
            "fast-jobs",
            "cron",
            combineJobCounters(reminders, notifications),
          );
        },
      );
      return leased.acquired ? (leased.value ?? { skipped: 1 }) : { skipped: 1 };
    },
    { rethrow: true, commitSha: env.BUILD_COMMIT_SHA },
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
    await handleNotificationWakeQueue(batch, env);
  },
};
