// MIG-0652 U04: SA-024 candidate against the real SQLite migration schema.
// This deliberately mounts only the private test router, NOT the production app.
// Full CURRENT-vs-Hono and admin parent-stack parity remain T01-T06 work.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { D1_MAX_BATCH_QUERIES } from "@flamenode/server-core/audit/mutateBudget";
import { createSqlite, insert } from "./support/personalHarness.mjs";
import { eventLifecycleRoutes } from "../src/eventLifecycle/archiveRoute.ts";
import { originGuardMiddleware, writeGuardMiddleware } from "../src/middleware/writeOrigin.ts";
import { sessionMiddleware } from "../src/auth/session.ts";

const ADMIN = { id: "u_admin", role: "admin", name: "Admin", is_banned: 0 };
const SITE = "https://app.flamenode.example";
const EVENT = "evArchive";
const SESSION_TOKEN = "11111111-1111-4111-8111-111111111111";
const VALID_SESSION_COOKIE = "__Secure-authjs.session-token=" + SESSION_TOKEN;

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

function createR2(timeline, { rejectPut = false, hideFirstVerification = false, seedManifest = null, concurrentFirstPutEntry = null } = {}) {
  let body = seedManifest === null ? null : JSON.stringify(seedManifest);
  let etag = seedManifest === null ? null : "etag-seed";
  let version = 0;
  let verificationHidden = false;
  let injectedConcurrentPut = false;
  const key = "visibility/blocked-entities.v1.json";
  return {
    get manifest() { return body === null ? null : JSON.parse(body); },
    async get(path) {
      assert.equal(path, key);
      timeline.push("r2.get");
      if (body === null) return null;
      if (hideFirstVerification && !verificationHidden) {
        verificationHidden = true;
        // Simulate a stale confirmation read immediately after a successful PUT.
        return null;
      }
      return {
        size: Buffer.byteLength(body),
        etag,
        text: async () => body,
      };
    },
    async put(path, next, options) {
      assert.equal(path, key);
      timeline.push("r2.put");
      if (concurrentFirstPutEntry && !injectedConcurrentPut) {
        // Simulate a different writer winning creation before our CAS checks.
        // This is the same stored R2 manifest (not a second fake object).
        injectedConcurrentPut = true;
        const current = body === null
          ? { schema_version: 1, revision: 0, generated_at: 1000, entities: [] }
          : JSON.parse(body);
        body = JSON.stringify({
          ...current, revision: current.revision + 1,
          entities: [...current.entities, concurrentFirstPutEntry],
        });
        etag = "etag-" + ++version;
        timeline.push("r2.concurrent-write");
      }
      if (rejectPut) return null;
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

function setup({ status = "public", eventId = EVENT, r2 = true, beforeBatch, role = "admin", mode = "normal", r2Options = {}, enforceOrigin = false, enforceWriteGuard = false, enforceSession = false, sessionExpired = false, isBanned = 0, tosAccepted = 1 } = {}) {
  const sqlite = createSqlite();
  const timestamp = Math.floor(Date.now() / 1000) - 100;
  insert(sqlite, "user", {
    id: "u_admin", name: "Admin", discord_id: "d-admin", role,
    created_at: timestamp, is_banned: isBanned, is_tos_accepted: tosAccepted,
  });
  if (enforceSession) {
    insert(sqlite, "session", { sessionToken: SESSION_TOKEN, userId: ADMIN.id,
      expires: Date.now() + (sessionExpired ? -60_000 : 60_000) });
  }
  // The real migrations already seed the singleton default settings row.
  // Updating it avoids a duplicate primary key and exercises the actual schema.
  const settingsUpdated = sqlite.prepare(`
    UPDATE system_settings
    SET operation_mode = ?,
        audit_normal_retention_days = ?,
        audit_restorable_retention_days = ?,
        audit_long_retention_days = ?,
        audit_max_payload_bytes = ?,
        audit_compact_after_days = ?
    WHERE id = 'default'
  `).run(mode, 30, 180, 365, 120000, 30);
  assert.equal(settingsUpdated.changes, 1, "migrations must seed default system_settings");
  insert(sqlite, "events", {
    id: eventId, title: "Event before archive",
    visibility_status: status, created_at: timestamp,
    updated_at: timestamp,
    start_time: timestamp - 3600, end_time: timestamp + 3600,
    slot_part_gap_minutes: 10, parts_json: "[]",
  });
  const timeline = [];
  const d1 = createAtomicD1(sqlite, timeline, beforeBatch);
  const bucket = createR2(timeline, r2Options);
  const app = new Hono();
  if (enforceOrigin) {
    // Real admin-origin middleware, mounted BEFORE the synthetic session/DB.
    app.use("*", originGuardMiddleware({
      loadSiteUrl: () => SITE,
      allowLocalPreview: () => false,
    }));
  }
  if (enforceSession) {
    // Real Auth.js session resolution, no synthetic user injected.
    app.use("*", sessionMiddleware());
  } else {
    app.use("*", async (c, next) => {
      // Test-only session identity. A real session provider is deliberately not faked.
      c.set("user", { ...ADMIN, role, is_banned: isBanned });
      if (!enforceWriteGuard) {
        c.set("db", drizzle(d1, { schema }));
        c.set("actorSnapshotJsonById", {
          u_admin: JSON.stringify({
            discord_id: "d-admin", discord_name: "Admin",
            x_user_id: null, x_name: null, icon_url: null,
          }),
        });
      }
      await next();
    });
  }
  if (enforceWriteGuard) {
    // Mirror admin parent ordering: session -> real write identity guard -> DB adapter.
    // writeGuardMiddleware preloads the actor snapshot for the strict audit.
    app.use("*", writeGuardMiddleware({
      loadSiteUrl: () => SITE,
      allowLocalPreview: () => false,
    }));
    app.use("*", async (c, next) => {
      c.set("db", drizzle(d1, { schema }));
      await next();
    });
  }
  app.route("/api/admin/events", eventLifecycleRoutes);
  const env = {
    DB: d1,
    NEXT_PUBLIC_SITE_URL: SITE,
    ...(r2 ? { BUCKET: bucket } : {}),
  };
  const request = (requestedId = eventId, body = { event_id: eventId, confirm: eventId }, origin = SITE, cookie = enforceSession ? VALID_SESSION_COOKIE : null) =>
    app.request("https://app.flamenode.example/api/admin/events/" + encodeURIComponent(requestedId), {
      method: "DELETE", headers: { "content-type": "application/json", ...(origin === null ? {} : { Origin: origin }), ...(cookie === null ? {} : { Cookie: cookie }) },
      body: JSON.stringify(body),
    }, env);
  const requestRaw = (rawBody, cookie = enforceSession ? VALID_SESSION_COOKIE : null) =>
    app.request(SITE + "/api/admin/events/" + EVENT, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        Origin: SITE,
        ...(cookie === null ? {} : { Cookie: cookie }),
      },
      body: rawBody,
    }, env);
  const read = (table, where = "") =>
    sqlite.prepare("SELECT * FROM " + table + " " + where).all();
  return { sqlite, d1, timeline, bucket, request, requestRaw, read, timestamp };
}

test("MIG-0652 U04 SQLite T08: public event archive atomically writes event, fence, audit, rebuild queue only after R2 confirmation", async () => {
  const f = setup();
  const oldCache = globalThis.caches;
  globalThis.caches = { default: { delete: async () => true } };
  let response;
  try { response = await f.request(); } finally { globalThis.caches = oldCache; }
  assert.equal(response.status, 200);
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
  assert.equal(response.status, 500);
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

test("MIG-0652 U04 SQLite T12: already-private archive skips R2 precommit but retains audited D1/queue", async () => {
  const f = setup({ status: "private", r2: false });
  const oldCache = globalThis.caches;
  globalThis.caches = { default: { delete: async () => true } };
  let response;
  try { response = await f.request(); } finally { globalThis.caches = oldCache; }
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(f.d1.stats.batches, 1);
  assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "private");
  assert.equal(f.read("public_visibility_fences", "WHERE entity_id = '" + EVENT + "'").length, 0);
  assert.equal(f.read("audit_logs", "WHERE target_id = '" + EVENT + "'").length, 1);
  assert.ok(f.read("static_rebuild_queue").length > 0);
  assert.deepEqual(f.timeline, ["d1.batch"], "no new R2 visibility fence for a no-op transition");
});

test("MIG-0652 U04 SQLite T13: forged confirmation and absent event cannot mutate D1/R2", async () => {
  for (const options of [
    { eventId: EVENT, body: { event_id: EVENT, confirm: "unrelated" }, expected: 400 },
    { eventId: "other_event", body: { event_id: "other_event", confirm: "other_event" }, expected: 404 },
    { eventId: EVENT, body: { event_id: "other_event", confirm: EVENT }, expected: 400 },
  ]) {
    const f = setup();
    const response = await f.request(options.eventId, options.body);
    assert.equal(response.status, options.expected, JSON.stringify(options));
    assert.equal((await response.json()).ok, false);
    assert.equal(f.d1.stats.batches, 0);
    assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "public");
    assert.equal(f.read("audit_logs").length, 0);
    assert.equal(f.read("static_rebuild_queue").length, 0);
    assert.deepEqual(f.timeline, [], "invalid request must not touch R2 or run a D1 batch");
  }
});


test("MIG-0652 U04 SQLite T14: R2 CAS rejection refuses archive before D1 and leaves no fence", async () => {
  const f = setup({ r2Options: { rejectPut: true } });
  const oldError = console.error;
  console.error = () => {};
  let response;
  try { response = await f.request(); } finally { console.error = oldError; }
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
  assert.equal(f.d1.stats.batches, 0);
  assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "public");
  assert.equal(f.read("public_visibility_fences").length, 0);
  assert.equal(f.read("audit_logs").length, 0);
  assert.equal(f.read("static_rebuild_queue").length, 0);
  assert.equal(f.bucket.manifest, null);
  assert.ok(f.timeline.includes("r2.put"), "CAS must have been attempted");
  assert.ok(!f.timeline.includes("d1.batch"));
});

