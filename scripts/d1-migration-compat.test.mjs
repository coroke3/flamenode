import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  D1_COMPAT_MIGRATION_NAME,
  D1_COMPAT_PRESERVED_TABLES,
  buildD1CompatibleMigration,
} from "./d1-migration-compat.mjs";

const root = process.cwd();
const source = fs.readFileSync(
  path.join(root, "migrations", D1_COMPAT_MIGRATION_NAME),
  "utf8",
);

test("0045 source remains immutable and compatibility is materialized out-of-tree", () => {
  assert.doesNotMatch(source, /D1_0045_COMPAT_PRESERVE_BEGIN/);
  const compatible = buildD1CompatibleMigration(D1_COMPAT_MIGRATION_NAME, source);
  assert.match(compatible, /D1_0045_COMPAT_PRESERVE_BEGIN/);
  assert.match(compatible, /UPDATE "videos"[\s\S]*"primary_event_id"/);
  for (const tableName of D1_COMPAT_PRESERVED_TABLES) {
    assert.match(
      compatible,
      new RegExp(`CREATE TABLE "_migration_0045_preserve_${tableName}"`),
    );
    assert.match(
      compatible,
      new RegExp(`INSERT INTO "${tableName}" SELECT \\* FROM`),
    );
  }
});

test("unrelated migrations are byte-for-byte unchanged", () => {
  assert.equal(
    buildD1CompatibleMigration("0046_video_creator_profile_snapshot.sql", "SELECT 1;"),
    "SELECT 1;",
  );
});
