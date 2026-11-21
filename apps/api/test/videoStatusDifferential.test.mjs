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
          url: "data:text/javascript," + encodeURIComponent(
            "export function unstable_rethrow(error) { " +
            "if (typeof error?.digest === 'string' && " +
            "error.digest.startsWith('NEXT_REDIRECT;')) throw error; }",
          ),
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
  const { MANIFEST_PUT_MAX_RETRIES } = await import(
    "@flamenode/server-core/visibility/manifestR2"
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
  async function executeAuditedStatus(nextStatus, useCurrent, forceStaleCas = false, replaceR2FenceOwner = false, enableWake = false, initialStatus = "public", r2Fault = null, injectedNextControl = null) {
    const sqlite = createSqlite();
    seed(sqlite);
    if (initialStatus !== "public") {
      sqlite.prepare("UPDATE videos SET visibility_status = ? WHERE id = ?")
        .run(initialStatus, "vid-1");
    }
    const d1 = createVideoStatusD1(sqlite);
    // Inject at the real D1 batch boundary, after the R2 precommit.
    // Do not mock the production CURRENT status mutation bridge.
    let injectedBatchAttempts = 0;
    if (injectedNextControl) {
      d1.batch = async () => {
        injectedBatchAttempts++;
        throw injectedNextControl;
      };
    }
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
      let transientPutFailures = 0;
      const bucket = {
        async delete(key) {
          events.push(["r2.delete", key]);
          return objects.delete(key);
        },
        async get(key) {
          events.push(["r2.get", key]);
          if (r2Fault === "read" || (r2Fault === "read-after-write" && etagVersion > 0)) {
            throw new Error("public_visibility_manifest_transport_unavailable");
          }
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
          if (r2Fault === "write" || (r2Fault === "write-once" && transientPutFailures++ === 0)) {
            throw new Error("public_visibility_manifest_transport_unavailable");
          }
          const current = objects.get(key);
          const condition = options?.onlyIf;
          if (r2Fault === "compensation-rejected" && etagVersion > 0 &&
              !JSON.parse(value).entities.some((row) =>
                row.entity_type === "video" && row.entity_id === "vid-1")) {
            // The initial video block was committed. Every attempted R2 CAS
            // removal loses afterward, leaving the precommitted block live.
            return null;
          }
          if (condition instanceof Headers &&
              condition.get("If-None-Match") === "*" && current) return null;
          if (condition && !(condition instanceof Headers) &&
              condition.etagMatches !== current?.etag) return null;
          objects.set(key, { text: value, etag: `etag-${++etagVersion}` });
          if ((r2Fault === "write-committed-once" ||
               r2Fault === "write-committed-foreign-owner-once") &&
              transientPutFailures++ === 0) {
            // The CAS has committed in R2, but the client did not receive its ACK.
            if (r2Fault === "write-committed-foreign-owner-once") {
              // Before the client retries, an independent writer replaces its
              // successful fence; subsequent retries must not mutate D1 or
              // remove the foreign R2 owner during compensation.
              const overridden = JSON.parse(value);
              const entry = overridden.entities.find((row) =>
                row.entity_type === "video" && row.entity_id === "vid-1");
              assert.ok(entry, "precommit did persist the video's original fence");
              entry.fence_token = "vf-foreign-after-lost-ack";
              objects.set(key, {
                text: JSON.stringify(overridden), etag: "etag-foreign-after-lost-ack",
              });
              events.push(["r2.concurrent-owner-after-lost-ack", key]);
            }
            throw new Error("public_visibility_manifest_transport_unavailable");
          }
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
      let result;
      let controlThrown = null;
      try {
        result = useCurrent
          ? await executeCurrentStatusMutation(mutationInput)
          : await executeHonoVideoVisibilityStatusMutation(mutationInput, auditedHost);
      } catch (error) {
        if (!injectedNextControl) throw error;
        controlThrown = error;
      }
      await Promise.all(pendingWakePromises);
      if (injectedNextControl) {
        if (r2Fault === "compensation-rejected") {
          assert.equal(controlThrown, null,
            "unconfirmed R2 cleanup must not propagate a redirect");
          assert.equal(result?.ok, false);
          assert.equal(result?.errorCode, "status_unverified");
          assert.equal(result?.retryable, false);
        } else {
          assert.equal(controlThrown, injectedNextControl,
            "CURRENT Next bridge rethrows exact control after verified cleanup");
        }
      } else if (r2Fault === "read" || r2Fault === "write" ||
          r2Fault === "read-after-write" ||
          r2Fault === "write-committed-foreign-owner-once") {
        assert.equal(result.ok, false, "persistent R2 errors or lost R2 ownership must stop before D1");
        assert.equal(result.errorCode, "visibility_precommit_failed");
        assert.equal(result.retryable, false, "no unsafe retry after an unconfirmed R2 fence");
      } else if (r2Fault === "compensation-rejected" && forceStaleCas) {
        assert.deepEqual(result, {
          ok: false,
          message: "状態の確認に失敗しました。状態を再取得してから操作してください。",
          errorCode: "status_unverified",
          retryable: false,
          traceId: result.traceId,
        }, "unconfirmed R2 compensation must never report D1 CAS retry or public success");
      } else if (replaceR2FenceOwner) {
        assert.equal(result.ok, false, "R2 owner changes must stop before D1");
        assert.equal(result.errorCode, "visibility_precommit_failed");
        assert.equal(result.retryable, false, "lost R2 ownership is fail-closed");
      } else if (forceStaleCas) {
        assert.equal(result.ok, false, "the stale CAS must fail");
        assert.equal(result.retryable, true, "a D1 CAS failure is recoverable");
      } else {
        assert.deepEqual(result, {
          ok: true,
          message: "ステータスを更新しました。",
          ...(transition.queueBatch.statements.length > 0
            ? { pendingPublicReflection: true }
            : {}),
        });
      }
      return {
        result,
        ...(injectedNextControl ? {
          thrownSameControl: controlThrown === injectedNextControl,
          injectedBatchAttempts,
        } : {}),
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

  for (const [initialStatus, nextStatus] of [["public", "private"], ["private", "public"]]) {
    test(`CURRENT/Hono real audited stale CAS + nine failed R2 rollbacks fail closed for ${initialStatus}→${nextStatus}`, async () => {
      const current = await executeAuditedStatus(
        nextStatus, true, true, false, false, initialStatus, "compensation-rejected",
      );
      const hono = await executeAuditedStatus(
        nextStatus, false, true, false, false, initialStatus, "compensation-rejected",
      );
      assert.deepEqual(hono, current,
        "CURRENT and Hono must fail closed with identical persisted D1/R2 and HTTP-like result");
      assert.equal(current.result.ok, false);
      assert.equal(current.result.errorCode, "status_unverified");
      assert.equal(current.result.retryable, false);
      assert.equal(current.batches, 1, "the audited D1 transaction was attempted exactly once");
      assert.equal(current.video.visibility_status, initialStatus, "D1 CAS was rolled back");
      assert.equal(current.video.updated_at, 2000, "a concurrent D1 update is preserved");
      assert.deepEqual(current.fences, [], "no D1 visibility fence survived the failed batch");
      assert.deepEqual(current.audits, [], "no strict audit survived the failed batch");
      assert.deepEqual(current.notifications, [], "no notifications survived the failed batch");
      assert.deepEqual(current.queue, [], "no rebuild queue survived the failed batch");
      assert.equal(current.manifest?.entities.length, 1,
        "the R2 precommitted block remains after every compensation CAS loss");
      assert.equal(current.manifest.entities[0].entity_id, "vid-1");
      assert.equal(current.events.filter((event) => event[0] === "r2.put").length, 10,
        "one initial R2 precommit and 3 outer x 3 inner rejected rollback CAS writes");
      assert.deepEqual(current.events.filter((event) => event[0] === "queue.send"), [],
        "no Queue wake may escape a failed audited video transition");
    });
  }

  test("CURRENT and Hono do not create R2 fences for a pending-to-private transition", async () => {
    // This changes the audited video state without crossing the public boundary.
    // Neither adapter may manufacture a new R2 blocker or D1 fence.
    const current = await executeAuditedStatus("private", true, false, false, false, "pending");
    const hono = await executeAuditedStatus("private", false, false, false, false, "pending");
    assert.deepEqual(hono, current, "CURRENT/Hono non-public transition must have identical side effects");
    assert.equal(current.result.ok, true);
    assert.equal(current.video.visibility_status, "private");
    assert.equal(current.batches, 1, "the audit and mutation run in one D1 batch");
    assert.equal(current.audits.length, 1, "status transition keeps a strict audit row");
    assert.deepEqual(current.fences, [], "no visibility fence for a non-public transition");
    assert.equal(current.manifest, null, "R2 manifest is not created");
    assert.deepEqual(current.events.filter((event) => event[0] === "r2.put"), [],
      "no R2 CAS attempt for an unchanged public boundary");
  });

  test("CURRENT and Hono persist identical release-pending fences when publishing a private video", async () => {
    // A legacy private video can have no existing visibility fence. Publishing
    // must still produce an atomic audit + release-pending fence and R2 block
    // rather than expose stale public projections before their rebuild.
    const current = await executeAuditedStatus("public", true, false, false, false, "private");
    const hono = await executeAuditedStatus("public", false, false, false, false, "private");
    assert.deepEqual(hono, current, "CURRENT Next/Hono public-release persistence and CAS must match");
    assert.equal(current.result.ok, true);
    assert.equal(current.video.visibility_status, "public");
    assert.equal(current.batches, 1, "one audited D1 transaction");
    assert.equal(current.audits.length, 1, "the public transition is strictly audited");
    assert.equal(current.fences.length, 1);
    assert.equal(current.fences[0].state, "release_pending",
      "D1 must retain the rebuild fence until fresh public projections exist");
    assert.equal(current.manifest?.entities?.length, 1);
    assert.equal(current.manifest.entities[0].fence_token, current.fences[0].fence_token,
      "R2 and D1 must refer to the same release-pending fence owner");
    assert.equal(current.events.filter((event) => event[0] === "r2.put").length, 1,
      "a conditional R2 block is created before publishing");
    assert.ok(current.queue.length > 0, "publication requests a static rebuild");
  });

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

  test("private-to-public stale D1 CAS rolls back release fence, audit and rebuild on both hosts", async () => {
    const current = await executeAuditedStatus("public", true, true, false, false, "private");
    const hono = await executeAuditedStatus("public", false, true, false, false, "private");
    assert.deepEqual(hono, current, "CURRENT/Hono public release must have identical rollback semantics");
    assert.equal(current.result.ok, false);
    assert.equal(current.result.retryable, true, "stale D1 status is retryable, not a success");
    assert.equal(current.batches, 1, "the atomic mutation was attempted once");
    assert.equal(current.video.visibility_status, "private", "D1 CAS rollback preserves the private state");
    assert.equal(current.video.updated_at, 2000, "the concurrent D1 writer is preserved");
    assert.deepEqual(current.fences, [], "release-pending D1 fence must not survive a failed CAS");
    assert.deepEqual(current.audits, [], "strict audit may not commit without the video transition");
    assert.deepEqual(current.notifications, []);
    assert.deepEqual(current.queue, [], "static rebuild must roll back atomically");
    assert.deepEqual(current.manifest?.entities, [],
      "a temporary release-blocker is compensated using its own R2 token");
    const puts = current.events.filter((event) => event[0] === "r2.put");
    assert.equal(puts.length, 2, "R2 precommit and exact-owner compensation");
    assert.equal(puts[0][2], "create-if-absent", "first R2 write is conditional");
    assert.equal(puts[1][2], "etag-1", "rollback is conditional on the R2 object version");
    assert.deepEqual(current.events.filter((event) => event[0] === "queue.send"), [],
      "a failed private-to-public transition cannot wake either queue");
  });

  for (const [initialStatus, nextStatus] of [["public", "private"], ["private", "public"]]) {
    for (const r2Fault of ["read", "write"]) {
      test(`R2 manifest ${r2Fault} outage prevents ${initialStatus}→${nextStatus} D1 commits on CURRENT/Hono`, async () => {
        const current = await executeAuditedStatus(
          nextStatus, true, false, false, false, initialStatus, r2Fault,
        );
        const hono = await executeAuditedStatus(
          nextStatus, false, false, false, false, initialStatus, r2Fault,
        );
        assert.deepEqual(hono, current, "both runtimes must fail closed on the same R2 outage");
        assert.equal(current.result.ok, false);
        assert.equal(current.result.errorCode, "visibility_precommit_failed");
        assert.equal(current.batches, 0, "R2 errors prevent any audited D1 transaction");
        assert.equal(current.video.visibility_status, initialStatus);
        assert.equal(current.video.updated_at, 1000);
        assert.deepEqual(current.fences, [], "no D1 visibility fence is recorded");
        assert.deepEqual(current.audits, [], "no partial audit is committed");
        assert.deepEqual(current.notifications, []);
        assert.deepEqual(current.queue, [], "no public rebuild is scheduled");
        assert.equal(current.manifest, null, "the failed write must not create a public block");
        assert.deepEqual(current.events.filter((event) => event[0] === "queue.send"), []);
        const writes = current.events.filter((event) => event[0] === "r2.put");
        assert.equal(writes.length, r2Fault === "write" ? MANIFEST_PUT_MAX_RETRIES : 0,
          "transport failures retry bounded conditional PUTs, but never reach D1");
        assert.ok(writes.every((event) => event[2] === "create-if-absent"),
          "R2 transport retries must preserve the create-if-absent CAS condition");
      });
    }
  }

  for (const [initialStatus, nextStatus] of [["public", "private"], ["private", "public"]]) {
    test(`transient R2 manifest PUT outage recovers safely for ${initialStatus}→${nextStatus} on CURRENT/Hono`, async () => {
      const current = await executeAuditedStatus(
        nextStatus, true, false, false, false, initialStatus, "write-once",
      );
      const hono = await executeAuditedStatus(
        nextStatus, false, false, false, false, initialStatus, "write-once",
      );
      assert.deepEqual(hono, current, "CURRENT and unmounted Hono host must recover with identical committed state");
      assert.equal(current.result.ok, true, "a transient R2 outage must not reject a safely recovered CAS");
      assert.equal(current.video.visibility_status, nextStatus);
      assert.equal(current.batches, 1, "D1 audit and state transition commit only after the R2 CAS succeeds");
      assert.equal(current.audits.length, 1, "status transition retains its strict audit");
      assert.equal(current.fences.length, 1, "a public visibility boundary requires a durable D1 fence");
      assert.equal(current.fences[0].state, nextStatus === "private" ? "blocked" : "release_pending");
      assert.equal(current.manifest?.entities?.length, 1, "the successfully retried R2 object remains present");
      assert.equal(current.manifest.entities[0].fence_token, current.fences[0].fence_token,
        "D1 and R2 must store the same owner after recovery");
      const puts = current.events.filter((event) => event[0] === "r2.put");
      assert.equal(puts.length, 2, "one simulated transport failure followed by one successful conditional PUT");
      assert.ok(puts.every((event) => event[2] === "create-if-absent"),
        "retry must preserve create-only CAS and cannot overwrite a competing blocker");
      assert.deepEqual(current.events.filter((event) => event[0] === "queue.send"), [],
        "the Hono/CURRENT fixture has dispatch disabled, so retry does not produce an uncommitted wake");
    });
  }

  for (const [initialStatus, nextStatus] of [["public", "private"], ["private", "public"]]) {
    test(`lost ACK after successful R2 manifest CAS safely recovers for ${initialStatus}→${nextStatus}`, async () => {
      const current = await executeAuditedStatus(
        nextStatus, true, false, false, false, initialStatus, "write-committed-once",
      );
      const hono = await executeAuditedStatus(
        nextStatus, false, false, false, false, initialStatus, "write-committed-once",
      );
      assert.deepEqual(hono, current, "CURRENT and unmounted Hono host must recover with identical effects");
      assert.equal(current.result.ok, true, "recoverable lost ACK must not turn a confirmed CAS into denial");
      assert.equal(current.video.visibility_status, nextStatus);
      assert.equal(current.batches, 1, "no D1 batch occurs until the R2 fence is reconfirmed");
      assert.equal(current.audits.length, 1, "strict audited write occurs once");
      assert.equal(current.fences.length, 1);
      assert.equal(current.fences[0].state, nextStatus === "private" ? "blocked" : "release_pending");
      assert.equal(current.manifest?.entities?.length, 1, "no duplicate R2 entity after uncertain commit");
      assert.equal(current.manifest.entities[0].fence_token, current.fences[0].fence_token,
        "R2 owner and D1 fence token stay identical");
      const puts = current.events.filter((event) => event[0] === "r2.put");
      assert.deepEqual(puts.map((event) => event[2]),
        ["create-if-absent", "create-if-absent", "etag-1"],
        "lost ACK retries must never use unconditional PUT; the third attempt owns exact etag");
      assert.deepEqual(current.events.filter((event) => event[0] === "queue.send"), [],
        "no Queue wake when dispatch is disabled");
    });
  }

  for (const [initialStatus, nextStatus] of [["public", "private"], ["private", "public"]]) {
    test(`foreign R2 owner after a lost PUT ACK blocks ${initialStatus}→${nextStatus} D1 mutation`, async () => {
      const current = await executeAuditedStatus(
        nextStatus, true, false, false, false, initialStatus, "write-committed-foreign-owner-once",
      );
      const hono = await executeAuditedStatus(
        nextStatus, false, false, false, false, initialStatus, "write-committed-foreign-owner-once",
      );
      assert.deepEqual(hono, current,
        "CURRENT Next and unmounted Hono must fail closed with identical effects after owner replacement");
      assert.equal(current.result.ok, false);
      assert.equal(current.result.errorCode, "visibility_precommit_failed");
      assert.equal(current.result.retryable, false, "never automatically retry a lost foreign fence");
      assert.equal(current.batches, 0, "no audited D1 transaction begins without confirmed R2 ownership");
      assert.equal(current.video.visibility_status, initialStatus, "video visibility is unchanged");
      assert.equal(current.video.updated_at, 1000);
      assert.deepEqual(current.fences, []);
      assert.deepEqual(current.audits, []);
      assert.deepEqual(current.notifications, []);
      assert.deepEqual(current.queue, []);
      assert.equal(current.manifest?.entities?.[0]?.fence_token,
        "vf-foreign-after-lost-ack", "the surviving foreign blocker must never be removed");
      const puts = current.events.filter((event) => event[0] === "r2.put");
      assert.equal(puts.length, MANIFEST_PUT_MAX_RETRIES,
        "all attempts remain bounded despite owner-conflict errors");
      assert.ok(puts.every((event) => event[2] === "create-if-absent"),
        "a lost owner never escalates to an unconditional or stale-ETag overwrite");
      assert.equal(current.events.filter((event) =>
        event[0] === "r2.concurrent-owner-after-lost-ack").length, 1);
      assert.deepEqual(current.events.filter((event) => event[0] === "queue.send"), []);
    });
  }

  for (const [initialStatus, nextStatus] of [["public", "private"], ["private", "public"]]) {
    test(`R2 read-back outage after a committed block holds ${initialStatus}→${nextStatus} fail-closed`, async () => {
      const current = await executeAuditedStatus(
        nextStatus, true, false, false, false, initialStatus, "read-after-write",
      );
      const hono = await executeAuditedStatus(
        nextStatus, false, false, false, false, initialStatus, "read-after-write",
      );
      assert.deepEqual(hono, current,
        "CURRENT bridge and Hono adapter must fail closed identically without a confirmed R2 read-back");
      assert.equal(current.result.ok, false);
      assert.equal(current.result.errorCode, "visibility_precommit_failed");
      assert.equal(current.result.retryable, false,
        "unconfirmed R2 fence state is never safe to retry automatically");
      assert.equal(current.batches, 0, "an unverified R2 fence cannot authorize any D1 mutation");
      assert.equal(current.video.visibility_status, initialStatus);
      assert.equal(current.video.updated_at, 1000);
      assert.deepEqual(current.fences, []);
      assert.deepEqual(current.audits, []);
      assert.deepEqual(current.notifications, []);
      assert.deepEqual(current.queue, []);
      assert.equal(current.manifest?.entities?.length, 1,
        "the committed R2 public blocker must stay in place when read-back fails");
      assert.equal(current.manifest.entities[0].entity_type, "video");
      assert.equal(current.manifest.entities[0].entity_id, "vid-1");
      assert.equal(current.events.filter((event) => event[0] === "r2.put").length, 1,
        "R2 blocker is not overwritten or compensated away without confirmed ownership");
      assert.ok(current.events.filter((event) => event[0] === "r2.get").length >= 2,
        "initial read succeeded; confirmation and best-effort compensation tried to re-read");
      assert.deepEqual(current.events.filter((event) => event[0] === "queue.send"), [],
        "no post-commit side effect can run without the D1 commit");
    });
  }

  test("private-to-public foreign R2 owner fails closed before D1 on CURRENT and Hono", async () => {
    const current = await executeAuditedStatus("public", true, false, true, false, "private");
    const hono = await executeAuditedStatus("public", false, false, true, false, "private");
    assert.deepEqual(hono, current, "both adapters reject a lost release-block owner");
    assert.equal(current.result.ok, false);
    assert.equal(current.result.errorCode, "visibility_precommit_failed");
    assert.equal(current.result.retryable, false);
    assert.equal(current.batches, 0, "no mutation may start after losing the R2 CAS");
    assert.equal(current.video.visibility_status, "private");
    assert.equal(current.video.updated_at, 1000, "the initial private row stays unchanged");
    assert.deepEqual(current.fences, []);
    assert.deepEqual(current.audits, []);
    assert.deepEqual(current.notifications, []);
    assert.deepEqual(current.queue, []);
    assert.equal(current.manifest?.entities?.[0]?.fence_token, "vf-foreign-owner",
      "foreign R2 blocker remains authoritative");
    assert.equal(current.events.filter((event) => event[0] === "r2.put").length, 1,
      "compensation must never overwrite the new R2 owner");
    assert.deepEqual(current.events.filter((event) => event[0] === "queue.send"), []);
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

  test("CURRENT Next bridge defers framework redirect until R2 fence cleanup is verified", async () => {
    for (const [r2Fault, unverified] of [
      [null, false],
      ["compensation-rejected", true],
    ]) {
      const control = Object.assign(new Error("private NEXT redirect sentinel"), {
        digest: "NEXT_REDIRECT;push;/video;307;",
      });
      const state = await executeAuditedStatus(
        "private", true, false, false, false, "public", r2Fault, control,
      );
      assert.equal(state.injectedBatchAttempts, 1,
        "real CURRENT audit pipeline reaches D1 batch only after R2 precommit");
      assert.equal(state.batches, 0,
        "injected D1 exception prevents all audited writes from committing");
      assert.equal(state.video.visibility_status, "public");
      assert.deepEqual(state.fences, []);
      assert.deepEqual(state.audits, []);
      assert.deepEqual(state.notifications, []);
      assert.deepEqual(state.queue, []);
      assert.deepEqual(state.events.filter(event => event[0] === "queue.send"), []);
      assert.equal(state.thrownSameControl, !unverified);
      if (unverified) {
        assert.equal(state.result.errorCode, "status_unverified");
        assert.equal(state.result.retryable, false);
        assert.equal(state.manifest.entities.length, 1,
          "unconfirmed rollback leaves R2 public block in place");
      } else {
        assert.deepEqual(state.manifest.entities, [],
          "confirmed rollback removes original R2 video block");
      }
      const puts = state.events.filter(event => event[0] === "r2.put");
      assert.equal(puts[0][2], "create-if-absent");
      assert.equal(puts.length, unverified ? 10 : 2,
        "R2 compensation is bounded and token/etag scoped");
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