test("MIG-0652 U04 SQLite T15: failed R2 confirmation triggers compensation without D1 mutation", async () => {
  const f = setup({ r2Options: { hideFirstVerification: true } });
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
  assert.equal(f.read("public_visibility_fences").length, 0);
  assert.equal(f.bucket.manifest?.entities.some((e) => e.entity_id === EVENT), false);
  assert.deepEqual(f.timeline.slice(0, 3), ["r2.get", "r2.put", "r2.get"]);
  assert.ok(f.timeline.filter((op) => op === "r2.put").length >= 2, "compensation should CAS-release the uncommitted manifest entry");
  assert.ok(!f.timeline.includes("d1.batch"));
});


test("MIG-0652 U04 SQLite T16: postcommit cache outage never rolls back an archived event or its visibility fence", async () => {
  const f = setup();
  const oldCache = globalThis.caches;
  const oldWarn = console.warn;
  const warnings = [];
  globalThis.caches = { default: { delete: async () => { throw new Error("simulated cache outage"); } } };
  console.warn = (...parts) => warnings.push(parts.join(" "));
  let response;
  try {
    response = await f.request();
  } finally {
    globalThis.caches = oldCache;
    console.warn = oldWarn;
  }
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(f.d1.stats.batches, 1);
  assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "private");
  const fence = f.read("public_visibility_fences", "WHERE entity_id = '" + EVENT + "'")[0];
  assert.ok(fence?.fence_token);
  assert.equal(f.bucket.manifest.entities.find((e) => e.entity_id === EVENT).fence_token, fence.fence_token);
  assert.equal(f.read("audit_logs", "WHERE target_id = '" + EVENT + "'").length, 1);
  assert.ok(f.read("static_rebuild_queue").some((entry) => entry.reason === "event_private"));
  assert.ok(warnings.some((line) => line.includes("cache_api_delete_failed")));
  assert.ok(!warnings.some((line) => line.includes("simulated cache outage")), "provider error must stay redacted");
  assert.ok(!f.timeline.slice(f.timeline.indexOf("d1.batch") + 1).includes("r2.put"),
    "postcommit cache failure must never compensate a committed visibility fence");
});


