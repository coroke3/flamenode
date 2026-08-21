import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { rebuildUsersIndexV2Artifacts } from "./usersIndexV2Artifacts.ts";

function source(index) {
  return {
    x_id: `creator-${index}`,
    x_name: `Creator ${index}`,
    icon_url: null,
    personal_count: 1,
    collab_count: 0,
    total_works: 1,
    sort_score: 3,
  };
}

function createSqliteEnv() {
  const sqlite = new DatabaseSync(":memory:");
  const createTable = ["CREATE", "TABLE"].join(" ");
  sqlite.exec(`
    ${createTable} static_artifacts (
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

  const DB = {
    prepare(sql) {
      return {
        bind(...values) {
          const statement = sqlite.prepare(sql);
          return {
            async first() {
              return statement.get(...values) ?? null;
            },
            async run() {
              const result = statement.run(...values);
              return { meta: { changes: Number(result.changes ?? 0) } };
            },
            async all() {
              return { results: statement.all(...values) };
            },
          };
        },
      };
    },
  };

  const objects = new Map();
  let putCount = 0;
  const R2 = {
    async head(key) {
      return objects.has(key) ? {} : null;
    },
    async put(key, value) {
      putCount += 1;
      objects.set(key, String(value));
      return {};
    },
    async get(key) {
      const value = objects.get(key);
      if (value == null) return null;
      return { json: async () => JSON.parse(value) };
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
  };

  return { DB, R2, sqlite, objects, get putCount() { return putCount; } };
}

test("users index v2 JSON1 tracking SQL runs against SQLite and upserts all artifacts", async () => {
  const env = createSqliteEnv();
  const result = await rebuildUsersIndexV2Artifacts(
    env,
    Array.from({ length: 500 }, (_, index) => source(index)),
    1_700_000_000,
  );

  assert.ok(result.objectCount > 35);
  const count = env.sqlite
    .prepare(
      `SELECT COUNT(*) AS count
       FROM static_artifacts
       WHERE target_type = 'users_index_v2'
         AND target_id = 'global'
         AND deleted_at IS NULL`,
    )
    .get().count;
  assert.equal(Number(count), result.objectCount);
  assert.equal(env.objects.size, result.objectCount);
  env.sqlite.close();
});

test("同一generationでtrackingが揃っている通常rebuildはimmutable R2 PUTをskipする", async () => {
  const env = createSqliteEnv();
  const items = Array.from({ length: 20 }, (_, index) => source(index));
  const first = await rebuildUsersIndexV2Artifacts(env, items, 1_700_000_000);
  const putsAfterFirst = env.putCount;
  const second = await rebuildUsersIndexV2Artifacts(env, items, 1_700_000_000);
  assert.equal(second.skipped, true);
  assert.equal(second.hasMore, false);
  assert.equal(env.putCount, putsAfterFirst);
  assert.equal(second.objectCount, first.objectCount);
  env.sqlite.close();
});

test("同一generationでもR2のページ欠損時はskipせずimmutable artifactをhealする", async () => {
  const env = createSqliteEnv();
  const items = Array.from({ length: 20 }, (_, index) => source(index));
  const first = await rebuildUsersIndexV2Artifacts(env, items, 1_700_000_000);
  const pageKey = first.liveKeys.find((key) => key.includes("/score/1.json"));
  assert.ok(pageKey);
  env.objects.delete(pageKey);
  const putsBeforeRepair = env.putCount;
  const repaired = await rebuildUsersIndexV2Artifacts(env, items, 1_700_000_000);
  assert.equal(repaired.skipped, false);
  assert.ok(env.putCount > putsBeforeRepair);
  assert.ok(env.objects.has(pageKey));
  env.sqlite.close();
});

test("current manifest generation keys are never removed as stale GC", async () => {
  const env = createSqliteEnv();
  const items = Array.from({ length: 20 }, (_, index) => source(index));
  await rebuildUsersIndexV2Artifacts(env, items, 1_700_000_000);
  const manifest = JSON.parse(env.objects.get("users/index.v2/manifest.json"));
  const protectedKey = `users/index.v2/g/${manifest.generation}/score/recovery.json`;
  env.objects.set(protectedKey, "{}");
  env.sqlite
    .prepare(
      `INSERT INTO static_artifacts
        (id, target_type, target_id, object_key, content_hash, schema_version,
         source_updated_at, generated_at, deleted_at)
       VALUES (?, 'users_index_v2', 'global', ?, 'stale', 2, NULL, 1, NULL)`,
    )
    .run("protected-current-generation", protectedKey);

  const result = await rebuildUsersIndexV2Artifacts(env, items, 1_700_000_000);
  assert.equal(result.skipped, true);
  assert.equal(env.objects.has(protectedKey), true);
  const row = env.sqlite
    .prepare(
      `SELECT deleted_at FROM static_artifacts
       WHERE target_type = 'users_index_v2' AND target_id = 'global'
         AND object_key = ?`,
    )
    .get(protectedKey);
  assert.equal(row.deleted_at, null);
  env.sqlite.close();
});

test("users v2 GCは500件超のstale backlogをhasMoreで次回へ継続する", async () => {
  const env = createSqliteEnv();
  const items = Array.from({ length: 20 }, (_, index) => source(index));
  await rebuildUsersIndexV2Artifacts(env, items, 1_700_000_000);
  const insert = env.sqlite.prepare(
    `INSERT INTO static_artifacts
      (id, target_type, target_id, object_key, content_hash, schema_version,
       source_updated_at, generated_at, deleted_at)
     VALUES (?, 'users_index_v2', 'global', ?, 'stale', 2, NULL, 1, NULL)`,
  );
  for (let index = 0; index < 501; index += 1) {
    insert.run(`stale-${index}`, `users/index.v2/old/${index}.json`);
  }
  const first = await rebuildUsersIndexV2Artifacts(env, items, 1_700_000_000);
  assert.equal(first.skipped, true);
  assert.equal(first.hasMore, true);
  const remainingAfterFirst = env.sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM static_artifacts
       WHERE target_type = 'users_index_v2' AND target_id = 'global'
         AND object_key LIKE 'users/index.v2/old/%' AND deleted_at IS NULL`,
    )
    .get().count;
  assert.equal(Number(remainingAfterFirst), 1);
  const second = await rebuildUsersIndexV2Artifacts(env, items, 1_700_000_000);
  assert.equal(second.hasMore, false);
  env.sqlite.close();
});
