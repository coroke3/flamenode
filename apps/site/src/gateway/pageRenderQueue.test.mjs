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
  requestPageRenderStatement,
} from "./pageRenderQueue.ts";
import gateway, { resetGatewayCaches } from "./index.ts";
import { r2HtmlKey, resetRebuildMemory } from "./r2Html.ts";
import { buildRouteMap } from "../lib/routeMap.ts";
import { buildRouteShards, revocationKey } from "./routeShards.ts";

const GENERATION = "gen-mig-0411-test";
const ORIGIN = "https://site.example"; // request URL host only: page URLs are the build's (pageMetadata.ts)
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
  video.run("vid-yt", "Alpha", "YouTube clip", "Intro", "public");
  sqlite.exec("UPDATE videos SET youtube_video_id = 'ytSlug00001' WHERE id = 'vid-yt'");
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
      // id = videos.id, slug = YouTube id (the CURRENT canonical URL), internal-id URL = alias.
      { kind: "video", id: "vid-yt", slug: "ytSlug00001", aliases: ["vid-yt"] },
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
    ...extra,
  };
  // The producer statement (S3 contract). The mock D1 writes synchronously when run() is called.
  const request = (kind, id, at = 1000) => requestPageRenderStatement(d1(sqlite), kind, id, at).run();
  const tracker = (kind, id) =>
    sqlite.prepare(
      "SELECT requested_at, rendered_at, request_version, rendered_version FROM public_page_renders WHERE entity = ? AND entity_id = ?",
    ).get(kind, id);
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
const buildHtml = (kind, id, key) => ({
  body: "<!DOCTYPE html><p>Generated by build</p>",
  customMetadata: { kind, id, key, generation: GENERATION },
  httpMetadata: { contentType: "text/html; charset=utf-8" },
});

test("T01: a gateway miss stays 503; the consumer closes a public tracker without PUT", async () => {
  const h = harness();
  assert.equal((await h.get("/user/creator-alpha")).status, 503);
  assert.equal(h.sent.length, 1);
  assert.deepEqual(Object.keys(h.sent[0]).sort(), ["generation", "id", "key", "kind", "reason", "type"]);
  await h.request("user", "creator-alpha", 1000);
  const { outcomes, acks } = await h.consume(h.sent[0]);
  assert.deepEqual(outcomes, [{ action: "excluded_kind", kind: "user", id: "creator-alpha" }]);
  assert.deepEqual(acks, [["ack", 0]]);
  assert.equal(h.tracker("user", "creator-alpha").rendered_version, 1);
  assert.deepEqual(h.ops, []);
  assert.equal((await h.get("/user/creator-alpha")).status, 503, "only the build supplies HTML");
});

test("T01: video, user and event public pages are excluded without altering build HTML", async () => {
  const cases = [
    ["video", "vid-public", "vid-public"],
    ["user", "creator-alpha", "user/creator-alpha"],
    ["event", "ev-public", "event/ev-public"],
  ];
  for (const [kind, id, key] of cases) {
    const h = harness();
    const html = buildHtml(kind, id, key);
    h.r2.set(r2HtmlKey(key), html);
    await h.request(kind, id, 1000);
    const { outcomes } = await h.consume(doorbell(kind, id));
    assert.equal(outcomes[0].action, "excluded_kind", kind);
    assert.equal(h.tracker(kind, id).rendered_version, 1);
    assert.equal(h.r2.get(r2HtmlKey(key)), html, "build output is never overwritten");
    assert.deepEqual(h.ops, [], "R2 PUT/DELETE must both be zero for public HTML");
  }
});

test("T02: revoked, non-public and unrouted HTML are deleted, with version closure", async () => {
  for (const [kind, id, key, reason] of [
    ["video", "vid-private", "vid-private", "not_public"],
    ["video", "vid-pending", "vid-pending", "not_public"],
    ["user", "rejected-user", "user/rejected-user", "not_public"],
    ["event", "ev-private", "event/ev-private", "not_public"],
    ["video", "vid-missing", "vid-missing", "not_routed"],
  ]) {
    const h = harness();
    h.r2.set(r2HtmlKey(key), buildHtml(kind, id, key));
    await h.request(kind, id, 1000);
    const { outcomes } = await h.consume(doorbell(kind, id));
    assert.equal(outcomes[0].action, "deleted", id);
    assert.equal(outcomes[0].reason, reason, id);
    assert.deepEqual(h.ops, [["delete", r2HtmlKey(key)]], id);
    assert.equal(h.r2.has(r2HtmlKey(key)), false);
    assert.equal(h.tracker(kind, id).rendered_version, 1);
  }
  const h = harness();
  const key = "user/creator-alpha";
  h.r2.set(r2HtmlKey(key), buildHtml("user", "creator-alpha", key));
  h.kv.set(revocationKey("user", "creator-alpha"), "1");
  await h.request("user", "creator-alpha", 1000);
  assert.equal((await h.get("/user/creator-alpha")).status, 404, "gateway denies revoked pages");
  const { outcomes } = await h.consume(doorbell("user", "creator-alpha"));
  assert.equal(outcomes[0].reason, "revoked");
  assert.equal(h.r2.size, 0);
});

