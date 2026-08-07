import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runningWithTsx = process.env.FLAMENODE_BATCH_COUNT_EXECUTION === "1";

if (!runningWithTsx) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", fileURLToPath(import.meta.url)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_BATCH_COUNT_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  const {
    computeCountModeSlotBatchCount,
    computeTimeModeSlotBatchCount,
  } = await import("./batchGenerateCount.ts");

  test("time mode: 0 slots when end <= start", () => {
    const result = computeTimeModeSlotBatchCount(1000, 1000, 1);
    assert.equal(result.ok, false);
    assert.match(result.message, /開始・終了/);
  });

  test("time mode: 1 slot for minimal valid range", () => {
    const result = computeTimeModeSlotBatchCount(0, 60, 1);
    assert.deepEqual(result, { ok: true, count: 1 });
  });

  test("time mode: 100 slots at limit", () => {
    const start = 0;
    const intervalMin = 1;
    const end = start + intervalMin * 60 * 100;
    const result = computeTimeModeSlotBatchCount(start, end, intervalMin);
    assert.deepEqual(result, { ok: true, count: 100 });
  });

  test("time mode: 101 slots rejected without allocating rows", () => {
    const start = 0;
    const intervalMin = 1;
    const end = start + intervalMin * 60 * 101;
    const result = computeTimeModeSlotBatchCount(start, end, intervalMin);
    assert.equal(result.ok, false);
    assert.match(result.message, /100/);
  });

  test("time mode: extreme long range with 1min interval rejects over limit", () => {
    const result = computeTimeModeSlotBatchCount(0, 10_000_000, 1);
    assert.equal(result.ok, false);
    assert.match(result.message, /100/);
  });

  test("time mode: bad interval rejected", () => {
    assert.equal(computeTimeModeSlotBatchCount(0, 3600, 0).ok, false);
    assert.equal(computeTimeModeSlotBatchCount(0, 3600, 1.5).ok, false);
  });

  test("count mode: 0 and negatives rejected", () => {
    assert.equal(computeCountModeSlotBatchCount(0).ok, false);
    assert.equal(computeCountModeSlotBatchCount(-1).ok, false);
  });

  test("count mode: 1 and 100 accepted", () => {
    assert.deepEqual(computeCountModeSlotBatchCount(1), { ok: true, count: 1 });
    assert.deepEqual(computeCountModeSlotBatchCount(100), { ok: true, count: 100 });
  });

  test("count mode: 101 rejected", () => {
    const result = computeCountModeSlotBatchCount(101);
    assert.equal(result.ok, false);
    assert.match(result.message, /100/);
  });
}
