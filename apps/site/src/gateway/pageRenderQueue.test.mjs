import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  handlePageRenderQueue,
  pageRenderGatewayKey,
  pageRenderSpecKey,
  processPageRenderItem,
  recoverPendingPageRenders,
} from "./pageRenderQueue.ts";
import { renderPublicPage } from "./renderPublicPage.ts";
import gateway, { resetGatewayCaches } from "./index.ts";
import { resetRebuildMemory } from "./r2Html.ts";
import { buildRouteMap } from "../lib/routeMap.ts";
import { buildRouteShards, revocationKey } from "./routeShards.ts";

function createTestDb() {
  const sqlite = new DatabaseSync(":memory:");

  sqlite.exec(`
    CREATE TABLE public_page_renders (
      entity TEXT NOT NULL CHECK (entity IN ('video', 'user', 'event')),
      entity_id TEXT NOT NULL,
      requested_at INTEGER NOT NULL,
      rendered_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (entity, entity_id)
    );

    CREATE TABLE videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      creator_name TEXT,
      thumbnail_url TEXT,
      visibility TEXT NOT NULL DEFAULT 'public'
    );

    CREATE TABLE x_users (
      id TEXT PRIMARY KEY,
      name TEXT,
      handle TEXT,
      bio TEXT,
      icon_url TEXT
    );

    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      icon_url TEXT,
      visibility TEXT NOT NULL DEFAULT 'public'
    );
  `);

  return {
    raw: sqlite,
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              const stmt = sqlite.prepare(query);
              const row = stmt.get(...args);
              return row ?? null;
            },
            async all() {
              const stmt = sqlite.prepare(query);
              const rows = stmt.all(...args);
              return { results: rows, success: true };
            },
            async run() {
              const stmt = sqlite.prepare(query);
              const info = stmt.run(...args);
              const changes = Number(info.changes);
              return { success: true, meta: { changes }, changes };
            },
          };
        },
      };
    },
  };
}

function createTestR2() {
  const store = new Map();
  return {
    store,
    async put(key, value, options) {
      store.set(key, { value: String(value), options });
    },
    async get(key) {
      if (!store.has(key)) return null;
      const item = store.get(key);
      return {
        body: new Response(item.value).body,
        httpMetadata: item.options?.httpMetadata,
        customMetadata: item.options?.customMetadata,
        size: Buffer.byteLength(item.value),
      };
    },
    async delete(key) {
      if (Array.isArray(key)) {
        for (const k of key) store.delete(k);
      } else {
        store.delete(key);
      }
    },
  };
}

test("T01: 公開の作品を更新 -> その作品の R2 HTML だけが作り直される", async () => {
  const db = createTestDb();
  const r2 = createTestR2();
  const env = { DB: db, R2_STORAGE: r2, DEFAULT_GENERATION: "gen-2026-t01" };

  db.raw.exec(`
    INSERT INTO videos (id, title, description, visibility)
    VALUES ('vid-t01', 'Test Public Video 1', 'A description', 'public');

    INSERT INTO public_page_renders (entity, entity_id, requested_at, rendered_at)
    VALUES ('video', 'vid-t01', 1000, 0);
  `);

  const outcome = await processPageRenderItem("video", "vid-t01", env, 1050);
  assert.equal(outcome.action, "rendered");
  assert.equal(outcome.entity, "video");
  assert.equal(outcome.id, "vid-t01");

  const gatewayKey = pageRenderGatewayKey("video", "vid-t01");
  const specKey = pageRenderSpecKey("video", "vid-t01");
  assert.equal(gatewayKey, "vid-t01/index.html");
  assert.equal(specKey, "pages/video/vid-t01.html");

  assert.ok(r2.store.has(gatewayKey));
  assert.ok(r2.store.has(specKey));

  const savedHtml = r2.store.get(gatewayKey).value;
  assert.ok(savedHtml.includes("<title>Test Public Video 1 - FlameNode</title>"));
  assert.ok(savedHtml.includes('href="https://flamenode.net/vid-t01"'));
  assert.ok(savedHtml.includes('data-entity="video" data-id="vid-t01"'));

  const tracker = db.raw
    .prepare("SELECT requested_at, rendered_at FROM public_page_renders WHERE entity = 'video' AND entity_id = 'vid-t01'")
    .get();
  assert.equal(tracker.rendered_at, 1050);
  assert.ok(tracker.rendered_at >= tracker.requested_at);
});

