// MIG-0652 U04: SA-024 candidate against the real SQLite migration schema.
// This deliberately mounts only the private test router, NOT the production app.
// Full CURRENT-vs-Hono and admin parent-stack parity remain T01-T06 work.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { createSqlite, insert } from "./support/personalHarness.mjs";
import { eventLifecycleRoutes } from "../src/eventLifecycle/archiveRoute.ts";

const ADMIN = { id: "u_admin", role: "admin", name: "Admin", is_banned: 0 };
const SITE = "https://app.flamenode.example";
const EVENT = "evArchive";

function createAtomicD1(sqlite, timeline, beforeBatch = null) {
  const stats = { batches: 0, statements: 0 };
  const run = (query, params, arrays = false) => {
    stats.statements++;
    const statement = sqlite.prepare(query);
    if (arrays) statement.setReturnArrays(true);
    try {
      const rows = statement.all(...params);
      return arrays ? rows.map((r) => [...r]) : rows.map((r) => ({ ...r }));
    } finally {
      if (arrays) statement.setReturnArrays(false);
    }
  };
  const prepare = (query, params = []) => ({
    bind: (...values) => prepare(query, values),
    all: async () => ({
      results: run(query, params), success: true, meta: {},
    }),
    first: async () => run(query, params)[0] ?? null,
    raw: async () => run(query, params, true),
    run: async () => ({
      results: run(query, params), success: true, meta: {},
    }),
    _sql: query,
    _params: params,
  });
  return {
    stats,
    prepare: (query) => prepare(query),
    batch: async (statements) => {
      stats.batches++;
      timeline.push("d1.batch");
      if (beforeBatch) beforeBatch(sqlite);
      sqlite.exec("BEGIN");
      try {
        const result = statements.map((s) => ({
          results: run(s._sql, s._params),
          success: true,
          meta: { changes: sqlite.prepare("SELECT changes() AS n").get().n },
        }));
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function createR2(timeline) {
  let body = null;
  let etag = null;
  let version = 0;
  const key = "visibility/blocked-entities.v1.json";
  return {
    get manifest() { return body === null ? null : JSON.parse(body); },
    async get(path) {
      assert.equal(path, key);
      timeline.push("r2.get");
      if (body === null) return null;
      return {
        size: Buffer.byteLength(body),
        etag,
        text: async () => body,
      };
    },
    async put(path, next, options) {
      assert.equal(path, key);
      timeline.push("r2.put");
      const condition = options?.onlyIf;
      if (condition instanceof Headers) {
        assert.equal(condition.get("If-None-Match"), "*");
        if (body !== null) return null;
      } else if (condition?.etagMatches !== etag) {
        return null;
      }
      body = next;
      etag = "etag-" + ++version;
      return { etag };
    },
  };
}

function setup({ status = "public", r2 = true, beforeBatch, role = "admin", mode = "normal" } = {}) {
  const sqlite = createSqlite();
  const timestamp = Math.floor(Date.now() / 1000) - 100;
  insert(sqlite, "user", {
    id: "u_admin", name: "Admin", discord_id: "d-admin", role,
    created_at: timestamp, is_banned: 0, is_tos_accepted: 1,
  });
  insert(sqlite, "system_settings", {
    id: "default", operation_mode: mode,
    audit_normal_retention_days: 30,
    audit_restorable_retention_days: 180,
    audit_long_retention_days: 365,
    audit_max_payload_bytes: 120000,
    audit_compact_after_days: 30,
  });
  insert(sqlite, "events", {
    id: EVENT, title: "Event before archive",
    visibility_status: status, created_at: timestamp,
    updated_at: timestamp,
    start_time: timestamp - 3600, end_time: timestamp + 3600,
    slot_part_gap_minutes: 10, parts_json: "[]",
  });
  const timeline = [];
  const d1 = createAtomicD1(sqlite, timeline, beforeBatch);
  const bucket = createR2(timeline);
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", { ...ADMIN, role });
    c.set("db", drizzle(d1, { schema }));
    c.set("actorSnapshotJsonById", {
      u_admin: JSON.stringify({
        discord_id: "d-admin", discord_name: "Admin",
        x_user_id: null, x_name: null, icon_url: null,
      }),
    });
    await next();
  });
  app.route("/api/admin/events", eventLifecycleRoutes);
  const env = {
    DB: d1,
    NEXT_PUBLIC_SITE_URL: SITE,
    ...(r2 ? { BUCKET: bucket } : {}),
  };
  const request = (eventId = EVENT, body = { event_id: EVENT, confirm: EVENT }) =>
    app.request("https://app.flamenode.example/api/admin/events/" + eventId, {
      method: "DELETE", headers: { "content-type": "application/json", Origin: SITE },
      body: JSON.stringify(body),
    }, env);
  const read = (table, where = "") =>
    sqlite.prepare("SELECT * FROM " + table + " " + where).all();
  return { sqlite, d1, timeline, bucket, request, read, timestamp };
}

test("MIG-0652 U04 SQLite T08: public event archive atomically writes event, fence, audit, rebuild queue only after R2 confirmation", async () => {
  const f = setup();
  const oldCache = globalThis.caches;
  globalThis.caches = { default: { delete: async () => true } };
  let response;
  try { response = await f.request(); } finally { globalThis.caches = oldCache; }
  assert.equal(response.status, 200, await response.text());
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.clone().json()).ok, true);
  assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "private");
  assert.equal(f.d1.stats.batches, 1);
  const fence = f.read("public_visibility_fences", "WHERE entity_id = '" + EVENT + "'")[0];
  assert.equal(fence.entity_type, "event");
  assert.ok(fence.fence_token);
  const log = f.read("audit_logs", "WHERE table_name = 'events' AND target_id = '" + EVENT + "'");
  assert.equal(log.length, 1);
  assert.equal(log[0].operation, "UPDATE");
  assert.equal(JSON.parse(log[0].before_json).visibility_status, "public");
  assert.equal(JSON.parse(log[0].after_json).visibility_status, "private");
  const queue = f.read("static_rebuild_queue");
  assert.ok(queue.length > 0);
  assert.ok(queue.some((x) => x.reason === "event_private"));
  assert.equal(f.bucket.manifest.entities.find((e) => e.entity_id === EVENT).fence_token, fence.fence_token);
  const firstBatch = f.timeline.indexOf("d1.batch");
  assert.ok(firstBatch > 2, JSON.stringify(f.timeline));
  assert.deepEqual(f.timeline.slice(0, 3), ["r2.get", "r2.put", "r2.get"]);
});

