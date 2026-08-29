import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("content cron propagates its deadline signal through queue and cleanup", async () => {
  const content = await read("./index.ts");
  const queue = await read("../json-generator/queue.ts");
  const optimizedRebuild = await read("../json-generator/optimizedRebuild.ts");
  const cleanup = await read("../cleanup/index.ts");
  const sync = await read("../sync-jobs/index.ts");

  assert.match(content, /signal: context\.signal/);
  assert.match(content, /processStaticRebuildQueue\([\s\S]*signal/);
  assert.match(content, /runCleanupWithRetry\(rebuildEnv, cleanupSignal\)/);
  assert.match(queue, /throwIfAborted\(signal/);
  assert.match(
    queue,
    /optimizedRebuildTarget\([\s\S]*row\.target_type[\s\S]*row\.target_id[\s\S]*signal/,
  );
  assert.match(optimizedRebuild, /throwIfAborted\(signal/);
  assert.match(
    optimizedRebuild,
    /rebuildTarget\(\s*(?:env|legacyEnv)\s*,\s*targetType\s*,\s*targetId\s*,\s*signal(?:\s*,\s*reason)?\s*,?\s*\)/,
  );
  assert.match(queue, /markRetryOrFailed\(env, row, token, error, now, metrics\)/);
  assert.match(cleanup, /runCleanup\(env, signal, metrics\)/);
  assert.match(cleanup, /if \(signal\?\.aborted\) throw error/);
  assert.match(sync, /recalcScoreBatch\(env, signal\)/);
});

test("aborted deadline is rejected before score or static rebuild side effects", async () => {
  const { recalcScoreBatch } = await import("../score-recalc/index.ts");
  const { optimizedRebuildTarget } = await import("../json-generator/optimizedRebuild.ts");
  const controller = new AbortController();
  controller.abort(new Error("deadline"));
  let prepareCalls = 0;
  const env = {
    DB: {
      prepare() {
        prepareCalls += 1;
        throw new Error("unexpected D1 call");
      },
    },
    R2: {
      put() {
        throw new Error("unexpected R2 put");
      },
      delete() {
        throw new Error("unexpected R2 delete");
      },
    },
    KV: {
      put() {
        throw new Error("unexpected KV put");
      },
    },
  };

  await assert.rejects(() => recalcScoreBatch(env, controller.signal), /deadline/);
  await assert.rejects(
    () => optimizedRebuildTarget(env, "top", "global", 0, controller.signal),
    /deadline/,
  );
  assert.equal(prepareCalls, 0);
});
