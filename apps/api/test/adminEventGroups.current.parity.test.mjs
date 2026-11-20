// MIG-0653 T01..T04 differential parity: the REAL CURRENT Server Actions
// (src/lib/actions/event-group-admin.ts) and the mounted Hono routes
// (/api/admin/event-groups/* via apps/api/src/app.ts) on identically seeded
// SQLite databases built from all migrations (PRAGMA foreign_keys = ON).
//
// Stubbed CURRENT edges: Next revalidatePath / unstable_rethrow / react.cache,
// @opennextjs/cloudflare, @/lib/cloudflare (handing the test R2 manifest
// bucket and queue double), and @/lib/auth/writeGuard (admin/ToS/CostGuard
// check over that side's SQLite DB).
import assert from "node:assert/strict";
import { test } from "node:test";
import { cookie, createSqlite, insert, runUnderRootTsx } from "./support/personalHarness.mjs";
import { NOW, seed } from "./support/manageSeed.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const STUBS = {
    "server-only": "export {}",
    "react": "export const cache = (fn) => fn;",
    "next/cache": "export function revalidatePath(p) { globalThis.__mig0653Cur?.revalidated.push(p); }",
    "next/navigation": "export function unstable_rethrow() {}",
    "@opennextjs/cloudflare": `
      export function getCloudflareContext() {
        return { ctx: { waitUntil(p) { globalThis.__mig0653Cur?.waitUntils.push(p); } } };
      }
    `,
    "@/lib/cloudflare": `
      export function getEnv() {
        const s = globalThis.__mig0653Cur;
        if (!s) throw new Error("getEnv outside CURRENT parity case");
        return s.env;
      }
    `,
    "@/lib/auth/writeGuard": `
      import { evaluateWriteIdentity } from "@flamenode/domain/admin";
      export async function requireAdminWrite(feature) {
        const s = globalThis.__mig0653Cur;
        if (!s) throw new Error("requireAdminWrite outside CURRENT parity case");
        s.features.push(feature);
        if (!s.user) return { ok: false, message: "ログインが必要です。" };
        const userRow = s.sqlite.prepare('SELECT is_tos_accepted, terms_reaccept_required FROM (SELECT u.is_tos_accepted, 0 AS terms_reaccept_required FROM "user" u WHERE u.id = ?)').get(s.user.id);
        const major = s.sqlite.prepare("SELECT id, published_at FROM terms_versions WHERE severity = 'major' AND published_at IS NOT NULL ORDER BY published_at DESC, updated_at DESC LIMIT 1").get();
        let reaccept = 0;
        if (userRow?.is_tos_accepted === 1 && major?.published_at != null) {
          const ok = s.sqlite.prepare('SELECT 1 FROM "user" u WHERE u.id = ? AND (EXISTS (SELECT 1 FROM terms_versions t WHERE t.id = u.accepted_terms_version_id AND t.published_at IS NOT NULL AND (t.id = ? OR t.published_at > ?)) OR EXISTS (SELECT 1 FROM user_tos_consents c INNER JOIN terms_versions ct ON ct.id = c.terms_version_id WHERE c.user_id = u.id AND ct.published_at IS NOT NULL AND (ct.id = ? OR ct.published_at > ?)))').get(s.user.id, major.id, major.published_at, major.id, major.published_at);
          if (!ok) reaccept = 1;
        }
        const identity = evaluateWriteIdentity({ role: s.user.role, is_banned: s.user.is_banned, is_tos_accepted: userRow?.is_tos_accepted ?? 0, terms_reaccept_required: reaccept }, "admin");
        if (identity) return { ok: false, message: identity };
        const settings = s.sqlite.prepare("SELECT operation_mode, disabled_features_json FROM system_settings WHERE id = 'default'").get();
        if (!settings || settings.operation_mode === "maintenance" || settings.operation_mode === "static_only") {
          return { ok: false, message: "maintenance_mode" };
        }
        const disabled = settings.disabled_features_json ? JSON.parse(settings.disabled_features_json) : [];
        if (Array.isArray(disabled) && disabled.includes(feature)) {
          return { ok: false, message: "cost_guard_blocked" };
        }
        return { ok: true, db: s.db, user: s.user, activeXId: null, approvedXIds: [], hasPendingXRequest: false };
      }
    `,
  };
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.prototype.hasOwnProperty.call(STUBS, specifier)) {
        return { url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const actions = await import("../../../src/lib/actions/event-group-admin.ts");
  const { app } = await import("../src/app.ts");

  const SITE = "https://app.flamenode.example";

  function freeze() {
    let n = 0;
    const originalNow = Date.now;
    const originalUuid = globalThis.crypto.randomUUID;
    Date.now = () => NOW * 1000;
    globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    return () => {
      Date.now = originalNow;
      globalThis.crypto.randomUUID = originalUuid;
    };
  }

  function createBucket(eventsLog) {
    const objects = new Map();
    let seq = 0;
    return {
      objects,
      async get(key) {
        const entry = objects.get(key);
        if (!entry) return null;
        return {
          etag: entry.etag,
          httpEtag: entry.etag,
          size: Buffer.byteLength(entry.body),
          body: { cancel: async () => {} },
          async text() { return entry.body; },
          async json() { return JSON.parse(entry.body); },
        };
      },
      async put(key, value, options) {
        const current = objects.get(key);
        if (options?.onlyIf?.etagDoesNotMatch === "*" && current) {
          throw new Error("R2 precondition failed: already exists");
        }
        if (options?.onlyIf?.etagMatches !== undefined && current?.etag !== options.onlyIf.etagMatches) {
          throw new Error("R2 precondition failed: etag mismatch");
        }
        seq += 1;
        const body = typeof value === "string" ? value : String(value);
        const etag = `etag-${seq}`;
        objects.set(key, { body, etag });
        eventsLog.push(`r2:put:${key}`);
        return { etag };
      },
      manifest() {
        const entry = objects.get("visibility/blocked-entities.v1.json");
        return entry ? JSON.parse(entry.body) : null;
      },
    };
  }

  function database(extra) {
    const sqlite = createSqlite();
    seed(sqlite);
    sqlite.exec(`DELETE FROM audit_logs; DELETE FROM event_group_events; DELETE FROM event_groups; DELETE FROM static_rebuild_queue; DELETE FROM public_visibility_fences;`);
    sqlite.exec(`UPDATE "user" SET is_tos_accepted = 1`);
    sqlite.exec(`UPDATE system_settings SET operation_mode = 'normal', disabled_features_json = NULL, audit_normal_retention_days = 30, audit_restorable_retention_days = 180, audit_long_retention_days = 365, audit_max_payload_bytes = 120000, audit_compact_after_days = 30 WHERE id = 'default'`);
    // Ensure distinct updated_at on events for deterministic SA-025 cursor order.
    sqlite.exec(`UPDATE events SET updated_at = ${NOW} - rowid`);
    extra?.(sqlite);
    sqlite.exec("PRAGMA foreign_keys = ON");
    return sqlite;
  }

  function d1(sqlite, eventsLog, { failBatch = false } = {}) {
    const stats = { reads: 0, batches: 0 };
    const make = (text, params) => ({
      _sql: text,
      _params: params,
      bind: (...values) => make(text, values),
      first: async () => { stats.reads += 1; return sqlite.prepare(text).get(...params) ?? null; },
      all: async () => { stats.reads += 1; return { results: sqlite.prepare(text).all(...params), success: true, meta: {} }; },
      run: async () => ({ results: sqlite.prepare(text).all(...params), success: true, meta: {} }),
      raw: async () => {
        stats.reads += 1;
        const prepared = sqlite.prepare(text);
        prepared.setReturnArrays(true);
        try { return prepared.all(...params).map((row) => [...row]); } finally { prepared.setReturnArrays(false); }
      },
    });
    return {
      stats,
      prepare: (text) => make(text, []),
      batch: async (statements) => {
        stats.batches += 1;
        eventsLog.push("d1:batch");
        if (failBatch) throw new Error("simulated D1 batch failure");
        sqlite.exec("BEGIN");
        try {
          const results = statements.map((s) => ({ results: sqlite.prepare(s._sql).all(...s._params), success: true, meta: {} }));
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    };
  }

  function execute(sqlite, text, params, method) {
    const statement = sqlite.prepare(text);
    if (method === "run") { statement.run(...params); return []; }
    statement.setReturnArrays(true);
    if (method === "get") return statement.get(...params);
    return statement.all(...params);
  }
  const drizzleOver = (sqlite, eventsLog, { failBatch = false } = {}) =>
    drizzle(
      async (text, params, method) => ({ rows: execute(sqlite, text, params, method) }),
      async (queries) => {
        eventsLog.push("d1:batch");
        if (failBatch) throw new Error("simulated D1 batch failure");
        sqlite.exec("BEGIN");
        try {
          const results = queries.map(({ sql: text, params, method }) => ({ rows: execute(sqlite, text, params, method) }));
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    );

  async function runCurrent(sqlite, name, call, { failBatch = false } = {}) {
    const eventsLog = [];
    const bucket = createBucket(eventsLog);
    const wakes = [];
    const user = name ? sqlite.prepare(`SELECT id, role, is_banned FROM "user" WHERE id = ?`).get(`u_${name}`) : null;
    const state = {
      sqlite,
      db: drizzleOver(sqlite, eventsLog, { failBatch }),
      user: user ? { ...user } : null,
      features: [],
      revalidated: [],
      waitUntils: [],
      env: {
        PUBLIC_VISIBILITY_GUARD_MODE: "enforce",
        QUEUE_DISPATCH_ENABLED: "1",
        BUCKET: bucket,
        STATIC_REBUILD_WAKE_QUEUE: { async send(msg) { wakes.push(msg); } },
        KV: { async get() { return null; }, async put() {} },
      },
    };
    globalThis.__mig0653Cur = state;
    const restore = freeze();
    try {
      const result = JSON.parse(JSON.stringify(await call()));
      await Promise.allSettled(state.waitUntils);
      return { result, bucket, wakes, eventsLog, ...state };
    } finally {
      restore();
      delete globalThis.__mig0653Cur;
    }
  }

  async function runHono(sqlite, name, method, path, body, { origin = SITE, failBatch = false } = {}) {
    const eventsLog = [];
    const db = d1(sqlite, eventsLog, { failBatch });
    const bucket = createBucket(eventsLog);
    const wakes = [];
    const restore = freeze();
    try {
      const headers = { ...(name ? cookie(`tok-${name}`) : {}), ...(origin ? { Origin: origin } : {}) };
      if (body !== undefined) headers["content-type"] = "application/json";
      const res = await app.request(
        path,
        { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
        {
          DB: db,
          BUCKET: bucket,
          QUEUE_DISPATCH_ENABLED: "1",
          STATIC_REBUILD_WAKE_QUEUE: { async send(msg) { wakes.push(msg); } },
          AUTH_SECRET: "test-secret",
          NEXT_PUBLIC_SITE_URL: SITE,
        },
      );
      const text = await res.text();
      return { status: res.status, cache: res.headers.get("cache-control"), body: text ? JSON.parse(text) : null, stats: db.stats, bucket, wakes, eventsLog };
    } finally {
      restore();
    }
  }

  const form = (fields) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== null) f.append(k, String(v));
    }
    return f;
  };
  const groups = (sqlite) => sqlite.prepare("SELECT * FROM event_groups ORDER BY id").all().map((r) => ({ ...r }));
  const relations = (sqlite) => sqlite.prepare("SELECT * FROM event_group_events ORDER BY event_group_id, event_id").all().map((r) => ({ ...r }));
  const fences = (sqlite) => sqlite.prepare("SELECT * FROM public_visibility_fences ORDER BY entity_type, entity_id").all().map((r) => ({ ...r }));
  const queues = (sqlite) => sqlite.prepare("SELECT target_type, target_id, reason, priority, status, attempt_count, requested_by_user_id FROM static_rebuild_queue ORDER BY target_type, target_id").all().map((r) => ({ ...r }));
  const audits = (sqlite) =>
    sqlite.prepare("SELECT table_name, target_id, operation, before_json, after_json, changed_keys_json, inverse_patch_json, actor_user_id, actor_x_user_id, actor_snapshot_json, retention_class, restore_strategy, restore_status, expires_at, created_at FROM audit_logs ORDER BY table_name, target_id, operation").all().map((r) => {
      const out = { ...r };
      for (const k of ["before_json", "after_json", "changed_keys_json", "inverse_patch_json", "actor_snapshot_json"]) {
        if (typeof out[k] === "string") out[k] = JSON.parse(out[k]);
      }
      return out;
    });

  // ---------------- T01: SA-025 search ----------------

  test("T01 SA-025: searchEventGroupEventOptions matches GET /api/admin/event-groups/event-options across search, exclusion and cursor", async () => {
    const seedGroup = (s) => {
      insert(s, "event_groups", { id: "grp-opt", name: "Opt", slug: "opt", group_type: "series", visibility_status: "private", sort_order: 0, created_at: NOW, updated_at: NOW });
      insert(s, "event_group_events", { event_group_id: "grp-opt", event_id: "evA", relation_type: "member", created_at: NOW, updated_at: NOW });
      insert(s, "events", { id: "evPct", title: "100%_\\special", visibility_status: "public", created_at: NOW, updated_at: NOW });
    };
    const curDb = database(seedGroup);
    const honoDb = database(seedGroup);

    const curPage1 = await runCurrent(curDb, "admin", () => actions.searchEventGroupEventOptions({ groupId: "grp-opt" }));
    const honoPage1 = await runHono(honoDb, "admin", "GET", "/api/admin/event-groups/event-options?groupId=grp-opt", undefined, { origin: null });
    assert.equal(honoPage1.status, 200);
    assert.equal(honoPage1.cache, "private, no-store");
    assert.deepStrictEqual(honoPage1.body, curPage1.result);
    assert.equal(honoPage1.body.options.length, 80);
    assert.ok(honoPage1.body.nextCursor);
    assert.ok(honoPage1.stats.reads <= 3, `S2 read budget <= 3 (got ${honoPage1.stats.reads})`);
    assert.equal(honoPage1.stats.batches, 0);

    const curPage2 = await runCurrent(curDb, "admin", () => actions.searchEventGroupEventOptions({ groupId: "grp-opt", cursor: curPage1.result.nextCursor }));
    const honoPage2 = await runHono(honoDb, "admin", "GET", `/api/admin/event-groups/event-options?groupId=grp-opt&cursor=${encodeURIComponent(honoPage1.body.nextCursor)}`, undefined, { origin: null });
    assert.equal(honoPage2.status, 200);
    assert.deepStrictEqual(honoPage2.body, curPage2.result);

    const curLike = await runCurrent(curDb, "admin", () => actions.searchEventGroupEventOptions({ groupId: "grp-opt", query: "%_\\" }));
    const honoLike = await runHono(honoDb, "admin", "GET", `/api/admin/event-groups/event-options?groupId=grp-opt&q=${encodeURIComponent("%_\\")}`, undefined, { origin: null });
    assert.equal(honoLike.status, 200);
    assert.deepStrictEqual(honoLike.body, curLike.result);
    assert.deepStrictEqual(honoLike.body.options.map((o) => o.id), ["evPct"]);

    const curBad = await runCurrent(curDb, "admin", () => actions.searchEventGroupEventOptions({ groupId: "   " }));
    const honoBad = await runHono(honoDb, "admin", "GET", "/api/admin/event-groups/event-options?groupId=%20%20", undefined, { origin: null });
    assert.equal(honoBad.status, 400);
    assert.deepStrictEqual(honoBad.body, curBad.result);
  });

  // ---------------- T01 + T04: SA-026 CREATE ----------------

  test("T01/T04 SA-026: createEventGroup matches POST /api/admin/event-groups (private & public, validation, duplicate slug, wakes)", async () => {
    for (const [label, fields, expectedStatus] of [
      ["private create", { id: "grp-priv", name: "  Priv Group  ", slug: "priv-group", description: "  desc  ", group_type: "genre", icon_url: " https://img.test/i.png ", img_url: "https://ignored.test/x.png", accent_color: "#112233", visibility_status: "private", sort_order: "5" }, 200],
      ["public create", { id: "grp-pub", name: "Pub Group", slug: "pub-group", group_type: "series", visibility_status: "public" }, 200],
      ["invalid slug", { id: "grp-bad", name: "Bad", slug: "Invalid Slug!" }, 400],
      ["duplicate slug", { id: "grp-dup", name: "Dup", slug: "existing-slug" }, 400],
    ]) {
      const extra = (s) => insert(s, "event_groups", { id: "grp-existing", name: "Existing", slug: "existing-slug", group_type: "series", visibility_status: "private", sort_order: 0, created_at: NOW - 10, updated_at: NOW - 10 });
      const curDb = database(extra);
      const honoDb = database(extra);
      const cur = await runCurrent(curDb, "admin", () => actions.createEventGroup(form(fields)));
      const hono = await runHono(honoDb, "admin", "POST", "/api/admin/event-groups", fields);

      assert.equal(hono.status, expectedStatus, label);
      assert.equal(hono.cache, "private, no-store", label);
      assert.deepStrictEqual(hono.body, cur.result, label);
      assert.deepStrictEqual(groups(honoDb), groups(curDb), `${label}: event_groups`);
      assert.deepStrictEqual(audits(honoDb), audits(curDb), `${label}: audit_logs`);
      assert.deepStrictEqual(queues(honoDb), queues(curDb), `${label}: static_rebuild_queue`);
      assert.deepStrictEqual(fences(honoDb), fences(curDb), `${label}: public_visibility_fences`);
      assert.deepStrictEqual(hono.bucket.manifest(), cur.bucket.manifest(), `${label}: R2 manifest`);
      if (expectedStatus === 200) {
        assert.ok(hono.stats.reads <= 3, `${label}: S3 pre-reads ${hono.stats.reads}`);
        assert.equal(hono.stats.batches, 1);
        // T04 (D-0603-1): CURRENT wakes 1 time, Hono wakes 0 times.
        assert.equal(cur.wakes.length, 1, `${label}: CURRENT wake count`);
        assert.equal(hono.wakes.length, 0, `${label}: Hono wake count (D-0603-1)`);
      } else {
        assert.equal(hono.stats.batches, 0);
      }
    }
  });

  // ---------------- T01 + T02 + T04: SA-027 UPDATE ----------------

  test("T01/T02/T04 SA-027: updateEventGroup matches PATCH /api/admin/event-groups/:id (nullable sort_order, public->private fence order, CAS)", async () => {
    const seedExisting = (visibility, sortOrder = 3) => (s) => {
      insert(s, "event_groups", {
        id: "grp-upd", name: "Old Name", slug: "old-slug", description: "Old desc",
        group_type: "series", icon_url: "https://old.test/i.png", img_url: "https://keep.test/img.png",
        accent_color: "#abcdef", visibility_status: visibility, sort_order: sortOrder,
        created_at: NOW - 100, updated_at: NOW - 50,
      });
    };

    // 1. Private update with nullable sort_order preserved & omitted accent_color cleared
    {
      const curDb = database(seedExisting("private", null));
      const honoDb = database(seedExisting("private", null));
      const fields = { id: "grp-upd", base_updated_at: NOW - 50, name: "New Name", slug: "new-slug", description: "", group_type: "collection", visibility_status: "private" };
      const cur = await runCurrent(curDb, "admin", () => actions.updateEventGroup(form(fields)));
      const hono = await runHono(honoDb, "admin", "PATCH", "/api/admin/event-groups/grp-upd", fields);
      assert.equal(hono.status, 200);
      assert.deepStrictEqual(hono.body, cur.result);
      assert.deepStrictEqual(groups(honoDb), groups(curDb));
      assert.equal(groups(honoDb)[0].sort_order, null);
      assert.equal(groups(honoDb)[0].img_url, "https://keep.test/img.png");
      assert.equal(groups(honoDb)[0].accent_color, null);
      assert.deepStrictEqual(audits(honoDb), audits(curDb));
      assert.deepStrictEqual(queues(honoDb), queues(curDb));
      assert.ok(hono.stats.reads <= 3);
      assert.equal(hono.stats.batches, 1);
      assert.equal(cur.wakes.length, 1);
      assert.equal(hono.wakes.length, 0);
    }

    // 2. T02: Public -> Private unpublishing: R2 manifest block precedes D1 batch on BOTH sides
    {
      const curDb = database(seedExisting("public", 4));
      const honoDb = database(seedExisting("public", 4));
      const fields = { id: "grp-upd", base_updated_at: NOW - 50, name: "Unpub", slug: "old-slug", group_type: "series", visibility_status: "private" };
      const cur = await runCurrent(curDb, "admin", () => actions.updateEventGroup(form(fields)));
      const hono = await runHono(honoDb, "admin", "PATCH", "/api/admin/event-groups/grp-upd", fields);
      assert.equal(hono.status, 200);
      assert.deepStrictEqual(hono.body, cur.result);
      assert.deepStrictEqual(fences(honoDb), fences(curDb));
      assert.equal(fences(honoDb)[0].state, "blocked");
      assert.deepStrictEqual(hono.bucket.manifest(), cur.bucket.manifest());
      assert.deepStrictEqual(hono.eventsLog, ["r2:put:visibility/blocked-entities.v1.json", "d1:batch"]);
      assert.deepStrictEqual(cur.eventsLog, ["r2:put:visibility/blocked-entities.v1.json", "d1:batch"]);
      assert.deepStrictEqual(audits(honoDb), audits(curDb));
      assert.deepStrictEqual(queues(honoDb), queues(curDb));
    }

    // 3. Stale CAS & missing group
    {
      const curDb = database(seedExisting("private", 1));
      const honoDb = database(seedExisting("private", 1));
      const stale = { id: "grp-upd", base_updated_at: NOW - 999, name: "Stale", slug: "old-slug", group_type: "series", visibility_status: "private" };
      const curStale = await runCurrent(curDb, "admin", () => actions.updateEventGroup(form(stale)));
      const honoStale = await runHono(honoDb, "admin", "PATCH", "/api/admin/event-groups/grp-upd", stale);
      assert.equal(honoStale.status, 409);
      assert.deepStrictEqual(honoStale.body, curStale.result);

      const missing = { id: "grp-none", base_updated_at: 1, name: "Missing", slug: "missing", group_type: "series", visibility_status: "private" };
      const curMissing = await runCurrent(curDb, "admin", () => actions.updateEventGroup(form(missing)));
      const honoMissing = await runHono(honoDb, "admin", "PATCH", "/api/admin/event-groups/grp-none", missing);
      assert.equal(honoMissing.status, 404);
      assert.deepStrictEqual(honoMissing.body, curMissing.result);
    }
  });

  // ---------------- T01 + T02 + T04: SA-028 DELETE ----------------

  test("T01/T02/T04 SA-028: deleteEventGroup matches DELETE /api/admin/event-groups/:id (relations, audits, public fence & compensation)", async () => {
    const seedDelete = (visibility, sortOrder = null) => (s) => {
      insert(s, "event_groups", {
        id: "grp-del", name: "Del Group", slug: "del-group", description: null,
        group_type: "related", icon_url: null, img_url: null, accent_color: null,
        visibility_status: visibility, sort_order: sortOrder, created_at: NOW - 20, updated_at: NOW - 10,
      });
      insert(s, "event_group_events", { event_group_id: "grp-del", event_id: "evA", relation_type: "primary", created_at: NOW - 5, updated_at: NOW - 5 });
      insert(s, "event_group_events", { event_group_id: "grp-del", event_id: "evB", relation_type: "member", created_at: NOW - 4, updated_at: NOW - 4 });
    };

    // Public delete with 2 relations + nullable sort_order
    {
      const curDb = database(seedDelete("public", null));
      const honoDb = database(seedDelete("public", null));
      const cur = await runCurrent(curDb, "admin", () => actions.deleteEventGroup("grp-del"));
      const hono = await runHono(honoDb, "admin", "DELETE", "/api/admin/event-groups/grp-del");
      assert.equal(hono.status, 200);
      assert.deepStrictEqual(hono.body, cur.result);
      assert.deepStrictEqual(groups(honoDb), []);
      assert.deepStrictEqual(relations(honoDb), []);
      assert.deepStrictEqual(audits(honoDb), audits(curDb));
      assert.equal(audits(honoDb).length, 3);
      assert.deepStrictEqual(queues(honoDb), queues(curDb));
      assert.deepStrictEqual(fences(honoDb), fences(curDb));
      assert.deepStrictEqual(hono.bucket.manifest(), cur.bucket.manifest());
      assert.deepStrictEqual(hono.eventsLog, ["r2:put:visibility/blocked-entities.v1.json", "d1:batch"]);
      assert.deepStrictEqual(cur.eventsLog, ["r2:put:visibility/blocked-entities.v1.json", "d1:batch"]);
      assert.ok(hono.stats.reads <= 3);
      assert.equal(hono.stats.batches, 1);
      assert.equal(cur.wakes.length, 1);
      assert.equal(hono.wakes.length, 0);
    }

    // T02: D1 batch failure triggers R2 compensation on BOTH sides
    {
      const curDb = database(seedDelete("public", 0));
      const honoDb = database(seedDelete("public", 0));
      const cur = await runCurrent(curDb, "admin", () => actions.deleteEventGroup("grp-del"), { failBatch: true });
      const hono = await runHono(honoDb, "admin", "DELETE", "/api/admin/event-groups/grp-del", undefined, { failBatch: true });
      assert.equal(hono.status, 500);
      assert.deepStrictEqual(hono.body, cur.result);
      assert.equal(groups(honoDb).length, 1);
      assert.equal(relations(honoDb).length, 2);
      assert.deepStrictEqual(fences(honoDb), []);
      assert.deepStrictEqual(hono.bucket.manifest()?.entities, []);
      assert.deepStrictEqual(cur.bucket.manifest()?.entities, []);
      assert.equal(hono.eventsLog.filter((e) => e.startsWith("r2:put:")).length, 2);
      assert.equal(cur.eventsLog.filter((e) => e.startsWith("r2:put:")).length, 2);
    }

    // Missing group -> 404
    {
      const curDb = database();
      const honoDb = database();
      const cur = await runCurrent(curDb, "admin", () => actions.deleteEventGroup("grp-none"));
      const hono = await runHono(honoDb, "admin", "DELETE", "/api/admin/event-groups/grp-none");
      assert.equal(hono.status, 404);
      assert.deepStrictEqual(hono.body, cur.result);
    }
  });

  // ---------------- T01 + T04: SA-029 ADD & SA-030 REMOVE ----------------

  test("T01/T04 SA-029/030: membership add and remove match CURRENT field-by-field", async () => {
    const seedMembers = (s) => {
      insert(s, "event_groups", { id: "grp-m", name: "Members", slug: "members", group_type: "series", visibility_status: "private", sort_order: 0, created_at: NOW - 10, updated_at: NOW - 10 });
      insert(s, "event_group_events", { event_group_id: "grp-m", event_id: "evA", relation_type: "related", created_at: NOW - 5, updated_at: NOW - 5 });
    };

    // SA-029 add (dedup + existing member skipped + request order preserved)
    {
      const curDb = database(seedMembers);
      const honoDb = database(seedMembers);
      const eventIds = [" evB ", "evA", "evC", "evB", ""];
      const cur = await runCurrent(curDb, "admin", () => actions.addEventsToGroup({ groupId: "grp-m", eventIds }));
      const hono = await runHono(honoDb, "admin", "POST", "/api/admin/event-groups/grp-m/events", { eventIds });
      assert.equal(hono.status, 200);
      assert.deepStrictEqual(hono.body, cur.result);
      assert.deepStrictEqual(relations(honoDb), relations(curDb));
      assert.deepStrictEqual(audits(honoDb), audits(curDb));
      assert.deepStrictEqual(queues(honoDb), queues(curDb));
      assert.ok(hono.stats.reads <= 3);
      assert.equal(hono.stats.batches, 1);
      assert.equal(cur.wakes.length, 1);
      assert.equal(hono.wakes.length, 0);
    }

    // SA-029 validation / not-found cases
    for (const [label, groupId, eventIds, expectedStatus] of [
      ["missing group", "grp-missing", ["evA"], 404],
      ["nonexistent event even when evA is member", "grp-m", ["evA", "no-such-event"], 400],
      ["all already members", "grp-m", ["evA"], 400],
      ["empty selection", "grp-m", ["  ", ""], 400],
      ["over 80 unique", "grp-m", Array.from({ length: 81 }, (_, i) => `evMany${String(i).padStart(3, "0")}`), 400],
    ]) {
      const curDb = database(seedMembers);
      const honoDb = database(seedMembers);
      const cur = await runCurrent(curDb, "admin", () => actions.addEventsToGroup({ groupId, eventIds }));
      const hono = await runHono(honoDb, "admin", "POST", `/api/admin/event-groups/${groupId}/events`, { eventIds });
      assert.equal(hono.status, expectedStatus, label);
      assert.deepStrictEqual(hono.body, cur.result, label);
      assert.equal(hono.stats.batches, 0, label);
    }

    // SA-030 remove (removes 'related' relation + restorable audit + queue; missing -> 404)
    {
      const curDb = database(seedMembers);
      const honoDb = database(seedMembers);
      const cur = await runCurrent(curDb, "admin", () => actions.removeEventFromGroup({ groupId: "grp-m", eventId: "evA" }));
      const hono = await runHono(honoDb, "admin", "DELETE", "/api/admin/event-groups/grp-m/events/evA");
      assert.equal(hono.status, 200);
      assert.deepStrictEqual(hono.body, cur.result);
      assert.deepStrictEqual(relations(honoDb), []);
      assert.deepStrictEqual(audits(honoDb), audits(curDb));
      assert.deepStrictEqual(queues(honoDb), queues(curDb));
      assert.ok(hono.stats.reads <= 3);
      assert.equal(hono.stats.batches, 1);
      assert.equal(cur.wakes.length, 1);
      assert.equal(hono.wakes.length, 0);

      const curMissing = await runCurrent(curDb, "admin", () => actions.removeEventFromGroup({ groupId: "grp-m", eventId: "evA" }));
      const honoMissing = await runHono(honoDb, "admin", "DELETE", "/api/admin/event-groups/grp-m/events/evA");
      assert.equal(honoMissing.status, 404);
      assert.deepStrictEqual(honoMissing.body, curMissing.result);
    }
  });

  // ---------------- T03: Auth, Role, ToS, CostGuard, Origin denials ----------------

  test("T03: anonymous, non-admin, banned, ToS, maintenance/CostGuard and bad-origin requests deny with 0 writes", async () => {
    const validBody = { name: "Denied", slug: "denied", group_type: "series", visibility_status: "public" };
    const scenarios = [
      ["anonymous", null, SITE, () => {}, 401],
      ["non-admin", "owner", SITE, () => {}, 403],
      ["banned", "banned", SITE, () => {}, 403],
      ["tos unaccepted", "admin", SITE, (s) => s.exec(`UPDATE "user" SET is_tos_accepted = 0 WHERE id = 'u_admin'`), 403],
      ["tos reaccept required", "admin", SITE, (s) => insert(s, "terms_versions", { id: "major-2", version_label: "2.0.0", body_markdown: "c", status: "published", severity: "major", published_at: NOW, created_by_user_id: "u_admin", created_at: NOW, updated_at: NOW }), 403],
      ["maintenance mode", "admin", SITE, (s) => s.exec(`UPDATE system_settings SET operation_mode = 'maintenance' WHERE id = 'default'`), 503],
      ["feature disabled", "admin", SITE, (s) => s.exec(`UPDATE system_settings SET disabled_features_json = '["admin_event_create"]' WHERE id = 'default'`), 503],
      ["cross-origin", "admin", "https://evil.example", () => {}, 403],
    ];

    for (const [label, userName, origin, mutateDb, expectedStatus] of scenarios) {
      const curDb = database(mutateDb);
      const honoDb = database(mutateDb);
      const hono = await runHono(honoDb, userName, "POST", "/api/admin/event-groups", validBody, { origin });
      assert.equal(hono.status, expectedStatus, label);
      assert.equal(hono.cache, "private, no-store", label);
      assert.equal(hono.body.ok, false, label);
      assert.equal(hono.stats.batches, 0, label);
      assert.deepStrictEqual(groups(honoDb), [], label);
      assert.deepStrictEqual(audits(honoDb), [], label);
      assert.deepStrictEqual(queues(honoDb), [], label);
      assert.equal(hono.bucket.manifest(), null, label);

      if (label !== "cross-origin") {
        const cur = await runCurrent(curDb, userName, () => actions.createEventGroup(form(validBody)));
        assert.equal(cur.result.ok, false, `${label}: CURRENT`);
        assert.deepStrictEqual(groups(curDb), [], `${label}: CURRENT groups`);
        assert.deepStrictEqual(audits(curDb), [], `${label}: CURRENT audits`);
      }
    }
  });
}
