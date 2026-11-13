import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { createSqlite, runUnderRootTsx } from "./support/personalHarness.mjs";
import { createVideoStatusD1 } from "./support/videoStatusD1.mjs";

if (runUnderRootTsx(import.meta.url)) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      }
      if (specifier === "next/navigation") {
        return {
          url: "data:text/javascript,export%20function%20unstable_rethrow()%20%7B%7D",
          shortCircuit: true,
        };
      }
      if (specifier === "@opennextjs/cloudflare") {
        return {
          url: "data:text/javascript," + encodeURIComponent(
            "export function getCloudflareContext() { return globalThis.__visibilityGoldenContext; }",
          ),
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  process.env.NEXT_PUBLIC_SITE_URL = "https://flamenode.example.test";
  const { drizzle } = await import("drizzle-orm/d1");
  const { eq } = await import("drizzle-orm");
  const schema = await import("@flamenode/db/schema");
  const { planVideoVisibilityTransition: planCurrent } = await import(
    "../../../src/lib/video/videoVisibilityTransition.ts"
  );
  const { createVideoVisibilityTransitionHost } = await import(
    "../src/visibility/videoTransitionHost.ts"
  );
  const { executeVideoVisibilityStatusMutation: executeCurrentStatusMutation } = await import(
    "../../../src/lib/video/videoVisibilityStatusAction.ts"
  );
  const {
    createVideoVisibilityStatusMutationHost,
    executeHonoVideoVisibilityStatusMutation,
  } = await import("../src/visibility/videoStatusMutationHost.ts");
  const { planVideoVisibilityTransition: planShared } = await import(
    "@flamenode/server-core/visibility/videoTransition"
  );
  const { PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY: MANIFEST_KEY } = await import(
    "@flamenode/server-core/visibility/manifestCore"
  );

  function seed(sqlite) {
    sqlite.exec(`
      INSERT INTO "user" (
        id, name, email, role, is_banned, discord_id, active_x_user_id,
        is_notification_enabled
      ) VALUES
        ('u-recipient', 'Recipient', 'r@example.test', 'user', 0, 'discord-r', NULL, 1),
        ('u-actor', 'Actor', 'a@example.test', 'admin', 0, 'discord-a', 'x_actor', 1);
      INSERT INTO x_users (id, x_name, approval_status)
        VALUES ('x_actor', 'Actor X', 'approved');
      INSERT INTO x_users (id, x_name, approval_status)
        VALUES ('x_creator', 'Creator X', 'approved');
      INSERT INTO events (id, title, visibility_status, created_at, updated_at)
        VALUES ('evt-1', 'Event One', 'public', 1000, 1000);
      INSERT INTO videos (
        id, primary_event_id, creator_x_user_id, submitted_by_user_id,
        creator_display_name, title, youtube_video_id, visibility_status,
        created_at, updated_at
      ) VALUES (
        'vid-1', 'evt-1', 'x_creator', 'u-recipient',
        'Creator', 'Video One', 'yt123', 'public', 1000, 1000
      );
    `);
  }

  // Execute the planned D1 writes against the migrated SQLite schema.
  // This tests persistence, not the full audit/R2 action adapter.
  function applyMutationPlan(sqlite, plan) {
    assert.equal(plan.mutationStatements.length, plan.expectedMutationChanges.length);
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (const [index, statement] of plan.mutationStatements.entries()) {
        const { sql, params } = statement;
        const result = sqlite.prepare(sql).run(...params);
        const expected = plan.expectedMutationChanges[index];
        if (expected !== null) {
          assert.equal(result.changes, expected, `mutation ${index + 1} changed rows`);
        }
      }
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
    return {
      video: sqlite.prepare("SELECT id, visibility_status, updated_at FROM videos WHERE id = ?").get("vid-1"),
      fences: sqlite.prepare("SELECT entity_type, entity_id, fence_token, state, blocked_at FROM public_visibility_fences ORDER BY entity_type, entity_id").all(),
      staticRebuildQueue: sqlite.prepare("SELECT * FROM static_rebuild_queue ORDER BY id").all(),
    };
  }

  function queryOf(statement) {
    const query = typeof statement.getQuery === "function"
      ? statement.getQuery()
      : statement.toSQL();
    return { sql: query.sql, params: query.params };
  }

  function snapshot(plan) {
    return {
      mutationStatements: plan.mutationStatements.map(queryOf),
      expectedMutationChanges: plan.expectedMutationChanges,
      audits: plan.audits,
      notificationBatch: {
        statements: plan.notificationBatch.statements.map(queryOf),
        expectedChanges: plan.notificationBatch.expectedChanges,
      },
      queueBatch: {
        statements: plan.queueBatch.statements.map(queryOf),
        expectedChanges: plan.queueBatch.expectedChanges,
        acceptedTargetCount: plan.queueBatch.acceptedTargetCount,
      },
      visibilityChanged: plan.visibilityChanged,
      fenceToken: plan.fenceToken,
      depublicizedFromPublic: plan.depublicizedFromPublic,
      publicCacheKeys: plan.publicCacheKeys,
      exportEventIds: plan.exportEventIds,
      validationError: plan.validationError,
    };
  }

  async function makePlan(nextStatus, useCurrent) {
    const sqlite = createSqlite();
    seed(sqlite);
    try {
      const d1 = createVideoStatusD1(sqlite);
      const db = drizzle(d1, { schema });
      const video = (
        await db.select().from(schema.videos)
          .where(eq(schema.videos.id, "vid-1")).limit(1)
      )[0];
      assert.ok(video);
      const bucket = { async get() { return null; }, async put() { return {}; } };
      globalThis.__visibilityGoldenContext = {
        env: { DB: d1, BUCKET: bucket, NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL },
        ctx: { waitUntil() {} },
      };
      const honoHost = createVideoVisibilityTransitionHost({
        env: { BUCKET: bucket, NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL },
      });
      let uuid = 0;
      const realRandomUUID = globalThis.crypto.randomUUID;
      const realNow = Date.now;
      globalThis.crypto.randomUUID = () =>
        `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`;
      Date.now = () => 1_760_000_000_000;
      try {
        const input = {
          video, nextStatus, actorUserId: "u-actor",
          context: "admin_video_status", reason: "differential fixture",
          eventIds: ["evt-1"], notificationEventId: "evt-1",
          now: 1_760_000_000,
        };
        const plan = useCurrent
          ? await planCurrent(db, input)
          : await planShared(db, input, honoHost);
        const planned = snapshot(plan);
        return { planned, persisted: applyMutationPlan(sqlite, planned) };
      } finally {
        Date.now = realNow;
        globalThis.crypto.randomUUID = realRandomUUID;
      }
    } finally {
      sqlite.close();
    }
  }

  // Execute the REAL audited D1 batch from the shared status executor, as
  // opposed to applying only the planner's video/fence SQL in isolation.
  // The R2 bucket below implements real CAS precommit on the shared Hono
  // manifest adapter. This is still not a live Cloudflare binding, and does
  // not replace complete CURRENT Action/HTTP/authorization parity.
  async function executeAuditedStatus(nextStatus, useCurrent, forceStaleCas = false, replaceR2FenceOwner = false, enableWake = false) {
    const sqlite = createSqlite();
    seed(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const realNow = Date.now;
    const realRandomUUID = globalThis.crypto.randomUUID;
    Date.now = () => 1_760_000_000_000;
    let uuid = 0;
    globalThis.crypto.randomUUID = () =>
      `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`;
    try {
      const video = (await db.select().from(schema.videos)
        .where(eq(schema.videos.id, "vid-1")).limit(1))[0];
      assert.ok(video);
      const events = [];
      const pendingWakePromises = [];
      const objects = new Map();
      let etagVersion = 0;
      const bucket = {
        async delete(key) {
          events.push(["r2.delete", key]);
          return objects.delete(key);
        },
        async get(key) {
          events.push(["r2.get", key]);
          const row = objects.get(key);
          return row ? {
            etag: row.etag,
            size: new TextEncoder().encode(row.text).byteLength,
            text: async () => row.text,
          } : null;
        },
        async put(key, value, options) {
          events.push(["r2.put", key, options?.onlyIf instanceof Headers
            ? "create-if-absent" : options?.onlyIf?.etagMatches ?? null]);
          const current = objects.get(key);
          const condition = options?.onlyIf;
          if (condition instanceof Headers &&
              condition.get("If-None-Match") === "*" && current) return null;
          if (condition && !(condition instanceof Headers) &&
              condition.etagMatches !== current?.etag) return null;
          objects.set(key, { text: value, etag: `etag-${++etagVersion}` });
          if (replaceR2FenceOwner && etagVersion === 1) {
            // Another writer takes ownership between a successful R2 put
            // and the mandatory read-back confirmation.
            const overwritten = JSON.parse(value);
            const entry = overwritten.entities.find((row) =>
              row.entity_type === "video" && row.entity_id === "vid-1");
            assert.ok(entry, "the precommit actually blocked the intended video");
            entry.fence_token = "vf-foreign-owner";
            objects.set(key, { text: JSON.stringify(overwritten), etag: "etag-foreign" });
            events.push(["r2.concurrent-owner", key]);
          }
          return { key };
        },
      };
      globalThis.__visibilityGoldenContext = {
        env: {
          DB: d1, BUCKET: bucket,
          KV: { async get() { return null; }, async put() {}, async delete() {} },
          NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
          QUEUE_DISPATCH_ENABLED: enableWake ? "1" : "0",
          NOTIFICATION_WAKE_QUEUE: { async send(message) { events.push(["queue.send", "notification", message.kind]); } },
          STATIC_REBUILD_WAKE_QUEUE: { async send(message) { events.push(["queue.send", "static-rebuild", message.kind]); } },
        },
        ctx: { waitUntil(promise) { pendingWakePromises.push(promise); } },
      };
      const transitionHost = createVideoVisibilityTransitionHost({
        env: { BUCKET: bucket, NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL },
      });
      const input = {
        video, nextStatus, actorUserId: "u-actor",
        context: "admin_video_status", reason: "audited differential",
        eventIds: ["evt-1"], notificationEventId: "evt-1",
        now: 1_760_000_000,
      };
      const transition = useCurrent
        ? await planCurrent(db, input)
        : await planShared(db, input, transitionHost);
      if (forceStaleCas) {
        // A competing write happens after planning and before the atomic CAS.
        sqlite.prepare("UPDATE videos SET updated_at = ? WHERE id = ?")
          .run(2_000, "vid-1");
      }
      const auditedHost = createVideoVisibilityStatusMutationHost({
        env: { BUCKET: bucket, NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL },
        get(key) {
          if (key === "auditSettings") return undefined;
          if (key === "actorSnapshotJsonById") return {};
          throw new Error(`unexpected audit preload: ${key}`);
        },
      });
      const mutationInput = {
        db, videoId: "vid-1", requestedStatus: nextStatus, transition,
        reason: "audited differential", logTag: "status-differential",
        ...(enableWake ? { notificationWakeSource: "admin", staticRebuildWakeSource: "admin" } : {}),
      };
      // Exercise CURRENT's actual Next mutation bridge rather than Hono twice.
      const result = useCurrent
        ? await executeCurrentStatusMutation(mutationInput)
        : await executeHonoVideoVisibilityStatusMutation(mutationInput, auditedHost);
      await Promise.all(pendingWakePromises);
      if (replaceR2FenceOwner) {
        assert.equal(result.ok, false, "R2 owner changes must stop before D1");
        assert.equal(result.errorCode, "visibility_precommit_failed");
        assert.equal(result.retryable, false, "lost R2 ownership is fail-closed");
      } else if (forceStaleCas) {
        assert.equal(result.ok, false, "the stale CAS must fail");
        assert.equal(result.retryable, true, "a D1 CAS failure is recoverable");
      } else {
        assert.deepEqual(result, {
          ok: true, message: "ステータスを更新しました。", pendingPublicReflection: true,
        });
      }
      return {
        result,
        events,
        manifest: objects.has(MANIFEST_KEY) ? JSON.parse(objects.get(MANIFEST_KEY).text) : null,
        batches: d1.stats.batches,
        video: sqlite.prepare(
          "SELECT id, visibility_status, updated_at FROM videos WHERE id = ?"
        ).get("vid-1"),
        fences: sqlite.prepare(
          "SELECT entity_type, entity_id, fence_token, state FROM public_visibility_fences ORDER BY entity_id"
        ).all(),
        audits: sqlite.prepare(
          "SELECT table_name, target_id, operation, before_json, after_json, actor_snapshot_json, reason, context, retention_class FROM audit_logs ORDER BY target_id"
        ).all(),
        notifications: sqlite.prepare(
          "SELECT recipient_user_id, type, payload_json, status, dedupe_key, event_id FROM notification_outbox ORDER BY id"
        ).all(),
        queue: sqlite.prepare(
          "SELECT target_type, target_id, status FROM static_rebuild_queue ORDER BY target_type, target_id"
        ).all(),
      };
    } finally {
      Date.now = realNow;
      globalThis.crypto.randomUUID = realRandomUUID;
      delete globalThis.__visibilityGoldenContext;
      sqlite.close();
    }
  }

  for (const nextStatus of ["private", "voided"]) {
    test(`CURRENT Next/Hono host persist matching audited D1 video/fence/queue/outbox rows for ${nextStatus}`, async () => {
      const current = await executeAuditedStatus(nextStatus, true);
      const hono = await executeAuditedStatus(nextStatus, false);
      assert.deepEqual(hono, current, "identical persisted SQLite state and audited execution");
      assert.equal(current.video.visibility_status, nextStatus);
      assert.equal(current.batches, 1, "one atomic D1 batch includes audit and outbox");
      assert.equal(current.audits.length, 1, "strict audit row committed");
      assert.ok(current.queue.length > 0, "rebuild queue committed");
      assert.equal(current.notifications.length, nextStatus === "voided" ? 1 : 0);
      if (nextStatus === "voided") {
        assert.equal(current.notifications[0].type, "video_voided");
        assert.equal(current.notifications[0].status, "pending");
      }
      assert.ok(current.events.some((entry) => entry[0] === "r2.put"),
        "the real Hono R2 manifest CAS adapter must precommit a block");
      assert.ok(current.manifest?.entities.some((entry) =>
        entry.entity_type === "video" &&
        entry.entity_id === "vid-1" &&
        entry.fence_token === current.fences[0].fence_token
      ), "the R2 manifest must retain the exact D1 fence token after commit");
    });
  }

  test("stale D1 CAS rolls back audit/outbox/rebuild and compensates only its R2 fence token", async () => {
    const current = await executeAuditedStatus("private", true, true);
    const hono = await executeAuditedStatus("private", false, true);
    assert.deepEqual(hono, current, "CURRENT Next/Hono mutation adapters preserve identical rollback semantics");
    assert.equal(current.batches, 1, "an atomic D1 batch was attempted");
    assert.equal(current.video.visibility_status, "public");
    assert.equal(current.video.updated_at, 2000, "the competing update is untouched");
    assert.deepEqual(current.fences, [], "failed CAS does not commit D1 fence");
    assert.deepEqual(current.audits, [], "strict audit must not survive a failed CAS");
    assert.deepEqual(current.notifications, [], "notification outbox must roll back");
    assert.deepEqual(current.queue, [], "rebuild queue must roll back");
    assert.deepEqual(current.manifest?.entities, [],
      "R2 blocker with the original token is removed after failed D1 mutation");
    const puts = current.events.filter((event) => event[0] === "r2.put");
    assert.equal(puts.length, 2, "one conditional precommit and one compensated release");
    assert.equal(puts[0][2], "create-if-absent", "first R2 write is never unconditional");
    assert.equal(puts[1][2], "etag-1", "compensation releases by exact R2 CAS etag");
  });

  test("concurrent R2 fence ownership supersedes the stale caller without clearing the winner", async () => {
    const current = await executeAuditedStatus("private", true, false, true);
    const hono = await executeAuditedStatus("private", false, false, true);
    assert.deepEqual(hono, current, "CURRENT Next and Hono hosts must reject a lost R2 fence owner");
    assert.equal(current.batches, 0, "no audited D1 mutation may run after lost R2 CAS ownership");
    assert.equal(current.video.visibility_status, "public");
    assert.deepEqual(current.fences, []);
    assert.deepEqual(current.audits, []);
    assert.deepEqual(current.notifications, []);
    assert.deepEqual(current.queue, []);
    assert.equal(current.manifest.entities[0].fence_token, "vf-foreign-owner",
      "compensation may never remove a different writer's R2 fence");
    assert.equal(current.events.filter((event) => event[0] === "r2.put").length, 1,
      "the original precommit is the only R2 put, never an unauthorized compensation");
    assert.equal(current.events.filter((event) => event[0] === "r2.concurrent-owner").length, 1);
  });

  test("CURRENT wakes both queues only after committed audit/outbox while Hono keeps durable outbox and zero wakes", async () => {
    const current = await executeAuditedStatus("voided", true, false, false, true);
    const hono = await executeAuditedStatus("voided", false, false, false, true);
    const currentWake = current.events.filter((event) => event[0] === "queue.send");
    const honoWake = hono.events.filter((event) => event[0] === "queue.send");
    assert.deepEqual(currentWake.map((event) => event.slice(1)), [
      ["notification", "notification_available"],
      ["static-rebuild", "static_rebuild_available"],
    ], "CURRENT sends one wake per committed outbox kind");
    assert.deepEqual(honoWake, [],
      "Hono must not wake directly; recovery cron owns outbox delivery");
    assert.equal(current.batches, 1);
    assert.equal(hono.batches, 1);
    assert.deepEqual(current.notifications, hono.notifications,
      "both paths persist the same notification outbox row");
    assert.deepEqual(current.queue, hono.queue,
      "both paths persist the same static rebuild queue");
    assert.equal(current.notifications.length, 1);
    assert.equal(current.queue.length > 0, true);
    assert.equal(current.events.filter((event) => event[0] === "r2.put").length, 1,
      "the visibility fence is committed before any wake");
  });

  test("stale D1 CAS never wakes either queue even when both wake sources are requested", async () => {
    for (const useCurrent of [true, false]) {
      const result = await executeAuditedStatus("voided", useCurrent, true, false, true);
      assert.equal(result.result.ok, false);
      assert.equal(result.batches, 1, "the D1 CAS batch was attempted and rolled back");
      assert.deepEqual(result.events.filter((event) => event[0] === "queue.send"), []);
      assert.deepEqual(result.notifications, [], "notification outbox rolled back");
      assert.deepEqual(result.queue, [], "static rebuild outbox rolled back");
    }
  });

  for (const nextStatus of ["private", "voided"]) {
    test(`CURRENT and Hono transition planners match SQLite mutation/audit/outbox plans for ${nextStatus}`, async () => {
      const current = await makePlan(nextStatus, true);
      const hono = await makePlan(nextStatus, false);
      assert.deepEqual(hono, current);
      assert.equal(current.persisted.video.visibility_status, nextStatus);
      assert.equal(current.persisted.fences.length, 1);
      assert.equal(current.persisted.fences[0].state, "blocked");
      assert.ok(current.planned.mutationStatements.length > 0);
      assert.ok(current.planned.queueBatch.statements.length > 0);
      if (nextStatus === "voided") assert.equal(current.planned.notificationBatch.statements.length, 1);
      if (nextStatus === "private") {
        assert.equal(current.planned.notificationBatch.statements.length, 0);
        assert.equal(current.planned.depublicizedFromPublic, true);
        assert.ok(current.planned.fenceToken);
      }
    });
  }
}
