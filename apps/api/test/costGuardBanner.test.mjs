import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.ts";
import { resetOperationModeCachesForTests } from "../src/routes/live/operationMode.ts";

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
  assert.equal(kv.count, 2); // mode then reason, just like CURRENT
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
