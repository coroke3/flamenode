// MIG-0411 consumer tests on the real D1 schema (every file in migrations/ applied),
// real route shards, and the real gateway reading what the consumer wrote.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  MAX_RECOVERY_DOORBELLS,
  canonicalRouteKey,
  handlePageRenderQueue,
  parsePageRenderMessage,
  processPageRender,
  recoverPendingPageRenders,
} from "./pageRenderQueue.ts";
import { renderPublicPage } from "./renderPublicPage.ts";
import gateway, { resetGatewayCaches } from "./index.ts";
import { r2HtmlKey, resetRebuildMemory } from "./r2Html.ts";
import { buildRouteMap } from "../lib/routeMap.ts";
import { buildRouteShards, revocationKey } from "./routeShards.ts";

const GENERATION = "gen-mig-0411-test";
const ORIGIN = "https://site.example";
const MIGRATIONS = fileURLToPath(new URL("../../../../migrations/", import.meta.url));

function realSchema() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    sqlite.exec(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"));
  }
  return sqlite;
}

function d1(sqlite, log = []) {
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async first() { log.push(sql); return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { log.push(sql); return { results: sqlite.prepare(sql).all(...args) }; },
    async run() { log.push(sql); return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
  });
  return { prepare: (sql) => statement(sql) };
}

function seed(sqlite) {
  sqlite.exec(`INSERT INTO "user" (id, name) VALUES ('u1', 'Submitter')`);
  const user = sqlite.prepare("INSERT INTO x_users (id, x_name, icon_url, profile_text, approval_status) VALUES (?, ?, ?, ?, ?)");
  user.run("creator-alpha", "Alpha <b>", "https://img.example/a.png", "Bio & more", "approved");
  user.run("pending-user", "Pending", null, null, "pending");
  user.run("rejected-user", "Rejected", null, null, "rejected");
  user.run("Mixed_Case", "Mixed", null, null, "approved");
  const video = sqlite.prepare(
    `INSERT INTO videos (id, submitted_by_user_id, creator_display_name, title, intro_comment, visibility_status)
     VALUES (?, 'u1', ?, ?, ?, ?)`,
  );
  video.run("vid-public", "Alpha", "Public \"clip\" <script>", "Intro", "public");
  video.run("vid-private", "Alpha", "Private clip", null, "private");
  video.run("vid-pending", "Alpha", "Pending clip", null, "pending");
  const event = sqlite.prepare("INSERT INTO events (id, title, explanation, visibility_status) VALUES (?, ?, ?, ?)");
  event.run("ev-public", "Spring Fest", "Desc", "public");
  event.run("ev-private", "Hidden Fest", null, "private");
}

function manifest() {
  return buildRouteMap(
    [
      { kind: "video", id: "vid-public", aliases: ["vid-alias"] },
      { kind: "video", id: "vid-private" },
      { kind: "video", id: "vid-pending" },
      { kind: "video", id: "vid-missing-row" },
      { kind: "user", id: "creator-alpha" },
      { kind: "user", id: "pending-user" },
      { kind: "user", id: "rejected-user" },
      { kind: "user", id: "mixed_case" },
      { kind: "event", id: "ev-public" },
      { kind: "event", id: "ev-private" },
    ],
    GENERATION,
  );
}

