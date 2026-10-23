// MIG-0604 U02: RH-020..022 live APIs (CURRENT liveGuard/liveApi contract).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { app } from "../src/app.ts";
import { resetIsolateMicroCacheForTests } from "../src/routes/live/microCache.ts";
import { resetOperationModeCachesForTests } from "../src/routes/live/operationMode.ts";

function createDb({ failAll = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE system_settings (id TEXT PRIMARY KEY, operation_mode TEXT);
    CREATE TABLE events (id TEXT PRIMARY KEY, visibility_status TEXT, slot_visibility_mode TEXT, start_time INTEGER, end_time INTEGER);
    CREATE TABLE slots (id TEXT PRIMARY KEY, event_id TEXT, status TEXT, video_id TEXT, display_name TEXT, start_time INTEGER);
    CREATE TABLE videos (id TEXT PRIMARY KEY, visibility_status TEXT, title TEXT, creator_display_name TEXT, updated_at INTEGER);
    CREATE TABLE video_events (video_id TEXT, event_id TEXT);
    INSERT INTO system_settings VALUES ('default', 'normal');
    INSERT INTO events VALUES ('ev-1', 'public', 'public_name', 1000, 2000);
    INSERT INTO events VALUES ('ev-anon', 'public', 'anonymous', 1000, 2000);
    INSERT INTO events VALUES ('ev-priv', 'private', 'public_name', 1000, 2000);
    INSERT INTO events VALUES ('ev-empty', 'public', 'public_name', NULL, NULL);
    INSERT INTO videos VALUES ('v-pub', 'public', 'T1', 'C1', 50);
    INSERT INTO videos VALUES ('v-priv', 'private', 'T2', 'C2', 60);
    INSERT INTO slots VALUES ('s1', 'ev-1', 'submitted', 'v-pub', 'Alice', 1);
    INSERT INTO slots VALUES ('s2', 'ev-1', 'reserved', 'v-priv', 'Bob', 2);
    INSERT INTO slots VALUES ('s3', 'ev-1', 'available', NULL, NULL, 3);
    INSERT INTO slots VALUES ('a1', 'ev-anon', 'reserved', 'v-pub', 'Secret', 1);
    INSERT INTO video_events VALUES ('v-pub', 'ev-1');
    INSERT INTO video_events VALUES ('v-priv', 'ev-1');
  `);
  let queries = 0;
  const db = {
    prepare: (sql) => ({
      bind: (...p) => ({
        first: async () => {
          queries += 1;
          if (failAll) throw new Error("boom");
          return sqlite.prepare(sql).get(...p) ?? null;
        },
        all: async () => {
          queries += 1;
          if (failAll) throw new Error("boom");
          return { results: sqlite.prepare(sql).all(...p) };
        },
      }),
    }),
  };
  return { db, sqlite, queries: () => queries };
}

const get = (path, env) => app.request(path, {}, env);

beforeEach(() => {
  resetIsolateMicroCacheForTests();
  resetOperationModeCachesForTests();
});

test("slots: public_name event exposes only public video ids; 5s CDN cache header", async () => {
  const { db } = createDb();
  const res = await get("/api/live/events/ev-1/slots", { DB: db });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "public, s-maxage=5, stale-while-revalidate=30");
  assert.match(res.headers.get("content-type"), /application\/json/);
  const body = await res.json();
  assert.equal(body.event_id, "ev-1");
  assert.equal(body.truncated, false);
  assert.deepEqual(body.slots, [
    { id: "s1", status: "submitted", video_id: "v-pub", display_name: "Alice" },
    { id: "s2", status: "reserved", video_id: null, display_name: "Bob" },
    { id: "s3", status: "available", video_id: null, display_name: null },
  ]);
});

test("slots: non public_name visibility hides identity", async () => {
  const { db } = createDb();
  const body = await (await get("/api/live/events/ev-anon/slots", { DB: db })).json();
  assert.deepEqual(body.slots, [{ id: "a1", status: "reserved", video_id: null, display_name: null }]);
});

test("slots: event with no slots -> 200 with empty list; private/unknown -> 404 no-store", async () => {
  const { db } = createDb();
  const empty = await get("/api/live/events/ev-empty/slots", { DB: db });
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).slots, []);
  for (const id of ["ev-priv", "missing"]) {
    const res = await get(`/api/live/events/${id}/slots`, { DB: db });
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { error: "not_found", message: "イベントが見つかりません。" });
  }
});

test("submissions: only public videos, newest first; summary counts slots by status", async () => {
  const { db, sqlite } = createDb();
  sqlite.exec("INSERT INTO videos VALUES ('v-new', 'public', 'T3', 'C3', 90); INSERT INTO video_events VALUES ('v-new', 'ev-1');");
  const sub = await (await get("/api/live/events/ev-1/submissions", { DB: db })).json();
  assert.deepEqual(sub.submissions.map((s) => s.video_id), ["v-new", "v-pub"]);
  const sum = await (await get("/api/live/events/ev-1/summary", { DB: db })).json();
  assert.equal(sum.open_slots, 1);
  assert.equal(sum.reserved_slots, 1);
  assert.equal(sum.submitted, 1);
  assert.equal(sum.freshness, "ended");
  assert.equal((await (await get("/api/live/events/ev-priv/summary", { DB: db })).json()).error, "not_found");
});

test("summary: active within 24h grace after end", async () => {
  const { db, sqlite } = createDb();
  const now = Math.floor(Date.now() / 1000);
  sqlite.prepare("UPDATE events SET end_time = ? WHERE id = 'ev-1'").run(now - 3600);
  assert.equal((await (await get("/api/live/events/ev-1/summary", { DB: db })).json()).freshness, "active");
});

test("invalid id -> 400; no DB -> 503 db_unavailable (no-store)", async () => {
  const { db } = createDb();
  const long = "x".repeat(129);
  const bad = await get(`/api/live/events/${long}/slots`, { DB: db });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "invalid_event_id");
  const noDb = await get("/api/live/events/ev-1/slots", {});
  assert.equal(noDb.status, 503);
  assert.equal(noDb.headers.get("cache-control"), "no-store");
  assert.equal((await noDb.json()).error, "db_unavailable");
});

test("operation mode gate: static_only / maintenance disabled per request, read_only allowed", async () => {
  for (const [mode, status] of [["static_only", 503], ["maintenance", 503], ["read_only", 200], ["economy", 200]]) {
    resetOperationModeCachesForTests();
    const { db, sqlite } = createDb();
    sqlite.prepare("UPDATE system_settings SET operation_mode = ?").run(mode);
    const res = await get("/api/live/events/ev-1/slots", { DB: db });
    assert.equal(res.status, status, mode);
    if (status === 503) {
      assert.equal((await res.json()).error, "live_api_disabled");
      assert.equal(res.headers.get("cache-control"), "no-store");
    }
  }
});

test("FORCE_STATIC_ONLY env and KV mirror take precedence over D1", async () => {
  const { db } = createDb();
  const forced = await get("/api/live/events/ev-1/slots", { DB: db, FORCE_STATIC_ONLY: "Yes" });
  assert.equal(forced.status, 503);
  resetOperationModeCachesForTests();
  const kv = { get: async () => JSON.stringify({ mode: "maintenance", updated_at: 1 }) };
  assert.equal((await get("/api/live/events/ev-1/slots", { DB: db, KV: kv })).status, 503);
  resetOperationModeCachesForTests();
  const badKv = { get: async () => "not json" };
  assert.equal((await get("/api/live/events/ev-1/slots", { DB: db, KV: badKv })).status, 200);
});

test("micro cache coalesces successes (1 D1 snapshot) but never caches 404/errors", async () => {
  const { db, queries } = createDb();
  await get("/api/live/events/ev-1/slots", { DB: db });
  const afterFirst = queries();
  await get("/api/live/events/ev-1/slots", { DB: db });
  await get("/api/live/events/ev-1/slots", { DB: db });
  assert.equal(queries(), afterFirst, "no extra D1 reads while cached");
  const before = queries();
  await get("/api/live/events/missing/slots", { DB: db });
  await get("/api/live/events/missing/slots", { DB: db });
  assert.equal(queries() - before, 2, "404 is re-queried each time");
});

test("D1 failure -> 503 live_api_error no-store; operation-mode D1 failure falls back to normal", async () => {
  const { db } = createDb({ failAll: true });
  const res = await get("/api/live/events/ev-1/slots", { DB: db });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal((await res.json()).error, "live_api_error");
});
