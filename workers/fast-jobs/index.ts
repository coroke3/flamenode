/**
 * fast-jobs: 5分毎の軽量ジョブ。
 * - 通知ディスパッチ
 * - スロット締切リマインド enqueue
 *
 * 既存の notification-dispatcher と reminders を統合。
 */
import { processNotificationQueue } from "../notification-dispatcher/dispatch.ts";
import { enqueueSlotDeadlineReminders } from "../notification-dispatcher/reminders.ts";

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
      try {
        const lastReminder = await env.KV.get("fast_jobs:reminders:last_run");
        const now = Math.floor(Date.now() / 1000);
        if (!lastReminder || now - Number(lastReminder) > REMINDER_INTERVAL_SEC) {
          await enqueueSlotDeadlineReminders(env);
          await env.KV.put("fast_jobs:reminders:last_run", String(now), { expirationTtl: 7200 });
        }
      } catch (e) {
        console.error("[fast-jobs] reminder enqueue failed:", e);
      }
      try {
        await processNotificationQueue(env, { limit: 15 });
      } catch (e) {
        console.error("[fast-jobs] notification dispatch failed:", e);
      }
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