function harness({ kv = new Map(), env: extra = {} } = {}) {
  const sqlite = realSchema();
  seed(sqlite);
  const files = new Map(buildRouteShards(manifest()).map((s) => [s.path, s.body]));
  const r2 = new Map();
  const ops = [];
  const sent = [];
  const env = {
    ASSETS: {
      fetch: async (req) => {
        const { pathname } = new URL(req.url);
        return files.has(pathname)
          ? new Response(files.get(pathname), { status: 200 })
          : new Response("nf", { status: 404 }); // no detail page in Assets: R2 only
      },
    },
    VISIBILITY_KV: { get: async (key) => kv.get(key) ?? null },
    R2_STORAGE: {
      async get(key) {
        const o = r2.get(key);
        if (!o) return null;
        return {
          body: new Response(o.body).body,
          size: Buffer.byteLength(o.body),
          httpMetadata: o.httpMetadata,
          customMetadata: o.customMetadata,
        };
      },
      async put(key, body, options) { ops.push(["put", key]); r2.set(key, { body, ...options }); },
      async delete(key) { ops.push(["delete", key]); r2.delete(key); },
    },
    REBUILD_QUEUE: { send: async (m) => { sent.push(m); } },
    DB: d1(sqlite),
    PUBLIC_SITE_URL: ORIGIN,
    ...extra,
  };
  const request = (kind, id, at = 1000) =>
    sqlite.prepare(
      `INSERT INTO public_page_renders (entity, entity_id, requested_at) VALUES (?, ?, ?)
       ON CONFLICT (entity, entity_id) DO UPDATE SET requested_at = excluded.requested_at`,
    ).run(kind, id, at);
  const tracker = (kind, id) =>
    sqlite.prepare("SELECT requested_at, rendered_at FROM public_page_renders WHERE entity = ? AND entity_id = ?").get(kind, id);
  const consume = async (...bodies) => {
    const acks = [];
    const outcomes = await gateway.queue(
      { messages: bodies.map((body, i) => ({ body, ack: () => acks.push(["ack", i]), retry: () => acks.push(["retry", i]) })) },
      env,
    );
    return { outcomes, acks };
  };
  const get = async (p) => {
    resetGatewayCaches();
    resetRebuildMemory();
    return gateway.fetch(new Request(`${ORIGIN}${p}`), env);
  };
  return { sqlite, env, r2, ops, sent, kv, request, tracker, consume, get };
}

const doorbell = (kind, id) => ({ type: "render-page", kind, id });

test("contract: a missing page -> gateway rebuild-page message -> consumer -> gateway serves it", async () => {
  const h = harness();
  const first = await h.get("/vid-public");
  assert.equal(first.status, 503, "public route without HTML is a build gap");
  assert.equal(h.sent.length, 1);
  assert.deepEqual(Object.keys(h.sent[0]).sort(), ["generation", "id", "key", "kind", "reason", "type"]);

  const { outcomes, acks } = await h.consume(h.sent[0]);
  assert.equal(outcomes[0].action, "rendered");
  assert.deepEqual(acks, [["ack", 0]]);
  const stored = h.r2.get(r2HtmlKey("vid-public"));
  assert.equal(stored.customMetadata.generation, GENERATION, "stamped with the route shard generation");
  assert.match(stored.httpMetadata.contentType, /^text\/html/);
  assert.deepEqual([...h.r2.keys()], ["vid-public/index.html"], "one key layout: <route key>/index.html only");

  const served = await h.get("/vid-public");
  assert.equal(served.status, 200);
  const html = await served.text();
  assert.match(html, /<link rel="canonical" href="https:\/\/site\.example\/vid-public"\/>/);
  assert.ok(!html.includes("<script>"), "row text is escaped");
  assert.ok(!html.includes("flamenode.net"));
});

test("T01: a doorbell for an updated public page rebuilds only that page and advances rendered_at", async () => {
  const h = harness();
  h.request("video", "vid-public", 5000);
  const { outcomes } = await h.consume(doorbell("video", "vid-public"));
  assert.equal(outcomes[0].action, "rendered");
  assert.deepEqual(h.ops, [["put", "vid-public/index.html"]]);
  assert.equal(h.tracker("video", "vid-public").rendered_at > 0, true);
});

test("T02: unpublish -> R2 HTML deleted and the gateway answers 404 at once (deny entry)", async () => {
  const h = harness();
  await h.consume(doorbell("video", "vid-public"));
  assert.equal((await h.get("/vid-public")).status, 200);
  // S3 unpublish: D1 row, revocation entry and tracker in the same request.
  h.sqlite.exec("UPDATE videos SET visibility_status = 'private' WHERE id = 'vid-public'");
  h.kv.set(revocationKey("video", "vid-public"), "1");
  h.request("video", "vid-public", 9000);
  assert.equal((await h.get("/vid-public")).status, 404, "blocked before the consumer runs");
  const { outcomes } = await h.consume(doorbell("video", "vid-public"));
  assert.equal(outcomes[0].action, "deleted");
  assert.equal(outcomes[0].reason, "revoked");
  assert.equal(h.r2.size, 0);
  const res = await h.get("/vid-public");
  assert.equal(res.status, 404);
  assert.match(res.headers.get("X-Robots-Tag"), /noindex/);
});

