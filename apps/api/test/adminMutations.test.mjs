// MIG-0602 U02: SA-004..008 Hono endpoints (T01 origin, T02 non-admin, T03
// success + audit + queue, T04 CAS conflict) against real SQLite.
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
const ADMIN = { id: "admin-1", name: "Admin", email: null, image: null, role: "admin", is_banned: 0, active_x_user_id: null };

function setup({ user = ADMIN, role = "admin", settings = "normal", onFirst } = {}) {
  const { db, sqlite } = createAdminD1({ onFirst: onFirst ? (s, q) => onFirst(s, q) : undefined });
  seedBase(sqlite, { role, settings });
  const calls = [];
  const hono = new Hono();
  hono.route("/api/admin", createAdminRoutes({
    session: async (c, next) => {
      calls.push("session");
      c.set("user", user);
      c.set("sessionState", user ? "user" : "none");
      await next();
    },
  }));
  const request = (method, path, body, headers = { Origin: SITE }) =>
    hono.request(path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { DB: db, NEXT_PUBLIC_SITE_URL: SITE });
  return { sqlite, request, calls };
}

const count = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

const VALID = { title: "T", body: "B", severity: "info", target_audience: "all", is_published: 1 };

// ---------------- guards (T01 / T02) ----------------

const ROUTES = [
  ["POST", "/api/admin/announcements", VALID],
  ["PUT", "/api/admin/announcements/a1", { ...VALID, base_updated_at: 1 }],
  ["DELETE", "/api/admin/announcements/a1", undefined],
  ["POST", "/api/admin/api-endpoints", { event_id: "ev-1" }],
  ["PATCH", "/api/admin/api-endpoints/ev-1", { public_api_enabled: "0" }],
];

for (const [method, path, body] of ROUTES) {
  test(`T01 ${method} ${path}: other origin -> 403 invalid_origin, nothing written`, async () => {
    const { sqlite, request } = setup();
    const res = await request(method, path, body, { Origin: "https://evil.example" });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason, "invalid_origin");
    assert.equal(count(sqlite, "audit_logs"), 0);
  });

  test(`T02 ${method} ${path}: non-admin -> 403 forbidden (before CostGuard), audit 0`, async () => {
    const { sqlite, request } = setup({ user: { ...ADMIN, role: "moderator" }, role: "moderator", settings: "maintenance" });
    const res = await request(method, path, body);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { ok: false, reason: "forbidden", message: "この操作を実行する権限がありません。" });
    assert.equal(count(sqlite, "audit_logs"), 0);
  });

  test(`contract ${method} ${path}: session -> writeGuard -> CostGuard order`, async () => {
    // unauthenticated: session ran, writeGuard denies 401
    const anon = setup({ user: null });
    const r1 = await anon.request(method, path, body);
    assert.equal(r1.status, 401);
    assert.deepEqual(anon.calls, ["session"]);
    assert.equal(r1.headers.get("cache-control"), "private, no-store");
    // admin + maintenance: CostGuard denies 503 (reached only after identity)
    const m = setup({ settings: "maintenance" });
    const r2 = await m.request(method, path, body);
    assert.equal(r2.status, 503);
    assert.deepEqual(await r2.json(), { ok: false, reason: "maintenance_mode", message: "現在、書き込みを一時停止しています (コストガード)。しばらく時間をおいてからお試しください。" });
    assert.equal(r2.headers.get("cache-control"), "private, no-store");
    // missing system_settings row -> maintenance_mode (CURRENT)
    const n = setup({ settings: null });
    assert.equal((await n.request(method, path, body)).status, 503);
  });
}

test("CostGuard: disabled feature -> 503 cost_guard_blocked only for that feature", async () => {
  const { sqlite, request } = setup();
  sqlite.prepare("UPDATE system_settings SET disabled_features_json = ?").run(JSON.stringify(["admin_api_endpoints"]));
  const blocked = await request("POST", "/api/admin/api-endpoints", { event_id: "ev-1" });
  assert.equal(blocked.status, 503);
  assert.equal((await blocked.json()).reason, "cost_guard_blocked");
  const ok = await request("POST", "/api/admin/announcements", VALID);
  assert.equal(ok.status, 200);
});

// ---------------- announcements (SA-004..006) ----------------

test("SA-004 create: validation failure -> 400 with CURRENT message, audit 0", async () => {
  const { sqlite, request } = setup();
  const res = await request("POST", "/api/admin/announcements", { ...VALID, title: "" });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.ok(body.message);
  assert.equal(count(sqlite, "audit_logs"), 0);
});

