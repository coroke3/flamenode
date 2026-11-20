import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { AuditMutationError } from "@flamenode/server-core/audit/mutate";
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
    preMutationAssertions: ["trusted-first-batch-authz"],
    mutationStatements: ["mutation"],
    expectedMutationChanges: [1],
    audits: [{ table_name: "videos", target_id: "v-1", operation: "UPDATE" }],
    notificationWakeSource: "admin_video_status",
    staticRebuildWakeSource: "admin_video_status",
  });

  assert.equal(received.db, db);
  assert.deepEqual(received.input.preMutationAssertions, ["trusted-first-batch-authz"],
    "adapter forwards the server-owned authorization guard to mutateWithAudit");
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
    preMutationAssertions: ["frozen-current-event-authz"],
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
  assert.deepEqual(mutationInput.preMutationAssertions, ["frozen-current-event-authz"],
    "the executor preserves the trusted assertion for the Hono audit transaction");
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

test("Hono full status executor fails closed after successful R2 precommit and silently exhausted rollback", async () => {
  const sqlite = createSqlite();
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    sqlite.prepare(`
      INSERT INTO videos (
        id, submitted_by_user_id, creator_display_name, title,
        visibility_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("video-failed-rollback", "missing-user", "Creator", "Video", "public", 1000, 1000);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    let stored = {
      schema_version: 1, revision: 1, generated_at: 1000, entities: [],
    };
    let etag = "etag-initial";
    let precommitWrites = 0;
    let rejectedRollbackWrites = 0;
    let mutationCalls = 0;
    let rereadCalls = 0;
    const bucket = {
      get: async (key) => {
        assert.equal(key, "visibility/blocked-entities.v1.json");
        const body = JSON.stringify(stored);
        return { size: Buffer.byteLength(body), etag, text: async () => body };
      },
      put: async (key, body, options) => {
        assert.equal(key, "visibility/blocked-entities.v1.json");
        const next = JSON.parse(body);
        if (next.entities.some((entity) =>
          entity.entity_type === "video" && entity.entity_id === "video-failed-rollback")) {
          assert.equal(precommitWrites++, 0, "the visibility fence precommit must happen exactly once");
          assert.deepEqual(options.onlyIf, { etagMatches: "etag-initial" });
          stored = next;
          etag = "etag-after-precommit";
          return { etag };
        }
        assert.deepEqual(options.onlyIf, { etagMatches: "etag-after-precommit" });
        rejectedRollbackWrites += 1;
        return null; // Conditional R2 writes lose; prior precommit remains durable.
      },
    };
    const diagnostics = [];
    const host = createVideoVisibilityStatusMutationHost({
      env: { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" },
      get: (key) => {
        if (key === "auditSettings") return { enabled: true, retentionDays: 90 };
        if (key === "actorSnapshotJsonById") return { admin: '{"role":"admin"}' };
        throw new Error("unexpected context read: " + key);
      },
    }, {
      createTraceId: () => "trace-complete",
      mutateWithAudit: async () => {
        mutationCalls += 1;
        throw new Error("D1 transport timeout Authorization:Bearer private-token");
      },
    });
    const realReread = host.rereadStatus;
    host.rereadStatus = async (requestDb, videoId) => {
      rereadCalls += 1;
      return realReread(requestDb, videoId);
    };
    host.log = (level, tag, details) => diagnostics.push([level, tag, details]);

    const result = await executeHonoVideoVisibilityStatusMutation({
      db,
      videoId: "video-failed-rollback",
      requestedStatus: "private",
      transition: {
        mutationStatements: ["video-update"],
        expectedMutationChanges: [1],
        audits: [{ table_name: "videos", target_id: "video-failed-rollback", operation: "UPDATE" }],
        notificationBatch: { statements: [], expectedChanges: [] },
        queueBatch: { statements: [], expectedChanges: [] },
        visibilityChanged: true,
        fenceToken: "vf-executor-owned",
        depublicizedFromPublic: true,
        publicCacheKeys: [],
        exportEventIds: [],
      },
      reason: "moderation",
      logTag: "admin-video-status",
    }, host);
    assert.deepEqual(result, {
      ok: false,
      message: "状態の確認に失敗しました。状態を再取得してから操作してください。",
      errorCode: "status_unverified",
      traceId: "trace-complete",
      retryable: false,
    });
    assert.equal(precommitWrites, 1, "R2 precommit persisted before the D1 failure");
    assert.equal(mutationCalls, 1, "one audited mutation was attempted, no retry");
    assert.equal(rejectedRollbackWrites, 9, "real nested R2 CAS retries all failed");
    assert.equal(rereadCalls, 0, "no D1 idempotent success or extra D1 query after unknown R2 rollback");
    assert.equal(stored.entities.length, 1);
    assert.equal(stored.entities[0].fence_token, "vf-executor-owned",
      "an unreleased visibility fence must never be reported as public");
    assert.equal(await realReread(db, "video-failed-rollback"), "public",
      "the observed D1 value alone is not sufficient proof of public visibility");
    assert.equal(d1.stats.batches, 0);
    assert.equal(d1.stats.writes, 0);
    assert.deepEqual(diagnostics, [[
      "warn", "[admin-video-status] visibility compensation failed",
      { traceId: "trace-complete", error_code: "visibility_compensation_failed" },
    ]]);
    assert.equal(warnings.some((entries) =>
      entries.some((entry) => String(entry).includes('"stuck_fence_candidate":true'))), true);
    assert.doesNotMatch(JSON.stringify({ result, diagnostics }), /Bearer|private-token|D1 transport timeout/);
  } finally {
    console.warn = originalWarn;
    sqlite.close();
  }
});

test("Hono executor permits CAS conflict retry only after a verified successful R2 rollback", async () => {
  const sqlite = createSqlite();
  try {
    sqlite.prepare(`
      INSERT INTO videos (
        id, submitted_by_user_id, creator_display_name, title,
        visibility_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("video-rollback-ok", "missing-user", "Creator", "Video", "public", 1000, 1000);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const unrelated = {
      entity_type: "video", entity_id: "video-foreign",
      fence_token: "vf-foreign", blocked_at: 1000, reason: "other",
    };
    let stored = {
      schema_version: 1, revision: 1, generated_at: 1000, entities: [unrelated],
    };
    let revision = 1;
    let writes = 0;
    const bucket = {
      get: async () => {
        const body = JSON.stringify(stored);
        return {
          size: Buffer.byteLength(body), etag: "etag-" + revision,
          text: async () => body,
        };
      },
      put: async (_key, body, options) => {
        assert.deepEqual(options.onlyIf, { etagMatches: "etag-" + revision });
        const candidate = JSON.parse(body);
        const ownsFence = candidate.entities.some((entry) =>
          entry.entity_type === "video" && entry.entity_id === "video-rollback-ok");
        assert.equal(ownsFence, writes === 0,
          "first put precommits, second put removes exactly the target block");
        writes += 1;
        revision += 1;
        stored = candidate;
        return { etag: "etag-" + revision };
      },
    };
    let mutationCalls = 0;
    let rereadCalls = 0;
    const logs = [];
    const host = createVideoVisibilityStatusMutationHost({
      env: { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" },
      get: (key) => {
        if (key === "auditSettings") return { enabled: true, retentionDays: 90 };
        if (key === "actorSnapshotJsonById") return { admin: '{"role":"admin"}' };
        throw new Error("unexpected context read: " + key);
      },
    }, {
      createTraceId: () => "trace-rollback-success",
      mutateWithAudit: async () => {
        mutationCalls += 1;
        throw new AuditMutationError("forced D1 CAS mismatch");
      },
    });
    const realReread = host.rereadStatus;
    host.rereadStatus = async (requestDb, videoId) => {
      rereadCalls += 1;
      return realReread(requestDb, videoId);
    };
    host.log = (level, tag, details) => logs.push([level, tag, details]);

    const result = await executeHonoVideoVisibilityStatusMutation({
      db,
      videoId: "video-rollback-ok",
      requestedStatus: "private",
      transition: {
        mutationStatements: ["video-update"],
        expectedMutationChanges: [1],
        audits: [{ table_name: "videos", target_id: "video-rollback-ok", operation: "UPDATE" }],
        notificationBatch: { statements: [], expectedChanges: [] },
        queueBatch: { statements: [], expectedChanges: [] },
        visibilityChanged: true,
        fenceToken: "vf-rollback-owned",
        depublicizedFromPublic: true,
        publicCacheKeys: [],
        exportEventIds: [],
      },
      reason: null,
      logTag: "admin-video-status",
    }, host);
    assert.deepEqual(result, {
      ok: false,
      message: "別の担当者が状態を変更しました。状態を再取得してもう一度お試しください。",
      errorCode: "concurrent_update",
      traceId: "trace-rollback-success",
      retryable: true,
    }, "retryable CAS conflict is safe only after R2 cleanup is positively confirmed");
    assert.equal(writes, 2);
    assert.equal(mutationCalls, 1);
    assert.equal(rereadCalls, 1);
    assert.deepEqual(stored.entities, [unrelated], "foreign manifest entries remain untouched");
    assert.equal(await host.confirmCompensation("video-rollback-ok"), true);
    assert.equal(d1.stats.batches, 0);
    assert.equal(d1.stats.writes, 0);
    assert.deepEqual(logs, [], "no false compensation-outage warning on verified rollback");
  } finally {
    sqlite.close();
  }
});
