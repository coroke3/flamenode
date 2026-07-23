import assert from "node:assert/strict";
import { test } from "node:test";
import { handleStaticRebuildWakeQueue } from "./staticRebuildWakeQueue.ts";

function makeMessage(body) {
  return {
    body,
    ackCalls: 0,
    retryCalls: 0,
    ack() {
      this.ackCalls += 1;
    },
    retry() {
      this.retryCalls += 1;
    },
  };
}

function makeBatch(messages) {
  return { messages };
}

function wakeMessage(source = "web", traceId = "trace-1") {
  return {
    version: 1,
    kind: "static_rebuild_available",
    source,
    requested_at: 1,
    trace_id: traceId,
  };
}

test("consumer: duplicate wake batch は1回だけ drain して全件 ack する", async () => {
  let drainCalls = 0;
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          async first() {
            if (sql.includes("operation_mode")) {
              return { operation_mode: "normal" };
            }
            return null;
          },
          async run() {
            return { meta: { changes: 0 } };
          },
          async all() {
            if (sql.includes("FROM static_rebuild_queue")) {
              drainCalls += 1;
              return { results: [] };
            }
            return { results: [] };
          },
        };
      },
    },
    R2: { get: async () => null, put: async () => undefined },
    KV: {},
    QUEUE_DISPATCH_ENABLED: "1",
    QUEUE_CONTINUATION_ENABLED: "0",
  };

  const messages = [
    makeMessage(wakeMessage("web", "a")),
    makeMessage(wakeMessage("web", "b")),
    makeMessage(wakeMessage("web", "c")),
  ];

  await handleStaticRebuildWakeQueue(makeBatch(messages), env);
  assert.equal(drainCalls, 1);
  assert.equal(messages.every((message) => message.ackCalls === 1), true);
  assert.equal(messages.every((message) => message.retryCalls === 0), true);
});

test("consumer: hasMore のとき continuation wake を1件送る", async () => {
  let continuationSent = false;
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          async first() {
            if (sql.includes("operation_mode")) {
              return { operation_mode: "normal" };
            }
            return null;
          },
          async run() {
            if (sql.includes("SET status = 'processing'")) {
              return { meta: { changes: 1 } };
            }
            if (sql.includes("processed_at = CASE")) {
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          },
          async all() {
            if (sql.includes("FROM static_rebuild_queue")) {
              return {
                results: [
                  {
                    id: "srb-1",
                    target_type: "top",
                    target_id: "global",
                    priority: "normal",
                    attempt_count: 0,
                  },
                  {
                    id: "srb-2",
                    target_type: "event",
                    target_id: "evt-1",
                    priority: "normal",
                    attempt_count: 0,
                  },
                ],
              };
            }
            return { results: [] };
          },
        };
      },
    },
    R2: {
      get: async () => null,
      put: async () => undefined,
    },
    KV: {},
    STATIC_REBUILD_WAKE_QUEUE: {
      async send(body) {
        if (body.source === "continuation") continuationSent = true;
      },
    },
    QUEUE_DISPATCH_ENABLED: "1",
    QUEUE_CONTINUATION_ENABLED: "1",
  };

  const message = makeMessage(wakeMessage());
  await handleStaticRebuildWakeQueue(makeBatch([message]), env);
  assert.equal(continuationSent, true);
  assert.equal(message.ackCalls, 1);
});
