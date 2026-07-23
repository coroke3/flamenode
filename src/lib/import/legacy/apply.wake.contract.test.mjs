import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const apply = await readFile(new URL("./apply.ts", import.meta.url), "utf8");
const enqueue = await readFile(
  new URL("../../staticRebuild/enqueue.ts", import.meta.url),
  "utf8",
);

test("legacy import apply は step ごとに static rebuild wake を最大1件", () => {
  assert.match(apply, /staticRebuildWakeSource:\s*"import"/g);
  assert.equal(
    (apply.match(/staticRebuildWakeSource:\s*"import"/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(apply, /wakeStaticRebuildQueueAfterCommit[\s\S]*for\s*\(/);
  assert.doesNotMatch(apply, /sendQueueWakeBestEffort/);
});

test("enqueue many は sentKinds を共有して wake を dedupe する", () => {
  assert.match(enqueue, /const sentKinds = options\?\.sentKinds \?\? new Set/);
  assert.match(enqueue, /enqueueStaticRebuild\(db, item, \{ \.\.\.options, sentKinds \}\)/);
  assert.match(enqueue, /wakeAfterSuccessfulEnqueue/);
});
