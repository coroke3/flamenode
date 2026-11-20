import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import { AuditMutationError, asBatchRunnable } from "@flamenode/server-core/audit/mutate";
import { loadManageVideoStatusSnapshot, planManageVideoStatusCommitAssertion } from "@flamenode/server-core/video/manageStatusAccess";
import * as schema from "@flamenode/db/schema";
import { createSqlite } from "./support/personalHarness.mjs";
import { seed } from "./support/manageSeed.mjs";
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



test("Hono status execution actually rolls back first-batch authz after a revoked X grant", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    sqlite.exec('UPDATE "user" SET is_tos_accepted=1');
    sqlite.exec(`INSERT INTO system_settings
      (id,operation_mode,disabled_features_json,cost_guard_exception_until,cost_guard_exception_features_json)
      VALUES ('default','normal',NULL,NULL,NULL)
      ON CONFLICT(id) DO UPDATE SET operation_mode='normal',disabled_features_json=NULL,
        cost_guard_exception_until=NULL,cost_guard_exception_features_json=NULL`);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const actor = { id: "u_mgr", role: "user" };
    const snapshot = await loadManageVideoStatusSnapshot(db, actor, "evA", "v1");
    assert.equal(snapshot.ok, true, "legitimate reviewer had a complete trusted preload");
    assert.deepEqual(snapshot.rebuildEventIds, ["evA"]);

    let auditedBatchCalls = 0;
    const host = createVideoVisibilityStatusMutationHost({
      env: {},
      get(key) {
        if (key === "auditSettings") return { enabled: true, retentionDays: 90 };
        if (key === "actorSnapshotJsonById") return { u_mgr: '{"role":"user"}' };
        throw new Error("unexpected context key: " + key);
      },
    }, {
      createTraceId: () => "trace-guard-wiring",
      // This callback executes the real transactional SQLite/D1 batch with
      // production asBatchRunnable conversions, not the full audit logger.
      // The fixture includes explicit audit/outbox INSERTs as mutation DML.
      mutateWithAudit: async (requestDb, payload) => {
        auditedBatchCalls++;
        assert.equal(payload.preMutationAssertions?.length, 1,
          "trusted authorization must be the first statement inside the batch");
        assert.equal(payload.mutationStatements.length, 3,
          "status, audit and notification outbox must share the batch");
        assert.equal(payload.audits.length, 1);
        await requestDb.batch([
          ...payload.preMutationAssertions,
          ...payload.mutationStatements,
        ].map(stmt => asBatchRunnable(requestDb, stmt)));
        return ["guard-wiring-audit"];
      },
    });
    const logs = [];
    host.log = (level, tag, details) => logs.push([level, tag, details]);
    const transition = {
      mutationStatements: [
        db.run(sql`UPDATE videos SET visibility_status='public' WHERE id='v1'`),
        db.run(sql`INSERT INTO audit_logs
          (id,table_name,target_id,operation,actor_user_id,created_at)
          VALUES ('status-wiring-audit','videos','v1','UPDATE','u_mgr',1000)`),
      ],
      expectedMutationChanges: [1, 1],
      audits: [{ table_name: "videos", target_id: "v1",
        operation: "UPDATE", actor_user_id: "u_mgr" }],
      notificationBatch: {
        statements: [db.run(sql`INSERT INTO notification_outbox
          (id,type,payload_json,status,created_at)
          VALUES ('status-wiring-outbox','video_posted','{}','pending',1000)`)],
        expectedChanges: [1],
      },
      queueBatch: { statements: [], expectedChanges: [] },
      fenceToken: null,
      depublicizedFromPublic: false,
      visibilityChanged: true,
      publicCacheKeys: [],
      exportEventIds: [],
    };
    const execute = () => executeHonoVideoVisibilityStatusMutation({
      db, videoId: "v1", requestedStatus: "public",
      reason: "review", logTag: "status-guard-wiring",
      preMutationAssertions: [
        planManageVideoStatusCommitAssertion(
          db, actor, "evA", "v1", "tok-mgr", "manage_video_status",
          snapshot.rebuildEventIds),
      ],
      transition,
    }, host);

    // A concurrent writer revokes the formerly valid approved X AFTER
    // preload but BEFORE the video status transaction.
    sqlite.exec("UPDATE x_users SET approval_status='rejected' WHERE id='mgr_x'");
    const deniedStart = d1.stats.statements;
    const denied = await execute();
    assert.equal(denied.ok, false, "revoked reviewer cannot update through Hono executor");
    assert.equal(d1.stats.statements - deniedStart, 1,
      "first batch assertion rejects before all three mutation statements");
    assert.equal(d1.stats.batches, 1);
    assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'")
      .get().visibility_status, "pending");
    assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_logs WHERE id='status-wiring-audit'")
      .get().n, 0, "the audit INSERT is rolled back");
    assert.equal(sqlite.prepare("SELECT count(*) n FROM notification_outbox WHERE id='status-wiring-outbox'")
      .get().n, 0, "the notification outbox INSERT is rolled back");
    assert.equal(auditedBatchCalls, 1);

    // Restoring the previously trusted X privilege makes the exact same
    // frozen preflight and status/audit/outbox transaction valid again.
    sqlite.exec("UPDATE x_users SET approval_status='approved' WHERE id='mgr_x'");
    const allowedStart = d1.stats.statements;
    const allowed = await execute();
    assert.equal(allowed.ok, true);
    assert.equal(d1.stats.statements - allowedStart, 4,
      "one trusted guard and three DML writes, no additional D1 pre-read");
    assert.equal(d1.stats.batches, 2);
    assert.equal(auditedBatchCalls, 2);
    assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'")
      .get().visibility_status, "public");
    assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_logs WHERE id='status-wiring-audit'")
      .get().n, 1);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM notification_outbox WHERE id='status-wiring-outbox'")
      .get().n, 1);
    assert.ok(d1.stats.maxBinds <= 100, "first-batch guard and DML remain D1-bind-bounded");
    assert.ok(logs.every(([level, _tag, details]) =>
      level === "error" && details.error_code === "mutation_failed"),
      "provider errors are not included in structured logs");
  } finally {
    sqlite.close();
  }
});