test("T02: 公開→非公開 -> R2 HTML が消え、gateway が 404 を返す", async () => {
  const db = createTestDb();
  const r2 = createTestR2();
  const env = { DB: db, R2_STORAGE: r2, DEFAULT_GENERATION: "gen-2026-t02" };

  // First render as public
  db.raw.exec(`
    INSERT INTO videos (id, title, description, visibility)
    VALUES ('vid-t02', 'Initially Public', 'Desc', 'public');

    INSERT INTO public_page_renders (entity, entity_id, requested_at, rendered_at)
    VALUES ('video', 'vid-t02', 1000, 0);
  `);
  await processPageRenderItem("video", "vid-t02", env, 1050);
  assert.ok(r2.store.has("vid-t02/index.html"));

  // Now change to private and set requested_at = 2000
  db.raw.exec(`
    UPDATE videos SET visibility = 'private' WHERE id = 'vid-t02';
    UPDATE public_page_renders SET requested_at = 2000 WHERE entity = 'video' AND entity_id = 'vid-t02';
  `);

  const outcome = await processPageRenderItem("video", "vid-t02", env, 2050);
  assert.equal(outcome.action, "deleted");
  assert.equal(r2.store.has("vid-t02/index.html"), false);
  assert.equal(r2.store.has("pages/video/vid-t02.html"), false);

  const tracker = db.raw
    .prepare("SELECT requested_at, rendered_at FROM public_page_renders WHERE entity = 'video' AND entity_id = 'vid-t02'")
    .get();
  assert.equal(tracker.rendered_at, 2050);

  // Gateway integration test: verify that when route is revoked or not in manifest, gateway denies (404)
  const manifest = buildRouteMap([{ kind: "video", id: "vid-t02" }], "gen-2026-t02");
  const shards = buildRouteShards(manifest);
  const shardFiles = new Map(shards.map((s) => [s.path, s.body]));

  const gatewayEnv = {
    ASSETS: {
      fetch: async (req) => {
        const { pathname } = new URL(req.url);
        if (shardFiles.has(pathname)) return new Response(shardFiles.get(pathname), { status: 200 });
        return new Response("not found", { status: 404 });
      },
    },
    VISIBILITY_KV: {
      get: async (key) => {
        if (key === revocationKey("video", "vid-t02")) return "1"; // Revoked in KV
        return null;
      },
    },
    R2_STORAGE: r2,
  };

  resetGatewayCaches();
  resetRebuildMemory();
  const res = await gateway.fetch(new Request("https://flamenode.net/vid-t02"), gatewayEnv);
  assert.equal(res.status, 404);
});

