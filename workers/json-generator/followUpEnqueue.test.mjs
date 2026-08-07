import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { enqueueComposerFollowUps, enqueueTopRecommendAfterUsersIndex } from "./followUpEnqueue.ts";

const FOLLOW_UP_REASON = "users_index_follow_up";
const BASELINE = readFileSync(
  new URL("../../migrations/0000_flame_node_baseline.sql", import.meta.url),
  "utf8",
);

function d1FromSqlite(sqlite) {
  return {
    prepare(sql) {
      let params = [];
      const statement = {
        bind(...values) {
          params = values;
          return statement;
        },
        async run() {
          const result = sqlite.prepare(sql).run(...params);
          return { meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
  };
}

function createHarness(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(BASELINE);
  t.after(() => sqlite.close());

  const env = { DB: d1FromSqlite(sqlite) };

  return {
    sqlite,
    env,
    insertRow(row) {
      sqlite
        .prepare(
          `INSERT INTO static_rebuild_queue (
             id, target_type, target_id, reason, priority, status,
             attempt_count, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(
          row.id,
          row.targetType,
          row.targetId ?? "global",
          row.reason ?? "prior_reason",
          row.priority ?? "normal",
          row.status,
          row.createdAt ?? 100,
          row.updatedAt ?? 100,
        );
    },
    readActiveRows() {
      return sqlite
        .prepare(
          `SELECT id, target_type, target_id, reason, status, updated_at
           FROM static_rebuild_queue
           WHERE target_type IN ('top', 'recommend')
             AND target_id = 'global'
             AND status IN ('pending', 'processing')
           ORDER BY target_type`,
        )
        .all();
    },
    countRows() {
      return sqlite
        .prepare("SELECT COUNT(*) AS count FROM static_rebuild_queue")
        .get().count;
    },
  };
}

function createNoChangeEnv() {
  return {
    DB: {
      prepare() {
        const statement = {
          bind() {
            return statement;
          },
          async run() {
            return { meta: { changes: 0 } };
          },
        };
        return statement;
      },
    },
  };
}

test("enqueueComposerFollowUps(users_index) は top/recommend 欠損時に INSERT する", async (t) => {
  const harness = createHarness(t);

  const changed = await enqueueComposerFollowUps(harness.env, "users_index");

  assert.equal(changed, true);
  assert.equal(harness.countRows(), 2);

  const rows = harness.readActiveRows();
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.target_type),
    ["recommend", "top"],
  );
  for (const row of rows) {
    assert.equal(row.target_id, "global");
    assert.equal(row.reason, FOLLOW_UP_REASON);
    assert.equal(row.status, "pending");
    assert.match(row.id, /^srb:(top|recommend):/);
  }
});

test("enqueueComposerFollowUps は未知 producer で false", async () => {
  const changed = await enqueueComposerFollowUps(createNoChangeEnv(), "unknown_producer");
  assert.equal(changed, false);
});

test("enqueueTopRecommendAfterUsersIndex は top/recommend 欠損時に INSERT する", async (t) => {
  const harness = createHarness(t);

  const changed = await enqueueTopRecommendAfterUsersIndex(harness.env);

  assert.equal(changed, true);
  assert.equal(harness.countRows(), 2);

  const rows = harness.readActiveRows();
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.target_type),
    ["recommend", "top"],
  );
  for (const row of rows) {
    assert.equal(row.target_id, "global");
    assert.equal(row.reason, FOLLOW_UP_REASON);
    assert.equal(row.status, "pending");
    assert.match(row.id, /^srb:(top|recommend):/);
  }
});

test("enqueueTopRecommendAfterUsersIndex は pending/processing 既存時に UPDATE し INSERT しない", async (t) => {
  const harness = createHarness(t);
  harness.insertRow({
    id: "srb:top:existing",
    targetType: "top",
    status: "pending",
    reason: "deploy_generator_change",
    updatedAt: 100,
  });
  harness.insertRow({
    id: "srb:recommend:existing",
    targetType: "recommend",
    status: "processing",
    reason: "deploy_generator_change",
    updatedAt: 200,
  });

  const changed = await enqueueTopRecommendAfterUsersIndex(harness.env);

  assert.equal(changed, true);
  assert.equal(harness.countRows(), 2);

  const rows = harness.readActiveRows();
  assert.deepEqual(
    rows.map((row) => ({
      id: row.id,
      target_type: row.target_type,
      reason: row.reason,
      status: row.status,
    })),
    [
      {
        id: "srb:recommend:existing",
        target_type: "recommend",
        reason: FOLLOW_UP_REASON,
        status: "processing",
      },
      {
        id: "srb:top:existing",
        target_type: "top",
        reason: FOLLOW_UP_REASON,
        status: "pending",
      },
    ],
  );
  const topRow = rows.find((row) => row.target_type === "top");
  const recommendRow = rows.find((row) => row.target_type === "recommend");
  assert.ok(topRow.updated_at > 100);
  assert.ok(recommendRow.updated_at > 200);
});

test("enqueueTopRecommendAfterUsersIndex の戻り値は変更がないとき false", async () => {
  const changed = await enqueueTopRecommendAfterUsersIndex(createNoChangeEnv());
  assert.equal(changed, false);
});

test("enqueueTopRecommendAfterUsersIndex の戻り値は INSERT/UPDATE 時 true", async (t) => {
  const harness = createHarness(t);

  assert.equal(await enqueueTopRecommendAfterUsersIndex(harness.env), true);
  assert.equal(await enqueueTopRecommendAfterUsersIndex(harness.env), true);
});
