// MIG-0629: SA-009 / SA-010 admin audit settings & restore dry-run parity test.
// Tests Hono endpoints (POST /api/admin/audit/settings, POST /api/admin/audit/dry-run)
// against SQLite D1 with full middleware chain:
//   T01 origin check (cross-origin 403, D1 reads = 0)
//   T02 auth/role checks (unauthenticated 401, non-admin 403, banned 403, audit = 0)
//   T03 settings update success (audit row written, S3 statement count <=3 reads + 1 batch)
//   T04 dry run (nonexistent, strategy none, expired, already restored, valid restorable log; host unused, writes = 0)
//   T05 CostGuard feature check (admin_permissions disabled -> 503, writes = 0)
//   T06 body size cap (>64KB -> 413)
import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
const ADMIN = {
  id: "admin-1",
  name: "Admin",
  email: null,
  image: null,
  role: "admin",
  is_banned: 0,
  active_x_user_id: null,
};

function setup({
  user = ADMIN,
  role = "admin",
  settings = "normal",
  costGuardDisabled = [],
  onFirst,
} = {}) {
  const { db, sqlite, stats } = createAdminD1({
    onFirst: onFirst ? (s, q) => onFirst(s, q) : undefined,
  });
  seedBase(sqlite, { role, settings });

  if (costGuardDisabled.length > 0) {
    sqlite
      .prepare(
        "UPDATE system_settings SET disabled_features_json = ? WHERE id = 'default'",
      )
      .run(JSON.stringify(costGuardDisabled));
  }

  const calls = [];
  const hono = new Hono();
  hono.route(
    "/api/admin",
    createAdminRoutes({
      session: async (c, next) => {
        calls.push("session");
        c.set("user", user);
        c.set("sessionState", user ? "user" : "none");
        await next();
      },
    }),
  );

  const request = (method, path, body, headers = { Origin: SITE }) =>
    hono.request(
      path,
      {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      { DB: db, NEXT_PUBLIC_SITE_URL: SITE },
    );

  return { sqlite, db, stats, request, calls };
}

const count = (sqlite, table) =>
  sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;

// ---------------- T01 Origin ----------------
test("T01: cross-origin POST /api/admin/audit/settings rejected with 403, 0 D1 reads", async () => {
  const { sqlite, stats, request } = setup();
  const res = await request(
    "POST",
    "/api/admin/audit/settings",
    { normal_retention_days: 60 },
    { Origin: "https://evil.example" },
  );
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, "invalid_origin");
  assert.equal(stats.reads, 0);
  assert.equal(count(sqlite, "audit_logs"), 0);
});

test("T01: cross-origin POST /api/admin/audit/dry-run rejected with 403, 0 D1 reads", async () => {
  const { sqlite, stats, request } = setup();
  const res = await request(
    "POST",
    "/api/admin/audit/dry-run",
    { audit_id: "aud-1", reason: "test dry run" },
    { Origin: "https://evil.example" },
  );
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, "invalid_origin");
  assert.equal(stats.reads, 0);
  assert.equal(count(sqlite, "audit_logs"), 0);
});

// ---------------- T02 Non-admin ----------------
test("T02: unauthenticated request -> 401 unauthenticated, audit 0", async () => {
  const { sqlite, request } = setup({ user: null });
  const res = await request("POST", "/api/admin/audit/settings", {
    normal_retention_days: 60,
  });
  assert.equal(res.status, 401);
  assert.equal(count(sqlite, "audit_logs"), 0);
});

test("T02: moderator request -> 403 forbidden, audit 0", async () => {
  const { sqlite, request } = setup({
    user: { ...ADMIN, role: "moderator" },
    role: "moderator",
  });
  const res = await request("POST", "/api/admin/audit/settings", {
    normal_retention_days: 60,
  });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), {
    ok: false,
    reason: "forbidden",
    message: "この操作を実行する権限がありません。",
  });
  assert.equal(count(sqlite, "audit_logs"), 0);
});

test("T02: banned admin request -> 403 banned, audit 0", async () => {
  const { sqlite, request } = setup({ user: { ...ADMIN, is_banned: 1 } });
  const res = await request("POST", "/api/admin/audit/settings", {
    normal_retention_days: 60,
  });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), {
    ok: false,
    reason: "banned",
    message: "現在、このアカウントは利用停止中です。",
  });
  assert.equal(count(sqlite, "audit_logs"), 0);
});