test("MIG-0652 U04 SQLite T09: missing R2 fails closed without D1 batch, audit or rebuild entries", async () => {
  const f = setup({ r2: false });
  const oldError = console.error;
  console.error = () => {};
  let response;
  try { response = await f.request(); } finally { console.error = oldError; }
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
  assert.equal(f.d1.stats.batches, 0);
  assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "public");
  assert.equal(f.read("audit_logs").length, 0);
  assert.equal(f.read("static_rebuild_queue").length, 0);
});

test("MIG-0652 U04 SQLite T10: stale updated_at causes full D1 rollback and R2 compensation", async () => {
  const f = setup({
    beforeBatch: (sqlite) => sqlite.prepare("UPDATE events SET updated_at = updated_at + 5 WHERE id = ?").run(EVENT),
  });
  const oldError = console.error;
  console.error = () => {};
  let response;
  try { response = await f.request(); } finally { console.error = oldError; }
  assert.equal(response.status, 500, await response.text());
  assert.equal((await response.clone().json()).ok, false);
  assert.equal(f.d1.stats.batches, 1);
  assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "public");
  assert.equal(f.read("audit_logs").length, 0);
  assert.equal(f.read("static_rebuild_queue").length, 0);
  assert.equal(f.bucket.manifest.entities.some((e) => e.entity_id === EVENT), false);
});

test("MIG-0652 U04 SQLite T11: non-admin and maintenance denials cannot mutate D1 or R2", async () => {
  for (const options of [
    { role: "moderator", expected: 403 },
    { mode: "maintenance", expected: 503 },
  ]) {
    const f = setup(options);
    const response = await f.request();
    assert.equal(response.status, options.expected);
    assert.equal(f.d1.stats.batches, 0);
    assert.equal(f.read("audit_logs").length, 0);
    assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "public");
    assert.deepEqual(f.timeline, []);
  }
});
