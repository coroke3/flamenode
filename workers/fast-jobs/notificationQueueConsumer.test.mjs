import assert from "node:assert/strict";
import { test } from "node:test";
import { handleNotificationWakeQueue } from "./notificationQueueConsumer.ts";

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

test("consumer: duplicate wake を1回の drain にまとめる", async () => {
  let drainCalls = 0;
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          async run() {
            return { meta: { changes: 0 } };
          },
          async all() {
            if (sql.includes("LIMIT 1") && sql.includes("INNER JOIN")) {
              return { results: [] };
            }
            if (sql.includes("recipient_user_not_found")) {
              return { meta: { changes: 0 } };
            }
            drainCalls += 1;
            return { results: [] };
          },
        };
      },
    },
    QUEUE_DISPATCH_ENABLED: "1",
    QUEUE_CONTINUATION_ENABLED: "0",
  };

  const messages = [
    makeMessage({
      version: 1,
      kind: "notification_available",
      source: "web",
      requested_at: 1,
      trace_id: "a",
    }),
    makeMessage({
      version: 1,
      kind: "notification_available",
      source: "web",
      requested_at: 2,
      trace_id: "b",
    }),
  ];

  await handleNotificationWakeQueue(makeBatch(messages), env);
  assert.equal(drainCalls, 1);
  assert.equal(messages.every((message) => message.ackCalls === 1), true);
  assert.equal(messages.every((message) => message.retryCalls === 0), true);
});

test("consumer: due pending が残ると continuation wake を送る", async () => {
  let continuationSent = false;
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          async run() {
            return { meta: { changes: 0 } };
          },
          async all() {
            if (sql.includes("LIMIT 1") && sql.includes("INNER JOIN")) {
              return { results: [{ id: "pending-1" }] };
            }
            return { results: [] };
          },
        };
      },
    },
    NOTIFICATION_WAKE_QUEUE: {
      async send(body) {
        if (body.source === "continuation") continuationSent = true;
      },
    },
    QUEUE_DISPATCH_ENABLED: "1",
    QUEUE_CONTINUATION_ENABLED: "1",
  };

  const message = makeMessage({
    version: 1,
    kind: "notification_available",
    source: "web",
    requested_at: 1,
    trace_id: "trace",
  });
  await handleNotificationWakeQueue(makeBatch([message]), env);
  assert.equal(continuationSent, true);
  assert.equal(message.ackCalls, 1);
});

test("consumer: D1障害時は batch を retry する", async () => {
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async run() {
            throw new Error("SQLITE_BUSY: database is locked");
          },
          async all() {
            throw new Error("SQLITE_BUSY: database is locked");
          },
        };
      },
    },
    QUEUE_DISPATCH_ENABLED: "1",
  };
  const message = makeMessage({
    version: 1,
    kind: "notification_available",
    source: "web",
    requested_at: 1,
    trace_id: "trace",
  });

  await handleNotificationWakeQueue(makeBatch([message]), env);
  assert.equal(message.retryCalls, 1);
  assert.equal(message.ackCalls, 0);
});

test("consumer: 非一時的障害でも wake を ack せず retry する", async () => {
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async all() {
            throw new Error("no such table: notification_outbox");
          },
          async run() {
            throw new Error("no such table: notification_outbox");
          },
        };
      },
    },
    QUEUE_DISPATCH_ENABLED: "1",
  };
  const message = makeMessage({
    version: 1,
    kind: "notification_available",
    source: "web",
    requested_at: 1,
    trace_id: "trace",
  });

  await handleNotificationWakeQueue(makeBatch([message]), env);
  assert.equal(message.retryCalls, 1);
  assert.equal(message.ackCalls, 0);
});

test("consumer: 不正 wake は ack して破棄する", async () => {
  let drainCalls = 0;
  const env = {
    DB: {
      prepare() {
        drainCalls += 1;
        return {
          bind() {
            return this;
          },
          async run() {
            return { meta: { changes: 0 } };
          },
          async all() {
            return { results: [] };
          },
        };
      },
    },
  };
  const message = makeMessage({ version: 9, kind: "notification_available" });
  await handleNotificationWakeQueue(makeBatch([message]), env);
  assert.equal(drainCalls, 0);
  assert.equal(message.ackCalls, 1);
});
