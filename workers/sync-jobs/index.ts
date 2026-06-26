/**
 * sync-jobs: 12時間毎の外部API同期ジョブ。
 * - YouTube メタデータ同期
 * - スコア再計算
 *
 * 既存の youtube-sync と score-recalc を統合。
 */
import { syncBatch } from "../youtube-sync/index.ts";
import { recalcAll } from "../score-recalc/index.ts";

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  YOUTUBE_API_KEY?: string;
}

export default {
  async scheduled(_evt: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      try {
        await syncBatch(env);
      } catch (e) {
        console.error("[sync-jobs] youtube sync failed:", e);
      }
      try {
        await recalcAll(env);
      } catch (e) {
        console.error("[sync-jobs] score recalc failed:", e);
      }
    })());
  },

  async fetch(): Promise<Response> {
    return new Response("FlameNode sync-jobs (12h)", { status: 200 });
  },
};
