/**
 * fast-jobs: 5分毎の軽量ジョブ。
 * - 通知ディスパッチ
 * - スロット締切リマインド enqueue
 */
import { processNotificationQueue } from "../notification-dispatcher/dispatch.ts";
import { enqueueSlotDeadlineReminders } from "../notification-dispatcher/reminders.ts";
import { runJob } from "../shared/runJob.ts";

export interface Env {
  DB: D1Database;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_BOT_TOKEN?: string;
  APP_ORIGIN?: string;
  NEXT_PUBLIC_APP_URL?: string;
  KV: KVNamespace;
}

const REMINDER_INTERVAL_SEC = 3600;

export default {
  async scheduled(_evt: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      const lastReminder = await env.KV.get("fast_jobs:reminders:last_run");
      const now = Math.floor(Date.now() / 1000);
      if (!lastReminder || now - Number(lastReminder) > REMINDER_INTERVAL_SEC) {
        await runJob("fast-jobs", async () => {
          await enqueueSlotDeadlineReminders(env);
          await env.KV.put("fast_jobs:reminders:last_run", String(now), {
            expirationTtl: 7200,
          });
        });
      }
      await runJob("fast-jobs", () =>
        processNotificationQueue(env, { limit: 15 }),
      );
    })());
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, worker: "fast-jobs" });
    }
    return new Response("FlameNode fast-jobs (*/5)", { status: 200 });
  },
};