test("MIG-0652 U04 SQLite T17: strict audit INSERT failure rolls back event, fence and queue then compensates R2", async () => {
  const f = setup({
    beforeBatch: (sqlite) => sqlite.exec(
      "CREATE TRIGGER reject_archive_audit BEFORE INSERT ON audit_logs " +
      "BEGIN SELECT RAISE(ABORT, 'forced audit insert failure'); END;",
    ),
  });
  const oldError = console.error;
  console.error = () => {};
  let response;
  try { response = await f.request(); } finally { console.error = oldError; }
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.ok(!body.message.includes("forced audit insert failure"), "raw database details must not reach clients");
  assert.equal(f.d1.stats.batches, 1, "strict audit must be inside the same atomic D1 batch");
  assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "public");
  assert.equal(f.read("public_visibility_fences").length, 0);
  assert.equal(f.read("audit_logs").length, 0);
  assert.equal(f.read("static_rebuild_queue").length, 0);
  assert.equal(f.bucket.manifest?.entities.some((e) => e.entity_id === EVENT), false);
  assert.deepEqual(f.timeline.slice(0, 3), ["r2.get", "r2.put", "r2.get"]);
  assert.ok(f.timeline.indexOf("d1.batch") > 2);
  assert.ok(f.timeline.slice(f.timeline.indexOf("d1.batch") + 1).includes("r2.put"),
    "a failed atomic audit commit must release only its own R2 precommit fence");
});

test("MIG-0652 U04 SQLite T18: parent origin guard rejects forged or missing Origin before any D1/R2 read", async () => {
  for (const origin of ["https://attacker.example", null]) {
    const f = setup({ enforceOrigin: true });
    const response = await f.request(EVENT, { event_id: EVENT, confirm: EVENT }, origin);
    assert.equal(response.status, 403, String(origin));
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { ok: false, reason: "invalid_origin" });
    assert.equal(f.d1.stats.statements, 0, "Origin rejection must not read D1");
    assert.equal(f.d1.stats.batches, 0, "Origin rejection must not write D1");
    assert.deepEqual(f.timeline, [], "Origin rejection must not contact R2");
    assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "public");
    assert.equal(f.read("audit_logs").length, 0);
    assert.equal(f.read("static_rebuild_queue").length, 0);
  }
});


