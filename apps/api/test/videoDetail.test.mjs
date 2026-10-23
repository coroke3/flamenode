// MIG-0603 U01: RH-030 GET /api/videos/:id parity with CURRENT
// app/api/videos/[id]/route.ts (status / body / header).
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { app } from "../src/app.ts";
import { clearVideoDetailRateLimitForTests } from "../src/routes/videos/detail.ts";

const INTERNAL = "video_123e4567-e89b-42d3-a456-426614174000";

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE videos (id TEXT PRIMARY KEY, title TEXT, youtube_video_id TEXT,
      creator_display_name TEXT, creator_x_user_id TEXT, creator_icon_url TEXT,
      primary_event_id TEXT, scheduled_time INTEGER, visibility_status TEXT);
    INSERT INTO videos VALUES
      ('${INTERNAL}', 'T1', 'yt1', '  Name  ', 'xid1', 'https://i/1.png', 'ev1', 100, 'public'),
      ('vid2', 'T2', 'yt2', '   ', 'xid2', NULL, NULL, NULL, 'public'),
      ('vid3', 'Hidden', 'yt3', 'N', 'x3', NULL, NULL, NULL, 'private'),
      ('vid4', 'PkIsYt', 'yt1b', 'N', 'x4', NULL, NULL, NULL, 'public');
  `);
  const counter = { reads: 0 };
  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            first: async () => {
              counter.reads += 1;
              return sqlite.prepare(sql).get(...params) ?? null;
            },
          };
        },
      };
    },
  };
  return { db, counter };
}

function get(path, env, headers = {}) {
  return app.request(path, { headers: { "CF-Connecting-IP": "9.9.9.9", ...headers } }, env);
}

test.beforeEach(() => clearVideoDetailRateLimitForTests());

test("returns the allowlisted DTO for a public video by internal id", async () => {
  const { db, counter } = createDb();
  const res = await get(`/api/videos/${INTERNAL}`, { DB: db });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=30, s-maxage=60, stale-while-revalidate=120");
  assert.match(res.headers.get("ETag") ?? "", /^"[0-9a-f]{64}"$/);
  assert.deepEqual(await res.json(), {
    item: {
      id: INTERNAL, title: "T1", youtube_video_id: "yt1", display_name: "Name",
      icon_url: "https://i/1.png", primary_event_id: "ev1", scheduled_time: 100, status: "public",
    },
  });
  assert.ok(counter.reads <= 3);
});

test("display_name falls back to creator_x_user_id; resolves by youtube id", async () => {
  const { db } = createDb();
  const res = await get("/api/videos/yt2", { DB: db });
  assert.equal(res.status, 200);
  const { item } = await res.json();
  assert.equal(item.id, "vid2");
  assert.equal(item.display_name, "xid2");
  assert.equal(item.icon_url, null);
});

test("non-public and unknown videos are 404 not_found with no-store (no leak)", async () => {
  const { db } = createDb();
  for (const id of ["vid3", "yt3", "missing"]) {
    const res = await get(`/api/videos/${id}`, { DB: db });
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await res.json(), { error: "not_found" });
  }
});

test("a confirmed internal id never falls through to youtube lookup", async () => {
  const { db, counter } = createDb();
  const res = await get("/api/videos/video_00000000-0000-4000-8000-000000000000", { DB: db });
  assert.equal(res.status, 404);
  assert.equal(counter.reads, 1);
});

test("malformed percent encoding is 404; missing DB and query failure are 503", async () => {
  const { db } = createDb();
  assert.equal((await get("/api/videos/%25E0%25A4%25A", { DB: db })).status, 404);
  const none = await get("/api/videos/vid2", {});
  assert.equal(none.status, 503);
  assert.deepEqual(await none.json(), { error: "database_unavailable" });
  assert.equal(none.headers.get("Cache-Control"), "no-store");
  assert.equal(none.headers.get("Retry-After"), "30");
  const broken = { prepare() { throw new Error("boom"); } };
  assert.equal((await get("/api/videos/vid2", { DB: broken })).status, 503);
});

test("If-None-Match returns bodyless 304; 429 after 60 requests per client", async () => {
  const { db } = createDb();
  const first = await get("/api/videos/vid2", { DB: db });
  const etag = first.headers.get("ETag");
  const again = await get("/api/videos/vid2", { DB: db }, { "If-None-Match": etag });
  assert.equal(again.status, 304);
  assert.equal(await again.text(), "");
  let last;
  for (let i = 0; i < 60; i += 1) last = await get("/api/videos/vid2", { DB: db });
  assert.equal(last.status, 429);
  assert.equal(last.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await last.json(), { error: "rate_limited" });
});
