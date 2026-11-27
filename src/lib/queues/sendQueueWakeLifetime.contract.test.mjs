import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("../../../packages/server-core/src/queues/sendQueueWakeBestEffort.ts", import.meta.url),
  "utf8",
);

test("binding missing telemetryはwaitUntilまたはawaitへ必ず接続する", () => {
  assert.match(source, /async function persistFailureWithinWorkerLifetime/);
  assert.match(source, /const waitUntil = resolveWaitUntil\(options\.waitUntil, host\)/);
  assert.match(source, /waitUntil\(promise\)/);
  assert.match(source, /await promise/);
  assert.match(
    source,
    /await persistFailureWithinWorkerLifetime\(options, "binding_missing", host\)/,
  );
});

test("Queue send失敗telemetryをfloating Promiseとして捨てない", () => {
  assert.doesNotMatch(source, /void recordQueueWakeFailureBestEffort/);
  // The rejection handler must await its diagnostic write, but must not
  // depend on the name or existence of a thrown provider Error object.
  assert.match(
    source,
    /async \(\) => \{[\s\S]*?await recordQueueWakeFailureBestEffort/,
  );
  assert.doesNotMatch(source, /error_name:\s*error\s+instanceof\s+Error/);
  assert.match(source, /waitUntil\(trackedPromise\)/);
});
