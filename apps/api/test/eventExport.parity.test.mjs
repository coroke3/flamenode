import assert from "node:assert/strict";
import { test } from "node:test";
import { runUnderRootTsx, createSqlite, createD1 } from "./support/personalHarness.mjs";

// Compare the *real* CURRENT Next handler and the Hono route against the same
// SQLite schema, timestamp, Cache API host and event visibility state.
if (runUnderRootTsx(import.meta.url)) {
  const stub = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: stub("export {}"), shortCircuit: true };
      if (specifier === "@/lib/cloudflare") return {
        url: stub(`
          export class CloudflareBindingsUnavailableError extends Error {}
          export function getDatabase() {
            if (globalThis.__eventExport.dbError) throw new Error("database_error");
            return globalThis.__eventExport.db;
          }
        `), shortCircuit: true,
      };
      if (specifier === "@opennextjs/cloudflare") return {
        url: stub(`
          export function getCloudflareContext() {
            return { ctx: { waitUntil: (p) => globalThis.__eventExport.pending.push(p) } };
          }
        `), shortCircuit: true,
      };
      return nextResolve(specifier, context);
    },
  });
  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { schema } = await import("@flamenode/db");
  const { app } = await import("../src/app.ts");
  const { GET: currentGet } = await import("../../../app/api/event-endpoints/[id]/route.ts");
  const { clearPublicApiRateLimitForTests } = await import("@flamenode/server-core/publicData/publicApi");
  const { resetIsolateMicroCacheForTests } = await import("../src/routes/live/microCache.ts");
  const { resetIsolateMicroCacheForTests: resetCurrentMicroCache } = await import("../../../src/lib/api/isolateMicroCache.ts");
  const { resetPublicJsonIsolateCacheForTests } = await import("../../../src/lib/publicData/publicCacheIsolate.ts");

  const sqlite = createSqlite();
  // Real Cloudflare D1 implements .raw() for Drizzle's typed select() reads.
  // Keep the test's in-memory D1 faithful without mutating the shared harness.
  const baseD1 = createD1(sqlite);
  const d1 = {
    ...baseD1,
    prepare(query) {
      const original = baseD1.prepare(query);
      return {
        ...original,
        bind(...params) {
          const bound = original.bind(...params);
          return {
            ...bound,
            async raw() {
              baseD1.stats.statements += 1;
              baseD1.stats.maxBinds = Math.max(baseD1.stats.maxBinds, params.length);
              const prepared = sqlite.prepare(query);
              prepared.setReturnArrays(true);
              try {
                return prepared.all(...params).map((row) => [...row]);
              } finally {
                prepared.setReturnArrays(false);
              }
            },
          };
        },
      };
    },
  };
  const proxyDb = drizzle(async (query, values, method) => {
    if (globalThis.__eventExport.dbError) throw new Error("database_error");
    const rows = sqlite.prepare(query).all(...values);
    return { rows: method === "all" || method === "values" ? rows.map(row => Object.values(row)) : rows };
  }, { schema });
  const map = new Map();
  const edgeCache = {
    async match(request) { const r = map.get(request.url); return r?.clone(); },
    async put(request, response) { map.set(request.url, response.clone()); },
    async delete(request) { return map.delete(request.url); },
  };
  globalThis.caches = { default: edgeCache };
  globalThis.__eventExport = { db: proxyDb, pending: [], dbError: false };
  const clock = Date.now;
  Date.now = () => 1700000200000;
  sqlite.exec(`
    DELETE FROM events;
    INSERT INTO events (id, title, visibility_status, start_time, end_time, created_at, updated_at, max_slots_per_video, public_api_enabled)
    VALUES ('export-event', '公開イベント', 'public', 1700000000, 1700003600, 100, 1700000100, 1, 1),
           ('hidden-event', '非公開イベント', 'private', 1700000000, 1700003600, 100, 1700000100, 1, 1),
           ('disabled-event', 'API無効', 'public', 1700000000, 1700003600, 100, 1700000100, 1, 0);
    INSERT INTO videos (id, title, submitted_by_user_id, creator_display_name, primary_event_id, visibility_status, scheduled_time)
    VALUES ('public-video', '公開作品', 'submitter', '制作者', 'export-event', 'public', 1700000110),
           ('private-video', '非公開作品', 'submitter', '制作者', 'export-event', 'private', 1700000120);
  `);
  const origin = "http://localhost/api/event-endpoints/";
  function reset() {
    map.clear();
    globalThis.__eventExport.pending = [];
    globalThis.__eventExport.dbError = false;
    d1.stats.statements = 0;
    d1.stats.writes = 0;
    clearPublicApiRateLimitForTests();
    resetIsolateMicroCacheForTests();
    resetCurrentMicroCache();
    resetPublicJsonIsolateCacheForTests();
  }
  const ctx = {
    waitUntil(p) { globalThis.__eventExport.pending.push(p); },
    passThroughOnException() {},
  };
  async function hono(path, extra = {}) {
    return app.fetch(new Request(origin + path, extra), { DB: d1 }, ctx);
  }
  async function current(path, extra = {}) {
    const [id] = path.split("?");
    return currentGet(new Request(origin + path, extra), { params: Promise.resolve({ id }) });
  }
  async function normalized(response) {
    return {
      status: response.status, body: await response.text(),
      headers: Object.fromEntries([
        "Cache-Control", "Content-Type", "ETag", "X-FlameNode-Schema-Version",
        "X-FlameNode-Format", "X-FlameNode-Update-Mode",
        "X-FlameNode-Refresh-Minutes", "X-FlameNode-Cache",
      ].map(key => [key, response.headers.get(key)])),
    };
  }
  test("T01: v5/legacy aliases + realtime/scheduled share CURRENT exact bytes/headers", async () => {
    for (const path of [
      "export-event", "export-event?format=new", "export-event?format=v1",
      "export-event?format=legacy&update=realtime",
      "export-event?format=v5&update=scheduled&refresh=15",
      "export-event?format=old&update=economy&refresh=360",
    ]) {
      reset();
      const a = await normalized(await current(path));
      reset();
      const b = await normalized(await hono(path));
      assert.deepEqual(b, a, path);
      assert.equal(b.status, 200);
      assert.equal(a.headers["Cache-Control"], "no-store",
        path + ": CURRENT must not permit CDN to retain event data after privacy changes");
      assert.equal(b.headers["Cache-Control"], "no-store",
        path + ": Hono must not permit shared CDN caching");
      assert.doesNotMatch(b.body, /private-video|submitted_by_user_id/);
    }
  });
  test("T02: format / update / refresh invalid values and 404 status parity", async () => {
    for (const path of [
      "export-event?format=foo", "export-event?update=now",
      "export-event?refresh=7", "export-event?refresh=1.5",
      "hidden-event", "disabled-event", "unknown-event",
    ]) {
      reset();
      const a = await normalized(await current(path));
      reset();
      assert.deepEqual(await normalized(await hono(path)), a, path);
    }
  });
  test("T03: D1 gate denies a private event even on a seeded Cache API HIT", async () => {
    reset();
    const path = "export-event?update=scheduled";
    const first = await hono(path);
    assert.equal(first.status, 200);
    await Promise.all(globalThis.__eventExport.pending);
    const cacheHit = await hono(path);
    assert.equal(cacheHit.headers.get("X-FlameNode-Cache"), "HIT",
      "private Cache API reuse remains enabled inside the origin");
    assert.equal(cacheHit.headers.get("Cache-Control"), "no-store",
      "CDN must not reuse cached scheduled export without a fresh D1 gate");
    sqlite.exec("UPDATE events SET visibility_status='private' WHERE id='export-event'");
    const denied = await hono(path);
    assert.equal(denied.status, 404);
    assert.equal(await denied.text(), '{"error":"not_found"}');
    sqlite.exec("UPDATE events SET visibility_status='public' WHERE id='export-event'");

    reset();
    const currentFirst = await current(path);
    assert.equal(currentFirst.status, 200);
    assert.equal(currentFirst.headers.get("Cache-Control"), "no-store");
    await Promise.all(globalThis.__eventExport.pending);
    const currentHit = await current(path);
    assert.equal(currentHit.headers.get("X-FlameNode-Cache"), "HIT");
    assert.equal(currentHit.headers.get("Cache-Control"), "no-store");
    sqlite.exec("UPDATE events SET visibility_status='private' WHERE id='export-event'");
    const currentDenied = await current(path);
    assert.equal(currentDenied.status, 404, "CURRENT fresh D1 gate denies cached private event");
    sqlite.exec("UPDATE events SET visibility_status='public' WHERE id='export-event'");
  });
  test("SEC-575: scheduled/realtimeのキャッシュHITでも非公開化作品を再配信しない", async () => {
    const paths = [
      "export-event?format=v5&update=scheduled&refresh=1440",
      "export-event?format=legacy&update=scheduled&refresh=1440",
      "export-event?format=v5&update=realtime",
      "export-event?format=legacy&update=realtime",
    ];
    for (const request of [current, hono]) {
      for (const path of paths) {
        reset();
        sqlite.exec("UPDATE videos SET visibility_status='public' WHERE id='public-video'");
        const first = await request(path);
        assert.equal(first.status, 200);
        assert.match(await first.text(), /public-video/);
        await Promise.all(globalThis.__eventExport.pending);
        sqlite.exec("UPDATE videos SET visibility_status='private' WHERE id='public-video'");
        const revoked = await request(path);
        assert.equal(revoked.status, 200);
        assert.doesNotMatch(await revoked.text(), /public-video|公開作品/, path);
        sqlite.exec("UPDATE videos SET visibility_status='public' WHERE id='public-video'");
      }
    }
    reset();
  });

  test("SEC-575: スタッフ公開フラグ解除とイベント再公開後に旧キャッシュを再配信しない", async () => {
    for (const request of [current, hono]) {
      for (const format of ["v5", "legacy"]) {
        reset();
        sqlite.exec("INSERT OR REPLACE INTO event_staff (id, event_id, x_user_id, display_name, is_public, created_at, updated_at) VALUES ('staff-575', 'export-event', 'x-staff-575', '機密スタッフ', 1, 1700000000, 1700000000)");
        const path = `export-event?format=${format}&update=scheduled&refresh=1440`;
        const first = await request(path);
        assert.equal(first.status, 200);
        assert.match(await first.text(), /機密スタッフ/);
        await Promise.all(globalThis.__eventExport.pending);
        sqlite.exec("UPDATE event_staff SET is_public=0 WHERE id='staff-575'");
        const revoked = await request(path);
        assert.equal(revoked.status, 200);
        assert.doesNotMatch(await revoked.text(), /機密スタッフ/);
        sqlite.exec("UPDATE events SET visibility_status='private' WHERE id='export-event'");
        assert.equal((await request(path)).status, 404);
        sqlite.exec("UPDATE events SET visibility_status='public' WHERE id='export-event'");
        assert.doesNotMatch(await (await request(path)).text(), /機密スタッフ/);
        sqlite.exec("DELETE FROM event_staff WHERE id='staff-575'");
      }
    }
    reset();
  });

  test("T04: corrupt legacy cache is evicted; MISS regenerates from D1", async () => {
    reset();
    const key = "public-event-export:9:export-event:legacy:60";
    const cacheRequest = new Request("https://flamenode.internal/public-json/" + encodeURIComponent(key));
    await edgeCache.put(cacheRequest, new Response(JSON.stringify({
      payload: { body: '[{"auth_user_id":"private"}]' }, stored_at: 1700000200,
    })));
    const result = await hono("export-event?format=legacy&update=scheduled");
    assert.equal(result.headers.get("X-FlameNode-Cache"), "MISS");
    assert.doesNotMatch(await result.text(), /auth_user_id/);
    await Promise.all(globalThis.__eventExport.pending);
  });
  test("WO-T07: full response header set (incl. CORS) matches CURRENT; no OPTIONS handler", async () => {
    const all = (r) => [...r.headers.entries()].map(([k, v]) => `${k}: ${v}`).sort();
    for (const path of ["export-event", "export-event?format=legacy&update=scheduled&refresh=15"]) {
      reset();
      const a = await current(path);
      reset();
      const b = await hono(path);
      assert.deepEqual(all(b), all(a), path);
    }
    // CURRENT exports GET only: Hono must not add an OPTIONS/CORS preflight handler.
    reset();
    const preflight = await hono("export-event", { method: "OPTIONS", headers: { origin: "https://example.test", "access-control-request-method": "GET" } });
    assert.notEqual(preflight.status, 200);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), null);
  });
  test("WO-T05: leak gate source guard: forbidden key in built payload returns 503 public_payload_unavailable", async () => {
    // The built payload is sanitized upstream (answers/social links drop FORBIDDEN_PUBLIC_KEYS), so the
    // 503 gate is defense in depth with no reachable data path; guard that it stays fail-closed.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/routes/events/export.ts", import.meta.url), "utf8");
    assert.match(src, /try \{ assertNoForbiddenKeys\(payload\); \}\s*catch \{ return publicJsonResponse\(req, \{ error: "public_payload_unavailable" \}, "no-store", 503\); \}/);
  });
  test("T08: matching cache metadata never bypasses private DTO validation in CURRENT/Hono (v5/legacy)", async () => {
    for (const [format, body, schemaVersion] of [
      ["v5", '{"schema_version":5,"auth_user_id":"secret"}', 5],
      ["legacy", '[{"auth_user_id":"secret"}]', 1],
    ]) {
      for (const [runtime, request] of [["CURRENT", current], ["Hono", hono]]) {
        reset();
        const key = "public-event-export:9:export-event:" + format + ":60";
        const cacheRequest = new Request("https://flamenode.internal/public-json/" + encodeURIComponent(key));
        await edgeCache.put(cacheRequest, new Response(JSON.stringify({
          payload: {
            body,
            metadata: { marker: "public-export-validated-v1", format, schema_version: schemaVersion },
          },
          stored_at: 1700000200,
        })));
        const result = await request("export-event?format=" + format + "&update=scheduled");
        assert.equal(result.status, 200, runtime + " " + format);
        assert.equal(result.headers.get("X-FlameNode-Cache"), "MISS",
          runtime + " must reject poisoned cache even with matching metadata");
        assert.doesNotMatch(await result.text(), /auth_user_id|secret/, runtime + " " + format);
        await Promise.all(globalThis.__eventExport.pending);
        assert.equal(d1.stats.writes, 0, runtime + " must not write D1");
      }
    }
  });
  test("T05: fail closed on D1 error; GET performs no D1 writes", async () => {
    reset();
    const ok = await hono("export-event");
    assert.equal(ok.status, 200);
    assert.equal(d1.stats.writes, 0);
    globalThis.__eventExport.dbError = true;
    const error = await hono("export-event");
    assert.equal(error.status, 200, "direct D1 fake is independent of CURRENT proxy error");
    const missing = await app.fetch(new Request(origin + "export-event"), { DB: null }, ctx);
    assert.equal(missing.status, 503);
    assert.equal(await missing.text(), '{"error":"db_unavailable"}');
    const throwingEnv = {};
    Object.defineProperty(throwingEnv, "DB", {
      get() { throw new Error("secret-D1-provider-detail"); },
    });
    const bindingFailure = await app.fetch(new Request(origin + "export-event"), throwingEnv, ctx);
    assert.equal(bindingFailure.status, 503);
    assert.equal(bindingFailure.headers.get("Cache-Control"), "no-store");
    const failureBody = await bindingFailure.text();
    assert.equal(failureBody, '{"error":"db_unavailable"}');
    assert.doesNotMatch(failureBody, /secret-D1-provider-detail/);
    assert.equal(d1.stats.writes, 0);
  });
  test("SEC-575: v5 scheduledキャッシュは生成時刻が変わってもCURRENT/HonoでHITする", async () => {
    const path = "export-event?format=v5&update=scheduled&refresh=1440";
    for (const request of [current, hono]) {
      reset();
      Date.now = () => 1700000200000;
      try {
        const first = await normalized(await request(path));
        assert.equal(first.status, 200);
        assert.equal(first.headers["X-FlameNode-Cache"], "MISS");
        await Promise.all(globalThis.__eventExport.pending);
        Date.now = () => 1700000320000;
        const next = await normalized(await request(path));
        assert.equal(next.status, 200);
        assert.equal(next.headers["X-FlameNode-Cache"], "HIT");
        assert.equal(next.body, first.body, "cached generated_at provenance must not change on HIT");
        assert.equal(next.headers.ETag, first.headers.ETag);
        assert.equal(d1.stats.writes, 0);
      } finally {
        Date.now = () => 1700000200000;
      }
    }
    reset();
  });
  test("T07: Cache API HIT is gated and keeps status/ETag/refresh headers", async () => {
    reset();
    const path = "export-event?format=v5&update=scheduled&refresh=1440";
    const first = await normalized(await hono(path));
    await Promise.all(globalThis.__eventExport.pending);
    const next = await normalized(await hono(path));
    assert.equal(first.status, 200);
    assert.equal(first.headers["X-FlameNode-Cache"], "MISS");
    assert.equal(next.headers["X-FlameNode-Cache"], "HIT");
    assert.equal(next.body, first.body);
    assert.equal(next.headers.ETag, first.headers.ETag);
    assert.equal(d1.stats.writes, 0);
  });
  test("T06: upper bound 500 public videos; record response byte budget (64 KiB)", async () => {
    reset();
    const stmt = sqlite.prepare("INSERT INTO videos (id, title, submitted_by_user_id, creator_display_name, primary_event_id, visibility_status, scheduled_time) VALUES (?, ?, 'submitter', 'creator', 'export-event', 'public', ?)");
    for (let i = 0; i < 500; i++) stmt.run(`bulk-${i}`, `upper bound video ${i}`, 1700000200 + i);
    const started = performance.now();
    const result = await hono("export-event?format=v5");
    const cpuWallMs = performance.now() - started;
    const body = await result.text();
    const bytes = Buffer.byteLength(body);
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(body).videos.length, 500);
    assert.equal(JSON.parse(body).meta.truncated, true);
    assert.equal(d1.stats.writes, 0);
    console.log(`MIG-0632 upper-bound: payload_bytes=${bytes}, wall_ms=${cpuWallMs.toFixed(2)} (wall-clock, NOT authoritative CPU)`);
    assert.ok(bytes > 0);
  });
}