test("Hono status real mutateWithAudit keeps revoked reviewer writes and audit completely atomic", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    sqlite.exec('UPDATE "user" SET is_tos_accepted=1');
    sqlite.exec(`INSERT INTO system_settings
      (id,operation_mode,disabled_features_json,cost_guard_exception_until,cost_guard_exception_features_json)
      VALUES ('default','normal',NULL,NULL,NULL)
      ON CONFLICT(id) DO UPDATE SET operation_mode='normal',disabled_features_json=NULL,
        cost_guard_exception_until=NULL,cost_guard_exception_features_json=NULL`);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const actor = { id: "u_mgr", role: "user" };
    const snapshot = await loadManageVideoStatusSnapshot(db, actor, "evA", "v1");
    assert.equal(snapshot.ok, true);
    assert.deepEqual(snapshot.rebuildEventIds, ["evA"]);

    // These snapshots are canonical five-field values from the trusted
    // user/settings guard, not the user's body or a partial test shortcut.
    const actorSnapshot = {
      discord_id: "d_mgr", discord_name: "Name mgr", x_user_id: null,
      x_name: null, icon_url: null,
    };
    const auditSettings = {
      normal_retention_days: 30, restorable_retention_days: 180,
      long_audit_retention_days: 365, max_payload_bytes: 120_000,
      compact_after_days: 30,
    };
    const host = createVideoVisibilityStatusMutationHost({
      env: {},
      get(key) {
        if (key === "auditSettings") return auditSettings;
        if (key === "actorSnapshotJsonById") {
          return { u_mgr: JSON.stringify(actorSnapshot) };
        }
        throw new Error("unexpected audit context key: " + key);
      },
    }, { createTraceId: () => "trace-real-audit-status" });
    const logs = [];
    host.log = (level, tag, details) => logs.push([level, tag, details]);

    const transition = {
      mutationStatements: [
        db.run(sql`UPDATE videos SET visibility_status='public' WHERE id='v1'`),
      ],
      expectedMutationChanges: [1],
      audits: [{
        table_name: "videos", target_id: "v1", operation: "UPDATE",
        before: { id: "v1", visibility_status: "pending" },
        after: { id: "v1", visibility_status: "public" },
        actor_user_id: "u_mgr", reason: "review", context: "manage_video_status",
        retention_class: "normal", restore_strategy: "none",
      }],
      notificationBatch: {
        statements: [db.run(sql`INSERT INTO notification_outbox
          (id,type,payload_json,status,created_at)
          VALUES ('real-audit-status-outbox','video_posted','{}','pending',1000)`)],
        expectedChanges: [1],
      },
      queueBatch: { statements: [], expectedChanges: [] },
      fenceToken: null, depublicizedFromPublic: false,
      visibilityChanged: true, publicCacheKeys: [], exportEventIds: [],
    };
    const execute = () => executeHonoVideoVisibilityStatusMutation({
      db, videoId: "v1", requestedStatus: "public",
      reason: "review", logTag: "real-audit-status",
      preMutationAssertions: [
        planManageVideoStatusCommitAssertion(db, actor, "evA", "v1",
          "tok-mgr", "manage_video_status", snapshot.rebuildEventIds),
      ],
      transition,
    }, host);

    // Revocation after a legitimate read-only preload, before the audited
    // commit. This uses the REAL mutateWithAudit, not an injected writer.
    sqlite.exec("UPDATE x_users SET approval_status='rejected' WHERE id='mgr_x'");
    const beforeDeny = d1.stats.statements;
    const denied = await execute();
    assert.equal(denied.ok, false, "no stale grant can authorize status");
    assert.equal(d1.stats.statements - beforeDeny, 1,
      "valid canonical audit preloads avoid extra D1 reads; guard fails first");
    assert.equal(d1.stats.batches, 1, "one atomic aborted audited batch");
    assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'")
      .get().visibility_status, "pending");
    assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_logs WHERE table_name='videos' AND target_id='v1'")
      .get().n, 0, "real audit logger cannot persist a denied action");
    assert.equal(sqlite.prepare("SELECT count(*) n FROM notification_outbox WHERE id='real-audit-status-outbox'")
      .get().n, 0, "no notification survives a denied action");

    sqlite.exec("UPDATE x_users SET approval_status='approved' WHERE id='mgr_x'");
    const beforeAllow = d1.stats.statements;
    const allowed = await execute();
    assert.equal(allowed.ok, true);
    assert.equal(d1.stats.statements - beforeAllow, 7,
      "guard + update/CAS assertion + notification/CAS assertion + audit insert/assertion");
    assert.equal(d1.stats.batches, 2);
    assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'")
      .get().visibility_status, "public");
    const audit = sqlite.prepare(`SELECT before_json,after_json,changed_keys_json,actor_snapshot_json,reason,context
      FROM audit_logs WHERE table_name='videos' AND target_id='v1'`).get();
    assert.ok(audit, "production mutateWithAudit persisted one strict audit row");
    assert.deepEqual(JSON.parse(audit.before_json), { id: "v1", visibility_status: "pending" });
    assert.deepEqual(JSON.parse(audit.after_json), { id: "v1", visibility_status: "public" });
    assert.deepEqual(JSON.parse(audit.changed_keys_json), ["visibility_status"]);
    assert.deepEqual(JSON.parse(audit.actor_snapshot_json), actorSnapshot);
    assert.equal(audit.reason, "review");
    assert.equal(audit.context, "manage_video_status");
    assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_logs WHERE table_name='videos' AND target_id='v1'")
      .get().n, 1);
    assert.equal(sqlite.prepare("SELECT status FROM notification_outbox WHERE id='real-audit-status-outbox'")
      .get().status, "pending");
    assert.ok(d1.stats.maxBinds <= 100,
      "production audit chunks and trusted guard stay below D1 bind cap");
    assert.ok(logs.every(([_level, _tag, details]) =>
      !Object.values(details).some(value => /token|password|secret/i.test(String(value)))),
      "structured logs cannot expose credentials");
  } finally {
    sqlite.close();
  }
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
