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

test("Hono R2 compensation confirmation requires a real ETag and no blocked video", async () => {
  const original = {
    entity_type: "video", entity_id: "video-one",
    fence_token: "vf-own", blocked_at: 100, reason: "blocked",
  };
  const foreign = { ...original, fence_token: "vf-other" };
  const unrelated = { ...original, entity_id: "video-other" };
  let entities = [original, unrelated];
  let mode = "persisted";
  const bucket = {
    get: async (key) => {
      assert.equal(key, "visibility/blocked-entities.v1.json");
      if (mode === "missing") return null;
      if (mode === "error") throw new Error("R2 manifest GET failed");
      const body = JSON.stringify({
        schema_version: 1, revision: 2, generated_at: 100, entities,
      });
      return {
        etag: mode === "etag-missing" ? undefined : "etag-current",
        size: Buffer.byteLength(body),
        text: async () => body,
      };
    },
  };
  const host = createVideoVisibilityStatusMutationHost({
    env: { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" },
    get: () => ({}),
  }, { mutateWithAudit: async () => [] });

  assert.equal(await host.confirmCompensation("video-one"), false,
    "our own video block still exists after a silently failed R2 CAS retry");
  entities = [foreign, unrelated];
  assert.equal(await host.confirmCompensation("video-one"), false,
    "a different writer's block also forbids claiming the video is public");
  entities = [unrelated];
  assert.equal(await host.confirmCompensation("video-one"), true,
    "a persisted R2 snapshot without the target block certifies cleanup");
  mode = "etag-missing";
  assert.equal(await host.confirmCompensation("video-one"), false,
    "missing ETag cannot certify a persisted post-compensation manifest");
  mode = "missing";
  assert.equal(await host.confirmCompensation("video-one"), false,
    "missing R2 manifest is not evidence of a confirmed rollback");
  mode = "error";
  await assert.rejects(host.confirmCompensation("video-one"), /manifest GET failed/,
    "R2 readback outage must reach shared executor's fail-closed path");
});

test("real Hono R2 compensator silently exhausts CAS yet manifest readback rejects false success", async () => {
  const sqlite = createSqlite();
  const savedWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    sqlite.prepare(`
      INSERT INTO videos (
        id, submitted_by_user_id, creator_display_name, title,
        visibility_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("video-r2-stuck", "missing-user", "Creator", "Video", "public", 1000, 1000);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const initial = {
      schema_version: 1, revision: 1, generated_at: 1000,
      entities: [{
        entity_type: "video", entity_id: "video-r2-stuck",
        fence_token: "vf-r2-stuck", blocked_at: 1000, reason: "status_update",
      }],
    };
    const raw = JSON.stringify(initial);
    let putCalls = 0;
    const bucket = {
      get: async (key) => {
        assert.equal(key, "visibility/blocked-entities.v1.json");
        return {
          size: Buffer.byteLength(raw),
          etag: "etag-still-fenced",
          text: async () => raw,
        };
      },
      put: async (key, _body, options) => {
        assert.equal(key, "visibility/blocked-entities.v1.json");
        assert.deepEqual(options.onlyIf, { etagMatches: "etag-still-fenced" });
        putCalls += 1;
        return null; // all R2 CAS writes lose; persisted fence stays.
      },
    };
    const host = createVideoVisibilityStatusMutationHost({
      env: { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" },
      get: () => ({}),
    }, { mutateWithAudit: async () => [] });

    // This is the actual production compensator, not a stubbed callback.
    // It exhausts both its own 3 tries and the shared R2 writer's 3 tries
    // per attempt, logs the failure, but still resolves without throwing.
    await host.compensate(db, {
      videoId: "video-r2-stuck",
      fenceToken: "vf-r2-stuck",
      traceId: "trace-r2-stuck",
      allowNonPublicRollback: false,
    });
    assert.equal(putCalls, 9, "three compensator attempts x three R2 CAS retries");
    assert.equal(await host.confirmCompensation("video-r2-stuck"), false,
      "successful Promise<void> from compensator does not certify unfenced R2");
    assert.equal(await host.rereadStatus(db, "video-r2-stuck"), "public",
      "D1 can read public even while R2 still blocks this video");
    assert.equal(warnings.some((line) =>
      line.some((entry) => String(entry).includes('"stuck_fence_candidate":true'))), true);
    assert.equal(d1.stats.batches, 0);
    assert.equal(d1.stats.writes, 0);
  } finally {
    console.warn = savedWarn;
    sqlite.close();
  }
});
