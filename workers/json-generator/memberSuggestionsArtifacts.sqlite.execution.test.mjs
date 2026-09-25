import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { MEMBER_SUGGESTIONS_ARTIFACT_KEYS_MARK_DELETED_SQL } from "./memberSuggestionsArtifacts.ts";

const oldSql = `
  UPDATE static_artifacts
     SET deleted_at = ?
   WHERE target_type = ? AND target_id = ? AND deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM json_each(?) AS removed_keys
        WHERE CAST(removed_keys.value AS TEXT) = static_artifacts.object_key
     )
`;

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE static_artifacts (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      object_key TEXT NOT NULL,
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
    INSERT INTO static_artifacts VALUES
      ('a', 'member_suggestions', 'global', 'members/a.json', 1, NULL),
      ('b', 'member_suggestions', 'global', 'members/b.json', 2, NULL),
      ('c', 'member_suggestions', 'global', 'members/c.json', 3, NULL),
      ('deleted', 'member_suggestions', 'global', 'members/deleted.json', 4, 7),
      ('other-target', 'member_suggestions', 'other', 'members/other.json', 5, NULL),
      ('other-type', 'users_index_v2', 'global', 'users/other.json', 6, NULL);
  `);
  return sqlite;
}

function rows(sqlite) {
  return sqlite.prepare(
    `SELECT object_key, deleted_at FROM static_artifacts ORDER BY object_key`,
  ).all();
}

test("member suggestionsの非相関membership UPDATEは旧結果を保ちNULL・空・重複keyを安全に扱う", () => {
  const oldPlanDb = createDb();
  const newPlanDb = createDb();
  const values = [1_700_000_000, "member_suggestions", "global", JSON.stringify(["members/a.json"])];
  const oldPlan = oldPlanDb
    .prepare(`EXPLAIN QUERY PLAN ${oldSql}`)
    .all(...values)
    .map((row) => row.detail)
    .join("\n");
  const newPlan = newPlanDb
    .prepare(`EXPLAIN QUERY PLAN ${MEMBER_SUGGESTIONS_ARTIFACT_KEYS_MARK_DELETED_SQL}`)
    .all(...values)
    .map((row) => row.detail)
    .join("\n");
  assert.match(oldPlan, /CORRELATED SCALAR SUBQUERY/);
  assert.match(newPlan, /LIST SUBQUERY/);
  assert.match(newPlan, /SCAN json_each/);
  assert.doesNotMatch(newPlan, /CORRELATED/);
  oldPlanDb.close();
  newPlanDb.close();

  const cases = [
    ["empty", []],
    ["one", ["members/a.json"]],
    ["duplicate", ["members/a.json", "members/a.json", "members/b.json"]],
    ["null filtered", [null, "members/a.json"]],
  ];
  for (const [name, keys] of cases) {
    const legacy = createDb();
    const optimized = createDb();
    const bindings = [1_700_000_000, "member_suggestions", "global", JSON.stringify(keys)];
    legacy.prepare(oldSql).run(...bindings);
    optimized.prepare(MEMBER_SUGGESTIONS_ARTIFACT_KEYS_MARK_DELETED_SQL).run(...bindings);
    assert.deepEqual(rows(optimized), rows(legacy), name);
    assert.equal(
      optimized.prepare("SELECT deleted_at FROM static_artifacts WHERE id = 'other-target'").get().deleted_at,
      null,
      `${name}:別targetは更新しない`,
    );
    assert.equal(
      optimized.prepare("SELECT deleted_at FROM static_artifacts WHERE id = 'deleted'").get().deleted_at,
      7,
      `${name}:既にdeletedの行は維持`,
    );
    legacy.close();
    optimized.close();
  }
});
