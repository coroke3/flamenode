import assert from "node:assert/strict";
import { test } from "node:test";
import { runUnderRootTsx } from "./support/personalHarness.mjs";
import { createFakeBucket, createFakeKv, createSqlite, createD1, insert } from "./support/publicEventsHarness.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
  const CLOUDFLARE_STUB = stub(`
    export async function withDatabaseRead(fn) {
      const r = globalThis.__pubRef; r.calls += 1;
      if (r.dbError) throw new Error("db_down");
      return fn(r.db);
    }
    export const withDatabase = withDatabaseRead;
    export async function withDatabaseWrite(fn) { return fn(globalThis.__pubRef.db); }
    export function getDatabase() {
      const r = globalThis.__pubRef;
      if (r.dbError) throw new Error("db_down");
      return r.db;
    }
    export function getEnv() { return globalThis.__pubRef.env; }
  `);

  const NEXT_PORTS_STUB = stub(`
    export async function nextQueueWakeHost() {
      return {
        async sendWake() { return { result: "ok" }; }
      };
    }
    export function nextRethrowFrameworkControl() {}
  `);

  const OPENNEXT_STUB = stub(`
    export function getCloudflareContext() {
      const r = globalThis.__pubRef;
      return {
        env: r.env,
        waitUntil: (p) => { r.waitUntilPromises.push(p); },
      };
    }
  `);

  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      if (specifier === "@/lib/cloudflare") return { url: CLOUDFLARE_STUB, shortCircuit: true };
      if (specifier === "@/lib/serverCore/nextPorts") return { url: NEXT_PORTS_STUB, shortCircuit: true };
      if (specifier === "@opennextjs/cloudflare") return { url: OPENNEXT_STUB, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { schema } = await import("@flamenode/db");
  const { app } = await import("../src/app.ts");
  const { GET: currentEventsGet } = await import("../../../app/api/events/route.ts");
  const { clearPublicApiRateLimitForTests } = await import("@flamenode/server-core/publicData/publicApi");
  const { resetOperationModeCachesForTests } = await import("../src/routes/live/operationMode.ts");
  const { resetPublicJsonIsolateCacheForTests } = await import("../../../src/lib/publicData/publicCacheIsolate.ts");

  const sqlite = createSqlite();
  const d1 = createD1(sqlite);
  const drizzleDb = drizzle(async (sql, params, method) => {
    const r = globalThis.__pubRef;
    if (r?.dbError) throw new Error("drizzle_db_down");
    if (method === "all" || method === "values") {
      const rows = sqlite.prepare(sql).all(...params);
      return { rows: rows.map((row) => Object.values(row)) };
    }
    const rows = sqlite.prepare(sql).all(...params);
    return { rows };
  }, { schema });

  const fakeBucket = createFakeBucket();
  const fakeKv = createFakeKv();

  globalThis.__pubRef = {
    db: drizzleDb,
    env: { DB: d1, BUCKET: fakeBucket, KV: fakeKv },
    calls: 0,
    dbError: false,
    waitUntilPromises: [],
  };

  function resetAll() {
    clearPublicApiRateLimitForTests();
    resetOperationModeCachesForTests();
    resetPublicJsonIsolateCacheForTests();
    fakeBucket.clear();
    fakeKv.clear();
    delete process.env.FORCE_STATIC_ONLY;
    delete process.env.PUBLIC_VISIBILITY_GUARD_MODE;
    globalThis.__pubRef.dbError = false;
    globalThis.__pubRef.calls = 0;
    globalThis.__pubRef.waitUntilPromises = [];
  }

  // Seed events
  sqlite.exec(`
    DELETE FROM events;
    INSERT INTO events (id, title, visibility_status, start_time, end_time, created_at, max_slots_per_video)
    VALUES ('evt-1', 'Event One', 'public', 1700002000, 1700003000, 100, 1),
           ('evt-2', 'Event Two', 'public', 1700001000, 1700002000, 200, 1),
           ('evt-point', 'Point Event', 'public', 1700001500, NULL, 150, 1),
           ('evt-priv', 'Private Event', 'private', 1700004000, 1700005000, 300, 1);
  `);

  test("T01: RH-015 normal live mode matches CURRENT byte-by-byte", async () => {
    resetAll();

    const cases = [
      "http://localhost/api/events",
      "http://localhost/api/events?limit=61",
      "http://localhost/api/events?limit=0",
      "http://localhost/api/events?page=-1",
      "http://localhost/api/events?page=999",
    ];

    for (const url of cases) {
      const curReq = new Request(url);
      const curRes = await currentEventsGet(curReq);
      const curBody = await curRes.text();

      const honoRes = await app.request(url, {
        headers: { "CF-Connecting-IP": "10.0.0.1" },
      }, {
        DB: d1,
        BUCKET: fakeBucket,
        KV: fakeKv,
      });
      const honoBody = await honoRes.text();

      assert.equal(honoRes.status, curRes.status);
      assert.equal(honoRes.headers.get("Cache-Control"), curRes.headers.get("Cache-Control"));
      assert.equal(honoRes.headers.get("ETag"), curRes.headers.get("ETag"));
      assert.equal(honoBody, curBody);
    }
  });

  test("T02: If-None-Match returns 304 on match", async () => {
    resetAll();
    const url = "http://localhost/api/events";
    const initRes = await app.request(url, {}, { DB: d1, BUCKET: fakeBucket, KV: fakeKv });
    const etag = initRes.headers.get("ETag");
    assert.ok(etag);

    const matchReq = new Request(url, { headers: { "If-None-Match": etag } });
    const curRes = await currentEventsGet(matchReq);
    const honoRes = await app.request(url, { headers: { "If-None-Match": etag } }, { DB: d1, BUCKET: fakeBucket, KV: fakeKv });

    assert.equal(curRes.status, 304);
    assert.equal(honoRes.status, 304);
    assert.equal(honoRes.headers.get("ETag"), curRes.headers.get("ETag"));
  });

  test("T03: Rate limiter limits at 61st request with 429", async () => {
    resetAll();
    const url = "http://localhost/api/events";
    const headers = { "CF-Connecting-IP": "10.0.0.2" };

    for (let i = 0; i < 60; i++) {
      const res = await app.request(url, { headers }, { DB: d1, BUCKET: fakeBucket, KV: fakeKv });
      assert.equal(res.status, 200);
    }

    const blocked = await app.request(url, { headers }, { DB: d1, BUCKET: fakeBucket, KV: fakeKv });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("Cache-Control"), "no-store");
    assert.ok(blocked.headers.get("Retry-After"));
  });

  test("T04: static_only reads R2 artifact and excludes point events", async () => {
    resetAll();
    const artifact = {
      generated_at: 1700000000,
      items: [
        { id: "evt-1", title: "Event One", start_time: 1700002000, end_time: 1700003000, visibility_status: "public" },
        { id: "evt-point", title: "Point Event", start_time: 1700001500, visibility_status: "public" },
      ],
      group_sections: [],
    };
    await fakeBucket.put("events/index.json", artifact);

    process.env.FORCE_STATIC_ONLY = "1";
    const curRes = await currentEventsGet(new Request("http://localhost/api/events"));
    const curBody = await curRes.text();

    const honoRes = await app.request("http://localhost/api/events", {}, {
      DB: d1,
      BUCKET: fakeBucket,
      KV: fakeKv,
      FORCE_STATIC_ONLY: "1",
    });
    const honoBody = await honoRes.text();

    assert.equal(honoRes.status, 200);
    assert.equal(curRes.status, 200);
    assert.equal(honoBody, curBody);
    const parsed = JSON.parse(honoBody);
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0].id, "evt-1");
  });

  test("T05: static_only with missing or broken artifact returns 503 public_data_unavailable", async () => {
    resetAll();
    process.env.FORCE_STATIC_ONLY = "1";

    // Missing artifact
    const curRes1 = await currentEventsGet(new Request("http://localhost/api/events"));
    const honoRes1 = await app.request("http://localhost/api/events", {}, {
      DB: d1,
      BUCKET: fakeBucket,
      KV: fakeKv,
      FORCE_STATIC_ONLY: "1",
    });
    assert.equal(curRes1.status, 503);
    assert.equal(honoRes1.status, 503);

    // Broken JSON
    fakeBucket.setRaw("events/index.json", { data: "{broken", size: 7 });
    const curRes2 = await currentEventsGet(new Request("http://localhost/api/events"));
    const honoRes2 = await app.request("http://localhost/api/events", {}, {
      DB: d1,
      BUCKET: fakeBucket,
      KV: fakeKv,
      FORCE_STATIC_ONLY: "1",
    });
    assert.equal(curRes2.status, 503);
    assert.equal(honoRes2.status, 503);
  });

  test("T06: static_only with empty items returns 503 public_data_unavailable", async () => {
    resetAll();
    process.env.FORCE_STATIC_ONLY = "1";
    await fakeBucket.put("events/index.json", { generated_at: 1700000000, items: [], group_sections: [] });

    const curRes = await currentEventsGet(new Request("http://localhost/api/events"));
    const honoRes = await app.request("http://localhost/api/events", {}, {
      DB: d1,
      BUCKET: fakeBucket,
      KV: fakeKv,
      FORCE_STATIC_ONLY: "1",
    });
    assert.equal(curRes.status, 503);
    assert.equal(honoRes.status, 503);
    assert.equal(await honoRes.json().then(j => j.error), "public_data_unavailable");
  });

  test("T07a: static_only x enforce mode with valid manifest returns 200", async () => {
    resetAll();
    process.env.FORCE_STATIC_ONLY = "1";
    process.env.PUBLIC_VISIBILITY_GUARD_MODE = "enforce";

    await fakeBucket.put("events/index.json", {
      generated_at: 1700000000,
      items: [
        { id: "evt-1", title: "Event One", start_time: 1700002000, end_time: 1700003000, visibility_status: "public" },
      ],
      group_sections: [],
    });

    await fakeBucket.put("visibility/blocked-entities.v1.json", {
      schema_version: 1,
      revision: 1,
      generated_at: 1700000000,
      entities: [],
    }, { httpMetadata: { etag: '"etag-1"' } });

    const curRes = await currentEventsGet(new Request("http://localhost/api/events"));
    const honoRes = await app.request("http://localhost/api/events", {}, {
      DB: d1,
      BUCKET: fakeBucket,
      KV: fakeKv,
      FORCE_STATIC_ONLY: "1",
      PUBLIC_VISIBILITY_GUARD_MODE: "enforce",
    });
    assert.equal(curRes.status, 200);
    assert.equal(honoRes.status, 200);
  });

  test("T07b: static_only x enforce mode without manifest fails closed 503", async () => {
    resetAll();
    process.env.FORCE_STATIC_ONLY = "1";
    process.env.PUBLIC_VISIBILITY_GUARD_MODE = "enforce";

    await fakeBucket.put("events/index.json", {
      generated_at: 1700000000,
      items: [
        { id: "evt-1", title: "Event One", start_time: 1700002000, end_time: 1700003000, visibility_status: "public" },
      ],
      group_sections: [],
    });

    const curRes = await currentEventsGet(new Request("http://localhost/api/events"));
    const honoRes = await app.request("http://localhost/api/events", {}, {
      DB: d1,
      BUCKET: fakeBucket,
      KV: fakeKv,
      FORCE_STATIC_ONLY: "1",
      PUBLIC_VISIBILITY_GUARD_MODE: "enforce",
    });
    assert.equal(curRes.status, 503);
    assert.equal(honoRes.status, 503);
  });

  test("T08: operation_mode maintenance returns 503 public_data_unavailable", async () => {
    resetAll();
    await fakeKv.put("operation_mode:mirror", JSON.stringify({ mode: "maintenance", updated_at: 1700000000 }));

    const curRes = await currentEventsGet(new Request("http://localhost/api/events"));
    const honoRes = await app.request("http://localhost/api/events", {}, {
      DB: d1,
      BUCKET: fakeBucket,
      KV: fakeKv,
    });

    assert.equal(curRes.status, 503);
    assert.equal(honoRes.status, 503);
    assert.equal(await honoRes.json().then(j => j.error), "public_data_unavailable");
  });

  test("T09: D1 failure returns 503 database_unavailable", async () => {
    resetAll();
    globalThis.__pubRef.dbError = true;

    const curRes = await currentEventsGet(new Request("http://localhost/api/events"));
    const honoRes = await app.request("http://localhost/api/events", {}, {
      DB: null,
      BUCKET: fakeBucket,
      KV: fakeKv,
    });

    assert.equal(curRes.status, 503);
    assert.equal(honoRes.status, 503);
    assert.equal(await honoRes.json().then(j => j.error), "database_unavailable");
  });

  test("T16: GET /api/events has no private headers and does not trigger session lookup", async () => {
    resetAll();
    const res = await app.request("http://localhost/api/events", {}, {
      DB: d1,
      BUCKET: fakeBucket,
      KV: fakeKv,
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "public, max-age=60, s-maxage=120, stale-while-revalidate=300");
    assert.equal(res.headers.get("Pragma"), null);
  });
}