// ---------------- T03 Settings Update (SA-009) ----------------
test("T03: POST /api/admin/audit/settings updates system_settings and writes audit log", async () => {
  const { sqlite, stats, request } = setup();

  const patch = {
    normal_retention_days: 45,
    restorable_retention_days: 90,
    long_audit_retention_days: 730,
    max_payload_bytes: 250000,
    compact_after_days: 14,
  };

  const res = await request("POST", "/api/admin/audit/settings", patch);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  // Verify system_settings row updated
  const settingsRow = sqlite
    .prepare("SELECT * FROM system_settings WHERE id = 'default'")
    .get();
  assert.equal(settingsRow.audit_normal_retention_days, 45);
  assert.equal(settingsRow.audit_restorable_retention_days, 90);
  assert.equal(settingsRow.audit_long_retention_days, 730);
  assert.equal(settingsRow.audit_max_payload_bytes, 250000);
  assert.equal(settingsRow.audit_compact_after_days, 14);
  assert.equal(settingsRow.audit_updated_by_auth_user_id, "admin-1");

  // Verify audit log written
  assert.equal(count(sqlite, "audit_logs"), 1);
  const auditRow = sqlite.prepare("SELECT * FROM audit_logs").get();
  assert.equal(auditRow.table_name, "system_settings");
  assert.equal(auditRow.target_id, "default");
  assert.equal(auditRow.context, "audit_settings_update");
  assert.equal(auditRow.retention_class, "long_audit");
  assert.equal(auditRow.actor_user_id, "admin-1");
  assert.equal(auditRow.reason, "監査ログ設定を更新");

  // S3 budget: preloaded context used, reads <= 3 (guard user + guard settings + before select) and exactly 1 batch
  assert.ok(stats.reads <= 3, `Expected reads <= 3, got ${stats.reads}`);
  assert.equal(stats.batches, 1);
});