test("T03 SA-004 create: 1 announcement + 1 audit + top_announcements queue row", async () => {
  const { sqlite, request } = setup();
  const res = await request("POST", "/api/admin/announcements", { ...VALID, id: "a-new" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, id: "a-new" });
  const row = sqlite.prepare("SELECT * FROM announcements WHERE id = 'a-new'").get();
  assert.equal(row.title, "T");
  assert.equal(row.created_by_user_id, "admin-1");
  const audits = sqlite.prepare("SELECT * FROM audit_logs").all();
  assert.equal(audits.length, 1);
  const a = audits[0];
  assert.equal(a.table_name, "announcements");
  assert.equal(a.operation, "CREATE");
  assert.equal(a.target_id, "a-new");
  assert.equal(a.before_json, null);
  assert.deepEqual(Object.keys(JSON.parse(a.after_json)), ["id", "title", "body", "severity", "target_audience", "is_published", "publish_at", "expire_at", "created_by_user_id", "created_at", "updated_at"]);
  assert.equal(a.retention_class, "normal");
  assert.equal(a.restore_status, "not_restorable");
  assert.equal(a.restore_unavailable_reason_code, "strategy_none");
  assert.equal(a.expires_at - a.created_at, 30 * 86400);
  assert.deepEqual(JSON.parse(a.actor_snapshot_json), { discord_id: "d-1", discord_name: "Admin", x_user_id: null, x_name: null, icon_url: null });
  const q = sqlite.prepare("SELECT * FROM static_rebuild_queue").all();
  assert.equal(q.length, 1);
  assert.deepEqual([q[0].target_type, q[0].target_id, q[0].reason, q[0].priority, q[0].status, q[0].requested_by_user_id], ["top_announcements", "global", "announcement_create", "normal", "pending", null]);
});

test("queue UPSERT: a second mutation merges into the active top_announcements row", async () => {
  const { sqlite, request } = setup();
  await request("POST", "/api/admin/announcements", { ...VALID, id: "a1" });
  await request("POST", "/api/admin/announcements", { ...VALID, id: "a2" });
  const q = sqlite.prepare("SELECT reason FROM static_rebuild_queue").all();
  assert.equal(q.length, 1);
  assert.equal(count(sqlite, "audit_logs"), 2);
});

function seedAnnouncement(sqlite, updated_at = 100) {
  sqlite.prepare("INSERT INTO announcements VALUES ('a1', 'Old', 'Body', 'info', 0, NULL, NULL, 'all', 'x', 50, ?)").run(updated_at);
}

test("SA-005 update: success writes UPDATE audit with before/after + queue", async () => {
  const { sqlite, request } = setup();
  seedAnnouncement(sqlite);
  const res = await request("PUT", "/api/admin/announcements/a1", { ...VALID, title: "New", base_updated_at: 100 });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, id: "a1" });
  assert.equal(sqlite.prepare("SELECT title FROM announcements WHERE id='a1'").get().title, "New");
  const a = sqlite.prepare("SELECT * FROM audit_logs").get();
  assert.equal(a.operation, "UPDATE");
  assert.equal(JSON.parse(a.before_json).title, "Old");
  assert.equal(JSON.parse(a.after_json).title, "New");
  assert.deepEqual(JSON.parse(a.changed_keys_json).sort(), ["is_published", "title", "updated_at", "body"].sort().filter((k) => k !== "body" || JSON.parse(a.before_json).body !== JSON.parse(a.after_json).body));
  assert.equal(sqlite.prepare("SELECT reason FROM static_rebuild_queue").get().reason, "announcement_update");
});

test("SA-005 update: missing -> 404; stale base_updated_at -> 409 with CURRENT message, no writes", async () => {
  const { sqlite, request } = setup();
  const nf = await request("PUT", "/api/admin/announcements/nope", { ...VALID, base_updated_at: 1 });
  assert.equal(nf.status, 404);
  assert.deepEqual(await nf.json(), { ok: false, message: "対象のお知らせが見つかりません。" });
  seedAnnouncement(sqlite);
  const stale = await request("PUT", "/api/admin/announcements/a1", { ...VALID, base_updated_at: 99 });
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { ok: false, message: "他の操作で更新されています。再読み込みして確認してください。" });
  const none = await request("PUT", "/api/admin/announcements/a1", { ...VALID });
  assert.equal(none.status, 409);
  assert.equal(count(sqlite, "audit_logs"), 0);
  assert.equal(count(sqlite, "static_rebuild_queue"), 0);
});

test("T04 SA-005 update: race after preflight -> CAS batch fails, full rollback, CURRENT message", async () => {
  let raced = false;
  const { sqlite, request } = setup({
    onFirst: (sql, q) => {
      if (!raced && sql.includes("FROM announcements")) {
        raced = true;
        q.prepare("UPDATE announcements SET updated_at = 500 WHERE id = 'a1'").run();
      }
    },
  });
  seedAnnouncement(sqlite);
  const original = console.error;
  console.error = () => {};
  try {
    const res = await request("PUT", "/api/admin/announcements/a1", { ...VALID, title: "Lost", base_updated_at: 100 });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { ok: false, message: "保存に失敗しました。再読み込みして、もう一度お試しください。" });
  } finally {
    console.error = original;
  }
  assert.equal(sqlite.prepare("SELECT title FROM announcements WHERE id='a1'").get().title, "Old");
  assert.equal(count(sqlite, "audit_logs"), 0);
  assert.equal(count(sqlite, "static_rebuild_queue"), 0);
});

