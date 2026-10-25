import assert from "node:assert/strict";
import { test } from "node:test";
import { runUnderRootTsx } from "./support/personalHarness.mjs";
import { createFakeBucket, createFakeKv, createSqlite, createD1, insert } from "./support/publicEventsHarness.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
  const CLOUDFLARE_STUB = stub(`
    export class CloudflareBindingsUnavailableError extends Error {
      constructor(missing = [], cause) {
        super("Cloudflare bindings unavailable: " + missing.join(", "));
        this.name = "CloudflareBindingsUnavailableError";
        this.missing = missing;
        this.cause = cause;
      }
    }
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
  const { GET: currentReleaseGet } = await import("../../../app/api/event-endpoints/[id]/release/route.ts");
  const { clearPublicApiRateLimitForTests } = await import("@flamenode/server-core/publicData/publicApi");
  const { resetOperationModeCachesForTests } = await import("../src/routes/live/operationMode.ts");
  const { resetPublicJsonIsolateCacheForTests } = await import("../../../src/lib/publicData/publicCacheIsolate.ts");
  const { resetPublicOperationModeCacheForTests } = await import("../../../src/lib/operationMode/publicModeCore.ts");
  const { resetDegradedCircuitBookkeepingForTests } = await import("../../../src/lib/publicData/degradedCircuitBreaker.ts");

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

  // CURRENT's KV operation-mode mirror cache (src/lib/operationMode/kvMirror.ts, 30 s TTL) has no
  // test reset; advance the clock past it on every reset so cases do not inherit the previous mode.
  const realNow = Date.now.bind(Date);
  let clockOffset = 0;
  Date.now = () => realNow() + clockOffset;

  function resetAll() {
    clockOffset += 31_000;
    clearPublicApiRateLimitForTests();
    resetOperationModeCachesForTests();
    resetPublicJsonIsolateCacheForTests();
    resetPublicOperationModeCacheForTests();
    resetDegradedCircuitBookkeepingForTests();
    fakeBucket.clear();
    fakeKv.clear();
    delete process.env.FORCE_STATIC_ONLY;
    delete process.env.PUBLIC_VISIBILITY_GUARD_MODE;
    globalThis.__pubRef.dbError = false;
    globalThis.__pubRef.calls = 0;
    globalThis.__pubRef.waitUntilPromises = [];
    d1.stats.statements = 0;
    d1.stats.writes = 0;
    d1.stats.maxBinds = 0;
    d1.stats.batches = 0;
  }

  // Seed events
  sqlite.exec(`
    DELETE FROM events;
    INSERT INTO events (id, title, visibility_status, start_time, end_time, created_at, max_slots_per_video, public_api_enabled)
    VALUES ('evt-1', 'Event One', 'public', 1700002000, 1700003000, 100, 1, 1),
           ('evt-2', 'Event Two', 'public', 1700001000, 1700002000, 200, 1, 0),
           ('evt-point', 'Point Event', 'public', 1700001500, NULL, 150, 1, 1),
           ('evt-priv', 'Private Event', 'private', 1700004000, 1700005000, 300, 1, 1);
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

  test("T10: RH-012 public + enabled + artifact returns 200 matching CURRENT", async () => {
    resetAll();
    const artifact = {
      schema_version: 1,
      generated_at: 1700000000,
      event: { id: "evt-1", title: "Event One", visibility_status: "public" },
      videos: [
        {
          id: "vid-1",
          title: "Video 1",
          visibility_status: "public",
          collaboration_type: "individual",
          creator_display_name: "Alice",
          members: [],
        },
      ],
      total: 1,
    };
    await fakeBucket.put("events/evt-1/release.v1.json", artifact);

    const curReq = new Request("http://localhost/api/event-endpoints/evt-1/release");
    const curRes = await currentReleaseGet(curReq, { params: Promise.resolve({ id: "evt-1" }) });
    const curBody = await curRes.text();

    const honoRes = await app.request("http://localhost/api/event-endpoints/evt-1/release", {}, {
      DB: d1,
      BUCKET: fakeBucket,
      KV: fakeKv,
    });
    const honoBody = await honoRes.text();

    assert.equal(honoRes.status, 200);
    assert.equal(curRes.status, 200);
    assert.equal(honoRes.headers.get("Cache-Control"), curRes.headers.get("Cache-Control"));
    assert.equal(honoRes.headers.get("ETag"), curRes.headers.get("ETag"));
    assert.equal(honoBody, curBody);
  });

  test("T11: RH-012 private / disabled / missing / overlong id returns 404 matching CURRENT", async () => {
    resetAll();
    const cases = [
      "evt-priv", // private
      "evt-2",    // public_api_enabled = 0
      "evt-404",  // missing
      "a".repeat(129), // > 128
      "%E0%A4%A", // malformed percent
    ];

    for (const id of cases) {
      const curReq = new Request(`http://localhost/api/event-endpoints/${id}/release`);
      const curRes = await currentReleaseGet(curReq, { params: Promise.resolve({ id }) });

      const honoRes = await app.request(`http://localhost/api/event-endpoints/${id}/release`, {}, {
        DB: d1,
        BUCKET: fakeBucket,
        KV: fakeKv,
      });

      assert.equal(curRes.status, 404);
      assert.equal(honoRes.status, 404);
      assert.equal(honoRes.headers.get("Cache-Control"), "public, max-age=60");
      assert.equal(await honoRes.json().then(j => j.error), "not_found");
    }
  });

  test("T12: RH-012 missing artifact returns 503 public_data_unavailable", async () => {
    resetAll();
    const honoRes = await app.request("http://localhost/api/event-endpoints/evt-1/release", {}, {
      DB: d1,
      BUCKET: fakeBucket,
      KV: fakeKv,
    });
    assert.equal(honoRes.status, 503);
    assert.equal(await honoRes.json().then(j => j.error), "public_data_unavailable");
  });

  test("T13: RH-012 artifact event.id mismatch returns 503 public_data_unavailable", async () => {
    resetAll();
    const artifact = {
      schema_version: 1,
      generated_at: 1700000000,
      event: { id: "evt-OTHER", title: "Wrong Event", visibility_status: "public" },
      videos: [],
    };
    await fakeBucket.put("events/evt-1/release.v1.json", artifact);

    const curReq = new Request("http://localhost/api/event-endpoints/evt-1/release");
    const curRes = await currentReleaseGet(curReq, { params: Promise.resolve({ id: "evt-1" }) });

    const honoRes = await app.request("http://localhost/api/event-endpoints/evt-1/release", {}, {
      DB: d1,
      BUCKET: fakeBucket,
      KV: fakeKv,
    });

    assert.equal(curRes.status, 503);
    assert.equal(honoRes.status, 503);
    assert.equal(await honoRes.json().then(j => j.error), "public_data_unavailable");
  });

  test("T14: RH-012 guard mode blocked event returns 404 in enforce mode", async () => {
    resetAll();
    const artifact = {
      schema_version: 1,
      generated_at: 1700000000,
      event: { id: "evt-1", title: "Event One", visibility_status: "public" },
      videos: [],
    };
    await fakeBucket.put("events/evt-1/release.v1.json", artifact);

    await fakeBucket.put("visibility/blocked-entities.v1.json", {
      schema_version: 1,
      revision: 1,
      generated_at: 1700000000,
      entities: [
        { entity_type: "event", entity_id: "evt-1", fence_token: "t1", blocked_at: 1700000000 },
      ],
    }, { httpMetadata: { etag: '"etag-1"' } });

    process.env.PUBLIC_VISIBILITY_GUARD_MODE = "enforce";
    const curReq = new Request("http://localhost/api/event-endpoints/evt-1/release");
    const curRes = await currentReleaseGet(curReq, { params: Promise.resolve({ id: "evt-1" }) });

    const honoRes = await app.request("http://localhost/api/event-endpoints/evt-1/release", {}, {
      DB: d1,
      BUCKET: fakeBucket,
      KV: fakeKv,
      PUBLIC_VISIBILITY_GUARD_MODE: "enforce",
    });

    assert.equal(curRes.status, 404);
    assert.equal(honoRes.status, 404);
  });

  test("T15: RH-012 filters private videos and updates total", async () => {
    resetAll();
    const artifact = {
      schema_version: 1,
      generated_at: 1700000000,
      event: { id: "evt-1", title: "Event One", visibility_status: "public" },
      videos: [
        { id: "vid-1", title: "Public", visibility_status: "public", collaboration_type: "individual", creator_display_name: "Alice", members: [] },
        { id: "vid-2", title: "Private", visibility_status: "private", collaboration_type: "individual", creator_display_name: "Bob", members: [] },
      ],
      total: 2,
    };
    await fakeBucket.put("events/evt-1/release.v1.json", artifact);

    const curReq = new Request("http://localhost/api/event-endpoints/evt-1/release");
    const curRes = await currentReleaseGet(curReq, { params: Promise.resolve({ id: "evt-1" }) });
    const curJson = await curRes.json();

    const honoRes = await app.request("http://localhost/api/event-endpoints/evt-1/release", {}, {
      DB: d1,
      BUCKET: fakeBucket,
      KV: fakeKv,
    });
    const honoJson = await honoRes.json();

    assert.equal(curRes.status, 200);
    assert.equal(honoRes.status, 200);
    assert.equal(honoJson.videos.length, 1);
    assert.equal(honoJson.videos[0].id, "vid-1");
    assert.equal(honoJson.total, 1);
    assert.deepEqual(honoJson, curJson);
  });

  test("T17: S2 limits & budget measurements at boundary inputs (RH-015 and RH-012)", async () => {
    resetAll();

    // 1. RH-015 live mode with 60 public events having long explanation (500 chars)
    const longExplanation = "x".repeat(500);
    const stmt = sqlite.prepare(`
      INSERT INTO events (id, title, visibility_status, start_time, end_time, created_at, max_slots_per_video, public_api_enabled, explanation)
      VALUES (?, ?, 'public', ?, ?, ?, 1, 1, ?)
    `);
    for (let i = 10; i < 70; i++) {
      stmt.run(`evt-long-${i}`, `Long Event ${i}`, 1700000000 + i * 10, 1700001000 + i * 10, i * 10, longExplanation);
    }

    d1.stats.statements = 0;
    d1.stats.writes = 0;
    const liveRes = await app.request("http://localhost/api/events?limit=60", {}, {
      DB: d1,
      BUCKET: fakeBucket,
      KV: fakeKv,
    });
    const liveBody = await liveRes.text();
    const liveBytes = Buffer.byteLength(liveBody);
    const liveStatements = d1.stats.statements;
    assert.equal(liveRes.status, 200);
    assert.equal(liveStatements, 1);
    assert.equal(d1.stats.writes, 0);

    // Large page: OFFSET near total
    d1.stats.statements = 0;
    const largePageRes = await app.request("http://localhost/api/events?page=2&limit=60", {}, {
      DB: d1,
      BUCKET: fakeBucket,
      KV: fakeKv,
    });
    const largePageStatements = d1.stats.statements;
    assert.equal(largePageRes.status, 200);
    assert.equal(largePageStatements, 1);

    // 2. RH-015 static_only mode with 200 events + group sections, ~1 MiB manifest
    const staticItems = Array.from({ length: 200 }, (_, i) => ({
      id: `evt-static-${i}`,
      title: `Static Event ${i}`,
      visibility_status: "public",
      start_time: 1700000000 + i * 10,
      end_time: 1700001000 + i * 10,
      format: "offline",
      group_sections: [{ id: `grp-${i}`, title: `Group ${i}`, display_order: 1 }],
    }));
    await fakeBucket.put("events/index.json", {
      schema_version: 1,
      generated_at: 1700000000,
      items: staticItems,
      total: 200,
    });
    // Create ~1 MiB manifest: entities array with many entries (under 1024 * 1024 bytes)
    const manifestEntities = Array.from({ length: 8000 }, (_, i) => ({
      entity_type: "event",
      entity_id: `blocked-evt-${i}`,
      fence_token: `token-${i}`,
      blocked_at: 1700000000,
    }));
    await fakeBucket.put("visibility/blocked-entities.v1.json", {
      schema_version: 1,
      revision: 1,
      generated_at: 1700000000,
      entities: manifestEntities,
    }, { httpMetadata: { etag: '"manifest-1mib"' } });

    d1.stats.statements = 0;
    const staticRes = await app.request("http://localhost/api/events", {}, {
      DB: d1,
      BUCKET: fakeBucket,
      KV: fakeKv,
      FORCE_STATIC_ONLY: "1",
      PUBLIC_VISIBILITY_GUARD_MODE: "enforce",
    });
    const staticBody = await staticRes.text();
    const staticBytes = Buffer.byteLength(staticBody);
    const staticStatements = d1.stats.statements;
    assert.equal(staticRes.status, 200);
    assert.equal(staticStatements, 0);

    // 3. RH-012 with 500 videos x 100 members
    const members100 = Array.from({ length: 100 }, (_, i) => ({
      user_id: `usr-${i}`,
      display_name: `Member ${i}`,
      role: "member",
    }));
    const videos500 = Array.from({ length: 500 }, (_, i) => ({
      id: `vid-big-${i}`,
      title: `Big Video ${i}`,
      visibility_status: "public",
      collaboration_type: "group",
      creator_display_name: `Creator ${i}`,
      members: members100,
    }));
    await fakeBucket.put("events/evt-big-rel/release.v1.json", {
      schema_version: 1,
      generated_at: 1700000000,
      event: { id: "evt-big-rel", title: "Big Release Event", visibility_status: "public" },
      videos: videos500,
      total: 500,
    });
    sqlite.exec(`
      INSERT INTO events (id, title, visibility_status, start_time, end_time, created_at, max_slots_per_video, public_api_enabled)
      VALUES ('evt-big-rel', 'Big Release Event', 'public', 1700000000, 1700001000, 100, 1, 1);
    `);

    d1.stats.statements = 0;
    d1.stats.writes = 0;
    const releaseRes = await app.request("http://localhost/api/event-endpoints/evt-big-rel/release", {}, {
      DB: d1,
      BUCKET: fakeBucket,
      KV: fakeKv,
    });
    const releaseBody = await releaseRes.text();
    const releaseBytes = Buffer.byteLength(releaseBody);
    const releaseStatements = d1.stats.statements;
    assert.equal(releaseRes.status, 200);
    assert.equal(releaseStatements, 1);
    assert.equal(d1.stats.writes, 0);

    console.log(
      `[events-public budget] ` +
      `RH-015_live: bytes=${liveBytes} D1_statements=${liveStatements} large_page_D1_statements=${largePageStatements} | ` +
      `RH-015_static: bytes=${staticBytes} D1_statements=${staticStatements} | ` +
      `RH-012: bytes=${releaseBytes} D1_statements=${releaseStatements} writes=0 CPU=unmeasured`
    );
  });

  // --- Work Order T-case coverage added in review (T01 budget, T05/T07/T08/T09/T12/T14/T16 gaps) ---
  const queueRows = () => sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n;
  const failingD1 = {
    prepare() {
      const stmt = {
        bind() { return stmt; },
        async all() { throw new Error("d1_down"); },
        async first() { throw new Error("d1_down"); },
      };
      return stmt;
    },
  };
  function countingBucket() {
    const counter = { gets: 0 };
    const bucket = {
      ...fakeBucket,
      async get(key) {
        counter.gets += 1;
        return fakeBucket.get(key);
      },
    };
    return { bucket, counter };
  }
  const INDEX_WITH_GROUP = {
    generated_at: 1700000000,
    items: [
      { id: "evt-1", title: "Event One", start_time: 1700002000, end_time: 1700003000, visibility_status: "public" },
      { id: "evt-blocked", title: "Blocked", start_time: 1700001900, end_time: 1700002900, visibility_status: "public" },
    ],
    group_sections: [
      { id: "grp-open", title: "Open", visibility_status: "public", events: [{ id: "evt-1", title: "Event One", visibility_status: "public" }] },
      { id: "grp-blocked", title: "Closed", visibility_status: "public", events: [] },
    ],
  };
  const BLOCK_MANIFEST = {
    schema_version: 1,
    revision: 2,
    generated_at: 1700000000,
    entities: [
      { entity_type: "event", entity_id: "evt-blocked", fence_token: "t1", blocked_at: 1700000000 },
      { entity_type: "event_group", entity_id: "grp-blocked", fence_token: "t2", blocked_at: 1700000000 },
    ],
  };

  async function compareList(env, label) {
    clockOffset += 31_000;
    resetPublicJsonIsolateCacheForTests();
    resetPublicOperationModeCacheForTests();
    resetDegradedCircuitBookkeepingForTests();
    resetOperationModeCachesForTests();
    clearPublicApiRateLimitForTests();
    const curRes = await currentEventsGet(new Request("http://localhost/api/events"));
    const curBody = await curRes.text();
    const honoRes = await app.request("http://localhost/api/events", {}, { DB: d1, BUCKET: fakeBucket, KV: fakeKv, ...env });
    const honoBody = await honoRes.text();
    assert.equal(honoRes.status, curRes.status, `${label}: status`);
    assert.equal(honoBody, curBody, `${label}: body`);
    return { status: honoRes.status, body: honoBody };
  }

  test("T01b: RH-015 live mode uses exactly 1 D1 statement and 0 R2 reads per request", async () => {
    resetAll();
    const { bucket, counter } = countingBucket();
    for (const url of ["http://localhost/api/events", "http://localhost/api/events?page=3&limit=2"]) {
      d1.stats.statements = 0;
      d1.stats.writes = 0;
      counter.gets = 0;
      const res = await app.request(url, {}, { DB: d1, BUCKET: bucket, KV: fakeKv });
      assert.equal(res.status, 200);
      assert.equal(d1.stats.statements, 1);
      assert.equal(d1.stats.writes, 0);
      assert.equal(counter.gets, 0);
    }
  });

  test("T05b: DOCUMENTED DIFFERENCE L3 — static_only miss (missing / broken / >16 MiB): same 503 code, CURRENT enqueues, Hono writes nothing", async () => {
    const variants = [
      ["missing", () => {}],
      ["broken", () => fakeBucket.setRaw("events/index.json", { data: "{broken", size: 7 })],
      ["oversize", () => fakeBucket.setRaw("events/index.json", { data: INDEX_WITH_GROUP, size: 16 * 1024 * 1024 + 1 })],
    ];
    for (const [label, seed] of variants) {
      resetAll();
      sqlite.exec("DELETE FROM static_rebuild_queue");
      process.env.FORCE_STATIC_ONLY = "1";
      seed();
      const curRes = await currentEventsGet(new Request("http://localhost/api/events"));
      await Promise.allSettled(globalThis.__pubRef.waitUntilPromises);
      const curRows = queueRows();
      const honoRes = await app.request("http://localhost/api/events", {}, { DB: d1, BUCKET: fakeBucket, KV: fakeKv, FORCE_STATIC_ONLY: "1" });
      assert.equal(curRes.status, 503, label);
      assert.equal(honoRes.status, 503, label);
      assert.equal((await honoRes.json()).error, (await curRes.json()).error, label);
      assert.ok(curRows >= 1, `${label}: CURRENT enqueues a rebuild row`);
      assert.equal(queueRows(), curRows, `${label}: Hono adds no queue row`);
      assert.equal(d1.stats.statements, 0, `${label}: Hono issues no D1 statement`);
    }
  });

  test("T07c: static_only x guard modes (enforce ETag-less / event+group block, observe, off) match CURRENT", async () => {
    const modes = [
      ["enforce-etagless", "enforce", { etag: null }],
      ["enforce-block", "enforce", { etag: '"m-2"' }],
      ["observe-block", "observe", { etag: '"m-2"' }],
      ["off-block", "off", { etag: '"m-2"' }],
    ];
    const results = {};
    for (const [label, mode, manifest] of modes) {
      resetAll();
      process.env.FORCE_STATIC_ONLY = "1";
      process.env.PUBLIC_VISIBILITY_GUARD_MODE = mode;
      await fakeBucket.put("events/index.json", INDEX_WITH_GROUP);
      if (manifest.etag === null) {
        fakeBucket.setRaw("visibility/blocked-entities.v1.json", { data: BLOCK_MANIFEST, etag: "" });
      } else {
        await fakeBucket.put("visibility/blocked-entities.v1.json", BLOCK_MANIFEST, { httpMetadata: { etag: manifest.etag } });
      }
      results[label] = await compareList({ FORCE_STATIC_ONLY: "1", PUBLIC_VISIBILITY_GUARD_MODE: mode }, label);
    }
    assert.equal(results["enforce-etagless"].status, 503);
    const enforced = JSON.parse(results["enforce-block"].body);
    assert.deepEqual(enforced.items.map((row) => row.id), ["evt-1"]);
    for (const label of ["observe-block", "off-block"]) {
      assert.deepEqual(JSON.parse(results[label].body).items.map((row) => row.id), ["evt-1", "evt-blocked"], label);
    }
  });

  test("T08b: RH-012 under maintenance returns 503 public_data_unavailable like CURRENT", async () => {
    resetAll();
    await fakeBucket.put("events/evt-1/release.v1.json", { schema_version: 1, generated_at: 1700000000, event: { id: "evt-1", title: "Event One", visibility_status: "public" }, videos: [], total: 0 });
    await fakeKv.put("operation_mode:mirror", JSON.stringify({ mode: "maintenance", updated_at: 1700000000 }));
    const curRes = await currentReleaseGet(new Request("http://localhost/api/event-endpoints/evt-1/release"), { params: Promise.resolve({ id: "evt-1" }) });
    const honoRes = await app.request("http://localhost/api/event-endpoints/evt-1/release", {}, { DB: d1, BUCKET: fakeBucket, KV: fakeKv });
    assert.equal(curRes.status, 503);
    assert.equal(honoRes.status, 503);
    assert.equal((await honoRes.json()).error, "public_data_unavailable");
    assert.equal((await curRes.json()).error, "public_data_unavailable");
  });

  test("T09b: live mode D1 query failure and missing DB both return CURRENT's 503 database_unavailable", async () => {
    resetAll();
    globalThis.__pubRef.dbError = true;
    const curRes = await currentEventsGet(new Request("http://localhost/api/events"));
    const curCode = (await curRes.json()).error;
    for (const DB of [failingD1, undefined]) {
      clearPublicApiRateLimitForTests();
      const honoRes = await app.request("http://localhost/api/events", {}, { DB, BUCKET: fakeBucket, KV: fakeKv });
      assert.equal(honoRes.status, curRes.status);
      assert.equal((await honoRes.json()).error, curCode);
    }
    assert.equal(curCode, "database_unavailable");
  });

  test("T12b: DOCUMENTED DIFFERENCE L3 — RH-012 missing artifact: CURRENT public_data_reflecting + enqueue, Hono public_data_unavailable + no write", async () => {
    resetAll();
    sqlite.exec("DELETE FROM static_rebuild_queue");
    const curRes = await currentReleaseGet(new Request("http://localhost/api/event-endpoints/evt-1/release"), { params: Promise.resolve({ id: "evt-1" }) });
    await Promise.allSettled(globalThis.__pubRef.waitUntilPromises);
    const curRows = queueRows();
    d1.stats.statements = 0;
    d1.stats.writes = 0;
    const honoRes = await app.request("http://localhost/api/event-endpoints/evt-1/release", {}, { DB: d1, BUCKET: fakeBucket, KV: fakeKv });
    assert.equal(curRes.status, 503);
    assert.equal((await curRes.json()).error, "public_data_reflecting");
    assert.ok(curRows >= 1);
    assert.equal(honoRes.status, 503);
    assert.equal((await honoRes.json()).error, "public_data_unavailable");
    assert.equal(queueRows(), curRows);
    assert.equal(d1.stats.statements, 1);
    assert.equal(d1.stats.writes, 0);
  });

  test("T14b: RH-012 guard modes (enforce without manifest, observe block, off block) match CURRENT", async () => {
    const artifact = { schema_version: 1, generated_at: 1700000000, event: { id: "evt-1", title: "Event One", visibility_status: "public" }, videos: [], total: 0 };
    const blockEvt1 = { ...BLOCK_MANIFEST, entities: [{ entity_type: "event", entity_id: "evt-1", fence_token: "t1", blocked_at: 1700000000 }] };
    const cases = [
      ["enforce-no-manifest", "enforce", null, 503],
      ["observe-block", "observe", blockEvt1, 200],
      ["off-block", "off", blockEvt1, 200],
    ];
    for (const [label, mode, manifest, expected] of cases) {
      resetAll();
      process.env.PUBLIC_VISIBILITY_GUARD_MODE = mode;
      await fakeBucket.put("events/evt-1/release.v1.json", artifact);
      if (manifest) await fakeBucket.put("visibility/blocked-entities.v1.json", manifest, { httpMetadata: { etag: '"m-3"' } });
      const curRes = await currentReleaseGet(new Request("http://localhost/api/event-endpoints/evt-1/release"), { params: Promise.resolve({ id: "evt-1" }) });
      const curBody = await curRes.text();
      const honoRes = await app.request("http://localhost/api/event-endpoints/evt-1/release", {}, { DB: d1, BUCKET: fakeBucket, KV: fakeKv, PUBLIC_VISIBILITY_GUARD_MODE: mode });
      const honoBody = await honoRes.text();
      assert.equal(curRes.status, expected, label);
      assert.equal(honoRes.status, expected, label);
      assert.equal(honoBody, curBody, label);
    }
  });

  test("T16b: GET /api/events with a session cookie sets no private headers and runs no session lookup", async () => {
    resetAll();
    d1.stats.statements = 0;
    const res = await app.request("http://localhost/api/events", {
      headers: { Cookie: "__Secure-authjs.session-token=abc; authjs.session-token=abc" },
    }, { DB: d1, BUCKET: fakeBucket, KV: fakeKv });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Pragma"), null);
    assert.equal(res.headers.get("Expires"), null);
    assert.equal(d1.stats.statements, 1, "only the list SELECT; no session/users lookup");
  });
}
