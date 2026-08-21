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
  const R2 = {
    async head(key) {
      return objects.has(key) ? {} : null;
    },
    async put(key, value) {
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

  return { DB, R2, sqlite, objects };
}

test("users index v2 JSON1 tracking SQL runs against SQLite and upserts all artifacts", async () => {
  const env = createSqliteEnv();
  const result = await rebuildUsersIndexV2Artifacts(
    env,
    Array.from({ length: 500 }, (_, index) => source(index)),
    1_700_000_000,
  );

  assert.equal(result.objectCount, 35);
  const count = env.sqlite
    .prepare(
      `SELECT COUNT(*) AS count
       FROM static_artifacts
       WHERE target_type = 'users_index_v2'
         AND target_id = 'global'
         AND deleted_at IS NULL`,
    )
    .get().count;
  assert.equal(Number(count), 35);
  assert.equal(env.objects.size, 35);
  env.sqlite.close();
});
