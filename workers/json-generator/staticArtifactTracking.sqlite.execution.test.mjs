import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { recordStaticArtifacts } from "./staticArtifactTracking.ts";

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
