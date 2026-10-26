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
