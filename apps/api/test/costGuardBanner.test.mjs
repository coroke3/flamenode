import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.ts";
import { resetOperationModeCachesForTests } from "../src/routes/live/operationMode.ts";
import { cookie, createD1, createSqlite } from "./support/personalHarness.mjs";
import { seed as seedAdminRead } from "./support/adminReadSeed.mjs";

function unavailableD1(calls) {
  return { prepare: () => {
    calls.count += 1;
    throw new Error("public CostGuardBanner must never touch D1");
  } };
}

function kvResponse(raw, count) {
  return { get: async (key, options) => {
    count.count += 1;
    assert.equal(key, "operation_mode:mirror");
    assert.deepEqual(options, { cacheTtl: 30 });
    return raw;
  } };
}

async function requestWith(env) {
  const response = await app.request("/api/operation-mode/banner", { method: "GET" }, env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  return response.json();
}

test("MIG-0661 T01: public economy mirror returns mode + reason without session or D1", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 }, kv = { count: 0 };
  const data = await requestWith({
    DB: unavailableD1(d1),
    KV: kvResponse(JSON.stringify({ mode: "economy", updated_at: 1, reason: "maintenance notice" }), kv),
  });
  assert.deepEqual(data, { mode: "economy", reason: "maintenance notice" });
  assert.equal(d1.count, 0);
  assert.equal(kv.count, 1); // CURRENT caches the mirror for mode and reason
});

test("MIG-0661 T02: missing/invalid mirror is normal, no D1 fallback", async () => {
  for (const raw of [null, "{broken-json", JSON.stringify({ mode: "economy", updated_at: "bad", reason: "x" })]) {
    resetOperationModeCachesForTests();
    const d1 = { count: 0 }, kv = { count: 0 };
    assert.deepEqual(await requestWith({ DB: unavailableD1(d1), KV: kvResponse(raw, kv) }),
      { mode: "normal", reason: null });
    assert.equal(d1.count, 0);
    assert.equal(kv.count, 1);
  }
});

test("MIG-0661 T02: FORCE_STATIC_ONLY dominates KV mode and retains mirror reason", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 }, kv = { count: 0 };
  assert.deepEqual(await requestWith({
    DB: unavailableD1(d1),
    FORCE_STATIC_ONLY: "1",
    KV: kvResponse(JSON.stringify({ mode: "read_only", updated_at: 1, reason: "limited access" }), kv),
  }), { mode: "static_only", reason: "limited access" });
  assert.equal(d1.count, 0);
  assert.equal(kv.count, 1); // forced mode skips the initial mode lookup
});

test("MIG-0661 T02: KV read errors do not fail the public endpoint or reach D1", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 };
  assert.deepEqual(await requestWith({
    DB: unavailableD1(d1),
    KV: { get: async () => { throw new Error("KV offline"); } },
  }), { mode: "normal", reason: null });
  assert.equal(d1.count, 0);
});

test("MIG-0661 T02: invalid mirror reason is null while its mode remains valid", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 }, kv = { count: 0 };
  assert.deepEqual(await requestWith({
    DB: unavailableD1(d1),
    KV: kvResponse(JSON.stringify({ mode: "read_only", updated_at: 1, reason: 22 }), kv),
  }), { mode: "read_only", reason: null });
  assert.equal(d1.count, 0);
});

test("MIG-0661 T02: two public banner reads share the bounded mirror cache", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 }, kv = { count: 0 };
  const env = {
    DB: unavailableD1(d1),
    KV: kvResponse(JSON.stringify({
      mode: "economy", updated_at: 1, reason: "cached reason",
    }), kv),
  };
  assert.deepEqual(await requestWith(env), { mode: "economy", reason: "cached reason" });
  assert.deepEqual(await requestWith(env), { mode: "economy", reason: "cached reason" });
  assert.equal(kv.count, 1, "warm public traffic must not read KV on each request");
  assert.equal(d1.count, 0);
});

test("MIG-0661 T02: cache prevents inconsistent reason when KV changes mid-request", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 };
  let reads = 0;
  const env = {
    DB: unavailableD1(d1),
    KV: { get: async () => {
      reads += 1;
      return reads === 1
        ? JSON.stringify({ mode: "read_only", updated_at: 1, reason: "original" })
        : JSON.stringify({ mode: "normal", updated_at: 2, reason: "later" });
    } },
  };
  assert.deepEqual(await requestWith(env), { mode: "read_only", reason: "original" });
  assert.equal(reads, 1);
  assert.equal(d1.count, 0);
});

