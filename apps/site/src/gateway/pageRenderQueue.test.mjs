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
import { PAGE_BODY_FORMAT, renderPublicPage, renderPublicPageHtml } from "./renderPublicPage.ts";
import { maxInputs } from "./renderPublicPage.measure.mjs";
import gateway, { resetGatewayCaches } from "./index.ts";
import { r2HtmlKey, resetRebuildMemory } from "./r2Html.ts";
import { buildRouteMap } from "../lib/routeMap.ts";
import { buildPageMetadata } from "../lib/pageMetadata.ts";
import { buildRouteShards, revocationKey } from "./routeShards.ts";

const GENERATION = "gen-mig-0411-test";
const ORIGIN = "https://site.example"; // request URL host only: page URLs are the build's (pageMetadata.ts)
const STYLESHEET = "/_astro/_id_.test0001.css";
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
    PUBLIC_PAGE_STYLESHEETS: STYLESHEET,
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

// Queue mechanics need a kind the consumer writes. In production every Island page kind is excluded after
// Phase 5, so these run on the pre-Phase-5 table and restore the production table
// (node:test runs the top-level tests of a file sequentially).
const PRODUCTION_FORMAT = Object.freeze({ ...PAGE_BODY_FORMAT });
const MECHANICS_FORMAT = { video: "server-rendered", user: "server-rendered", event: "server-rendered" };
const mechanics = (name, fn) =>
  test(name, async (t) => {
    Object.assign(PAGE_BODY_FORMAT, MECHANICS_FORMAT);
    try {
      await fn(t);
    } finally {
      Object.assign(PAGE_BODY_FORMAT, PRODUCTION_FORMAT);
    }
  });

mechanics("contract: a missing page -> gateway rebuild-page message -> consumer -> gateway serves it", async () => {
  const h = harness();
  const first = await h.get("/user/creator-alpha");
  assert.equal(first.status, 503, "public route without HTML is a build gap");
  assert.equal(h.sent.length, 1);
  assert.deepEqual(Object.keys(h.sent[0]).sort(), ["generation", "id", "key", "kind", "reason", "type"]);

  const { outcomes, acks } = await h.consume(h.sent[0]);
  assert.equal(outcomes[0].action, "rendered");
  assert.deepEqual(acks, [["ack", 0]]);
  const stored = h.r2.get(r2HtmlKey("user/creator-alpha"));
  assert.equal(stored.customMetadata.generation, GENERATION, "stamped with the route shard generation");
  assert.match(stored.httpMetadata.contentType, /^text\/html/);
  assert.deepEqual([...h.r2.keys()], ["user/creator-alpha/index.html"], "one key layout: <route key>/index.html only");

  const served = await h.get("/user/creator-alpha");
  assert.equal(served.status, 200);
  const html = await served.text();
  assert.match(html, /<link rel="canonical" href="https:\/\/flamenode\.net\/user\/creator-alpha">/, "canonical is the build's (pageMetadata.ts)");
  assert.ok(html.includes('<link rel="stylesheet" href="' + STYLESHEET + '">'), "styled: stylesheet link from configuration");
  assert.match(html, /Alpha &lt;b&gt;/, "body text is in the HTML and escaped");
  assert.ok(!html.includes("<b>"), "row text is escaped");
  assert.ok(!html.includes("<script"), "same as the build: no JavaScript");
});

mechanics("T01: a doorbell for an updated public page rebuilds only that page and records the version", async () => {
  const h = harness();
  h.request("user", "creator-alpha", 5000);
  const { outcomes } = await h.consume(doorbell("user", "creator-alpha"));
  assert.equal(outcomes[0].action, "rendered");
  assert.deepEqual(h.ops, [["put", "user/creator-alpha/index.html"]]);
  const t = h.tracker("user", "creator-alpha");
  assert.equal(t.rendered_version, t.request_version);
  assert.ok(t.rendered_at > 0);
});

