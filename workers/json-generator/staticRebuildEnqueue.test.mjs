import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  enqueueStaticRebuildTargets,
  globalTargets,
} from "./staticRebuildEnqueue.ts";

const BASELINE = readFileSync(
  new URL("../../migrations/0000_flame_node_baseline.sql", import.meta.url),
  "utf8",
);

function createHarness(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(BASELINE);
  t.after(() => sqlite.close());
  let prepared = 0;
  const DB = {
    prepare(sql) {
      prepared += 1;
      return {
        bind(...values) {
          return {
            async run() {
              const result = sqlite.prepare(sql).run(...values);
              return { meta: { changes: Number(result.changes) } };
            },
          };
        },
      };
    },
  };
  return {
    sqlite,
    env: { DB },
    prepared: () => prepared,
    insertRow({ id, targetType, targetId = "global", priority, status, updatedAt = 100 }) {
      sqlite
        .prepare(
          `INSERT INTO static_rebuild_queue (
             id, target_type, target_id, reason, priority, status,
             attempt_count, created_at, updated_at
           ) VALUES (?, ?, ?, 'prior', ?, ?, 0, 100, ?)`,
        )
        .run(id, targetType, targetId, priority, status, updatedAt);
    },
    rows() {
      return sqlite
        .prepare(
          `SELECT id, target_type, target_id, reason, priority, status, updated_at
           FROM static_rebuild_queue ORDER BY target_type, target_id, id`,
        )
        .all()
        .map((row) => ({ ...row }));
    },
  };
}

test("対象0件は D1 を呼ばず 0", async (t) => {
  const harness = createHarness(t);
  assert.equal(await enqueueStaticRebuildTargets(harness.env, [], "r", "high"), 0);
  assert.equal(harness.prepared(), 0);
});

test("active 行がなければ pending で INSERT し、changes は対象数", async (t) => {
  const harness = createHarness(t);
  const changes = await enqueueStaticRebuildTargets(
    harness.env,
    [...globalTargets(["top", "recommend"]), { targetType: "video", targetId: "v1" }],
    "follow_up",
    "low",
  );
  assert.equal(changes, 3);
  assert.equal(harness.prepared(), 1);
  const rows = harness.rows();
  assert.deepEqual(
    rows.map(({ target_type, target_id, reason, priority, status }) => ({
      target_type, target_id, reason, priority, status,
    })),
    [
      { target_type: "recommend", target_id: "global", reason: "follow_up", priority: "low", status: "pending" },
      { target_type: "top", target_id: "global", reason: "follow_up", priority: "low", status: "pending" },
      { target_type: "video", target_id: "v1", reason: "follow_up", priority: "low", status: "pending" },
    ],
  );
  for (const row of rows) assert.match(row.id, new RegExp(`^srb:${row.target_type}:`));
});

test("pending/processing 行は状態を保ったまま reason・高い方の priority・updated_at を更新する", async (t) => {
  const harness = createHarness(t);
  const cases = [
    ["a", "low", "processing", "normal", "normal"],
    ["b", "high", "pending", "low", "high"],
    ["c", "normal", "pending", "low", "normal"],
    ["d", "low", "pending", "low", "low"],
    ["e", "normal", "processing", "high", "high"],
  ];
  for (const [targetType, priority, status] of cases) {
    harness.insertRow({ id: `existing:${targetType}`, targetType, priority, status, updatedAt: 4_000_000_000 });
  }
  for (const [targetType, , , incoming] of cases) {
    assert.equal(
      await enqueueStaticRebuildTargets(harness.env, globalTargets([targetType]), "next", incoming),
      1,
    );
  }
  const rows = harness.rows();
  assert.equal(rows.length, cases.length);
  for (const [targetType, , status, , expected] of cases) {
    const row = rows.find((candidate) => candidate.target_type === targetType);
    assert.equal(row.id, `existing:${targetType}`);
    assert.equal(row.status, status);
    assert.equal(row.reason, "next");
    assert.equal(row.priority, expected, targetType);
    // 未来時刻の updated_at でも単調増加させ、processing 中の再要求を検知できるようにする。
    assert.equal(row.updated_at, 4_000_000_001);
  }
});

test("done/failed 履歴は再要求を抑止せず新しい pending 行を作る", async (t) => {
  const harness = createHarness(t);
  harness.insertRow({ id: "old:done", targetType: "top", priority: "high", status: "done" });
  harness.insertRow({ id: "old:failed", targetType: "recommend", priority: "high", status: "failed" });
  assert.equal(
    await enqueueStaticRebuildTargets(harness.env, globalTargets(["top", "recommend"]), "again", "normal"),
    2,
  );
  const pending = harness.rows().filter((row) => row.status === "pending");
  assert.deepEqual(pending.map((row) => row.target_type), ["recommend", "top"]);
  assert.ok(pending.every((row) => row.priority === "normal" && row.reason === "again"));
});

test("AbortSignal は D1 呼び出し前に止める", async (t) => {
  const harness = createHarness(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => enqueueStaticRebuildTargets(harness.env, globalTargets(["top"]), "r", "high", controller.signal),
    /abort/i,
  );
  assert.equal(harness.prepared(), 0);
});
