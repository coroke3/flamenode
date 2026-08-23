import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./sendQueueWakeBestEffort.ts", import.meta.url),
  "utf8",
);

test("binding missing telemetryはwaitUntilまたはawaitへ必ず接続する", () => {
  assert.match(source, /async function persistFailureWithinWorkerLifetime/);
  assert.match(source, /const waitUntil = resolveWaitUntil\(options\.waitUntil\)/);
  assert.match(source, /waitUntil\(promise\)/);
  assert.match(source, /await promise/);
  assert.match(
    source,
    /await persistFailureWithinWorkerLifetime\(options, "binding_missing"\)/,
  );
});

test("Queue send失敗telemetryをfloating Promiseとして捨てない", () => {
  assert.doesNotMatch(source, /void recordQueueWakeFailureBestEffort/);
  assert.match(
    source,
    /async \(error: unknown\) => \{[\s\S]*?await recordQueueWakeFailureBestEffort/,
  );
  assert.match(source, /waitUntil\(trackedPromise\)/);
});
