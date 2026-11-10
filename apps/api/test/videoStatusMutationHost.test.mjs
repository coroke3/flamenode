import assert from "node:assert/strict";
import test from "node:test";
import {
  createVideoVisibilityStatusMutationHost,
  executeHonoVideoVisibilityStatusMutation,
} from "../src/visibility/videoStatusMutationHost.ts";

test("Hono status mutation adapter keeps audit preloads and never wakes either queue", async () => {
  let received;
  const context = {
    env: {},
    get(key) {
      if (key === "auditSettings") return { enabled: true, retentionDays: 90 };
      if (key === "actorSnapshotJsonById") return { admin: '{"role":"admin"}' };
      throw new Error(`unexpected context read: ${key}`);
    },
  };
  const host = createVideoVisibilityStatusMutationHost(context, {
    mutateWithAudit: async (db, input) => {
      received = { db, input };
      return ["audit-1"];
    },
    createTraceId: () => "trace-test",
  });
  const db = { marker: "request-db" };
  await host.mutate(db, {
    mutationStatements: ["mutation"],
    expectedMutationChanges: [1],
    audits: [{ table_name: "videos", target_id: "v-1", operation: "UPDATE" }],
    notificationWakeSource: "admin_video_status",
    staticRebuildWakeSource: "admin_video_status",
  });

  assert.equal(received.db, db);
  assert.deepEqual(received.input.mutationStatements, ["mutation"]);
  assert.deepEqual(received.input.expectedMutationChanges, [1]);
  assert.equal(received.input.preloaded.settings.enabled, true);
  assert.deepEqual(received.input.preloaded.actorSnapshotJsonById, {
    admin: '{"role":"admin"}',
  });
  assert.equal(Object.hasOwn(received.input, "notificationWakeSource"), false);
  assert.equal(Object.hasOwn(received.input, "staticRebuildWakeSource"), false);
  assert.equal(host.createTraceId(), "trace-test");
});

test("Hono status mutation adapter recognizes visibility fence failures only", () => {
  const context = { env: {}, get() { return {}; } };
  const host = createVideoVisibilityStatusMutationHost(context, {
    mutateWithAudit: async () => [],
  });
  assert.equal(host.isVisibilityPrecommitFailure(new Error("public_visibility_manifest_missing")), true);
  assert.equal(host.isVisibilityPrecommitFailure(new Error("database unavailable")), false);
});


test("Hono executor composes the shared status core with the durable-outbox zero-wake policy", async () => {
  let mutationInput;
  const context = {
    env: {},
    get(key) {
      if (key === "auditSettings") return { enabled: true, retentionDays: 90 };
      if (key === "actorSnapshotJsonById") return { admin: '{"role":"admin"}' };
      throw new Error(`unexpected context read: ${key}`);
    },
  };
  const host = createVideoVisibilityStatusMutationHost(context, {
    mutateWithAudit: async (_db, input) => {
      mutationInput = input;
      return [];
    },
    createTraceId: () => "trace-composed",
  });
  const result = await executeHonoVideoVisibilityStatusMutation({
    db: { marker: "request-db" },
    videoId: "v-1",
    requestedStatus: "private",
    reason: "review",
    logTag: "admin-video-status",
    transition: {
      mutationStatements: ["video-update"],
      expectedMutationChanges: [1],
      audits: [{ table_name: "videos", target_id: "v-1", operation: "UPDATE" }],
      notificationBatch: { statements: ["notification-outbox"] },
      queueBatch: { statements: ["static-rebuild-outbox"] },
      visibilityChanged: true,
      fenceToken: null,
      depublicizedFromPublic: true,
      publicCacheKeys: [],
      exportEventIds: [],
    },
  }, host);

  assert.deepEqual(result, {
    ok: true,
    message: "ステータスを更新しました。",
    pendingPublicReflection: true,
  });
  assert.deepEqual(mutationInput.mutationStatements, ["video-update"]);
  assert.deepEqual(mutationInput.expectedMutationChanges, [1]);
  assert.equal(Object.hasOwn(mutationInput, "notificationWakeSource"), false);
  assert.equal(Object.hasOwn(mutationInput, "staticRebuildWakeSource"), false);
  assert.equal(mutationInput.preloaded.settings.enabled, true);
});