test("MIG-0652 U04 SQLite T19: real parent write identity guard denies banned, TOS and nonadmin before R2 or D1 mutations", async () => {
  for (const options of [
    { isBanned: 1, expectedReason: "banned" },
    { tosAccepted: 0, expectedReason: "tos_required" },
    { role: "moderator", expectedReason: "forbidden" },
  ]) {
    const f = setup({ ...options, enforceWriteGuard: true });
    const response = await f.request();
    assert.equal(response.status, 403, JSON.stringify(options));
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.reason, options.expectedReason);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(f.d1.stats.batches, 0, "guard denial must not start a D1 write batch");
    assert.deepEqual(f.timeline, [], "guard denial must not touch R2");
    assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "public");
    assert.equal(f.read("audit_logs").length, 0);
    assert.equal(f.read("static_rebuild_queue").length, 0);
  }

  const allowed = setup({ enforceWriteGuard: true });
  const oldCache = globalThis.caches;
  globalThis.caches = { default: { delete: async () => true } };
  let response;
  try { response = await allowed.request(); } finally { globalThis.caches = oldCache; }
  assert.equal(response.status, 200, "valid admin must reach the archive via the real write guard");
  assert.equal((await response.json()).ok, true);
  assert.equal(allowed.d1.stats.batches, 1);
  assert.equal(allowed.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "private");
  assert.equal(allowed.read("audit_logs", "WHERE target_id = '" + EVENT + "'").length, 1);
  assert.ok(allowed.read("static_rebuild_queue").some((row) => row.reason === "event_private"));
  assert.ok(allowed.bucket.manifest?.entities.some((row) => row.entity_id === EVENT));
});

test("MIG-0652 U04 SQLite T20: Auth.js session -> Origin -> write identity -> archived event", async () => {
  const body = { event_id: EVENT, confirm: EVENT };
  for (const variant of [
    { name: "missing", cookie: null, expired: false, expectedReads: 0 },
    { name: "forged", cookie: "__Secure-authjs.session-token=forged", expired: false, expectedReads: 1 },
    { name: "expired", cookie: VALID_SESSION_COOKIE, expired: true, expectedReads: 1 },
  ]) {
    const f = setup({ enforceOrigin: true, enforceSession: true, enforceWriteGuard: true, sessionExpired: variant.expired });
    const response = await f.request(EVENT, body, SITE, variant.cookie);
    assert.equal(response.status, 401, variant.name);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { ok: false, reason: "unauthenticated", message: "ログインが必要です。" });
    assert.equal(f.d1.stats.statements, variant.expectedReads, variant.name + ": only the indexed session lookup may run");
    assert.equal(f.d1.stats.batches, 0);
    assert.deepEqual(f.timeline, [], variant.name + ": no R2 mutation");
    assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "public");
    assert.equal(f.read("audit_logs").length, 0);
    assert.equal(f.read("static_rebuild_queue").length, 0);
  }

  const forgedOrigin = setup({ enforceOrigin: true, enforceSession: true, enforceWriteGuard: true });
  const rejected = await forgedOrigin.request(EVENT, body, "https://evil.example", VALID_SESSION_COOKIE);
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).reason, "invalid_origin");
  assert.equal(forgedOrigin.d1.stats.statements, 0, "Origin must precede real session lookup");
  assert.deepEqual(forgedOrigin.timeline, []);

  const allowed = setup({ enforceOrigin: true, enforceSession: true, enforceWriteGuard: true });
  const oldCache = globalThis.caches;
  globalThis.caches = { default: { delete: async () => true } };
  let success;
  try { success = await allowed.request(); } finally { globalThis.caches = oldCache; }
  assert.equal(success.status, 200, "valid Auth.js session admin may archive");
  assert.equal((await success.json()).ok, true);
  assert.equal(allowed.d1.stats.batches, 1);
  assert.equal(allowed.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "private");
  assert.equal(allowed.read("audit_logs", "WHERE target_id = '" + EVENT + "'").length, 1);
  assert.ok(allowed.read("static_rebuild_queue").some((row) => row.reason === "event_private"));
  const fence = allowed.read("public_visibility_fences", "WHERE entity_id = '" + EVENT + "'")[0];
  assert.ok(fence?.fence_token);
  assert.equal(allowed.bucket.manifest?.entities.find((row) => row.entity_id === EVENT)?.fence_token, fence.fence_token);
});

