import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.ts";

test("GET /api/health returns 200 and commit when BUILD_COMMIT_SHA is valid", async () => {
  const commit = "a".repeat(40);
  const res = await app.request(
    "/api/health",
    { method: "GET" },
    { BUILD_COMMIT_SHA: commit },
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const data = await res.json();
  assert.deepEqual(data, {
    ok: true,
    service: "flamenode-web",
    commit: commit,
    runtime: "cloudflare-worker",
  });
});

test("GET /api/health returns 503 when BUILD_COMMIT_SHA is missing or invalid", async () => {
  // Missing
  const res1 = await app.request("/api/health", { method: "GET" }, {});
  assert.equal(res1.status, 503);
  assert.equal(res1.headers.get("Cache-Control"), "no-store");
  const data1 = await res1.json();
  assert.deepEqual(data1, {
    ok: false,
    service: "flamenode-web",
    runtime: "cloudflare-worker",
  });

  // Invalid (short)
  const res2 = await app.request(
    "/api/health",
    { method: "GET" },
    { BUILD_COMMIT_SHA: "12345" },
  );
  assert.equal(res2.status, 503);
  const data2 = await res2.json();
  assert.deepEqual(data2, {
    ok: false,
    service: "flamenode-web",
    runtime: "cloudflare-worker",
  });
});

test("GET /health (fallback without /api) behaves identically to /api/health", async () => {
  const commit = "b".repeat(40);
  const res = await app.request(
    "/health",
    { method: "GET" },
    { BUILD_COMMIT_SHA: commit },
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.commit, commit);
});

test("GET /api/health/deep rejects unauthorized or missing tokens", async () => {
  const adminToken = "secret-admin-token-12345";

  // Missing configured token in env -> 503
  const res1 = await app.request("/api/health/deep", { method: "GET" }, {});
  assert.equal(res1.status, 503);
  assert.equal(res1.headers.get("Cache-Control"), "no-store");

  // Missing Authorization header -> 401
  const res2 = await app.request(
    "/api/health/deep",
    { method: "GET" },
    { WORKER_ADMIN_TOKEN: adminToken },
  );
  assert.equal(res2.status, 401);
  assert.equal(res2.headers.get("Cache-Control"), "no-store");

  // Invalid Authorization header format -> 401
  const res3 = await app.request(
    "/api/health/deep",
    {
      method: "GET",
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    },
    { WORKER_ADMIN_TOKEN: adminToken },
  );
  assert.equal(res3.status, 401);

  // Wrong Bearer token -> 401
  const res4 = await app.request(
    "/api/health/deep",
    {
      method: "GET",
      headers: { Authorization: "Bearer wrong-token" },
    },
    { WORKER_ADMIN_TOKEN: adminToken },
  );
  assert.equal(res4.status, 401);
});

test("GET /api/health/deep returns health check status with valid token", async () => {
  const adminToken = "secret-admin-token-12345";
  const commit = "c".repeat(40);

  const fakeDb = {
    prepare: (_sql) => ({
      first: async () => ({ "?": 1 }),
    }),
  };
  const fakeKv = {
    get: async (_key) => null,
  };
  const fakeBucket = {
    head: async (_key) => null,
  };

  const res = await app.request(
    "/api/health/deep",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${adminToken}` },
    },
    {
      WORKER_ADMIN_TOKEN: adminToken,
      BUILD_COMMIT_SHA: commit,
      DB: fakeDb,
      KV: fakeKv,
      BUCKET: fakeBucket,
    },
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.status, "ok");
  assert.equal(data.service, "flamenode-web");
  assert.equal(data.commit, commit);
  assert.equal(data.checks.d1, "ok");
  assert.equal(data.checks.kv, "ok");
  assert.equal(data.checks.r2, "ok");
  assert.equal(data.public_visibility_guard_mode, "off");

  // With explicit PUBLIC_VISIBILITY_GUARD_MODE
  const resObserve = await app.request(
    "/api/health/deep",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${adminToken}` },
    },
    {
      WORKER_ADMIN_TOKEN: adminToken,
      BUILD_COMMIT_SHA: commit,
      PUBLIC_VISIBILITY_GUARD_MODE: "observe",
    },
  );
  const dataObserve = await resObserve.json();
  assert.equal(dataObserve.public_visibility_guard_mode, "observe");
});
