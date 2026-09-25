import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  purgeDeletedArtifacts,
  rebuildUsersIndexV2Artifacts,
  reconcileTrackedArtifacts,
} from "./usersIndexV2Artifacts.ts";

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
    CREATE UNIQUE INDEX static_artifacts_live_key_uniq
      ON static_artifacts (object_key) WHERE deleted_at IS NULL;
    CREATE INDEX static_artifacts_target_idx
      ON static_artifacts (target_type, target_id, deleted_at);
    CREATE INDEX static_artifacts_live_cleanup_idx
      ON static_artifacts (target_type, target_id, generated_at, object_key)
      WHERE deleted_at IS NULL;
  `);

  const statements = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...values) {
          statements.push({ sql, values });
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
  const deletes = [];
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
      const normalized = Array.isArray(keys) ? [...keys] : [keys];
      deletes.push(normalized);
      for (const key of normalized) objects.delete(key);
    },
  };

  return { DB, R2, sqlite, objects, statements, deletes, get putCount() { return putCount; } };
}

function explain(env, { sql, values }) {
  return env.sqlite
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...values)
    .map((row) => row.detail)
    .join("\n");
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
  const membershipCount = env.statements.findLast(({ sql }) =>
    /SELECT COUNT\(\*\) AS count/.test(sql) && /object_key IN/.test(sql),
  );
  assert.ok(membershipCount);
  const plan = explain(env, membershipCount);
  assert.match(plan, /LIST SUBQUERY/);
  assert.match(plan, /SCAN json_each/);
  assert.doesNotMatch(plan, /CORRELATED/);
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

test("users v2 cleanup/purgeはmanifest世代とlive keyを保護し、staleだけをboundedに処理する", async () => {
  const env = createSqliteEnv();
  const items = Array.from({ length: 20 }, (_, index) => source(index));
  await rebuildUsersIndexV2Artifacts(env, items, 1_700_000_000);
  const manifest = JSON.parse(env.objects.get("users/index.v2/manifest.json"));
  const generationAKey = `users/index.v2/g/${manifest.generation}/score/recovery.json`;
  const generationBKey = "users/index.v2/g/generation-b/score/1.json";
  const oldKey = "users/index.v2/g/old-generation/score/1.json";
  const insert = env.sqlite.prepare(
    `INSERT INTO static_artifacts
      (id, target_type, target_id, object_key, content_hash, schema_version,
       source_updated_at, generated_at, deleted_at)
     VALUES (?, 'users_index_v2', 'global', ?, 'fixture', 2, NULL, ?, ?)` ,
  );
  insert.run("generation-a", generationAKey, 1, null);
  insert.run("generation-b", generationBKey, 2, null);
  insert.run("old-generation", oldKey, 3, null);
  env.objects.set(generationAKey, "{}");
  env.objects.set(generationBKey, "{}");
  env.objects.set(oldKey, "{}");

  const reconcileStart = env.statements.length;
  const reconcile = await reconcileTrackedArtifacts(env, [generationBKey]);
  assert.deepEqual(reconcile, { deleted: 1, hasMore: false });
  const reconcileStatements = env.statements.slice(reconcileStart);
  const reconcileSelect = reconcileStatements.find(({ sql }) =>
    /SELECT object_key\s+FROM static_artifacts/.test(sql),
  );
  const reconcileUpdate = reconcileStatements.find(({ sql }) =>
    /UPDATE static_artifacts/.test(sql),
  );
  assert.ok(reconcileSelect);
  assert.ok(reconcileUpdate);
  const selectPlan = explain(env, reconcileSelect);
  assert.match(selectPlan, /static_artifacts_live_cleanup_idx/);
  assert.match(selectPlan, /LIST SUBQUERY/);
  assert.match(selectPlan, /SCAN json_each/);
  assert.doesNotMatch(selectPlan, /CORRELATED|USE TEMP B-TREE FOR ORDER BY/);
  const updatePlan = explain(env, reconcileUpdate);
  assert.match(updatePlan, /LIST SUBQUERY/);
  assert.match(updatePlan, /SCAN json_each/);
  assert.doesNotMatch(updatePlan, /CORRELATED/);
  assert.deepEqual(env.deletes, [[oldKey]]);

  const tracked = (key) => env.sqlite.prepare(
    `SELECT deleted_at FROM static_artifacts WHERE object_key = ?`,
  ).get(key);
  assert.equal(tracked(generationAKey).deleted_at, null);
  assert.equal(tracked(generationBKey).deleted_at, null);
  assert.ok(tracked(oldKey).deleted_at !== null);
  assert.equal(env.objects.has(generationAKey), true);
  assert.equal(env.objects.has(generationBKey), true);
  assert.equal(env.objects.has(oldKey), false);
  assert.ok(tracked("users/index.v2/manifest.json"));

  // Purge has its own D1-only physical-delete stage: expired current-generation,
  // live, and manifest rows must remain protected even when marked deleted.
  const expiredGenerationA = `${generationAKey}.expired`;
  const expiredGenerationB = `${generationBKey}.expired`;
  const expiredOld = `${oldKey}.expired`;
  insert.run("expired-a", expiredGenerationA, 1, 1);
  insert.run("expired-b", expiredGenerationB, 2, 1);
  insert.run("expired-old", expiredOld, 3, 1);
  env.sqlite.prepare(
    `UPDATE static_artifacts SET deleted_at = 1 WHERE object_key = ?`,
  ).run("users/index.v2/manifest.json");
  const purgeStart = env.statements.length;
  const purge = await purgeDeletedArtifacts(env, [expiredGenerationB]);
  assert.deepEqual(purge, { deleted: 1, hasMore: false });
  const purgeStatements = env.statements.slice(purgeStart);
  const purgeSelect = purgeStatements.find(({ sql }) =>
    /SELECT object_key\s+FROM static_artifacts/.test(sql),
  );
  const purgeDelete = purgeStatements.find(({ sql }) =>
    /DELETE FROM static_artifacts/.test(sql),
  );
  assert.ok(purgeSelect);
  assert.ok(purgeDelete);
  assert.doesNotMatch(explain(env, purgeSelect), /CORRELATED/);
  assert.doesNotMatch(explain(env, purgeDelete), /CORRELATED/);
  assert.equal(tracked(expiredGenerationA).deleted_at, 1);
  assert.equal(tracked(expiredGenerationB).deleted_at, 1);
  assert.equal(tracked(expiredOld), undefined);
  assert.equal(tracked("users/index.v2/manifest.json").deleted_at, 1);
  env.sqlite.close();
});

test("users v2 manifest read unknown時はreconcile/purgeをfail-safeで停止する", async () => {
  const env = createSqliteEnv();
  const insert = env.sqlite.prepare(
    `INSERT INTO static_artifacts
      (id, target_type, target_id, object_key, content_hash, schema_version,
       source_updated_at, generated_at, deleted_at)
     VALUES (?, 'users_index_v2', 'global', ?, 'fixture', 2, NULL, 1, ?)` ,
  );
  insert.run("live-stale", "users/index.v2/old/live.json", null);
  insert.run("expired-stale", "users/index.v2/old/expired.json", 1);
  env.R2.get = async () => { throw new Error("manifest_unavailable"); };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await reconcileTrackedArtifacts(env, []), { deleted: 0, hasMore: true });
    assert.deepEqual(await purgeDeletedArtifacts(env, []), { deleted: 0, hasMore: true });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(env.statements.length, 0);
  assert.deepEqual(env.deletes, []);
  assert.equal(
    env.sqlite.prepare("SELECT COUNT(*) AS count FROM static_artifacts").get().count,
    2,
  );
  env.sqlite.close();
});
