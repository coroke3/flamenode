/**
 * Cloudflare無料枠向け統合Cron Worker。
 * - 5分Cron: 通知を正本に、締切・優先YouTube・高優先度JSONを時間分散
 * - 1時間Cron: 通常YouTube、dirtyスコア、通常JSON、cleanupを時間分散
 */
import { createCronWorker } from "../shared/createCronWorker.ts";
import { processNotificationQueue } from "../notification-dispatcher/dispatch.ts";
import { enqueueSlotDeadlineReminders } from "../notification-dispatcher/reminders.ts";
import { syncBatch } from "../youtube-sync/index.ts";
import { recalcScoreBatch } from "../score-recalc/index.ts";
import { processStaticRebuildQueue } from "../json-generator/queue.ts";
import { withDeduplicatingR2 } from "../json-generator/r2Dedup.ts";
import { runCleanupWithRetry } from "../cleanup/index.ts";
import { withCronLease } from "../shared/cronLease.ts";
import { runJob, type JobRunResult } from "../shared/runJob.ts";
import { handleContentJobsFetch } from "../content-jobs/index.ts";

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_BOT_TOKEN?: string;
  YOUTUBE_API_KEY?: string;
  APP_ORIGIN?: string;
  NEXT_PUBLIC_APP_URL?: string;
  WORKER_ADMIN_TOKEN?: string;
  BUILD_COMMIT_SHA?: string;
}

export const FAST_CRON = "*/5 * * * *";
export const HOURLY_CRON = "0 * * * *";
const SHORT_LEASE_SEC = 4 * 60;
const HOURLY_LEASE_SEC = 12 * 60;
const STATIC_SKIP_NOTIFICATION_COUNT = 4;

async function runLeasedJob(
  env: Env,
  job: string,
  leaseSeconds: number,
  task: () => Promise<unknown>,
  minimumIntervalSeconds = 0,
): Promise<JobRunResult> {
  try {
    const leased = await withCronLease(
      env,
      {
        jobName: `background-jobs:${job}`,
        leaseSeconds,
        minimumIntervalSeconds,
        heartbeatSeconds: 0,
      },
      () =>
        runJob("background-jobs", job, task, {
          rethrow: true,
        }),
    );
    if (leased.acquired && leased.value) return leased.value;
    return runJob("background-jobs", job, async () => ({ skipped: 1 }));
  } catch {
    return {
      succeeded: false,
      processed: 0,
      skipped: 0,
      failed: 1,
    };
  }
}

function utcMinute(event: ScheduledEvent): number {
  return new Date(event.scheduledTime).getUTCMinutes();
}

function utcHour(event: ScheduledEvent): number {
  return new Date(event.scheduledTime).getUTCHours();
}

/** 1回のD1/外部API予算を固定するため、5分枠ごとに補助処理を分散する。 */
export async function runFastLane(
  env: Env,
  event: ScheduledEvent,
): Promise<void> {
  const minute = utcMinute(event);

  if (minute === 0) {
    await runLeasedJob(
      env,
      "slot-deadline-reminders",
      SHORT_LEASE_SEC,
      () => enqueueSlotDeadlineReminders(env, 3),
      55 * 60,
    );
  }

  const notifications = await runLeasedJob(
    env,
    "notification-dispatch",
    SHORT_LEASE_SEC,
    () => processNotificationQueue(env, { limit: 6 }),
  );
  const notificationWork = notifications.processed + notifications.failed;

  if (minute === 10 || minute === 40) {
    await runLeasedJob(
      env,
      "youtube-realtime",
      SHORT_LEASE_SEC,
      () =>
        syncBatch(env, {
          limit: 10,
          realtimeOnly: true,
        }),
      25 * 60,
    );
    return;
  }

  if (
    minute !== 0 &&
    notificationWork < STATIC_SKIP_NOTIFICATION_COUNT
  ) {
    await runLeasedJob(
      env,
      "static-high-priority",
      SHORT_LEASE_SEC,
      () =>
        processStaticRebuildQueue(withDeduplicatingR2(env), {
          limit: 1,
          priorities: ["high"],
          targetTypes: ["event", "video", "user", "top", "list_recent"],
          reconcile: false,
        }),
    );
  }
}

/**
 * 毎時の通常処理。cleanup時刻は静的生成を止め、同一invocationのD1予算を確保する。
 */
export async function runHourlyLane(
  env: Env,
  event: ScheduledEvent,
): Promise<void> {
  const hour = utcHour(event);

  await runLeasedJob(
    env,
    "youtube-normal",
    HOURLY_LEASE_SEC,
    () => syncBatch(env, { limit: 50 }),
  );

  await runLeasedJob(
    env,
    "score-recalc",
    HOURLY_LEASE_SEC,
    () => recalcScoreBatch(env, { limit: 50 }),
  );

  if (hour % 6 === 0) {
    await runLeasedJob(
      env,
      "cleanup",
      HOURLY_LEASE_SEC,
      () => runCleanupWithRetry(env),
      5 * 60 * 60,
    );
    return;
  }

  await runLeasedJob(
    env,
    "static-normal",
    HOURLY_LEASE_SEC,
    () =>
      processStaticRebuildQueue(withDeduplicatingR2(env), {
        limit: 1,
        reconcile: true,
      }),
  );
}

export async function runBackgroundJobs(
  env: Env,
  event: ScheduledEvent,
): Promise<void> {
  if (event.cron === FAST_CRON) {
    await runFastLane(env, event);
    return;
  }
  if (event.cron === HOURLY_CRON) {
    await runHourlyLane(env, event);
    return;
  }
  await runJob("background-jobs", "unknown-cron", async () => ({ skipped: 1 }));
}

export default createCronWorker<Env>({
  service: "background-jobs",
  run: runBackgroundJobs,
  fetch: handleContentJobsFetch,
});
