import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return {
          url: "data:text/javascript,export%20{}",
          shortCircuit: true,
        };
      }
      if (specifier === "@opennextjs/cloudflare") {
        return {
          url: "data:text/javascript,export%20function%20getCloudflareContext()%20%7B%20throw%20new%20Error(%22no%20context%22)%3B%20%7D",
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  const {
    recordQueueWakeFailureBestEffort,
    resetQueueWakeFailureRecordStateForTests,
  } = await import("./wakeFailureRecord.ts");

  test("同じkind/reasonのKV書き込みを短時間にcoalesceする", async () => {
    resetQueueWakeFailureRecordStateForTests();
    const puts = [];
    const kv = {
      async put(key, value, options) {
        puts.push({ key, value, options });
      },
    };

    await Promise.all([
      recordQueueWakeFailureBestEffort({
        kind: "static_rebuild_available",
        reason: "binding_missing",
        kv,
      }),
      recordQueueWakeFailureBestEffort({
        kind: "static_rebuild_available",
        reason: "binding_missing",
        kv,
      }),
    ]);

    assert.equal(puts.length, 1);
  });

  test("reasonが変わってもKV同一キーの短時間連続書き込みを抑止する", async () => {
    resetQueueWakeFailureRecordStateForTests();
    const puts = [];
    const kv = {
      async put(key, value, options) {
        puts.push({ key, value, options });
      },
    };

    await recordQueueWakeFailureBestEffort({
      kind: "youtube_sync_pending",
      reason: "binding_missing",
      kv,
    });
    await recordQueueWakeFailureBestEffort({
      kind: "youtube_sync_pending",
      reason: "send_failed",
      kv,
    });

    assert.equal(puts.length, 1);
  });
}
