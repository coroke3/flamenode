/**
 * fast-jobs: 5分毎の軽量ジョブ。
 * - 通知ディスパッチ
 * - スロット締切リマインド enqueue
 */
import {
  createCronWorker,
  type CronRunContext,
} from "../shared/createCronWorker.ts";
import {
  MAX_NOTIFICATION_BATCH,
  processNotificationQueue,
} from "../notification-dispatcher/dispatch.ts";
import { enqueueSlotDeadlineReminders } from "../notification-dispatcher/reminders.ts";
import { withCronLease } from "../shared/cronLease.ts";
import { withBoundedRetry } from "../shared/queue.ts";
import {
  combineJobCounters,
  runJob,
  throwIfJobFailed,
} from "../shared/runJob.ts";

export interface Env {
  DB: D1Database;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_BOT_TOKEN?: string;
  NEXT_PUBLIC_SITE_URL?: string;
  KV: KVNamespace;
  BUILD_COMMIT_SHA?: string;
}

const REMINDER_INTERVAL_SEC = 3600;
const FAST_JOBS_LEASE_SEC = 4 * 60;
const REMINDER_LEASE_SEC = 4 * 60;
const FAST_JOBS_WALL_CLOCK_DEADLINE_MS = 3 * 60 * 1_000;

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

export async function runFastJobs(
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
          let notificationAbortError: Error | undefined;
          const notifications = await runJob(
            "fast-jobs",
            "notification-dispatch",
            async () => {
              try {
                return await processNotificationQueue(env, {
                  limit: MAX_NOTIFICATION_BATCH,
                  signal,
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

export default createCronWorker<Env>({
  service: "flamenode-fast-jobs",
  run: runFastJobs,
  wallClockDeadlineMs: FAST_JOBS_WALL_CLOCK_DEADLINE_MS,
});