test("MIG-0661 T02: forced static-only mode still reads at most one mirror", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 }, kv = { count: 0 };
  const env = {
    DB: unavailableD1(d1),
    FORCE_STATIC_ONLY: "true",
    KV: kvResponse(JSON.stringify({
      mode: "normal", updated_at: 1, reason: "operator note",
    }), kv),
  };
  assert.deepEqual(await requestWith(env), { mode: "static_only", reason: "operator note" });
  assert.deepEqual(await requestWith(env), { mode: "static_only", reason: "operator note" });
  assert.equal(kv.count, 1);
  assert.equal(d1.count, 0);
});

test("MIG-0661 T03: admin banner mirrors CURRENT D1 mode/reason with a single bounded read", async () => {
  const sqlite = createSqlite();
  try {
    seedAdminRead(sqlite);
    sqlite.prepare("UPDATE system_settings SET operation_mode = ?, cost_guard_reason = ? WHERE id = 'default'")
      .run("read_only", "temporary freeze");
    const db = createD1(sqlite);
    const response = await app.request(
      "/api/admin-read/cost-guard-banner",
      { method: "GET", headers: cookie("tok-root") },
      { DB: db },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(await response.json(), { mode: "read_only", reason: "temporary freeze" });
    assert.equal(db.stats.statements, 2, "one auth session SELECT and one settings SELECT only");
    assert.equal(db.stats.writes, 0);
    assert.equal(db.stats.batches, 0);
    sqlite.exec("DELETE FROM system_settings WHERE id = 'default'");
    const missingDb = createD1(sqlite);
    const missing = await app.request(
      "/api/admin-read/cost-guard-banner",
      { method: "GET", headers: cookie("tok-root") },
      { DB: missingDb },
    );
    assert.equal(missing.status, 200);
    assert.deepEqual(await missing.json(), { mode: "normal", reason: null });
    assert.equal(missingDb.stats.statements, 2);
  } finally {
    sqlite.close();
  }
});

test("MIG-0661 T03: admin D1 settings failure fails soft without exposing internals", async () => {
  const sqlite = createSqlite();
  try {
    seedAdminRead(sqlite);
    const base = createD1(sqlite);
    let settingsQueries = 0;
    const wrapped = {
      prepare(query) {
        if (query.includes("cost_guard_reason")) {
          settingsQueries += 1;
          throw new Error("SENSITIVE-D1-DRIVER-DETAIL");
        }
        return base.prepare(query);
      },
    };
    const response = await app.request(
      "/api/admin-read/cost-guard-banner",
      { method: "GET", headers: cookie("tok-root") },
      { DB: wrapped },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { mode: "normal", reason: null });
    assert.doesNotMatch(body, /SENSITIVE-D1/);
    assert.equal(settingsQueries, 1);
    assert.equal(base.stats.statements, 1, "authentication must still be required");
  } finally {
    sqlite.close();
  }
});

test("MIG-0661 T04: admin banner inherits guest/user/moderator/banned refusal", async () => {
  const sqlite = createSqlite();
  try {
    seedAdminRead(sqlite);
    for (const [token, expected, body] of [
      [null, 401, null],
      ["tok-alice", 403, { error: "Forbidden", redirect: "/dashboard" }],
      ["tok-bob", 403, { error: "Forbidden", redirect: "/dashboard" }],
      ["tok-badmin", 403, { error: "Forbidden", message: "User is banned" }],
    ]) {
      const db = createD1(sqlite);
      const response = await app.request(
        "/api/admin-read/cost-guard-banner",
        { method: "GET", headers: token ? cookie(token) : {} },
        { DB: db },
      );
      assert.equal(response.status, expected, String(token));
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      const actual = await response.json();
      if (body) assert.deepEqual(actual, body);
      assert.ok(db.stats.statements <= 1, "denied callers cannot query settings");
      assert.equal(db.stats.writes, 0);
    }
    const db = createD1(sqlite);
    const mutation = await app.request(
      "/api/admin-read/cost-guard-banner",
      { method: "POST", headers: cookie("tok-root") },
      { DB: db },
    );
    assert.equal(mutation.status, 404, "admin-read endpoint is GET-only");
    assert.equal(db.stats.writes, 0);
  } finally {
    sqlite.close();
  }
});