test("fail-closed visibility: never writes a page that is not public by CURRENT's rules", async () => {
  const h = harness({ kv: new Map([[revocationKey("user", "creator-alpha"), "1"]]) });
  const cases = [
    [doorbell("video", "vid-private"), "not_public"],
    [doorbell("video", "vid-pending"), "not_public"], // CURRENT isPublicVideoDirect: only "public"
    [doorbell("video", "vid-missing-row"), "not_public"],
    [doorbell("event", "ev-private"), "not_public"],
    [doorbell("user", "rejected-user"), "not_public"],
    [doorbell("user", "creator-alpha"), "revoked"], // public in D1, revoked after the build
    [doorbell("video", "not-in-shards"), "not_routed"],
    [doorbell("event", "vid-public"), "not_routed"], // wrong kind for the key
  ];
  for (const [body, reason] of cases) {
    const { outcomes } = await h.consume(body);
    assert.equal(outcomes[0].action, "deleted", JSON.stringify(body));
    assert.equal(outcomes[0].reason, reason, JSON.stringify(body));
  }
  assert.ok(h.ops.every(([op]) => op === "delete"), "no PUT for any non-public page");
  assert.equal(h.r2.size, 0);
});

test("users: CURRENT listable approval statuses and case-insensitive ids; events: public only", async () => {
  const h = harness();
  for (const body of [doorbell("user", "pending-user"), doorbell("user", "Mixed_Case"), doorbell("event", "ev-public")]) {
    const { outcomes } = await h.consume(body);
    assert.equal(outcomes[0].action, "rendered", JSON.stringify(body));
  }
  assert.deepEqual([...h.r2.keys()].sort(), ["event/ev-public/index.html", "user/mixed_case/index.html", "user/pending-user/index.html"]);
  assert.equal((await h.get("/user/Mixed_Case")).status, 200);
  assert.equal((await h.get("/event/ev-public")).status, 200);
});

test("T03: an update during the render is rebuilt by the next message", async () => {
  const h = harness();
  h.request("video", "vid-public", 1000);
  const originalPut = h.env.R2_STORAGE.put;
  h.env.R2_STORAGE.put = async (...args) => {
    h.request("video", "vid-public", 2000); // S3 writes a newer request mid-render
    return originalPut(...args);
  };
  const first = await h.consume(doorbell("video", "vid-public"));
  assert.equal(first.outcomes[0].action, "conflict_newer_request");
  assert.equal(h.tracker("video", "vid-public").rendered_at, 0, "rendered_at not advanced");
  h.env.R2_STORAGE.put = originalPut;
  const second = await h.consume(doorbell("video", "vid-public"));
  assert.equal(second.outcomes[0].action, "rendered");
  assert.ok(h.tracker("video", "vid-public").rendered_at > 0);
});

test("T04: the same doorbell twice: the second does nothing; a gateway request still rebuilds", async () => {
  const h = harness();
  h.request("video", "vid-public", 1000);
  await h.consume(doorbell("video", "vid-public"));
  const opsAfterFirst = h.ops.length;
  const { outcomes } = await h.consume(doorbell("video", "vid-public"));
  assert.equal(outcomes[0].action, "skipped_up_to_date");
  assert.equal(h.ops.length, opsAfterFirst);
  // After a new build the gateway reports the HTML stale although rendered_at is current.
  h.r2.get(r2HtmlKey("vid-public")).customMetadata.generation = "older-build";
  assert.equal((await h.get("/vid-public")).status, 503);
  const again = await h.consume(h.sent.at(-1));
  assert.equal(again.outcomes[0].action, "rendered");
  assert.equal((await h.get("/vid-public")).status, 200);
});

test("T05: R2 PUT failure retries the message and leaves rendered_at for recovery", async () => {
  const h = harness();
  h.request("video", "vid-public", 1000);
  h.env.R2_STORAGE.put = async () => { throw new Error("r2 down"); };
  const { outcomes, acks } = await h.consume(doorbell("video", "vid-public"));
  assert.equal(outcomes[0].action, "retry");
  assert.deepEqual(acks, [["retry", 0]]);
  assert.equal(h.tracker("video", "vid-public").rendered_at, 0);
  const sent = [];
  assert.equal(await recoverPendingPageRenders(h.env.DB, { send: async (m) => sent.push(m) }), 1);
  assert.deepEqual(sent, [{ type: "render-page", kind: "video", id: "vid-public" }]);
  assert.ok(parsePageRenderMessage(sent[0]), "recovery doorbells are accepted by the consumer");
});