test("T03: concurrent unpublish requests are protected by the request_version CAS even at the same timestamp", async () => {
  for (const secondAt of [1000, 2000]) {
    const h = harness();
    await h.request("event", "ev-private", 1000);
    const baseDelete = h.env.R2_STORAGE.delete;
    h.env.R2_STORAGE.delete = async (key) => {
      await h.request("event", "ev-private", secondAt);
      return baseDelete(key);
    };
    const { outcomes } = await h.consume(doorbell("event", "ev-private"));
    assert.equal(outcomes[0].action, "conflict_newer_request");
    assert.equal(h.tracker("event", "ev-private").rendered_version, 0);
    h.env.R2_STORAGE.delete = baseDelete;
    assert.equal((await h.consume(doorbell("event", "ev-private"))).outcomes[0].action, "deleted");
    assert.equal(h.tracker("event", "ev-private").rendered_version, 2);
  }
});

test("T04: duplicate doorbells are skipped; gateway messages still close the tracker", async () => {
  const h = harness();
  await h.request("video", "vid-public", 1000);
  assert.equal((await h.consume(doorbell("video", "vid-public"))).outcomes[0].action, "excluded_kind");
  assert.equal((await h.consume(doorbell("video", "vid-public"))).outcomes[0].action, "skipped_up_to_date");
  assert.equal((await h.consume({
    type: "rebuild-page", kind: "video", id: "vid-public", key: "vid-public",
    generation: GENERATION, reason: "html_missing",
  })).outcomes[0].action, "excluded_kind");
  assert.equal(h.ops.length, 0);
});

test("F-07: video doorbells follow internal-id -> YouTube slug only for deletion", async () => {
  const h = harness();
  const slug = "ytSlug00001";
  const html = buildHtml("video", "vid-yt", slug);
  h.r2.set(r2HtmlKey(slug), html);
  await h.request("video", "vid-yt", 1000);
  assert.equal((await h.consume(doorbell("video", "vid-yt"))).outcomes[0].action, "excluded_kind");
  assert.equal(h.r2.get(r2HtmlKey(slug)), html);
  h.kv.set(revocationKey("video", "vid-yt"), "1");
  await h.request("video", "vid-yt", 2000);
  const deleted = (await h.consume(doorbell("video", "vid-yt"))).outcomes[0];
  assert.deepEqual(deleted, { action: "deleted", kind: "video", id: "vid-yt", key: slug, reason: "revoked" });
  assert.deepEqual(h.ops, [["delete", r2HtmlKey(slug)]], "never deletes internal-id alias HTML");
  const spoof = await h.consume({ type: "rebuild-page", kind: "video", id: slug, key: slug, generation: "g", reason: "html_missing" });
  assert.equal(spoof.outcomes[0].reason, "not_routed", "a YouTube id is not videos.id");
});

test("T05: failed R2 DELETE retries and leaves the tracker pending for recovery", async () => {
  const h = harness();
  await h.request("event", "ev-private", 1000);
  h.env.R2_STORAGE.delete = async () => { throw new Error("r2 down"); };
  const { outcomes, acks } = await h.consume(doorbell("event", "ev-private"));
  assert.equal(outcomes[0].action, "retry");
  assert.deepEqual(acks, [["retry", 0]]);
  assert.equal(h.tracker("event", "ev-private").rendered_version, 0);
  const sent = [];
  assert.equal(await recoverPendingPageRenders(h.env.DB, { send: async (m) => { sent.push(m); } }), 1);
  assert.deepEqual(sent, [doorbell("event", "ev-private")]);
});

test("fail closed: missing DB, KV, R2, ASSETS and failing KV all cause retry", async () => {
  for (const extra of [{ DB: undefined }, { VISIBILITY_KV: undefined }, { R2_STORAGE: undefined }, { ASSETS: undefined }]) {
    const h = harness({ env: extra });
    const { outcomes, acks } = await h.consume(doorbell("video", "vid-public"));
    assert.equal(outcomes[0].action, "retry", JSON.stringify(extra));
    assert.deepEqual(acks, [["retry", 0]]);
    assert.equal(h.r2.size, 0);
  }
  const h = harness();
  h.env.VISIBILITY_KV = { get: async () => { throw new Error("kv down"); } };
  assert.equal((await h.consume(doorbell("video", "vid-public"))).outcomes[0].action, "retry");
});