test("MIG-0652 U04 SQLite T21: existing unrelated visibility fences survive both successful archive and failed D1 compensation", async () => {
  const foreignEntities = [
    { entity_type: "event", entity_id: "evUnrelated", fence_token: "vf-foreign-event", blocked_at: 1000, reason: "unrelated" },
    { entity_type: "video", entity_id: "videoUnrelated", fence_token: "vf-foreign-video", blocked_at: 1001, reason: "unrelated" },
  ];
  const seedManifest = {
    schema_version: 1, revision: 9, generated_at: 1001,
    entities: foreignEntities,
  };
  const retained = (bucket) => {
    assert.ok(bucket.manifest, "seeded manifest must not disappear");
    for (const row of foreignEntities) {
      assert.deepEqual(
        bucket.manifest.entities.find((entry) => entry.entity_type === row.entity_type && entry.entity_id === row.entity_id),
        row,
        "archive must preserve the full unrelated R2 entry, including its fencing token",
      );
    }
  };

  const success = setup({ r2Options: { seedManifest } });
  const oldCache = globalThis.caches;
  globalThis.caches = { default: { delete: async () => true } };
  let okResponse;
  try { okResponse = await success.request(); } finally { globalThis.caches = oldCache; }
  assert.equal(okResponse.status, 200);
  assert.equal((await okResponse.json()).ok, true);
  retained(success.bucket);
  const ownFence = success.read("public_visibility_fences", "WHERE entity_id = '" + EVENT + "'")[0];
  assert.ok(ownFence?.fence_token);
  assert.equal(
    success.bucket.manifest.entities.find((row) => row.entity_type === "event" && row.entity_id === EVENT)?.fence_token,
    ownFence.fence_token,
  );
  assert.equal(success.bucket.manifest.entities.length, foreignEntities.length + 1);
  assert.equal(success.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "private");
  assert.equal(success.d1.stats.batches, 1);

  const failure = setup({
    r2Options: { seedManifest },
    beforeBatch: (sqlite) => sqlite.exec(
      "CREATE TRIGGER reject_archive_audit_21 BEFORE INSERT ON audit_logs " +
      "BEGIN SELECT RAISE(ABORT, 'T21 audit failure'); END;",
    ),
  });
  const oldError = console.error;
  console.error = () => {};
  let failedResponse;
  try { failedResponse = await failure.request(); } finally { console.error = oldError; }
  assert.equal(failedResponse.status, 500);
  assert.equal((await failedResponse.json()).ok, false);
  assert.equal(failure.d1.stats.batches, 1);
  retained(failure.bucket);
  assert.equal(failure.bucket.manifest.entities.length, foreignEntities.length);
  assert.equal(failure.bucket.manifest.entities.some((row) => row.entity_type === "event" && row.entity_id === EVENT), false);
  assert.equal(failure.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "public");
  assert.equal(failure.read("public_visibility_fences").length, 0);
  assert.equal(failure.read("audit_logs").length, 0);
  assert.equal(failure.read("static_rebuild_queue").length, 0);
  assert.deepEqual(failure.timeline.slice(0, 3), ["r2.get", "r2.put", "r2.get"]);
  assert.ok(failure.timeline.slice(failure.timeline.indexOf("d1.batch") + 1).includes("r2.put"),
    "compensation must CAS-remove only its own uncommitted fence");
});

test("MIG-0652 U04 SQLite T22: racing R2 first-manifest writers preserve both blocked entities via CAS retry", async () => {
  const competitor = {
    entity_type: "video",
    entity_id: "vidConcurrent",
    fence_token: "vf-other-writer",
    blocked_at: 1000,
    reason: "concurrent_independent_archive",
  };
  const f = setup({ r2Options: { concurrentFirstPutEntry: competitor } });
  assert.equal(f.bucket.manifest, null, "both writers must begin from a missing manifest");
  const oldCache = globalThis.caches;
  globalThis.caches = { default: { delete: async () => true } };
  let response;
  try { response = await f.request(); } finally { globalThis.caches = oldCache; }
  assert.equal(response.status, 200, "archive should retry its conditional R2 create");
  assert.equal((await response.json()).ok, true);
  assert.deepEqual(
    f.bucket.manifest?.entities.find((row) => row.entity_type === "video" && row.entity_id === competitor.entity_id),
    competitor,
    "the winning concurrent writer must never be overwritten",
  );
  const targetFence = f.read("public_visibility_fences", "WHERE entity_id = '" + EVENT + "'")[0];
  assert.ok(targetFence?.fence_token);
  assert.equal(
    f.bucket.manifest?.entities.find((row) => row.entity_type === "event" && row.entity_id === EVENT)?.fence_token,
    targetFence.fence_token,
  );
  assert.equal(f.bucket.manifest?.entities.length, 2);
  assert.equal(f.bucket.manifest?.revision, 2, "initial rival write then the archived event CAS retry");
  assert.equal(f.timeline.filter((op) => op === "r2.concurrent-write").length, 1);
  assert.equal(f.timeline.filter((op) => op === "r2.put").length, 2, "failed create-if-absent + retry");
  assert.ok(f.timeline.lastIndexOf("r2.get") < f.timeline.indexOf("d1.batch"),
    "both block entries must be independently read back before committing D1");
  assert.equal(f.d1.stats.batches, 1);
  assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "private");
  assert.equal(f.read("audit_logs", "WHERE target_id = '" + EVENT + "'").length, 1);
  assert.ok(f.read("static_rebuild_queue").some((row) => row.reason === "event_private"));
});

