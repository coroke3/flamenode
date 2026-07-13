/**
 * fast-jobs: 5分毎の軽量ジョブ。
 * - 通知ディスパッチ
 * - スロット締切リマインド enqueue
 */
import { createCronWorker } from "../shared/createCronWorker.ts";
import {
  MAX_NOTIFICATION_BATCH,
  processNotificationQueue,
} from "../notification-dispatcher/dispatch.ts";
import { enqueueSlotDeadlineReminders } from "../notification-dispatcher/reminders.ts";
import { withCronLease } from "../shared/cronLease.ts";
import { withBoundedRetry } from "../shared/queue.ts";
import { combineJobCounters, runJob } from "../shared/runJob.ts";

export interface Env {
  DB: D1Database;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_BOT_TOKEN?: string;
  APP_ORIGIN?: string;
  NEXT_PUBLIC_APP_URL?: string;
  KV: KVNamespace;
  BUILD_COMMIT_SHA?: string;
}

const REMINDER_INTERVAL_SEC = 3600;
const FAST_JOBS_LEASE_SEC = 4 * 60;
const REMINDER_LEASE_SEC = 4 * 60;

export async function runFastJobs(env: Env): Promise<void> {
  await runJob(
    "fast-jobs",
    "cron",
    async () => {
      const leased = await withCronLease(
        env,
        { jobName: "fast-jobs", leaseSeconds: FAST_JOBS_LEASE_SEC },
        async () => {
          const reminderLease = await withCronLease(
            env,
            {
              jobName: "fast-jobs:slot-deadline-reminders",
              leaseSeconds: REMINDER_LEASE_SEC,
              minimumIntervalSeconds: REMINDER_INTERVAL_SEC,
            },
            () =>
              runJob(
                "fast-jobs",
                "slot-deadline-reminders",
                () =>
                  withBoundedRetry(() => enqueueSlotDeadlineReminders(env), {
                    attempts: 2,
                    delayMs: 100,
                  }),
                { rethrow: true },
              ),
          );
          const reminders = reminderLease.acquired
            ? (reminderLease.value ?? {})
            : await runJob(
                "fast-jobs",
                "slot-deadline-reminders",
                async () => ({ skipped: 1 }),
              );
          const notifications = await runJob(
            "fast-jobs",
            "notification-dispatch",
            () => processNotificationQueue(env, { limit: MAX_NOTIFICATION_BATCH }),
          );
          return combineJobCounters(reminders, notifications);
        },
      );
      return leased.acquired ? (leased.value ?? { skipped: 1 }) : { skipped: 1 };
    },
    { rethrow: true },
  );
}

export default createCronWorker<Env>({
  service: "fast-jobs",
  run: runFastJobs,
});