test("T03: 生成中に同じ作品がもう一度更新 -> 2回目の更新が次の message で反映される", async () => {
  const db = createTestDb();
  const r2 = createTestR2();
  const env = { DB: db, R2_STORAGE: r2 };

  db.raw.exec(`
    INSERT INTO videos (id, title, description, visibility)
    VALUES ('vid-t03', 'Initial Version', 'Desc 1', 'public');

    INSERT INTO public_page_renders (entity, entity_id, requested_at, rendered_at)
    VALUES ('video', 'vid-t03', 1000, 0);
  `);

  // Simulate concurrent update during render:
  // Step 1 queries requested_at = 1000.
  // Before Step 4 runs, an external API updates title and requested_at to 2000.
  const originalPrepare = db.prepare.bind(db);
  let intercepted = false;

  db.prepare = (query) => {
    const prepared = originalPrepare(query);
    if (query.includes("UPDATE public_page_renders") && !intercepted) {
      intercepted = true;
      // Mutate table to simulate concurrent update:
      db.raw.exec(`
        UPDATE videos SET title = 'Updated Mid Flight Version' WHERE id = 'vid-t03';
        UPDATE public_page_renders SET requested_at = 2000 WHERE entity = 'video' AND entity_id = 'vid-t03';
      `);
    }
    return prepared;
  };

  const outcome1 = await processPageRenderItem("video", "vid-t03", env, 1500);
  assert.equal(outcome1.action, "conflict_retry_pending");

  // rendered_at remains 0 because CAS failed!
  const tracker1 = db.raw
    .prepare("SELECT requested_at, rendered_at FROM public_page_renders WHERE entity = 'video' AND entity_id = 'vid-t03'")
    .get();
  assert.equal(tracker1.requested_at, 2000);
  assert.equal(tracker1.rendered_at, 0);

  // Restore prepare and process the 2nd message (next message)
  db.prepare = originalPrepare;
  const outcome2 = await processPageRenderItem("video", "vid-t03", env, 2100);
  assert.equal(outcome2.action, "rendered");

  const tracker2 = db.raw
    .prepare("SELECT requested_at, rendered_at FROM public_page_renders WHERE entity = 'video' AND entity_id = 'vid-t03'")
    .get();
  assert.equal(tracker2.rendered_at, 2100);

  // The final saved HTML reflects the 2nd update!
  const finalHtml = r2.store.get("vid-t03/index.html").value;
  assert.ok(finalHtml.includes("Updated Mid Flight Version"));
});

test("T04: 同じ doorbell が2回 -> 2回目は何もしない", async () => {
  const db = createTestDb();
  const r2 = createTestR2();
  const env = { DB: db, R2_STORAGE: r2 };

  db.raw.exec(`
    INSERT INTO videos (id, title, description, visibility)
    VALUES ('vid-t04', 'Title 4', 'Desc 4', 'public');

    INSERT INTO public_page_renders (entity, entity_id, requested_at, rendered_at)
    VALUES ('video', 'vid-t04', 1000, 0);
  `);

  // First doorbell
  const outcome1 = await processPageRenderItem("video", "vid-t04", env, 1050);
  assert.equal(outcome1.action, "rendered");

  const putCountBefore = r2.store.size;

  // Second doorbell with identical state (requested_at <= rendered_at)
  const outcome2 = await processPageRenderItem("video", "vid-t04", env, 1060);
  assert.equal(outcome2.action, "skipped_up_to_date");
  assert.equal(r2.store.size, putCountBefore);
});

test("T05: R2 の PUT が失敗 -> rendered_at が進まず、次の Cron が拾う", async () => {
  const db = createTestDb();
  const failingR2 = {
    async put() {
      throw new Error("R2 storage network outage");
    },
    async delete() {},
  };
  const env = { DB: db, R2_STORAGE: failingR2 };

  db.raw.exec(`
    INSERT INTO videos (id, title, description, visibility)
    VALUES ('vid-t05', 'Title 5', 'Desc 5', 'public');

    INSERT INTO public_page_renders (entity, entity_id, requested_at, rendered_at)
    VALUES ('video', 'vid-t05', 1000, 0);
  `);

  await assert.rejects(
    async () => {
      await processPageRenderItem("video", "vid-t05", env, 1050);
    },
    /R2 storage network outage/,
  );

  // rendered_at remains 0!
  const tracker = db.raw
    .prepare("SELECT requested_at, rendered_at FROM public_page_renders WHERE entity = 'video' AND entity_id = 'vid-t05'")
    .get();
  assert.equal(tracker.rendered_at, 0);
  assert.equal(tracker.requested_at, 1000);

  // U04: recoverPendingPageRenders detects the pending row and re-enqueues doorbell
  const enqueued = [];
  const mockQueue = {
    async send(msg) {
      enqueued.push(msg);
    },
  };

  const recoveredCount = await recoverPendingPageRenders(db, mockQueue, 5);
  assert.equal(recoveredCount, 1);
  assert.deepEqual(enqueued, [{ entity: "video", entity_id: "vid-t05" }]);
});