test("bindings / configuration missing, route data or KV unavailable: retry, nothing written", async () => {
  for (const extra of [{ PUBLIC_SITE_URL: undefined }, { DB: undefined }, { VISIBILITY_KV: undefined }, { ASSETS: undefined }]) {
    const h = harness({ env: extra });
    const { outcomes, acks } = await h.consume(doorbell("video", "vid-public"));
    assert.equal(outcomes[0].action, "retry", JSON.stringify(Object.keys(extra)));
    assert.deepEqual(acks, [["retry", 0]]);
    assert.equal(h.r2.size, 0);
  }
  const h = harness();
  h.env.VISIBILITY_KV = { get: async () => { throw new Error("kv down"); } };
  assert.equal((await h.consume(doorbell("video", "vid-public"))).outcomes[0].action, "retry");
  assert.equal(h.r2.size, 0);
});

test("messages: only the gateway RebuildRequest and the render-page doorbell are accepted", () => {
  const ok = { type: "rebuild-page", key: "user/mixed_case", kind: "user", id: "Mixed_Case", generation: "g", reason: "html_missing" };
  assert.deepEqual(parsePageRenderMessage(ok), { source: "gateway", kind: "user", id: "Mixed_Case", key: "user/mixed_case" });
  for (const bad of [
    { ...ok, key: "user/other" },
    { ...ok, type: "rebuild" },
    { type: "render-page", kind: "video", id: "a/b" },
    { type: "render-page", kind: "video", id: "..%2f" },
    { type: "render-page", kind: "group", id: "x" },
    { type: "render-page", kind: "video", id: "" },
    { entity: "video", entity_id: "vid-public" }, // the old ad-hoc shape
    null,
    "vid-public",
  ]) {
    assert.equal(parsePageRenderMessage(bad), null, JSON.stringify(bad));
  }
  assert.equal(canonicalRouteKey("video", "abc"), "abc");
  assert.equal(canonicalRouteKey("event", "e1"), "event/e1");
});

test("one message per invocation: the rest of a larger batch is retried", async () => {
  const h = harness();
  const { outcomes, acks } = await h.consume(doorbell("video", "vid-public"), doorbell("event", "ev-public"), { junk: 1 });
  assert.equal(outcomes.length, 1);
  assert.deepEqual(acks.sort(), [["ack", 0], ["retry", 1], ["retry", 2]].sort());
});

test("U04 recovery: bounded LIMIT, served by the partial pending index", async () => {
  const h = harness();
  for (let i = 0; i < 7; i += 1) h.request("video", `v-${i}`, 1000 + i);
  h.sqlite.prepare("INSERT INTO public_page_renders (entity, entity_id, requested_at, rendered_at) VALUES ('video', 'done', 5, 9)").run();
  const sent = [];
  assert.equal(await recoverPendingPageRenders(h.env.DB, { send: async (m) => sent.push(m) }, 100), MAX_RECOVERY_DOORBELLS);
  assert.deepEqual(sent.map((m) => m.id), ["v-0", "v-1", "v-2", "v-3", "v-4"]);
  const plan = h.sqlite.prepare(
    "EXPLAIN QUERY PLAN SELECT entity, entity_id FROM public_page_renders WHERE requested_at > rendered_at ORDER BY requested_at ASC LIMIT ?",
  ).all(5).map((r) => r.detail).join(" ");
  assert.match(plan, /public_page_renders_pending_idx/);
});

test("statement budget per message: ≤ 3 D1, 1 KV, 1 R2 write", async () => {
  const h = harness();
  h.request("video", "vid-public", 1000);
  const log = [];
  h.env.DB = d1(h.sqlite, log);
  let kvReads = 0;
  const kv = h.env.VISIBILITY_KV;
  h.env.VISIBILITY_KV = { get: async (k) => { kvReads += 1; return kv.get(k); } };
  await h.consume(doorbell("video", "vid-public"));
  assert.ok(log.length <= 3, `D1 statements ${log.length}`);
  assert.ok(log.every((sql) => /LIMIT 1|WHERE entity = \? AND entity_id = \? AND requested_at = \?/.test(sql)), log.join("\n"));
  assert.equal(kvReads, 1);
  assert.equal(h.ops.length, 1);
});

