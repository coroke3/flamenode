import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { createSqlite } from "./support/personalHarness.mjs";
import { createVideoStatusD1 } from "./support/videoStatusD1.mjs";
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
      notificationBatch: { statements: ["notification-outbox"], expectedChanges: [1] },
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
  assert.deepEqual(mutationInput.mutationStatements, ["video-update", "notification-outbox"]);
  assert.deepEqual(mutationInput.expectedMutationChanges, [1, 1]);
  assert.equal(Object.hasOwn(mutationInput, "notificationWakeSource"), false);
  assert.equal(Object.hasOwn(mutationInput, "staticRebuildWakeSource"), false);
  assert.equal(mutationInput.preloaded.settings.enabled, true);
});


test("Hono status mutation host rereads visibility from the migrated SQLite D1 schema", async () => {
  const sqlite = createSqlite();
  try {
    sqlite.prepare(`
      INSERT INTO videos (
        id, submitted_by_user_id, creator_display_name, title,
        visibility_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("video-reread", "missing-user", "Creator", "Video", "public", 1000, 1000);

    const db = drizzle(createVideoStatusD1(sqlite), { schema });
    const host = createVideoVisibilityStatusMutationHost(
      { env: {}, get: () => ({}) },
      { mutateWithAudit: async () => [] },
    );

    assert.equal(await host.rereadStatus(db, "video-reread"), "public");
    sqlite.prepare("UPDATE videos SET visibility_status = ? WHERE id = ?")
      .run("private", "video-reread");
    assert.equal(await host.rereadStatus(db, "video-reread"), "private");
    assert.equal(await host.rereadStatus(db, "missing-video"), undefined);
  } finally {
    sqlite.close();
  }
});
