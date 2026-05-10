/**
 * 静的 JSON 生成ワーカー。
 * R2 上に top.json / list.json / event/{id}.json などを書き出し、static_only モードでも閲覧を継続できるようにする。
 * 設計: 5 〜 10 分間隔のスケジュールで実行 (cron)。
 */
export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
}

export default {
  async scheduled(_evt: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(rebuildStaticJson(env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/rebuild") {
      await rebuildStaticJson(env);
      return new Response("ok", { status: 200 });
    }
    return new Response("FlameNode json-generator", { status: 200 });
  },
};

async function rebuildStaticJson(env: Env): Promise<void> {
  // 例: top.json
  const topRows = await env.DB.prepare(
    `SELECT id, title, youtube_video_id, display_name, icon_url
     FROM videos WHERE status = 'public' AND is_deleted = 0 AND is_manual_hidden = 0
     ORDER BY scheduled_time DESC LIMIT 60`,
  ).all();
  await env.R2.put(
    "top.json",
    JSON.stringify({ generated_at: Date.now(), items: topRows.results }),
    { httpMetadata: { contentType: "application/json; charset=utf-8" } },
  );

  // KV にも軽量サマリを書き、リクエスト時のフォールバックに使う。
  await env.KV.put(
    "static:top",
    JSON.stringify({ generated_at: Date.now(), count: topRows.results?.length ?? 0 }),
    { expirationTtl: 600 },
  );
}