test("T03: POST /api/admin/audit/settings validation failure returns 400", async () => {
  const { sqlite, request } = setup();

  // normal_retention_days minimum is 7
  const res = await request("POST", "/api/admin/audit/settings", {
    normal_retention_days: 3,
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.ok(body.message);
  assert.equal(count(sqlite, "audit_logs"), 0);

  // max_payload_bytes minimum is 1000
  const res2 = await request("POST", "/api/admin/audit/settings", {
    max_payload_bytes: 500,
  });
  assert.equal(res2.status, 400);
  assert.equal((await res2.json()).ok, false);
});

// ---------------- T04 Dry Run (SA-010) ----------------
test("T04: POST /api/admin/audit/dry-run validates input schema", async () => {
  const { request } = setup();

  // Missing audit_id
  const r1 = await request("POST", "/api/admin/audit/dry-run", {
    audit_id: "",
    reason: "valid reason",
  });
  assert.equal(r1.status, 400);
  assert.equal((await r1.json()).ok, false);

  // Missing reason
  const r2 = await request("POST", "/api/admin/audit/dry-run", {
    audit_id: "aud-1",
    reason: "",
  });
  assert.equal(r2.status, 400);
  assert.equal((await r2.json()).ok, false);
});

test("T04: POST /api/admin/audit/dry-run returns 200 with ok:false for missing audit log", async () => {
  const { request, stats } = setup();
  const res = await request("POST", "/api/admin/audit/dry-run", {
    audit_id: "missing-log-id",
    reason: "testing nonexistent",
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: false,
    message: "監査ログが見つかりません。",
  });
  assert.equal(stats.batches, 0); // No writes!
});

test("T04: POST /api/admin/audit/dry-run returns 200 with ok:false for strategy none", async () => {
  const { sqlite, request, stats } = setup();
  const now = Math.floor(Date.now() / 1000);

  sqlite
    .prepare(
      `INSERT INTO audit_logs (id, table_name, target_id, operation, restore_strategy, created_at, actor_user_id)
       VALUES ('log-none', 'system_settings', 'default', 'SYSTEM', 'none', ?, 'admin-1')`,
    )
    .run(now);

  const res = await request("POST", "/api/admin/audit/dry-run", {
    audit_id: "log-none",
    reason: "test strategy none",
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: false,
    message: "この監査操作には復元戦略がありません。",
  });
  assert.equal(stats.batches, 0);
});

test("T04: POST /api/admin/audit/dry-run returns 200 with ok:false for expired log", async () => {
  const { sqlite, request, stats } = setup();
  const past = Math.floor(Date.now() / 1000) - 3600;

  sqlite
    .prepare(
      `INSERT INTO audit_logs (id, table_name, target_id, operation, restore_strategy, expires_at, created_at, actor_user_id)
       VALUES ('log-exp', 'announcements', 'anc-1', 'UPDATE', 'update_before', ?, ?, 'admin-1')`,
    )
    .run(past, past - 100);

  const res = await request("POST", "/api/admin/audit/dry-run", {
    audit_id: "log-exp",
    reason: "test expired",
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: false,
    message: "このログの復元可能期間は終了しています。",
  });
  assert.equal(stats.batches, 0);
});

test("T04: POST /api/admin/audit/dry-run returns 200 with ok:false for already restored log", async () => {
  const { sqlite, request, stats } = setup();
  const now = Math.floor(Date.now() / 1000);

  sqlite
    .prepare(
      `INSERT INTO audit_logs (id, table_name, target_id, operation, restore_strategy, created_at, actor_user_id)
       VALUES ('log-restored', 'announcements', 'anc-1', 'UPDATE', 'update_before', ?, 'admin-1')`,
    )
    .run(now);

  sqlite
    .prepare(
      `INSERT INTO audit_restore_runs (id, audit_log_id, executed_by_user_id, reason, status, executed_at)
       VALUES ('run-prior', 'log-restored', 'admin-1', 'prior restore', 'success', ?)`,
    )
    .run(now - 10);

  const res = await request("POST", "/api/admin/audit/dry-run", {
    audit_id: "log-restored",
    reason: "test already restored",
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: false,
    message: "この監査ログはすでに復元済みです。",
  });
  assert.equal(stats.batches, 0);
});

test("T04: POST /api/admin/audit/dry-run returns diff for valid restorable log with 0 writes and host unused", async () => {
  const { sqlite, request, stats } = setup();
  const now = Math.floor(Date.now() / 1000);

  // Insert announcement row
  sqlite
    .prepare(
      `INSERT INTO announcements (id, title, body, severity, is_published, publish_at, expire_at, target_audience, created_by_user_id, created_at, updated_at)
       VALUES ('anc-1', 'Current Title', 'Current Body', 'info', 1, ?, ?, 'all', 'admin-1', ?, ?)`,
    )
    .run(now, now + 1000, now - 100, now - 10);

  // Insert audit log for anc-1
  const beforeJson = JSON.stringify({
    id: "anc-1",
    title: "Old Title",
    body: "Old Body",
    severity: "info",
    is_published: 1,
    publish_at: now,
    expire_at: now + 1000,
    target_audience: "all",
    created_by_user_id: "admin-1",
    created_at: now - 100,
    updated_at: now - 50,
  });
  const afterJson = JSON.stringify({
    id: "anc-1",
    title: "Current Title",
    body: "Current Body",
    severity: "info",
    is_published: 1,
    publish_at: now,
    expire_at: now + 1000,
    target_audience: "all",
    created_by_user_id: "admin-1",
    created_at: now - 100,
    updated_at: now - 10,
  });

  sqlite
    .prepare(
      `INSERT INTO audit_logs (id, table_name, target_id, operation, restore_strategy, before_json, after_json, created_at, actor_user_id)
       VALUES ('log-valid', 'announcements', 'anc-1', 'UPDATE', 'update_before', ?, ?, ?, 'admin-1')`,
    )
    .run(beforeJson, afterJson, now - 10);

  const res = await request("POST", "/api/admin/audit/dry-run", {
    audit_id: "log-valid",
    reason: "testing dry run",
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.diff);
  assert.equal(body.diff.current.title, "Current Title");
  assert.equal(body.diff.target.title, "Old Title");
  assert.deepEqual(body.diff.conflicts, []);

  // Invariant: zero writes, host never invoked
  assert.equal(stats.batches, 0);
  assert.equal(count(sqlite, "audit_logs"), 1); // Only the initial log row
});

// ---------------- T05 CostGuard ----------------
test("T05: disabled feature admin_permissions -> 503 cost_guard_blocked", async () => {
  const { sqlite, request } = setup({
    costGuardDisabled: ["admin_permissions"],
  });
  const res = await request("POST", "/api/admin/audit/settings", {
    normal_retention_days: 60,
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.reason, "cost_guard_blocked");
  assert.equal(count(sqlite, "audit_logs"), 0);

  const res2 = await request("POST", "/api/admin/audit/dry-run", {
    audit_id: "aud-1",
    reason: "some reason",
  });
  assert.equal(res2.status, 503);
  assert.equal((await res2.json()).reason, "cost_guard_blocked");
  assert.equal(count(sqlite, "audit_logs"), 0);
});

// ---------------- T06 Body Size Cap ----------------
test("T06: body > 64KB returns 413", async () => {
  const { request } = setup();
  const oversized = {
    normal_retention_days: 60,
    junk: "x".repeat(70000),
  };
  const res = await request("POST", "/api/admin/audit/settings", oversized);
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), {
    ok: false,
    message: "リクエストが大きすぎます。",
  });

  const res2 = await request("POST", "/api/admin/audit/dry-run", {
    audit_id: "aud-1",
    reason: "r".repeat(70000),
  });
  assert.equal(res2.status, 413);
  assert.deepEqual(await res2.json(), {
    ok: false,
    message: "リクエストが大きすぎます。",
  });
});