test("render: canonical comes from configuration + route canonicalPath, never a built-in domain", () => {
  assert.throws(() => renderPublicPage("video", { id: "x", title: "t" }, { origin: "", canonicalPath: "/x" }));
  assert.throws(() => renderPublicPage("video", { id: "x", title: "t" }, { origin: "javascript:alert(1)", canonicalPath: "/x" }));
  assert.throws(() => renderPublicPage("video", { id: "x", title: "t" }, { origin: ORIGIN, canonicalPath: "//evil.example/x" }));
  const html = renderPublicPage("user", { id: "u", x_name: "\"><img src=x onerror=1>" }, { origin: ORIGIN, canonicalPath: "/user/u" });
  assert.ok(!/<img/.test(html));
  assert.match(html, /href="https:\/\/site\.example\/user\/u"/);
});

test("T06: one message end to end (all I/O mocked) stays far below the 8ms Queue budget (local Node)", async () => {
  // Same method as scripts/migration-gateway.test.mjs: mocks resolve in a microtask,
  // fastest of 5 repeats per sample; local wall time, not workerd CPU. Max-size row:
  // 1,000-char title / name, 10,000-char intro / profile.
  const shard = buildRouteShards(manifest());
  const files = new Map(shard.map((s) => [s.path, s.body]));
  const big = "長".repeat(1000);
  const rows = {
    video: { id: "vid-public", title: big, creator_display_name: big, creator_icon_url: "https://img.example/a.png", intro_comment: "説".repeat(10_000), visibility_status: "public" },
    user: { id: "creator-alpha", x_name: big, icon_url: "https://img.example/a.png", profile_text: "説".repeat(10_000), approval_status: "approved" },
    event: { id: "ev-public", title: big, explanation: "説".repeat(10_000), icon_url: null, img_url: null, visibility_status: "public" },
  };
  const results = {};
  for (const kind of ["video", "user", "event"]) {
    const row = rows[kind];
    const db = {
      prepare(sql) {
        const stmt = {
          bind: () => stmt,
          first: async () => (sql.includes("public_page_renders") ? { requested_at: 2, rendered_at: 1 } : row),
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 1 } }),
        };
        return stmt;
      },
    };
    const env = {
      DB: db,
      R2_STORAGE: { put: async () => {}, delete: async () => {} },
      VISIBILITY_KV: { get: async () => null },
      PUBLIC_SITE_URL: ORIGIN,
    };
    const parsedShards = new Map();
    const lookup = async (key) => {
      for (const [p, body] of files) {
        let parsed = parsedShards.get(p);
        if (!parsed) { parsed = JSON.parse(body); parsedShards.set(p, parsed); }
        if (Object.hasOwn(parsed.routes, key)) return { resolution: parsed.routes[key], generation: parsed.generation };
      }
      return { resolution: null, generation: GENERATION };
    };
    const message = parsePageRenderMessage(doorbell(kind, row.id));
    await processPageRender(message, env, lookup); // warm the parsed-shard map (lookup is not under test)
    const samples = [];
    for (let i = 0; i < 200; i += 1) {
      let best = Infinity;
      for (let r = 0; r < 5; r += 1) {
        const start = performance.now();
        await processPageRender(message, env, lookup);
        best = Math.min(best, performance.now() - start);
      }
      samples.push(best);
    }
    samples.sort((a, b) => a - b);
    results[kind] = { p50: samples[100], p99: samples[197], max: samples.at(-1) };
    assert.ok(results[kind].max < 8, `${kind} max ${results[kind].max}ms`);
  }
  console.log(`[MIG-0411 CPU] n=200 fastest-of-5 local Node: ${Object.entries(results)
    .map(([k, v]) => `${k} p50=${v.p50.toFixed(3)} p99=${v.p99.toFixed(3)} max=${v.max.toFixed(3)}ms`).join("; ")}`);
});
