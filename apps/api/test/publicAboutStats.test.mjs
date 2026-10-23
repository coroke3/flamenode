import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.ts";

test("GET /api/public/about-stats returns 503 when BUCKET is missing", async () => {
  const res = await app.request("/api/public/about-stats", { method: "GET" }, {});
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(res.headers.get("Retry-After"), "30");
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  const data = await res.json();
  assert.deepEqual(data, { stats: null });
});

test("GET /api/public/about-stats returns 503 when object does not exist in R2", async () => {
  const fakeBucket = {
    get: async (_key) => null,
  };
  const res = await app.request(
    "/api/public/about-stats",
    { method: "GET" },
    { BUCKET: fakeBucket },
  );
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.deepEqual(data, { stats: null });
});

test("GET /api/public/about-stats returns 503 when object size exceeds 64KB", async () => {
  const fakeBucket = {
    get: async (_key) => ({
      size: 65 * 1024,
      json: async () => ({}),
    }),
  };
  const res = await app.request(
    "/api/public/about-stats",
    { method: "GET" },
    { BUCKET: fakeBucket },
  );
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.deepEqual(data, { stats: null });
});

test("GET /api/public/about-stats returns 200 with normalized stats", async () => {
  const fakeBucket = {
    get: async (_key) => ({
      size: 500,
      json: async () => ({
        schema_version: 1,
        generated_at: 1729000000,
        stats: {
          public_videos: 120,
          active_events: 4,
          public_events: 15,
          creators: 42,
        },
      }),
    }),
  };

  const res = await app.request(
    "/api/public/about-stats",
    { method: "GET" },
    { BUCKET: fakeBucket },
  );

  assert.equal(res.status, 200);
  assert.equal(
    res.headers.get("Cache-Control"),
    "public, max-age=300, stale-while-revalidate=1800",
  );
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");

  const data = await res.json();
  assert.deepEqual(data, {
    stats: {
      publicVideos: 120,
      creators: 42,
      events: 15,
    },
  });
});
