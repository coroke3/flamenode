import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.ts";
import { runDeepHealthChecks } from "@flamenode/server-core/health/deepHealth";
import { REQUIRED_RUNTIME_TABLE_COUNT } from "@flamenode/server-core/health/schemaContract";

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

test("GET /health (no /api prefix) is not routed: URL set matches CURRENT", async () => {
  const res = await app.request("/health", { method: "GET" }, { BUILD_COMMIT_SHA: "b".repeat(40) });
  assert.equal(res.status, 404);
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

const commit = "b".repeat(40);

function artifactPayload(key, now) {
  const generatedAt = now - 60;
  if (key === "top.json") {
    return {
      generated_at: generatedAt,
      latest: [],
      nostalgic_pool: [],
      nostalgic: [],
      nostalgic_shuffled_at: generatedAt,
      stats: { public_videos: 0 },
    };
  }
  if (key === "list/recent.json" || key === "list/popular.json") {
    return { generated_at: generatedAt, total: 0, items: [] };
  }
  if (key === "search-index-lite.json") {
    return { generated_at: generatedAt, videos: [], users: [] };
  }
  if (key === "events/index.json") {
    return { generated_at: generatedAt, items: [], group_sections: [] };
  }
  if (key === "users/index.json") {
    return { generated_at: generatedAt, items: [] };
  }
  if (key === "recommend.json") {
    return {
      generated_at: generatedAt,
      recommended: [],
      latest: [],
      underrated: [],
      creators: [],
    };
  }
  if (key === "recommend/core.v1.json") {
    return {
      schema_version: 1,
      generated_at: generatedAt,
      recommended: [],
      latest: [],
      underrated: [],
    };
  }
  if (key === "rules/current.json") {
    return {
      generated_at: generatedAt,
      version_label: "v1",
      body_markdown: "rules",
    };
  }
  if (key === "youtube/related-blocklist.v1.json") {
    return {
      schema_version: 1,
      generated_at: generatedAt,
      blocked: {},
    };
  }
  if (key === "videos/random-pool.v1.json") {
    return {
      schema_version: 1,
      generated_at: generatedAt,
      generation_key: "fixture-generation",
      items: [],
    };
  }
  if (key === "visibility/blocked-entities.v1.json") {
    return {
      schema_version: 1,
      revision: 0,
      generated_at: generatedAt,
      entities: [],
    };
  }
  throw new Error(`unexpected artifact key ${key}`);
}

function createBucket(now) {
  return {
    head: async () => null,
    get: async (key) => ({
      text: async () => JSON.stringify(artifactPayload(key, now)),
    }),
  };
}

function createBaseEnv(now, overrides = {}) {
  return {
    BUILD_COMMIT_SHA: commit,
    QUEUE_DISPATCH_ENABLED: "1",
    QUEUE_CONTINUATION_ENABLED: "1",
    QUEUE_YOUTUBE_SYNC_ENABLED: "1",
    NOTIFICATION_WAKE_QUEUE: { send: () => {} },
    STATIC_REBUILD_WAKE_QUEUE: { send: () => {} },
    YOUTUBE_SYNC_WAKE_QUEUE: { send: () => {} },
    DB: {
      prepare: () => ({
        first: async () => ({
          version: "2026-08-24-observability-1",
          required_table_count: REQUIRED_RUNTIME_TABLE_COUNT,
          public_video_detail_count: 0,
          tracked_video_detail_count: 0,
          oldest_video_detail_generated_at: null,
          public_event_detail_count: 0,
          tracked_event_detail_count: 0,
          oldest_event_detail_generated_at: null,
        }),
      }),
    },
    KV: { get: async () => null },
    BUCKET: createBucket(now),
    ...overrides,
  };
}


// Share the CURRENT fixture shape: every global artifact and runtime schema table is
// present, and all read-only binding probes are deterministic.
const adminToken = "health-api-fixture-token";

async function apiHealth(env, token = adminToken) {
  return app.request(
    "/api/health/deep",
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    { WORKER_ADMIN_TOKEN: adminToken, ...env },
  );
}

test("RH-017: Hono returns the CURRENT detailed health body on all checks OK", async () => {
  const env = createBaseEnv(Math.floor(Date.now() / 1000));
  const expected = await runDeepHealthChecks(env);
  const response = await apiHealth(env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), expected);
  assert.equal(expected.ok, true);
  assert.equal(expected.status, "ok");
});

test("RH-017: visibility degrade maps to HTTP 200 with CURRENT body", async () => {
  const env = createBaseEnv(Math.floor(Date.now() / 1000), {
    PUBLIC_VISIBILITY_GUARD_MODE: "enforce",
    BUCKET: {
      head: async () => null,
      get: async (key) =>
        key === "visibility/blocked-entities.v1.json"
          ? null
          : createBucket(Math.floor(Date.now() / 1000)).get(key),
    },
  });
  const expected = await runDeepHealthChecks(env);
  const response = await apiHealth(env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), expected);
  assert.equal(expected.status, "degraded");
  assert.equal(expected.ok, false);
});

test("RH-017: health exception is 503 and cannot leak internal errors", async () => {
  const env = createBaseEnv(Math.floor(Date.now() / 1000), {
    DB: { prepare() { throw new Error("private-secret-should-never-leak"); } },
  });
  const response = await apiHealth(env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body, { ok: false, service: "flamenode-web" });
  assert.doesNotMatch(JSON.stringify(body), /private-secret/);
});

test("RH-017: absent required binding fails closed after authentication", async () => {
  const valid = createBaseEnv(Math.floor(Date.now() / 1000));
  for (const name of ["DB", "KV", "BUCKET"]) {
    const response = await apiHealth({ ...valid, [name]: undefined });
    assert.equal(response.status, 503, name);
    assert.equal(response.headers.get("Cache-Control"), "no-store", name);
    assert.deepEqual(await response.json(), { ok: false, service: "flamenode-web" });
  }
});

test("RH-017: incorrect Bearer is rejected before any binding read", async () => {
  const env = createBaseEnv(Math.floor(Date.now() / 1000), {
    DB: { prepare() { throw new Error("unreachable"); } },
  });
  const response = await apiHealth(env, "not-the-token");
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { ok: false, service: "flamenode-web" });
});

test("RH-017: missing known artifact returns a fixed reason/key without leaking data", async () => {
  const now = Math.floor(Date.now() / 1000);
  const normal = createBucket(now);
  const env = createBaseEnv(now, {
    BUCKET: {
      head: normal.head,
      get: async (key) => key === "top.json" ? null : normal.get(key),
    },
  });
  const response = await apiHealth(env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    service: "flamenode-web",
    reason: "artifact_missing",
    key: "top.json",
  });
});

test("RH-017: schema mismatch returns CURRENT's private 503 without leaking DB values", async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = createBaseEnv(now, {
    DB: {
      prepare: () => ({
        first: async () => ({ version: "sensitive-private-version-marker" }),
      }),
    },
  });
  const response = await apiHealth(env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body, { ok: false, service: "flamenode-web" });
  assert.doesNotMatch(JSON.stringify(body), /sensitive-private-version-marker/);
});
