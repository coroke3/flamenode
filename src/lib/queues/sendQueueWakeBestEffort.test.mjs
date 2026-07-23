import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";
import { createQueueWakeMessage } from "./wakeMessage.ts";

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
    resetQueueWakeWarningStateForTests,
    sendQueueWakeBestEffort,
  } = await import("./sendQueueWakeBestEffort.ts");
  const { queueWakeLastFailureKvKey } = await import("./wakeFailureRecordCore.ts");

  const enabledFlags = {
    QUEUE_DISPATCH_ENABLED: "1",
    QUEUE_YOUTUBE_SYNC_ENABLED: "1",
  };

  test("dispatch_disabled では送信しない", async () => {
    let sendCalls = 0;
    const result = await sendQueueWakeBestEffort({
      kind: "notification_available",
      source: "web",
      queue: {
        async send() {
          sendCalls += 1;
        },
      },
      envFlags: { QUEUE_DISPATCH_ENABLED: "0" },
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, "dispatch_disabled");
    assert.equal(sendCalls, 0);
  });

  test("binding_missing では送信せず last-failure を記録する", async () => {
    resetQueueWakeWarningStateForTests();
    const puts = [];
    const result = await sendQueueWakeBestEffort({
      kind: "static_rebuild_available",
      source: "web",
      queue: null,
      envFlags: enabledFlags,
      kv: {
        async put(key, value, options) {
          puts.push({ key, value, options });
        },
      },
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, "binding_missing");
    assert.equal(puts.length, 1);
    assert.equal(puts[0].key, queueWakeLastFailureKvKey("static_rebuild_available"));
    const payload = JSON.parse(puts[0].value);
    assert.equal(payload.reason, "binding_missing");
    assert.equal(typeof payload.at, "number");
  });

  test("sentKinds を共有すると同一 kind は重複送信しない", async () => {
    let sendCalls = 0;
    const sentKinds = new Set();
    const queue = {
      async send() {
        sendCalls += 1;
      },
    };

    const first = await sendQueueWakeBestEffort({
      kind: "notification_available",
      source: "web",
      queue,
      envFlags: enabledFlags,
      sentKinds,
    });
    const duplicate = await sendQueueWakeBestEffort({
      kind: "notification_available",
      source: "web",
      queue,
      envFlags: enabledFlags,
      sentKinds,
    });

    assert.equal(first.sent, true);
    assert.equal(duplicate.sent, false);
    assert.equal(duplicate.reason, "duplicate_kind_in_scope");
    assert.equal(sendCalls, 1);
  });

  test("send 失敗でも throw しない", async () => {
    resetQueueWakeWarningStateForTests();
    const puts = [];
    const result = await sendQueueWakeBestEffort({
      kind: "youtube_sync_pending",
      source: "web",
      requireYoutubeFlag: true,
      queue: {
        async send() {
          throw new Error("queue unavailable");
        },
      },
      envFlags: enabledFlags,
      kv: {
        async put(key, value) {
          puts.push({ key, value });
        },
      },
    });
    assert.equal(result.sent, true);
    assert.equal(puts.length, 1);
    assert.equal(JSON.parse(puts[0].value).reason, "send_failed");
  });

  test("wake message は業務フィールドを含まない", () => {
    const message = createQueueWakeMessage({
      kind: "notification_available",
      source: "web",
      requestedAt: 1,
      traceId: "trace",
    });
    assert.deepEqual(Object.keys(message).sort(), [
      "kind",
      "requested_at",
      "source",
      "trace_id",
      "version",
    ]);
  });
}
