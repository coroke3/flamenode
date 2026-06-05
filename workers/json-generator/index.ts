/**
 * 公開用静的 JSON 生成ワーカー（R2）。
 * Next.js 本体ビルドとは無関係。`static_rebuild_queue` の pending を処理する。
 */
import { processStaticRebuildQueue } from "./queue";

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
}

export default {
  async scheduled(_evt: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(processStaticRebuildQueue(env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/rebuild" || url.pathname === "/process-queue") {
      const result = await processStaticRebuildQueue(env);
      return Response.json({ ok: true, ...result });
    }
    return new Response("FlameNode json-generator (queue-driven static JSON)", {
      status: 200,
    });
  },
};
