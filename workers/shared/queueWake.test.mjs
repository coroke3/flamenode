import assert from "node:assert/strict";
import { test } from "node:test";
import { sendWorkerQueueWakeBestEffort } from "./queueWake.ts";

const enabledFlags = {
  QUEUE_DISPATCH_ENABLED: "1",
  QUEUE_CONTINUATION_ENABLED: "1",
};

test("static rebuild continuation は指定されたdelaySecondsでbackpressureする", async () => {
  let sent = null;
  const queued = await sendWorkerQueueWakeBestEffort({
    queue: {
      async send(body, options) {
        sent = { body, options };
      },
    },
    kind: "static_rebuild_available",
    source: "continuation",
    delaySeconds: 30,
    envFlags: enabledFlags,
  });

  assert.equal(queued, true);
  assert.equal(sent.body.kind, "static_rebuild_available");
  assert.deepEqual(sent.options, { delaySeconds: 30 });
});

test("invalid Queue delayはwakeを送らずfail-closedする", async () => {
  let sendCount = 0;
  const queued = await sendWorkerQueueWakeBestEffort({
    queue: {
      async send() {
        sendCount += 1;
      },
    },
    kind: "static_rebuild_available",
    source: "continuation",
    delaySeconds: 86_401,
    envFlags: enabledFlags,
  });

  assert.equal(queued, false);
  assert.equal(sendCount, 0);
});