test("messages: accept only canonical gateway rebuild and bounded doorbells", () => {
  const ok = { type: "rebuild-page", key: "user/mixed_case", kind: "user", id: "Mixed_Case", generation: "g", reason: "html_missing" };
  assert.deepEqual(parsePageRenderMessage(ok), { source: "gateway", kind: "user", id: "Mixed_Case", key: "user/mixed_case" });
  for (const bad of [
    { ...ok, key: "user/other" }, { ...ok, type: "rebuild" },
    { type: "render-page", kind: "video", id: "a/b" },
    { type: "render-page", kind: "video", id: "..%2f" },
    { type: "render-page", kind: "group", id: "x" },
    { type: "render-page", kind: "video", id: "" },
    null, "vid-public",
  ]) assert.equal(parsePageRenderMessage(bad), null, JSON.stringify(bad));
  assert.equal(canonicalRouteKey("video", "abc"), "abc");
  assert.equal(canonicalRouteKey("event", "e1"), "event/e1");
});

test("one message per invocation, even when the Queue batch contains extras", async () => {
  const h = harness();
  const { outcomes, acks } = await h.consume(doorbell("video", "vid-public"), doorbell("event", "ev-public"), null);
  assert.equal(outcomes.length, 1);
  assert.deepEqual(acks.sort(), [["ack", 0], ["retry", 1], ["retry", 2]].sort());
});

test("T07: pending recovery is indexed, bounded at five, and skips closed trackers", async () => {
  const h = harness();
  for (let i = 0; i < 7; i++) await h.request("video", `v-${i}`, 1000 + i);
  h.sqlite.exec("INSERT INTO public_page_renders (entity, entity_id, requested_at, rendered_at, request_version, rendered_version) VALUES ('video', 'done', 5, 9, 4, 4)");
  const sent = [];
  assert.equal(await recoverPendingPageRenders(h.env.DB, { send: async (m) => { sent.push(m); } }, 100), MAX_RECOVERY_DOORBELLS);
  assert.deepEqual(sent.map((m) => m.id), ["v-0", "v-1", "v-2", "v-3", "v-4"]);
  const plan = h.sqlite.prepare(
    "EXPLAIN QUERY PLAN SELECT entity, entity_id FROM public_page_renders WHERE request_version > rendered_version ORDER BY requested_at ASC LIMIT ?",
  ).all(5).map((r) => r.detail).join(" ");
  assert.match(plan, /public_page_renders_pending_idx/);
});

test("D1/KV/DELETE budget: per message at most three SQL, one KV, one R2 DELETE", async () => {
  const h = harness();
  await h.request("event", "ev-private", 1000);
  const log = [];
  h.env.DB = d1(h.sqlite, log);
  let kv = 0;
  h.env.VISIBILITY_KV = { get: async () => { kv++; return null; } };
  await h.consume(doorbell("event", "ev-private"));
  assert.ok(log.length <= 3, `D1 statements ${log.length}`);
  assert.ok(log.every((sql) => /LIMIT 1|WHERE entity = \? AND entity_id = \? AND request_version = \?/.test(sql)), log.join("\n"));
  assert.equal(kv, 1);
  assert.deepEqual(h.ops, [["delete", "event/ev-private/index.html"]]);
});

test("U04: local DELETE/excluded path measurement (200 × 2, Node wall ms; not workerd CPU)", async () => {
  const results = {};
  for (const [name, kind, id, visibility] of [
    ["excluded", "video", "vid-public", "public"],
    ["delete", "video", "vid-private", "private"],
  ]) {
    let puts = 0, deletes = 0, statements = 0;
    const db = {
      prepare(sql) {
        statements++;
        const stmt = {
          bind: () => stmt,
          first: async () => sql.includes("public_page_renders")
            ? { request_version: 2, rendered_version: 1 }
            : { id, visibility_status: visibility },
          run: async () => ({ meta: { changes: 1 } }),
        };
        return stmt;
      },
    };
    const env = {
      DB: db,
      R2_STORAGE: { put: async () => { puts++; }, delete: async () => { deletes++; } },
      VISIBILITY_KV: { get: async () => null },
    };
    const lookup = async () => ({ generation: GENERATION, resolution: { type: "canonical", kind, id } });
    const message = parsePageRenderMessage(doorbell(kind, id));
    const samples = [];
    for (let i = 0; i < 200; i++) {
      const start = performance.now();
      const outcome = await processPageRender(message, env, lookup);
      samples.push(performance.now() - start);
      assert.equal(outcome.action, name === "delete" ? "deleted" : "excluded_kind");
    }
    samples.sort((a, b) => a - b);
    assert.equal(puts, 0);
    assert.equal(deletes, name === "delete" ? 200 : 0);
    results[name] = { p50: samples[100], p99: samples[197], max: samples[199], d1PerInvocation: statements / 200 };
  }
  console.log("[MIG-0411 Node wall ms, not workerd CPU] " + JSON.stringify(results));
});

test("T08: renderPublicPage and stylesheet binding have no references in active gateway code", () => {
  const queueSource = fs.readFileSync(new URL("./pageRenderQueue.ts", import.meta.url), "utf8");
  const gatewaySource = fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(queueSource + gatewaySource, /renderPublicPage|PUBLIC_PAGE_STYLESHEETS/);
});