test("MIG-0652 U04 SQLite T23: pre-existing same-target R2 fence is preserved and archive fails closed", async () => {
  const competing = {
    entity_type: "event", entity_id: EVENT,
    fence_token: "vf-inflight-other-writer", blocked_at: 1000, reason: "first_writer_precommit",
  };
  const seedManifest = {
    schema_version: 1, revision: 7, generated_at: 1000, entities: [competing],
  };
  const f = setup({ r2Options: { seedManifest } });
  const oldError = console.error;
  console.error = () => {};
  let response;
  try { response = await f.request(); } finally { console.error = oldError; }
  assert.equal(response.status, 503, "second archive must not overwrite a still-blocked public artifact");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const denied = await response.json();
  assert.equal(denied.ok, false);
  assert.ok(!JSON.stringify(denied).includes("vf-inflight-other-writer"), "do not leak the first writer token");
  assert.deepEqual(f.bucket.manifest, seedManifest, "the first writer's token and revision remain unchanged");
  assert.equal(f.timeline.filter((op) => op === "r2.put").length, 0);
  assert.equal(f.d1.stats.batches, 0, "the second archive cannot begin D1 mutation");
  assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "public");
  assert.equal(f.read("public_visibility_fences").length, 0);
  assert.equal(f.read("audit_logs").length, 0);
  assert.equal(f.read("static_rebuild_queue").length, 0);
});

test("MIG-0652 U04 SQLite T24: simultaneous first manifest creation for SAME event rejects competing token without D1 mutation", async () => {
  const rival = {
    entity_type: "event",
    entity_id: EVENT,
    fence_token: "vf-first-archive-concurrent",
    blocked_at: 1000,
    reason: "other_inflight_archive",
  };
  // Archive starts from a missing manifest. Another archive for the SAME event
  // wins R2 create-if-absent immediately before this request's first PUT.
  const f = setup({ r2Options: { concurrentFirstPutEntry: rival } });
  assert.equal(f.bucket.manifest, null);
  const priorError = console.error;
  console.error = () => {};
  let response;
  try { response = await f.request(); } finally { console.error = priorError; }
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const denied = await response.json();
  assert.equal(denied.ok, false);
  assert.ok(!JSON.stringify(denied).includes(rival.fence_token), "do not leak the winning writer's token");
  assert.equal(f.timeline.filter((op) => op === "r2.concurrent-write").length, 1);
  assert.ok(f.timeline.filter((op) => op === "r2.put").length >= 1, "our create-if-absent must lose the R2 CAS");
  assert.ok(!f.timeline.includes("d1.batch"), "losing R2 CAS must never begin an atomic D1 write");
  assert.equal(f.d1.stats.batches, 0);
  const finalManifest = f.bucket.manifest;
  assert.equal(finalManifest?.revision, 1);
  assert.deepEqual(finalManifest?.entities, [rival], "the winning same-event token must remain intact");
  assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "public");
  assert.equal(f.read("public_visibility_fences").length, 0);
  assert.equal(f.read("audit_logs").length, 0);
  assert.equal(f.read("static_rebuild_queue").length, 0);
});

test("MIG-0652 U04 SQLite T25: real session guard rejects malformed JSON, non-object JSON and oversized UTF-8 before archive", async () => {
  const oversizedJson = JSON.stringify({
    event_id: EVENT, confirm: EVENT,
    // The HTTP 64KiB ceiling is for UTF-8 bytes, NOT JavaScript string length.
    padding: "日".repeat(22_000),
  });
  assert.ok(Buffer.byteLength(oversizedJson, "utf8") > 65_536);
  for (const variant of [
    { name: "malformed", raw: '{"event_id":', status: 400, message: "入力エラー" },
    { name: "array", raw: '["evArchive"]', status: 400, message: "入力エラー" },
    { name: "null", raw: "null", status: 400, message: "入力エラー" },
    { name: "primitive", raw: '"evArchive"', status: 400, message: "入力エラー" },
    { name: "oversized utf8", raw: oversizedJson, status: 413, message: "リクエストが大きすぎます。" },
  ]) {
    // Exact production middleware order: Origin -> Auth.js session -> admin
    // writeGuard -> cost guard -> archive; only the test router is mounted.
    const f = setup({ enforceOrigin: true, enforceSession: true, enforceWriteGuard: true });
    const response = await f.requestRaw(variant.raw);
    assert.equal(response.status, variant.status, variant.name);
    assert.equal(response.headers.get("cache-control"), "private, no-store", variant.name);
    assert.deepEqual(await response.json(), { ok: false, message: variant.message }, variant.name);
    assert.equal(f.d1.stats.batches, 0, variant.name + ": no atomic mutation");
    assert.deepEqual(f.timeline, [], variant.name + ": no R2 access");
    assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "public");
    assert.equal(f.read("public_visibility_fences").length, 0);
    assert.equal(f.read("audit_logs").length, 0);
    assert.equal(f.read("static_rebuild_queue").length, 0);
  }
});

