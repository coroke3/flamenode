/**
 * fast-jobs: 5分毎の軽量ジョブ。
 * - 通知ディスパッチ
 * - スロット締切リマインド enqueue
 */
import { processNotificationQueue } from "../notification-dispatcher/dispatch.ts";
import { enqueueSlotDeadlineReminders } from "../notification-dispatcher/reminders.ts";
import { withCronLease } from "../shared/cronLease.ts";
import { withBoundedRetry } from "../shared/queue.ts";
import { runJob } from "../shared/runJob.ts";

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

export async function runFastJobs(env: Env): Promise<void> {
  await runJob("fast-jobs", "cron", async () => {
    const leased = await withCronLease(
      env,
      { jobName: "fast-jobs", leaseSeconds: FAST_JOBS_LEASE_SEC },
      async () => {
        let processed = 0;
        let failed = 0;
        const lastReminder = await env.KV.get("fast_jobs:reminders:last_run");
        const now = Math.floor(Date.now() / 1000);
        if (!lastReminder || now - Number(lastReminder) > REMINDER_INTERVAL_SEC) {
          const reminders = await runJob("fast-jobs", "slot-deadline-reminders", () =>
            withBoundedRetry(() => enqueueSlotDeadlineReminders(env), {
              attempts: 2,
              delayMs: 100,
            }),
          );
          processed += reminders.processed;
          failed += reminders.failed;
          if (reminders.succeeded) {
            await env.KV.put("fast_jobs:reminders:last_run", String(now), {
              expirationTtl: 7200,
            });
          }
        } else {
          await runJob("fast-jobs", "slot-deadline-reminders", async () => ({
            skipped: 1,
          }));
        }

        const notifications = await runJob("fast-jobs", "notification-dispatch", () =>
          processNotificationQueue(env, { limit: 15 }),
        );
        processed += notifications.processed;
        failed += notifications.failed;
        return { processed, failed };
      },
    );
    return leased.acquired ? (leased.value ?? { skipped: 1 }) : { skipped: 1 };
  });
}

export default {
  async scheduled(_evt: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runFastJobs(env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "fast-jobs",
        commit:
          env.BUILD_COMMIT_SHA ?? "unknown",
      });
    }
    return new Response("Not Found", { status: 404 });
  },
};
