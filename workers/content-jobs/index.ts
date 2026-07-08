/**
 * content-jobs: 15分毎のコンテンツ更新ジョブ。
 * - static_rebuild_queue 処理
 * - cleanup (1時間に1回)
 */
import { processStaticRebuildQueue } from "../json-generator/queue.ts";
import { runCleanupWithRetry } from "../cleanup/index.ts";
import { runJob } from "../shared/runJob.ts";
import { applyAutoCostGuard } from "../cost-guard/auto.ts";

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
}

const CLEANUP_INTERVAL_SEC = 3600;

export default {
  async scheduled(_evt: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      await runJob("content-jobs", () => applyAutoCostGuard(env));
      await runJob("content-jobs", () => processStaticRebuildQueue(env));
      const lastCleanup = await env.KV.get("content-jobs:cleanup:last_run");
      const now = Math.floor(Date.now() / 1000);
      if (!lastCleanup || now - Number(lastCleanup) > CLEANUP_INTERVAL_SEC) {
        await runJob("content-jobs", async () => {
          await runCleanupWithRetry(env);
          await env.KV.put("content-jobs:cleanup:last_run", String(now), {
            expirationTtl: 7200,
          });
        });
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
