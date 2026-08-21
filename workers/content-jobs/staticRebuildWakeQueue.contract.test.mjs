import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const consumerSource = await readFile(
  new URL("./staticRebuildWakeQueue.ts", import.meta.url),
  "utf8",
);
const recoverySource = await readFile(
  new URL("./index.ts", import.meta.url),
  "utf8",
);

test("queue consumer は通常wakeごとの stale reconcile を省略する", () => {
  assert.match(
    consumerSource,
    /processStaticRebuildQueue\([\s\S]*staleQueueAlreadyReconciled: true/,
  );
  assert.doesNotMatch(consumerSource, /reconcileStaleQueue\(/);
});

test("stale queue recovery はRecovery Cronに残す", () => {
  assert.match(recoverySource, /await reconcileStaleQueue\(rebuildEnv, now, signal\)/);
  assert.match(
    recoverySource,
    /processStaticRebuildQueue\([\s\S]*staleQueueAlreadyReconciled: true/,
  );
});