test("MIG-0652 U04 SQLite T26: CURRENT source-anchored archive result contract on real admin stack", async () => {
  // CURRENT's Server Action is not directly executable in this Hono integration
  // harness (Next/Cloudflare bootstrap). Anchor shared observable contracts to
  // its actual source, then exercise the candidate route via real Auth.js guards.
  // This deliberately does NOT claim a full runtime CURRENT-vs-Hono replay.
  const currentSource = await readFile(
    new URL("../../../src/lib/actions/event-admin.ts", import.meta.url), "utf8",
  );
  const actionStart = currentSource.indexOf("export async function deleteEvent(");
  assert.ok(actionStart >= 0, "CURRENT deleteEvent must remain discoverable");
  const currentAction = currentSource.slice(actionStart);
  for (const message of [
    "event_id が必要です。",
    "確認のため、イベント ID と同じ文字列を入力してください。",
    "イベントが見つかりません。",
  ]) {
    assert.ok(currentAction.includes(JSON.stringify(message)), "CURRENT archive must retain: " + message);
  }
  assert.match(
    currentAction,
    /return markPendingPublicReflection\(\{ ok: true \}, queue\.statements\.length > 0\);/,
    "CURRENT must return the queued-public-reflection contract",
  );

  for (const variant of [
    { name: "missing ID", path: EVENT, body: { confirm: EVENT }, status: 400, message: "event_id が必要です。" },
    { name: "confirmation mismatch", path: EVENT, body: { event_id: EVENT, confirm: "another" }, status: 400, message: "確認のため、イベント ID と同じ文字列を入力してください。" },
    { name: "nonexistent event", path: "nonexistent_event", body: { event_id: "nonexistent_event", confirm: "nonexistent_event" }, status: 404, message: "イベントが見つかりません。" },
  ]) {
    const f = setup({ enforceOrigin: true, enforceSession: true, enforceWriteGuard: true });
    const response = await f.request(variant.path, variant.body);
    assert.equal(response.status, variant.status, variant.name);
    assert.equal(response.headers.get("cache-control"), "private, no-store", variant.name);
    assert.deepEqual(await response.json(), { ok: false, message: variant.message }, variant.name);
    assert.equal(f.d1.stats.batches, 0, variant.name + " cannot mutate");
    assert.deepEqual(f.timeline, [], variant.name + " cannot write R2");
    assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "public");
    assert.equal(f.read("audit_logs").length, 0);
    assert.equal(f.read("static_rebuild_queue").length, 0);
  }

  const f = setup({ enforceOrigin: true, enforceSession: true, enforceWriteGuard: true });
  const oldCaches = globalThis.caches;
  globalThis.caches = { default: { delete: async () => true } };
  let success;
  try { success = await f.request(); } finally { globalThis.caches = oldCaches; }
  assert.equal(success.status, 200);
  assert.equal(success.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(
    await success.json(),
    { ok: true, pendingPublicReflection: true },
    "Hono must match CURRENT's successful queued-reflection response keys",
  );
  assert.equal(f.d1.stats.batches, 1);
  assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "private");
  assert.ok(f.read("static_rebuild_queue").length > 0);
});

test("MIG-0652 U04 SQLite T27: archived legacy dotted ID succeeds with real admin identity, R2 CAS, audit and queue", async () => {
  const legacyId = "legacy.event.2019";
  // A real imported event may predate the route-safe create/rename ID rule.
  const f = setup({
    eventId: legacyId, enforceOrigin: true, enforceSession: true,
    enforceWriteGuard: true,
  });
  const priorCaches = globalThis.caches;
  globalThis.caches = { default: { delete: async () => true } };
  let response;
  try { response = await f.request(); } finally { globalThis.caches = priorCaches; }
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { ok: true, pendingPublicReflection: true });
  const changed = f.read("events", "WHERE id = '" + legacyId + "'")[0];
  assert.equal(changed.visibility_status, "private");
  assert.equal(f.d1.stats.batches, 1);
  const fence = f.read("public_visibility_fences", "WHERE entity_id = '" + legacyId + "'")[0];
  assert.ok(fence?.fence_token);
  assert.equal(
    f.bucket.manifest.entities.find((entry) => entry.entity_type === "event" && entry.entity_id === legacyId)?.fence_token,
    fence.fence_token,
  );
  assert.equal(f.read("audit_logs", "WHERE table_name = 'events' AND target_id = '" + legacyId + "'").length, 1);
  assert.ok(f.read("static_rebuild_queue").some((row) => row.reason === "event_private"));
  assert.deepEqual(f.timeline.slice(0, 3), ["r2.get", "r2.put", "r2.get"]);
});

