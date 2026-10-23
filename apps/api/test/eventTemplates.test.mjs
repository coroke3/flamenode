// MIG-0604 U04 (partial): SA-036 deleteEventTemplate on Hono, against real
// SQLite. Mounted exactly as app.ts does (admin app first, then event routes).
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { adminEventRoutes } from "../src/routes/events/index.ts";
import { expectedRowCondition } from "../src/routes/events/templates.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
const ADMIN = { id: "admin-1", name: "Admin", email: null, image: null, role: "admin", is_banned: 0, active_x_user_id: null };
const TPL = { id: "etmpl_1", name: "T", description: null, source_event_id: "ev-1", settings_json: "{\"a\":1}", created_by_user_id: "admin-1", created_at: 10, updated_at: 20 };

function setup({ user = ADMIN, role = "admin", settings = "normal", seed = true, onFirst } = {}) {
  const { db, sqlite, stats } = createAdminD1({ onFirst });
  sqlite.exec(`CREATE TABLE event_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, source_event_id TEXT, settings_json TEXT NOT NULL, created_by_user_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  seedBase(sqlite, { role, settings });
  if (seed) sqlite.prepare("INSERT INTO event_templates VALUES (?,?,?,?,?,?,?,?)").run(...Object.values(TPL));
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
  hono.route("/api/admin", adminEventRoutes);
  const del = (id, headers = { Origin: SITE }) =>
    hono.request(`/api/admin/event-templates/${id}`, { method: "DELETE", headers }, { DB: db, NEXT_PUBLIC_SITE_URL: SITE });
  return { sqlite, del, calls, db, stats };
}
const count = (sqlite, t) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

test("guards: other origin 403 / anonymous 401 / non-admin 403 / maintenance 503 (session -> writeGuard once -> CostGuard)", async () => {
  const origin = setup();
  assert.equal((await origin.del("etmpl_1", { Origin: "https://evil.example" })).status, 403);
  const anon = setup({ user: null });
  const r401 = await anon.del("etmpl_1");
  assert.equal(r401.status, 401);
  assert.equal(r401.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(anon.calls, ["session"]);
  const mod = setup({ user: { ...ADMIN, role: "moderator" }, role: "moderator", settings: "maintenance" });
  const r403 = await mod.del("etmpl_1");
  assert.equal(r403.status, 403);
  assert.equal((await r403.json()).reason, "forbidden");
  const m = setup({ settings: "maintenance" });
  const r503 = await m.del("etmpl_1");
  assert.equal(r503.status, 503);
  assert.equal((await r503.json()).reason, "maintenance_mode");
  const off = setup();
  off.sqlite.prepare("UPDATE system_settings SET disabled_features_json = ?").run(JSON.stringify(["admin_event_templates"]));
  const rOff = await off.del("etmpl_1");
  assert.equal(rOff.status, 503);
  assert.equal((await rOff.json()).reason, "cost_guard_blocked");
  for (const s of [origin, anon, mod, m, off]) {
    assert.equal(count(s.sqlite, "audit_logs"), 0);
    assert.equal(count(s.sqlite, "event_templates"), 1);
  }
});

test("writeGuard runs once per request (no duplicate D1 TOS read from the second mount)", async () => {
  const tosReads = [];
  const s = setup({ onFirst: (sql) => { if (sql.includes("terms_versions")) tosReads.push(sql); } });
  assert.equal((await s.del("etmpl_1")).status, 200);
  assert.equal(tosReads.length, 1);
});

test("D1 statement budget (ZERO_1102 S3): audit context is preloaded, <=3 reads + 1 batch", async () => {
  const s = setup();
  assert.equal((await s.del("etmpl_1")).status, 200);
  assert.ok(s.stats.reads <= 3, `reads ${s.stats.reads}`);
  assert.equal(s.stats.reads, 3);
  assert.equal(s.stats.batches, 1);
});

test("success: deletes row, writes one audit row (DELETE, context/reason as CURRENT), no-store", async () => {
  const s = setup();
  const res = await s.del("etmpl_1");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await res.json(), { ok: true, message: "テンプレートを削除しました。" });
  assert.equal(count(s.sqlite, "event_templates"), 0);
  const audit = s.sqlite.prepare("SELECT * FROM audit_logs").all();
  assert.equal(audit.length, 1);
  const a = audit[0];
  assert.equal(a.table_name, "event_templates");
  assert.equal(a.target_id, "etmpl_1");
  assert.equal(a.operation, "DELETE");
  assert.equal(a.context, "admin_event_templates");
  assert.equal(a.reason, "イベントテンプレートを削除");
  assert.equal(a.retention_class, "normal");
  assert.equal(a.restore_strategy, "none");
  assert.equal(a.actor_user_id, "admin-1");
  assert.deepEqual(JSON.parse(a.before_json), TPL);
  assert.equal(a.after_json, null);
});

test("not found -> 404 with CURRENT message; blank id -> 400", async () => {
  const s = setup({ seed: false });
  const res = await s.del("nope");
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { ok: false, message: "テンプレートが見つかりません。" });
  assert.equal(count(s.sqlite, "audit_logs"), 0);
  const blank = await s.del("%20");
  assert.equal(blank.status, 400);
  assert.deepEqual(await blank.json(), { ok: false, message: "template_id が必要です。" });
});

test("CAS conflict: row changed between read and batch -> 409, rolled back, no audit", async () => {
  let armed = true;
  const s = setup({
    onFirst: (sql, sqlite) => {
      if (armed && sql.includes("FROM event_templates")) {
        armed = false;
        sqlite.prepare("UPDATE event_templates SET name = 'changed' WHERE id = 'etmpl_1'").run();
      }
    },
  });
  const res = await s.del("etmpl_1");
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { ok: false, message: "処理に失敗しました。再読み込みして、もう一度お試しください。" });
  assert.equal(count(s.sqlite, "event_templates"), 1);
  assert.equal(count(s.sqlite, "audit_logs"), 0);
});

test("audit failure rolls the delete back (500, generic message)", async () => {
  const s = setup();
  s.sqlite.exec("DROP TABLE audit_logs");
  const res = await s.del("etmpl_1");
  assert.equal(res.status, 500);
  assert.equal(count(s.sqlite, "event_templates"), 1);
});

test("expectedRowCondition mirrors CURRENT (null -> IS NULL, scalar -> =, non-scalar -> 0 = 1)", () => {
  assert.deepEqual(expectedRowCondition({ a: null, b: "x", c: 1 }), { sql: "\"a\" IS NULL AND \"b\" = ? AND \"c\" = ?", params: ["x", 1] });
  assert.deepEqual(expectedRowCondition({ a: {} }), { sql: "0 = 1", params: [] });
  assert.deepEqual(expectedRowCondition({}), { sql: "0 = 1", params: [] });
});
