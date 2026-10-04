import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  reconcileStaticArtifacts,
  recordStaticArtifacts,
} from "./staticArtifactTracking.ts";

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
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
  const statements = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              statements.push(sql);
              sqlite.prepare(sql).run(...values);
              return { meta: {} };
            },
            async all() {
              statements.push(sql);
              return { results: sqlite.prepare(sql).all(...values) };
            },
          };
        },
      };
    },
  };
  return { sqlite, DB, statements };
}

test("recordStaticArtifacts は 500 件ごとに1文で upsert し、削除済み行を live に戻す", async () => {
  const { sqlite, DB, statements } = createDb();
  sqlite
    .prepare(
      `INSERT INTO static_artifacts VALUES
       ('legacy-id', 'video', 'v1', 'k-0', 'old', 1, NULL, 1, 99)`,
    )
    .run();
  const cache = new Map();
  const artifacts = Array.from({ length: 501 }, (_, index) => ({
    objectKey: `k-${index}`,
    contentHash: `h-${index}`,
  }));

  await recordStaticArtifacts(
    { DB, artifactHashCache: cache },
    { targetType: "video", targetId: "v1", schemaVersion: 3, sourceUpdatedAt: 7, generatedAt: 42 },
    artifacts,
  );

  assert.equal(statements.length, 2);
  const rows = sqlite
    .prepare(`SELECT * FROM static_artifacts ORDER BY object_key`)
    .all();
  assert.equal(rows.length, 501);
  const first = rows.find((row) => row.object_key === "k-0");
  assert.equal(first.id, "legacy-id");
  assert.equal(first.content_hash, "h-0");
  assert.equal(first.deleted_at, null);
  const inserted = rows.find((row) => row.object_key === "k-500");
  assert.deepEqual(
    { ...inserted },
    {
      id: "sta:video:v1:k-500",
      target_type: "video",
      target_id: "v1",
      object_key: "k-500",
      content_hash: "h-500",
      schema_version: 3,
      source_updated_at: 7,
      generated_at: 42,
      deleted_at: null,
    },
  );
  assert.equal(cache.get("k-500"), "h-500");
  sqlite.close();
});

test("reconcileStaticArtifacts は live key を SQL で除き、古い順に limit 件だけ消す", async () => {
  const { sqlite, DB, statements } = createDb();
  const insert = sqlite.prepare(
    `INSERT INTO static_artifacts VALUES (?, ?, 'g', ?, 'h', 1, NULL, ?, ?)`,
  );
  // live key が最も古くても、stale の削除枠を食わない。
  insert.run("a", "member_suggestions", "live-old", 1, null);
  insert.run("b", "member_suggestions", "stale-1", 2, null);
  insert.run("c", "member_suggestions", "stale-2", 3, null);
  insert.run("d", "member_suggestions", "stale-3", 4, null);
  insert.run("e", "member_suggestions", "already-deleted", 0, 5);
  insert.run("f", "other", "stale-other", 0, null);
  const deletedFromR2 = [];
  const cache = new Map();

  await reconcileStaticArtifacts(
    {
      DB,
      R2: { delete: async (keys) => deletedFromR2.push(...keys) },
      artifactHashCache: cache,
    },
    { targetType: "member_suggestions", targetId: "g" },
    ["live-old"],
    2,
  );

  assert.deepEqual(deletedFromR2, ["stale-1", "stale-2"]);
  assert.equal(statements.length, 2);
  const live = sqlite
    .prepare(
      `SELECT object_key FROM static_artifacts
        WHERE deleted_at IS NULL ORDER BY object_key`,
    )
    .all()
    .map((row) => row.object_key);
  assert.deepEqual(live, ["live-old", "stale-3", "stale-other"]);
  assert.equal(cache.get("stale-1"), null);
  sqlite.close();
});
