/**
 * content-jobs: 15分毎のコンテンツ更新ジョブ。
 * - static_rebuild_queue 処理
 * - cleanup (1時間に1回)
 *
 * 既存の json-generator と cleanup を統合。
 */
import { processStaticRebuildQueue } from "../json-generator/queue.ts";
import { runCleanupWithRetry } from "../cleanup/index.ts";

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
}

const CLEANUP_INTERVAL_SEC = 3600;

export default {
  async scheduled(_evt: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      try {
        await processStaticRebuildQueue(env);
      } catch (e) {
        console.error("[content-jobs] static rebuild failed:", e);
      }
      try {
        const lastCleanup = await env.KV.get("content-jobs:cleanup:last_run");
        const now = Math.floor(Date.now() / 1000);
        if (!lastCleanup || now - Number(lastCleanup) > CLEANUP_INTERVAL_SEC) {
          await runCleanupWithRetry(env);
          await env.KV.put("content-jobs:cleanup:last_run", String(now), { expirationTtl: 7200 });
        }
      } catch (e) {
        console.error("[content-jobs] cleanup failed:", e);
      }
    })());
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/rebuild" || url.pathname === "/process-queue") {
      const result = await processStaticRebuildQueue(env);
      return Response.json({ ok: true, ...result });
    }
    if (url.pathname === "/health") {
      return Response.json({ ok: true, worker: "content-jobs" });
    }
    return new Response("FlameNode content-jobs (*/15)", { status: 200 });
  },
};
