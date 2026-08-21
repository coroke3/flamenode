import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { rebuildTarget } from "./rebuild.ts";

function createEnv() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      creator_display_name TEXT,
      creator_x_user_id TEXT,
      youtube_video_id TEXT,
      visibility_status TEXT NOT NULL,
      primary_event_id TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE video_events (video_id TEXT NOT NULL, event_id TEXT NOT NULL);
    CREATE TABLE x_users (id TEXT PRIMARY KEY, x_name TEXT, approval_status TEXT);
    CREATE TABLE static_artifacts (
      id TEXT PRIMARY KEY NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      object_key TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      source_updated_at INTEGER,
      generated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE UNIQUE INDEX static_artifacts_target_key_uniq
      ON static_artifacts (target_type, target_id, object_key);
  `);
  const insertVideo = sqlite.prepare(
    `INSERT INTO videos
      (id, title, creator_display_name, creator_x_user_id, youtube_video_id,
       visibility_status, primary_event_id, updated_at)
     VALUES (?, ?, ?, ?, ?, 'public', NULL, ?)`
  );
  for (let index = 0; index < 20; index += 1) {
    insertVideo.run(
      `video-${index}`,
      `Video title ${index}`,
      `Creator ${index}`,
      `creator-${index}`,
      `youtube-${index}`,
      1_700_000_000 - index,
    );
  }
  const insertUser = sqlite.prepare(
    `INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, 'approved')`,
  );
  for (let index = 0; index < 20; index += 1) {
    insertUser.run(`creator-${index}`, `Creator ${index}`);
  }

  const DB = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const direct = {
        async first() {
          return statement.get() ?? null;
        },
        async all() {
          return { results: statement.all() };
        },
        async run() {
          const result = statement.run();
          return { meta: { changes: Number(result.changes ?? 0) } };
        },
      };
      return {
        bind(...values) {
          const bound = sqlite.prepare(sql);
          return {
            async first() {
              return bound.get(...values) ?? null;
            },
            async all() {
              return { results: bound.all(...values) };
            },
            async run() {
              const result = bound.run(...values);
              return { meta: { changes: Number(result.changes ?? 0) } };
            },
          };
        },
        ...direct,
      };
    },
  };
  const objects = new Map();
  const R2 = {
    async head(key) {
      return objects.has(key) ? {} : null;
    },
    async put(key, value) {
      objects.set(key, String(value));
      return {};
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
  };
  return { DB, R2, KV: {}, objects, sqlite };
}

test("search-index posting rebuild tracks bounded shards and keeps them after target cleanup", async () => {
  const env = createEnv();
  await rebuildTarget(env, "search_index", "global");

  assert.ok(env.objects.has("search-index-lite.json"));
  assert.ok(env.objects.has("search-index-postings.v1/manifest.json"));
  const postingKeys = [...env.objects.keys()].filter((key) =>
    key.startsWith("search-postings.v1/"),
  );
  assert.ok(postingKeys.length > 0);

  const tracked = env.sqlite
    .prepare(
      `SELECT object_key FROM static_artifacts
       WHERE target_type = 'search_index' AND target_id = 'global'
         AND deleted_at IS NULL`,
    )
    .all()
    .map((row) => row.object_key);
  for (const key of ["search-index-lite.json", "search-index-postings.v1/manifest.json", ...postingKeys]) {
    assert.ok(tracked.includes(key), `missing tracking row for ${key}`);
  }
  env.sqlite.close();
});