test("SA-006 delete: success writes DELETE audit; missing -> 404", async () => {
  const { sqlite, request } = setup();
  seedAnnouncement(sqlite);
  const res = await request("DELETE", "/api/admin/announcements/a1");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(count(sqlite, "announcements"), 0);
  const a = sqlite.prepare("SELECT * FROM audit_logs").get();
  assert.equal(a.operation, "DELETE");
  assert.equal(a.after_json, null);
  assert.equal(sqlite.prepare("SELECT reason FROM static_rebuild_queue").get().reason, "announcement_delete");
  assert.equal((await request("DELETE", "/api/admin/announcements/a1")).status, 404);
});

// ---------------- api-endpoints (SA-007..008) ----------------

function installCacheStub() {
  const deleted = [];
  const previous = globalThis.caches;
  globalThis.caches = { default: { delete: async (req) => { deleted.push(req.url); return true; } } };
  return { deleted, restore: () => { globalThis.caches = previous; } };
}

test("T03 SA-007 create: enables public API, long_audit audit with context/reason, cache invalidated", async () => {
  const { sqlite, request } = setup();
  seedEvent(sqlite);
  const cache = installCacheStub();
  try {
    const res = await request("POST", "/api/admin/api-endpoints", { event_id: " ev-1 " });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, id: "ev-1", message: "公開APIリンクを発行しました。" });
    assert.equal(cache.deleted.length, 8);
  } finally {
    cache.restore();
  }
  const ev = sqlite.prepare("SELECT public_api_enabled, updated_at FROM events WHERE id='ev-1'").get();
  assert.equal(ev.public_api_enabled, 1);
  assert.ok(ev.updated_at >= 21);
  const a = sqlite.prepare("SELECT * FROM audit_logs").get();
  assert.equal(a.table_name, "events");
  assert.equal(a.operation, "UPDATE");
  assert.equal(a.context, "admin_api_endpoints");
  assert.equal(a.reason, "公開APIリンクを発行");
  assert.equal(a.retention_class, "long_audit");
  assert.equal(a.expires_at - a.created_at, 365 * 86400);
  assert.deepEqual(JSON.parse(a.changed_keys_json).sort(), ["public_api_enabled", "updated_at"]);
  assert.equal(count(sqlite, "static_rebuild_queue"), 0);
});

test("SA-007 create: event missing -> 404; non-public -> 400; bad id -> 400", async () => {
  const { sqlite, request } = setup();
  assert.equal((await request("POST", "/api/admin/api-endpoints", { event_id: "ghost" })).status, 404);
  seedEvent(sqlite, { id: "ev-draft", visibility_status: "draft" });
  const draft = await request("POST", "/api/admin/api-endpoints", { event_id: "ev-draft" });
  assert.equal(draft.status, 400);
  assert.deepEqual(await draft.json(), { ok: false, message: "公開イベントだけAPIを有効化できます。" });
  const bad = await request("POST", "/api/admin/api-endpoints", { event_id: "" });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { ok: false, message: "event_idが不正です。" });
  assert.equal(count(sqlite, "audit_logs"), 0);
});

test("SA-008 setActive: disable works even for non-public events; message matches CURRENT", async () => {
  const { sqlite, request } = setup();
  seedEvent(sqlite, { visibility_status: "archived", public_api_enabled: 1 });
  const res = await request("PATCH", "/api/admin/api-endpoints/ev-1", { public_api_enabled: "0" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, id: "ev-1", message: "公開APIを無効化しました。" });
  assert.equal(sqlite.prepare("SELECT public_api_enabled FROM events").get().public_api_enabled, 0);
  assert.equal(sqlite.prepare("SELECT reason FROM audit_logs").get().reason, "公開APIを無効化");
});

test("T04 SA-007: concurrent change after preflight -> CAS fails, rollback, CURRENT message", async () => {
  let raced = false;
  const { sqlite, request } = setup({
    onFirst: (sql, q) => {
      if (!raced && sql.includes("FROM events")) {
        raced = true;
        q.prepare("UPDATE events SET title = 'changed elsewhere' WHERE id = 'ev-1'").run();
      }
    },
  });
  seedEvent(sqlite);
  const cache = installCacheStub();
  const original = console.error;
  console.error = () => {};
  try {
    const res = await request("POST", "/api/admin/api-endpoints", { event_id: "ev-1" });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { ok: false, message: "更新が競合したか監査記録に失敗しました。" });
    assert.equal(cache.deleted.length, 0);
  } finally {
    console.error = original;
    cache.restore();
  }
  assert.equal(sqlite.prepare("SELECT public_api_enabled FROM events").get().public_api_enabled, 0);
  assert.equal(count(sqlite, "audit_logs"), 0);
});

test("SA-007: Cache API failure never fails the mutation (best effort)", async () => {
  const { sqlite, request } = setup();
  seedEvent(sqlite);
  const previous = globalThis.caches;
  globalThis.caches = { default: { delete: async () => { throw new Error("cache down"); } } };
  try {
    assert.equal((await request("POST", "/api/admin/api-endpoints", { event_id: "ev-1" })).status, 200);
  } finally {
    globalThis.caches = previous;
  }
  assert.equal(count(sqlite, "audit_logs"), 1);
});
