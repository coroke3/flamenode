import test from "node:test";
import assert from "node:assert/strict";
import { mutateWithAudit, AuditMutationError } from "@flamenode/server-core/audit/mutate";
import {
  resetQueueWakeWarningStateForTests,
  sendQueueWakeBestEffort,
} from "@flamenode/server-core/queues/sendQueueWakeBestEffort";
import { resetQueueWakeFailureRecordStateForTests } from "@flamenode/server-core/queues/wakeFailureRecord";

const enabled = { QUEUE_DISPATCH_ENABLED: "1" };

function makeHost({ env, waitUntil = null, kv = null } = {}) {
  return {
    readEnv: () => {
      if (env instanceof Error) throw env;
      return env ?? null;
    },
    readWaitUntil: () => waitUntil,
    readKv: () => kv,
  };
}

test.beforeEach(() => {
  resetQueueWakeWarningStateForTests();
  resetQueueWakeFailureRecordStateForTests();
});

test("wake sends through the Queue binding the host exposes for the kind", async () => {
  const sent = [];
  const host = makeHost({
    env: { ...enabled, NOTIFICATION_WAKE_QUEUE: { send: async (message) => sent.push(message) } },
  });
  const result = await sendQueueWakeBestEffort(
    { kind: "notification_available", source: "web" },
    host,
  );
  assert.deepEqual(result, { sent: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "notification_available");
});

test("wake is skipped when the host flags dispatch off or has no env", async () => {
  const off = await sendQueueWakeBestEffort(
    { kind: "notification_available", source: "web" },
    makeHost({ env: { QUEUE_DISPATCH_ENABLED: "0" } }),
  );
  assert.deepEqual(off, { sent: false, reason: "dispatch_disabled" });
  const noEnv = await sendQueueWakeBestEffort(
    { kind: "notification_available", source: "web" },
    makeHost({ env: new Error("no binding context") }),
  );
  assert.deepEqual(noEnv, { sent: false, reason: "dispatch_disabled" });
});

test("a missing binding records last failure in the host KV through waitUntil", async () => {
  const puts = [];
  const pending = [];
  const host = makeHost({
    env: enabled,
    kv: { put: async (key, value, options) => puts.push({ key, value, options }) },
    waitUntil: (promise) => pending.push(promise),
  });
  const result = await sendQueueWakeBestEffort(
    { kind: "static_rebuild_available", source: "admin" },
    host,
  );
  await Promise.all(pending);
  assert.deepEqual(result, { sent: false, reason: "binding_missing" });
  assert.equal(pending.length, 1);
  assert.equal(puts[0].key, "queue_wake:last_failure:static_rebuild_available");
});

test("a send failure without waitUntil is awaited and reported", async () => {
  const host = makeHost({
    env: { ...enabled, STATIC_REBUILD_WAKE_QUEUE: { send: async () => { throw new Error("down"); } } },
  });
  const result = await sendQueueWakeBestEffort(
    { kind: "static_rebuild_available", source: "admin" },
    host,
  );
  assert.deepEqual(result, { sent: false, reason: "send_failed" });
});

test("mutateWithAudit rejects a wake source without a host loader before touching D1", async () => {
  const db = new Proxy({}, { get() { throw new Error("D1 must not be touched"); } });
  await assert.rejects(
    mutateWithAudit(db, {
      mutationStatements: [{}],
      expectedMutationChanges: 1,
      audits: [{ table_name: "events", target_id: "e", operation: "UPDATE", actor_user_id: "u" }],
      staticRebuildWakeSource: "admin",
    }),
    (error) => error instanceof AuditMutationError && /host loader/.test(error.message),
  );
});