mechanics("T02: unpublish -> R2 HTML deleted and the gateway answers 404 at once (deny entry)", async () => {
  const h = harness();
  await h.consume(doorbell("user", "creator-alpha"));
  assert.equal((await h.get("/user/creator-alpha")).status, 200);
  // S3 unpublish: D1 row, revocation entry and tracker in the same request.
  h.sqlite.exec("UPDATE x_users SET approval_status = 'rejected' WHERE id = 'creator-alpha'");
  h.kv.set(revocationKey("user", "creator-alpha"), "1");
  h.request("user", "creator-alpha", 9000);
  assert.equal((await h.get("/user/creator-alpha")).status, 404, "blocked before the consumer runs");
  const { outcomes } = await h.consume(doorbell("user", "creator-alpha"));
  assert.equal(outcomes[0].action, "deleted");
  assert.equal(outcomes[0].reason, "revoked");
  assert.equal(h.r2.size, 0);
  const res = await h.get("/user/creator-alpha");
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

mechanics("users: CURRENT listable approval statuses and case-insensitive ids", async () => {
  const h = harness();
  for (const body of [doorbell("user", "pending-user"), doorbell("user", "Mixed_Case")]) {
    const { outcomes } = await h.consume(body);
    assert.equal(outcomes[0].action, "rendered", JSON.stringify(body));
  }
  assert.deepEqual([...h.r2.keys()].sort(), ["user/mixed_case/index.html", "user/pending-user/index.html"]);
  assert.equal((await h.get("/user/Mixed_Case")).status, 200);
});

test("excluded kinds (a kind switched to PAGE_BODY_FORMAT 'excluded'): never written, build HTML untouched, request done; unpublish still deletes", async () => {
  assert.deepEqual(PAGE_BODY_FORMAT, PRODUCTION_FORMAT, "production table, no override");
  await excludedKindsScenario();
});

async function excludedKindsScenario() {
  const h = harness();
  // HTML the build (MIG-0509) put in R2 for the current generation.
  const buildMeta = (kind, id, key) => ({ kind, id, key, generation: GENERATION });
  const build = { body: "<!DOCTYPE html><p>build</p>", httpMetadata: { contentType: "text/html" }, customMetadata: buildMeta("event", "ev-public", "event/ev-public") };
  h.r2.set(r2HtmlKey("vid-public"), { ...build, customMetadata: buildMeta("video", "vid-public", "vid-public") });
  h.r2.set(r2HtmlKey("event/ev-public"), { ...build });
  for (const [kind, id] of [["video", "vid-public"], ["event", "ev-public"]]) {
    h.request(kind, id, 1000);
    const { outcomes } = await h.consume(doorbell(kind, id));
    assert.equal(outcomes[0].action, "excluded_kind", kind);
    const t = h.tracker(kind, id);
    assert.equal(t.rendered_version, t.request_version, "not left pending (recovery is not starved)");
  }
  // A gateway miss for an excluded kind does not write an empty shell either.
  h.r2.delete(r2HtmlKey("vid-public"));
  assert.equal((await h.get("/vid-public")).status, 503);
  assert.equal((await h.consume(h.sent.at(-1))).outcomes[0].action, "excluded_kind");
  assert.deepEqual(h.ops, [], "no PUT or DELETE for a public page of an excluded kind");
  assert.equal(h.r2.get(r2HtmlKey("event/ev-public")).body, build.body);
  // Unpublish of an excluded kind still removes the build's HTML.
  h.sqlite.exec("UPDATE events SET visibility_status = 'private' WHERE id = 'ev-public'");
  h.request("event", "ev-public", 2000);
  const { outcomes } = await h.consume(doorbell("event", "ev-public"));
  assert.equal(outcomes[0].action, "deleted");
  assert.equal(outcomes[0].reason, "not_public");
  assert.equal(h.r2.size, 0);

  // /user/[id] (client:load Island page since MIG-0504) is excluded in production: same contract.
  assert.equal(PAGE_BODY_FORMAT.user, "excluded");
  h.ops.length = 0;
  const userBuild = { ...build, customMetadata: buildMeta("user", "creator-alpha", "user/creator-alpha") };
  h.r2.set(r2HtmlKey("user/creator-alpha"), userBuild);
  h.request("user", "creator-alpha", 3000);
  assert.equal((await h.consume(doorbell("user", "creator-alpha"))).outcomes[0].action, "excluded_kind");
  assert.deepEqual(h.ops, [], "no PUT or DELETE for a public user page");
  assert.equal(h.r2.get(r2HtmlKey("user/creator-alpha")).body, build.body);
  h.sqlite.exec("UPDATE x_users SET approval_status = 'rejected' WHERE id = 'creator-alpha'");
  h.request("user", "creator-alpha", 4000);
  const revoked = (await h.consume(doorbell("user", "creator-alpha"))).outcomes[0];
  assert.equal(revoked.action, "deleted");
  assert.equal(revoked.reason, "not_public");
  assert.equal(h.r2.size, 0);
}

mechanics("T03: an update during the render is rebuilt by the next message, also within the same millisecond", async () => {
  // Same requested_at for both edits: a CAS on the timestamp would succeed and lose the
  // second edit; the version CAS does not.
  for (const secondAt of [2000, 1000]) {
    const h = harness();
    h.request("user", "creator-alpha", 1000);
    const originalPut = h.env.R2_STORAGE.put;
    h.env.R2_STORAGE.put = async (...args) => {
      h.sqlite.exec("UPDATE x_users SET x_name = 'Alpha v2' WHERE id = 'creator-alpha'");
      h.request("user", "creator-alpha", secondAt); // S3 writes a newer request mid-render
      return originalPut(...args);
    };
    const first = await h.consume(doorbell("user", "creator-alpha"));
    assert.equal(first.outcomes[0].action, "conflict_newer_request", `second edit at ${secondAt}`);
    const pending = h.tracker("user", "creator-alpha");
    assert.deepEqual([pending.request_version, pending.rendered_version], [2, 0], "still pending");
    h.env.R2_STORAGE.put = originalPut;
    const second = await h.consume(doorbell("user", "creator-alpha"));
    assert.equal(second.outcomes[0].action, "rendered");
    assert.equal(h.tracker("user", "creator-alpha").rendered_version, 2);
    assert.match(h.r2.get(r2HtmlKey("user/creator-alpha")).body, /Alpha v2/);
  }
});

mechanics("producer: each request adds 1 to the version (same millisecond, clock behind), ids stored canonical", async () => {
  const h = harness();
  await h.request("user", "Mixed_Case", 5000);
  await h.request("user", "MIXED_case", 5000);
  await h.request("user", "mixed_case", 4000); // a producer whose clock is behind
  const t = h.tracker("user", "mixed_case");
  assert.equal(t.request_version, 3);
  assert.equal(t.rendered_version, 0);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM public_page_renders").get().n, 1);
  // Pending although requested_at (4000) is behind a consumer clock that rendered at 4500.
  h.sqlite.exec("UPDATE public_page_renders SET rendered_at = 4500");
  assert.equal((await h.consume(doorbell("user", "Mixed_Case"))).outcomes[0].action, "rendered");
});

mechanics("T04: the same doorbell twice: the second does nothing; a gateway request still rebuilds", async () => {
  const h = harness();
  h.request("user", "creator-alpha", 1000);
  await h.consume(doorbell("user", "creator-alpha"));
  const opsAfterFirst = h.ops.length;
  const { outcomes } = await h.consume(doorbell("user", "creator-alpha"));
  assert.equal(outcomes[0].action, "skipped_up_to_date");
  assert.equal(h.ops.length, opsAfterFirst);
  // After a new build the HTML is from an older generation although the version is current:
  // the gateway still serves it (F-02) and asks for one rebuild.
  const stored = h.r2.get(r2HtmlKey("user/creator-alpha")).customMetadata;
  assert.deepEqual(Object.keys(stored).sort(), ["generation", "id", "key", "kind"]);
  stored.generation = "older-build";
  const sentBefore = h.sent.length;
  assert.equal((await h.get("/user/creator-alpha")).status, 200);
  assert.equal(h.sent.length, sentBefore + 1);
  assert.equal(h.sent.at(-1).reason, "stale_generation");
  const again = await h.consume(h.sent.at(-1));
  assert.equal(again.outcomes[0].action, "rendered");
  assert.equal(h.r2.get(r2HtmlKey("user/creator-alpha")).customMetadata.generation, GENERATION);
  const fresh = h.sent.length;
  assert.equal((await h.get("/user/creator-alpha")).status, 200);
  assert.equal(h.sent.length, fresh, "current generation asks for nothing");
});

mechanics("F-02: R2 HTML written for another kind, id or key is never served (503, rebuild requested)", async () => {
  const h = harness();
  await h.consume(doorbell("user", "creator-alpha"));
  const meta = h.r2.get(r2HtmlKey("user/creator-alpha")).customMetadata;
  for (const wrong of [{ kind: "event" }, { id: "pending-user" }, { key: "user/pending-user" }]) {
    h.r2.get(r2HtmlKey("user/creator-alpha")).customMetadata = { ...meta, ...wrong };
    const before = h.sent.length;
    assert.equal((await h.get("/user/creator-alpha")).status, 503, JSON.stringify(wrong));
    assert.equal(h.sent.length, before + 1);
    assert.equal(h.sent.at(-1).reason, "corrupt_data");
  }
});

mechanics("F-07: a video whose URL slug is its YouTube id: id = videos.id, key = slug, canonical from the row", async () => {
  const h = harness();
  const slugKey = "ytSlug00001";
  // Gateway miss: the message carries the slug key and the INTERNAL id.
  assert.equal((await h.get(`/${slugKey}`)).status, 503);
  assert.deepEqual(h.sent.at(-1), { type: "rebuild-page", key: slugKey, kind: "video", id: "vid-yt", generation: GENERATION, reason: "html_missing" });
  const viaGateway = await h.consume(h.sent.at(-1));
  assert.equal(viaGateway.outcomes[0].action, "rendered");
  assert.deepEqual(viaGateway.outcomes[0], { action: "rendered", kind: "video", id: "vid-yt", key: slugKey, generation: GENERATION });
  assert.deepEqual([...h.r2.keys()], [`${slugKey}/index.html`]);
  assert.deepEqual(
    { ...h.r2.get(r2HtmlKey(slugKey)).customMetadata },
    { kind: "video", id: "vid-yt", key: slugKey, generation: GENERATION },
  );
  const served = await h.get(`/${slugKey}`);
  assert.equal(served.status, 200);
  const html = await served.text();
  assert.match(html, /<link rel="canonical" href="https:\/\/flamenode\.net\/ytSlug00001">/, "canonical is the YouTube-id URL, as CURRENT");
  // The internal-id URL is the route alias (308 to the slug), not a page of its own.
  const alias = await h.get("/vid-yt");
  assert.equal(alias.status, 308);
  assert.equal(alias.headers.get("Location"), `/${slugKey}`);

  // Doorbell (producer / recovery) carries only videos.id: the consumer follows the alias to the slug key.
  h.r2.clear();
  h.request("video", "vid-yt", 1000);
  const viaDoorbell = await h.consume(doorbell("video", "vid-yt"));
  assert.equal(viaDoorbell.outcomes[0].action, "rendered");
  assert.equal(viaDoorbell.outcomes[0].key, slugKey);
  assert.deepEqual([...h.r2.keys()], [`${slugKey}/index.html`], "never written under the internal id");
  const t = h.tracker("video", "vid-yt");
  assert.equal(t.rendered_version, t.request_version, "tracked by the internal id");

  // The revocation fence and the delete use the internal id, as CURRENT's fences do.
  h.kv.set(revocationKey("video", "vid-yt"), "1");
  assert.equal((await h.get(`/${slugKey}`)).status, 404);
  h.request("video", "vid-yt", 2000);
  const revoked = await h.consume(doorbell("video", "vid-yt"));
  assert.equal(revoked.outcomes[0].action, "deleted");
  assert.equal(revoked.outcomes[0].reason, "revoked");
  assert.equal(h.r2.size, 0);
  // A fence on the YouTube id is not the video's fence.
  h.kv.clear();
  h.kv.set(revocationKey("video", slugKey), "1");
  h.request("video", "vid-yt", 3000);
  assert.equal((await h.consume(doorbell("video", "vid-yt"))).outcomes[0].action, "rendered");
});

test("F-07: a gateway message with the YouTube id as the entity id is not_routed (the id is videos.id)", async () => {
  const h = harness();
  const { outcomes } = await h.consume({ type: "rebuild-page", key: "ytSlug00001", kind: "video", id: "ytSlug00001", generation: "g", reason: "html_missing" });
  assert.equal(outcomes[0].action, "deleted");
  assert.equal(outcomes[0].reason, "not_routed");
  assert.equal(h.r2.size, 0);
  // Slug key / id pairing is checked against the route shard, not trusted from the message.
  const wrongPair = await h.consume({ type: "rebuild-page", key: "ytSlug00001", kind: "video", id: "vid-public", generation: "g", reason: "html_missing" });
  assert.equal(wrongPair.outcomes[0].reason, "not_routed");
  assert.equal(h.r2.size, 0);
});

mechanics("T05: R2 PUT failure retries the message and leaves the request for recovery", async () => {
  const h = harness();
  h.request("user", "creator-alpha", 1000);
  h.env.R2_STORAGE.put = async () => { throw new Error("r2 down"); };
  const { outcomes, acks } = await h.consume(doorbell("user", "creator-alpha"));
  assert.equal(outcomes[0].action, "retry");
  assert.deepEqual(acks, [["retry", 0]]);
  assert.equal(h.tracker("user", "creator-alpha").rendered_version, 0);
  const sent = [];
  assert.equal(await recoverPendingPageRenders(h.env.DB, { send: async (m) => sent.push(m) }), 1);
  assert.deepEqual(sent, [{ type: "render-page", kind: "user", id: "creator-alpha" }]);
  assert.ok(parsePageRenderMessage(sent[0]), "recovery doorbells are accepted by the consumer");
});

mechanics("bindings / configuration missing, route data or KV unavailable: retry, nothing written", async () => {
  for (const extra of [{ PUBLIC_PAGE_STYLESHEETS: undefined }, { PUBLIC_PAGE_STYLESHEETS: "https://evil.example/x.css" }, { PUBLIC_PAGE_STYLESHEETS: "/_astro/a.css,/other.css" }, { DB: undefined }, { VISIBILITY_KV: undefined }, { ASSETS: undefined }]) {
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
  h.sqlite.prepare(
    "INSERT INTO public_page_renders (entity, entity_id, requested_at, rendered_at, request_version, rendered_version) VALUES ('video', 'done', 5, 9, 4, 4)",
  ).run();
  const sent = [];
  assert.equal(await recoverPendingPageRenders(h.env.DB, { send: async (m) => sent.push(m) }, 100), MAX_RECOVERY_DOORBELLS);
  assert.deepEqual(sent.map((m) => m.id), ["v-0", "v-1", "v-2", "v-3", "v-4"]);
  const plan = h.sqlite.prepare(
    "EXPLAIN QUERY PLAN SELECT entity, entity_id FROM public_page_renders WHERE request_version > rendered_version ORDER BY requested_at ASC LIMIT ?",
  ).all(5).map((r) => r.detail).join(" ");
  assert.match(plan, /public_page_renders_pending_idx/);
});

mechanics("statement budget per message: ≤ 3 D1, 1 KV, 1 R2 write", async () => {
  const h = harness();
  h.request("user", "creator-alpha", 1000);
  const log = [];
  h.env.DB = d1(h.sqlite, log);
  let kvReads = 0;
  const kv = h.env.VISIBILITY_KV;
  h.env.VISIBILITY_KV = { get: async (k) => { kvReads += 1; return kv.get(k); } };
  await h.consume(doorbell("user", "creator-alpha"));
  assert.ok(log.length <= 3, `D1 statements ${log.length}`);
  assert.ok(log.every((sql) => /LIMIT 1|WHERE entity = \? AND entity_id = \? AND request_version = \?/.test(sql)), log.join("\n"));
  assert.equal(kvReads, 1);
  assert.equal(h.ops.length, 1);
});


mechanics("T06: one message end to end (all I/O mocked) stays far below the 8ms Queue budget (local Node)", async () => {
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
          first: async () => (sql.includes("public_page_renders") ? { request_version: 2, rendered_version: 1 } : row),
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
      PUBLIC_PAGE_STYLESHEETS: STYLESHEET,
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

// --- Row -> snapshot projections (the byte-identical SSG checks are replaced by the excluded scenario: every kind is an Island page) ---

const { loadRepresentativeEvents, loadRepresentativeUsers, loadRepresentativeVideos } = await import("../lib/representativeFixtures.ts");
const { snapshotFromRow, parseStylesheets } = await import("./renderPublicPage.ts");

/** D1 rows holding exactly what the representative snapshots hold (same input as the SSG). */
const REP_ROWS = {
  video: {
    id: "repvideo01", title: "代表作品: 合同作品のサンプル", youtube_video_id: "repYTid0001",
    creator_display_name: "代表クリエイター", creator_x_user_id: "rep_creator", creator_icon_url: "/brand/flamenode-icon-192.png",
    creator_has_public_profile: 1, scheduled_time: 1792238400, music: "代表楽曲", credit: "代表アーティスト",
    intro_comment: "MIG-0403 の代表 fixture です。公開作品の静的 HTML を確認します。", visibility_status: "public",
  },
  user: {
    id: "rep_creator", x_name: "代表クリエイター", icon_url: "/brand/flamenode-icon-512.png",
    profile_text: "MIG-0403 の代表クリエイター fixture です。", approval_status: "approved",
  },
};

test("characterization: event row -> same snapshot fields (the byte-identical SSG check is replaced by the excluded scenario: /event/[id] is an Island page)", async () => {
  const [snapshot] = await loadRepresentativeEvents();
  // Row -> snapshot: the stored fields are equal; status / entry come from CURRENT at render time
  // and the period label has no CURRENT source yet (MIG-0502).
  const row = { id: snapshot.id, title: snapshot.title, explanation: snapshot.explanation, icon_url: snapshot.iconUrl, img_url: snapshot.imageUrl ?? null, visibility_status: "public" };
  const fromRow = snapshotFromRow("event", row, 1_800_000_000);
  for (const field of ["kind", "id", "title", "explanation", "iconUrl", "imageUrl"]) assert.equal(fromRow[field], snapshot[field], field);
});

test("characterization: the row projection equals the loaded snapshot field for field (video, user)", async () => {
  const [video] = await loadRepresentativeVideos();
  const [user] = await loadRepresentativeUsers();
  const clean = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(clean(snapshotFromRow("video", REP_ROWS.video)), clean({ ...video }));
  assert.deepEqual(clean(snapshotFromRow("user", REP_ROWS.user)), clean({ ...user }));
});

test("regenerated pages: row text is escaped, stylesheet must be a build asset, event label is the render-time status", async () => {
  const html = await renderPublicPage("user", { id: "u", x_name: '"><img src=x onerror=1>' }, { stylesheets: [STYLESHEET] });
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&quot;&gt;&lt;img src=x"));
  assert.deepEqual(parseStylesheets("/_astro/a.css, /_astro/b.1.css"), ["/_astro/a.css", "/_astro/b.1.css"]);
  for (const bad of [undefined, "", "https://evil.example/a.css", "/_astro/../x.css", '/_astro/a.css"><script>', "/other/a.css"]) {
    assert.throws(() => parseStylesheets(bad), /PUBLIC_PAGE_STYLESHEETS/, String(bad));
  }
  const now = 1_800_000_000;
  const open = snapshotFromRow("event", { id: "e", title: "E", visibility_status: "public", start_time: now + 10, end_time: now + 20, entry_start_time: now - 10, entry_end_time: now + 5 }, now);
  assert.equal(open.statusLabel, "募集期間中");
  assert.equal(open.entryAction, "reserve");
  const ended = snapshotFromRow("event", { id: "e", title: "E", visibility_status: "public", start_time: now - 20, end_time: now - 10 }, now);
  assert.equal(ended.statusLabel, "終了済");
  assert.equal(ended.entryAction, undefined);
});

test("U02 format: production table (every Island page kind is excluded; guards a leaked mechanics override or a hidden production flip)", () => {
  assert.deepEqual(PAGE_BODY_FORMAT, PRODUCTION_FORMAT);
  assert.deepEqual(PAGE_BODY_FORMAT, { video: "excluded", user: "excluded", event: "excluded" });
});

test("U02 server-rendered body: every kind renders its screen at the upper-bound input (MIG-0409 U05 (a) harness)", async () => {
  const inputs = maxInputs();
  for (const kind of ["video", "user", "event"]) {
    const html = await renderPublicPageHtml({ input: inputs[kind], meta: buildPageMetadata({ title: "t", path: "/" + kind }) }, [STYLESHEET]);
    assert.ok(html.length > 40_000, kind + " " + html.length);
  }
});