test("T06: 上限ちょうどのページ (max-size page) -> 非本番の max < 8ms CPU budget", async () => {
  const maxSizeRow = {
    id: "vid-large-max-size",
    title: "Very Long Video Title With Special Characters & <tag> Symbols ".repeat(5),
    description: "Detailed description paragraph with rich details. ".repeat(100), // ~5KB description
    creator_name: "Prominent Creator Name",
    thumbnail_url: "https://cdn.example.com/thumbnails/vid-large-max-size.webp",
    visibility: "public",
  };

  const iterations = 100;
  const times = [];

  // Warmup
  for (let i = 0; i < 10; i++) {
    renderPublicPage("video", maxSizeRow);
  }

  // Measure pure render function
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    const html = renderPublicPage("video", maxSizeRow);
    const end = process.hrtime.bigint();
    times.push(Number(end - start) / 1_000_000); // ms
    assert.ok(html.length > 5000);
  }

  const maxMs = Math.max(...times);
  const p95Ms = times.sort((a, b) => a - b)[Math.floor(iterations * 0.95)];
  const avgMs = times.reduce((acc, t) => acc + t, 0) / iterations;

  console.log(`[T06 Benchmark] max-size page render: max=${maxMs.toFixed(3)}ms, p95=${p95Ms.toFixed(3)}ms, avg=${avgMs.toFixed(3)}ms`);

  // Option B CPU budget is < 8ms (ZERO_1102.md Runtime B).
  assert.ok(maxMs < 8.0, `Max CPU ${maxMs}ms exceeds 8ms budget`);
  assert.ok(maxMs < 1.0, `Pure render is comfortably under 1ms (actual=${maxMs.toFixed(3)}ms)`);
});

test("Queue batch handler processes messages and acks them", async () => {
  const db = createTestDb();
  const r2 = createTestR2();
  const env = { DB: db, R2_STORAGE: r2 };

  db.raw.exec(`
    INSERT INTO x_users (id, name, handle, bio)
    VALUES ('usr-001', 'Alice User', '@alice', 'Bio here');

    INSERT INTO public_page_renders (entity, entity_id, requested_at, rendered_at)
    VALUES ('user', 'usr-001', 500, 0);

    INSERT INTO events (id, title, description)
    VALUES ('ev-001', 'Summer Fest', 'Event desc');

    INSERT INTO public_page_renders (entity, entity_id, requested_at, rendered_at)
    VALUES ('event', 'ev-001', 600, 0);
  `);

  let ack1 = false;
  let ack2 = false;
  let ack3 = false;

  const batch = {
    messages: [
      { body: { entity: "user", entity_id: "usr-001" }, ack: () => { ack1 = true; } },
      { body: { kind: "event", id: "ev-001" }, ack: () => { ack2 = true; } },
      { body: { invalid: "junk" }, ack: () => { ack3 = true; } },
    ],
  };

  const outcomes = await handlePageRenderQueue(batch, env);
  assert.equal(outcomes.length, 3);
  assert.equal(outcomes[0].action, "rendered");
  assert.equal(outcomes[1].action, "rendered");
  assert.equal(outcomes[2].action, "skipped_invalid_message");

  assert.equal(ack1, true);
  assert.equal(ack2, true);
  assert.equal(ack3, true);

  assert.ok(r2.store.has("user/usr-001/index.html"));
  assert.ok(r2.store.has("event/ev-001/index.html"));
});