test("MIG-0652 U04 SQLite T28: percent-encoded Unicode, spaces, slash and literal percent IDs archive the intended existing row", async () => {
  // CURRENT accepts historic event IDs outside the new create/rename pattern.
  // A Hono URI parameter must be decoded EXACTLY ONCE before matching its
  // JSON body, R2 blocked entity, audited D1 row and cache eviction identity.
  const legacyIds = [
    "旧イベント 2020",
    "legacy/a",
    "literal%2Fid",
    "x".repeat(65),
  ];
  for (const eventId of legacyIds) {
    const f = setup({
      eventId,
      enforceOrigin: true, enforceSession: true, enforceWriteGuard: true,
    });
    const evicted = [];
    const priorCache = globalThis.caches;
    globalThis.caches = { default: { delete: async (key) => {
      evicted.push(String(key));
      return true;
    } } };
    let response;
    try { response = await f.request(); } finally { globalThis.caches = priorCache; }
    assert.equal(response.status, 200, "transport failed for " + JSON.stringify(eventId));
    assert.deepEqual(await response.json(), { ok: true, pendingPublicReflection: true });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(f.d1.stats.batches, 1, eventId);
    assert.equal(
      f.sqlite.prepare("SELECT visibility_status FROM events WHERE id = ?").get(eventId)?.visibility_status,
      "private", eventId,
    );
    const fence = f.sqlite.prepare(
      "SELECT fence_token FROM public_visibility_fences WHERE entity_type = 'event' AND entity_id = ?",
    ).get(eventId);
    assert.ok(fence?.fence_token, eventId + " D1 fence");
    assert.equal(
      f.bucket.manifest?.entities.find((x) => x.entity_type === "event" && x.entity_id === eventId)?.fence_token,
      fence.fence_token,
      "R2 fence must target the decoded original event ID",
    );
    assert.equal(
      f.sqlite.prepare("SELECT count(*) AS n FROM audit_logs WHERE table_name = 'events' AND target_id = ?").get(eventId).n,
      1, eventId + " audit",
    );
    assert.ok(f.read("static_rebuild_queue").some((x) => x.reason === "event_private"));
    assert.ok(
      evicted.some((url) => url.endsWith(encodeURIComponent("events/" + eventId + ".json"))),
      eventId + " must evict its exactly-once-encoded public cache key",
    );
    assert.deepEqual(f.timeline.slice(0, 3), ["r2.get", "r2.put", "r2.get"]);
  }
});

test("MIG-0652 U04 SQLite T29: URL-decoded legacy ID cannot be forged by an encoded-looking JSON body", async () => {
  const eventId = "legacy/a";
  const f = setup({
    eventId,
    enforceOrigin: true, enforceSession: true, enforceWriteGuard: true,
  });
  const response = await f.request(eventId, {
    event_id: "legacy%2Fa",
    confirm: "legacy%2Fa",
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false, message: "イベントIDが一致しません。",
  });
  assert.equal(f.d1.stats.batches, 0);
  assert.deepEqual(f.timeline, []);
  assert.equal(
    f.sqlite.prepare("SELECT visibility_status FROM events WHERE id = ?").get(eventId)?.visibility_status,
    "public",
  );
  assert.equal(f.read("audit_logs").length, 0);
  assert.equal(f.read("public_visibility_fences").length, 0);
  assert.equal(f.read("static_rebuild_queue").length, 0);
});

test("MIG-0652 U04 SQLite T30: audited archive stays within D1 Free invocation query budget under real auth guards", async () => {
  // Count every prepared SQL statement actually executed by the in-memory D1
  // wrapper, including the real Auth.js lookup, identity/write/cost guards,
  // event/queue pre-reads and each atomic batch statement. Setup SQL runs
  // against SQLite directly and is intentionally not charged to a request.
  // This is a deterministic query-count regression, NOT workerd/D1 billing.
  assert.equal(D1_MAX_BATCH_QUERIES, 50, "update this test if D1 policy changes");
  for (const variant of [
    { name: "public to private", status: "public", r2: true },
    { name: "already private idempotent archive", status: "private", r2: false },
  ]) {
    const f = setup({
      status: variant.status, r2: variant.r2,
      enforceOrigin: true, enforceSession: true, enforceWriteGuard: true,
    });
    const previousCaches = globalThis.caches;
    globalThis.caches = { default: { delete: async () => true } };
    let response;
    try { response = await f.request(); } finally { globalThis.caches = previousCaches; }
    assert.equal(response.status, 200, variant.name);
    assert.deepEqual(await response.json(), { ok: true, pendingPublicReflection: true }, variant.name);
    assert.equal(f.d1.stats.batches, 1, variant.name);
    assert.ok(
      f.d1.stats.statements <= D1_MAX_BATCH_QUERIES,
      variant.name + " executed " + f.d1.stats.statements + " logical D1 queries, above " + D1_MAX_BATCH_QUERIES,
    );
    assert.equal(f.read("events", "WHERE id = '" + EVENT + "'")[0].visibility_status, "private");
    assert.equal(f.read("audit_logs", "WHERE target_id = '" + EVENT + "'").length, 1);
    assert.ok(f.read("static_rebuild_queue").some((row) => row.reason === "event_private"));
    if (variant.status === "public") {
      assert.ok(f.bucket.manifest?.entities.some((row) => row.entity_id === EVENT));
      assert.deepEqual(f.timeline.slice(0, 3), ["r2.get", "r2.put", "r2.get"]);
    } else {
      assert.deepEqual(f.timeline, ["d1.batch"], "same-status private archival must not need R2");
    }
  }
});

