import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { app } from "../src/app.ts";

function createTestD1() {
  const sqlite = new DatabaseSync(":memory:");

  sqlite.exec(`
    CREATE TABLE software_catalog (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      category TEXT,
      is_verified INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE software_aliases (
      id TEXT PRIMARY KEY,
      software_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      normalized_alias TEXT NOT NULL
    );

    CREATE TABLE video_softwares (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      software_id TEXT NOT NULL
    );
  `);

  sqlite.exec(`
    INSERT INTO software_catalog (id, name, normalized_name, category, is_verified, is_active) VALUES
    ('soft-1', 'Blender', 'blender', '3D', 1, 1),
    ('soft-2', 'Maya', 'maya', '3D', 1, 1),
    ('soft-3', 'After Effects', 'after effects', 'VFX', 0, 1),
    ('soft-4', 'Inactive Soft', 'inactive soft', 'Other', 1, 0);

    INSERT INTO software_aliases (id, software_id, alias, normalized_alias) VALUES
    ('alias-1', 'soft-3', 'AE', 'ae');

    INSERT INTO video_softwares (id, video_id, software_id) VALUES
    ('vs-1', 'v-1', 'soft-1'),
    ('vs-2', 'v-2', 'soft-1'),
    ('vs-3', 'v-1', 'soft-2');
  `);

  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            all: async () => {
              const stmt = sqlite.prepare(sql);
              const results = stmt.all(...params);
              return { results };
            },
          };
        },
      };
    },
  };
}

test("GET /api/software/suggestions returns 503 when DB is missing", async () => {
  const res = await app.request("/api/software/suggestions", { method: "GET" }, {});
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.deepEqual(data, { error: "database_unavailable" });
});

test("GET /api/software/suggestions lists active software ordered by verified/usage when no query", async () => {
  const fakeDb = createTestD1();
  const res = await app.request(
    "/api/software/suggestions?limit=10",
    { method: "GET" },
    { DB: fakeDb },
  );

  assert.equal(res.status, 200);
  assert.ok(res.headers.get("ETag"));
  assert.equal(
    res.headers.get("Cache-Control"),
    "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
  );

  const data = await res.json();
  assert.equal(data.length, 3); // soft-4 is inactive, filtered out
  // soft-1: is_verified=1, usage=2
  // soft-2: is_verified=1, usage=1
  // soft-3: is_verified=0, usage=0
  assert.equal(data[0].id, "soft-1");
  assert.equal(data[0].name, "Blender");
  assert.equal(data[0].usage_count, 2);
  assert.equal(data[0].is_verified, 1);

  assert.equal(data[1].id, "soft-2");
  assert.equal(data[2].id, "soft-3");
});

test("GET /api/software/suggestions finds by alias", async () => {
  const fakeDb = createTestD1();
  const res = await app.request(
    "/api/software/suggestions?q=ae",
    { method: "GET" },
    { DB: fakeDb },
  );

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.length, 1);
  assert.equal(data[0].id, "soft-3");
  assert.equal(data[0].name, "After Effects");
});

test("GET /api/software/suggestions finds by partial name match", async () => {
  const fakeDb = createTestD1();
  const res = await app.request(
    "/api/software/suggestions?q=blend",
    { method: "GET" },
    { DB: fakeDb },
  );

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.length, 1);
  assert.equal(data[0].id, "soft-1");
  assert.equal(data[0].name, "Blender");
});

test("GET /api/software/suggestions returns 304 on matching If-None-Match", async () => {
  const fakeDb = createTestD1();
  const res1 = await app.request(
    "/api/software/suggestions?limit=5",
    { method: "GET" },
    { DB: fakeDb },
  );
  assert.equal(res1.status, 200);
  const etag = res1.headers.get("ETag");
  assert.ok(etag);

  const res2 = await app.request(
    "/api/software/suggestions?limit=5",
    {
      method: "GET",
      headers: { "If-None-Match": etag },
    },
    { DB: fakeDb },
  );
  assert.equal(res2.status, 304);
});
