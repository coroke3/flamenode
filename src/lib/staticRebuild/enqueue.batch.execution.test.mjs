import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return {
          url: "data:text/javascript,export%20{}",
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const {
    buildStaticRebuildQueueBatch,
    MAX_STATIC_REBUILD_BATCH_TARGETS,
  } = await import("./enqueue.ts");

  const baseline = readFileSync(
    new URL("../../../migrations/0000_flame_node_baseline.sql", import.meta.url),
    "utf8",
  );

  function createDb(sqlite) {
    return drizzle(async (sql, params, method) => {
      const statement = sqlite.prepare(sql);
      if (method === "run") {
        statement.run(...params);
        return { rows: [] };
      }
      return { rows: statement.all(...params) };
    });
  }

  function sqlFromStatement(statement) {
    if (typeof statement.getQuery === "function") {
      return statement.getQuery();
    }
    if (typeof statement.toSQL === "function") {
      return statement.toSQL();
    }
    throw new Error("unsupported batch statement");
  }

  async function runBatch(sqlite, items) {
    const db = createDb(sqlite);
    const batch = await buildStaticRebuildQueueBatch(db, items);
    const expected = [...batch.expectedChanges];
    for (const statement of batch.statements) {
      const { sql, params } = sqlFromStatement(statement);
      const info = sqlite.prepare(sql).run(...params);
      assert.equal(info.changes, expected.shift());
    }
    return batch;
  }

  function getRow(sqlite, targetType, targetId) {
    return sqlite
      .prepare(
        `SELECT *
         FROM static_rebuild_queue
         WHERE target_type = ? AND target_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(targetType, targetId);
  }

  test("Case A: processing行へのenqueueはleaseを保持しupdated_atだけ進める", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(baseline);
    sqlite.exec(`
      INSERT INTO static_rebuild_queue (
        id, target_type, target_id, reason, priority, status,
        attempt_count, lease_token, lease_expires_at,
        processing_started_at, created_at, updated_at
      ) VALUES (
        'srb-processing', 'video', 'video-1', 'old_reason', 'normal', 'processing',
        1, 'lease-abc', 9999, 100, 90, 100
      );
    `);

    const before = getRow(sqlite, "video", "video-1");
    await runBatch(sqlite, [{
      targetType: "video",
      targetId: "video-1",
      reason: "visibility_change",
      priority: "high",
    }]);
    const after = getRow(sqlite, "video", "video-1");

    assert.equal(after.status, "processing");
    assert.equal(after.lease_token, "lease-abc");
    assert.equal(after.lease_expires_at, 9999);
    assert.equal(after.attempt_count, 1);
    assert.equal(after.processing_started_at, 100);
    assert.ok(after.updated_at > before.updated_at);
    assert.ok(after.updated_at > after.processing_started_at);
    assert.equal(after.reason, "visibility_change");
    sqlite.close();
  });

  test("Case B: pending行へのenqueueは同一active行を更新する", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(baseline);
    sqlite.exec(`
      INSERT INTO static_rebuild_queue (
        id, target_type, target_id, reason, priority, status,
        attempt_count, created_at, updated_at
      ) VALUES (
        'srb-pending', 'event', 'event-1', 'old_reason', 'normal', 'pending',
        0, 10, 10
      );
    `);

    await runBatch(sqlite, [{
      targetType: "event",
      targetId: "event-1",
      reason: "event_update",
      priority: "high",
      requestedByUserId: "user-1",
    }]);

    const rows = sqlite
      .prepare(
        `SELECT COUNT(*) AS count
         FROM static_rebuild_queue
         WHERE target_type = 'event' AND target_id = 'event-1' AND status IN ('pending', 'processing')`,
      )
      .get();
    assert.equal(rows.count, 1);
    const row = getRow(sqlite, "event", "event-1");
    assert.equal(row.id, "srb-pending");
    assert.equal(row.status, "pending");
    assert.equal(row.reason, "event_update");
    assert.equal(row.priority, "high");
    assert.equal(row.requested_by_user_id, "user-1");
    assert.ok(row.updated_at > 10);
    sqlite.close();
  });

  test("Case C: active行がなければpendingを新規insertする", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(baseline);

    await runBatch(sqlite, [{
      targetType: "top",
      targetId: "global",
      reason: "manual_repair",
    }]);

    const row = getRow(sqlite, "top", "global");
    assert.equal(row.status, "pending");
    assert.equal(row.reason, "manual_repair");
    assert.equal(row.attempt_count, 0);
    sqlite.close();
  });

  test("Case D: 256 targetは50行chunkの6 UPSERT文でbind上限内", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(baseline);
    const items = Array.from({ length: MAX_STATIC_REBUILD_BATCH_TARGETS }, (_, index) => ({
      targetType: "event",
      targetId: `event-${index}`,
      reason: "bulk_enqueue",
    }));
    const db = createDb(sqlite);
    const batch = await buildStaticRebuildQueueBatch(db, items);
    assert.equal(batch.statements.length, 6);
    assert.deepEqual(batch.expectedChanges, [50, 50, 50, 50, 50, 6]);
    for (const statement of batch.statements) {
      const { params } = sqlFromStatement(statement);
      assert.ok(params.length <= 100);
    }
    await runBatch(sqlite, items);
    const count = sqlite
      .prepare("SELECT COUNT(*) AS count FROM static_rebuild_queue")
      .get().count;
    assert.equal(count, MAX_STATIC_REBUILD_BATCH_TARGETS);
    sqlite.close();
  });

  test("Case E: processing行へのUPSERTはstatus CASなしで成功する", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(baseline);
    sqlite.exec(`
      INSERT INTO static_rebuild_queue (
        id, target_type, target_id, reason, priority, status,
        attempt_count, lease_token, lease_expires_at,
        processing_started_at, created_at, updated_at
      ) VALUES (
        'srb-claim-race', 'video', 'video-race', 'worker_claim', 'normal', 'processing',
        1, 'fresh-lease', 5000, 200, 150, 200
      );
    `);

    const batch = await runBatch(sqlite, [{
      targetType: "video",
      targetId: "video-race",
      reason: "concurrent_enqueue",
    }]);
    assert.equal(batch.acceptedTargetCount, 1);

    const after = getRow(sqlite, "video", "video-race");
    assert.equal(after.status, "processing");
    assert.equal(after.lease_token, "fresh-lease");
    assert.ok(after.updated_at > 200);
    sqlite.close();
  });

  test("低優先度enqueueは高優先度reasonを上書きしない", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(baseline);
    sqlite.exec(`
      INSERT INTO static_rebuild_queue (
        id, target_type, target_id, reason, priority, status,
        attempt_count, created_at, updated_at
      ) VALUES (
        'srb-high', 'video', 'video-meta', 'important_reason', 'high', 'pending',
        0, 1, 1
      );
    `);

    await runBatch(sqlite, [{
      targetType: "video",
      targetId: "video-meta",
      reason: "low_priority_touch",
      priority: "low",
    }]);

    const row = getRow(sqlite, "video", "video-meta");
    assert.equal(row.reason, "important_reason");
    assert.equal(row.priority, "high");
    sqlite.close();
  });

  test("requested_by_user_idはincomingがnullなら既存を保持する", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(baseline);
    sqlite.exec(`
      INSERT INTO static_rebuild_queue (
        id, target_type, target_id, reason, priority, status,
        requested_by_user_id, attempt_count, created_at, updated_at
      ) VALUES (
        'srb-user', 'event', 'event-user', 'old', 'normal', 'pending',
        'existing-user', 0, 1, 1
      );
    `);

    await runBatch(sqlite, [{
      targetType: "event",
      targetId: "event-user",
      reason: "touch",
    }]);

    const row = getRow(sqlite, "event", "event-user");
    assert.equal(row.requested_by_user_id, "existing-user");
    sqlite.close();
  });

  test("video visibility fence reason survives a competing active enqueue", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(baseline);
    sqlite.exec(`
      INSERT INTO static_rebuild_queue (
        id, target_type, target_id, reason, priority, status,
        attempt_count, created_at, updated_at
      ) VALUES (
        'srb-visibility', 'video', 'video-visibility',
        'video_visibility_update', 'high', 'pending', 0, 1, 1
      );
    `);

    await runBatch(sqlite, [{
      targetType: "video",
      targetId: "video-visibility",
      reason: "event_id_rename",
      priority: "high",
    }]);

    const row = getRow(sqlite, "video", "video-visibility");
    assert.equal(row.reason, "video_visibility_update");
    assert.equal(row.priority, "high");
    sqlite.close();
  });

  test("a visibility enqueue restores its release reason even at lower incoming priority", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(baseline);
    sqlite.exec(`
      INSERT INTO static_rebuild_queue (
        id, target_type, target_id, reason, priority, status,
        attempt_count, created_at, updated_at
      ) VALUES (
        'srb-ordinary', 'video', 'video-visibility-incoming',
        'event_update', 'high', 'pending', 0, 1, 1
      );
    `);

    await runBatch(sqlite, [{
      targetType: "video",
      targetId: "video-visibility-incoming",
      reason: "video_visibility_update",
      priority: "low",
    }]);

    const row = getRow(sqlite, "video", "video-visibility-incoming");
    assert.equal(row.reason, "video_visibility_update");
    assert.equal(row.priority, "high");
    sqlite.close();
  });

  test("old-event cleanup reason survives a competing active enqueue", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(baseline);
    sqlite.exec(`
      INSERT INTO static_rebuild_queue (
        id, target_type, target_id, reason, priority, status,
        attempt_count, created_at, updated_at
      ) VALUES (
        'srb-rename-cleanup', 'event', 'old-event-id',
        'event_id_rename_old_cleanup', 'high', 'pending', 0, 1, 1
      );
    `);

    await runBatch(sqlite, [{
      targetType: "event",
      targetId: "old-event-id",
      reason: "event_settings_update",
      priority: "high",
    }]);

    const row = getRow(sqlite, "event", "old-event-id");
    assert.equal(row.reason, "event_id_rename_old_cleanup");
    sqlite.close();
  });

  // Source of truth: workers/json-generator/queue.ts markDoneAttempt
  const MARK_DONE_SQL = `UPDATE static_rebuild_queue
     SET status = CASE
           WHEN updated_at > COALESCE(processing_started_at, updated_at)
             THEN 'pending'
           ELSE 'done'
         END,
         processed_at = CASE
           WHEN updated_at > COALESCE(processing_started_at, updated_at)
             THEN NULL
             ELSE ?
         END,
         updated_at = CASE
           WHEN updated_at > COALESCE(processing_started_at, updated_at)
             THEN updated_at
             ELSE ?
         END,
         attempt_count = 0,
         error = NULL,
         processing_started_at = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         next_retry_at = NULL
     WHERE id = ? AND status = 'processing' AND lease_token = ?`;

  function runMarkDone(sqlite, { id, token, now }) {
    return sqlite.prepare(MARK_DONE_SQL).run(now, now, id, token);
  }

  test("Case F: UPSERT dirty during processing then markDone requeues to pending", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(baseline);
    sqlite.exec(`
      INSERT INTO static_rebuild_queue (
        id, target_type, target_id, reason, priority, status,
        attempt_count, lease_token, lease_expires_at,
        processing_started_at, created_at, updated_at
      ) VALUES (
        'srb-dirty', 'video', 'video-dirty', 'worker_claim', 'normal', 'processing',
        1, 'lease-dirty', 9999, 200, 150, 200
      );
    `);

    const before = getRow(sqlite, "video", "video-dirty");
    await runBatch(sqlite, [{
      targetType: "video",
      targetId: "video-dirty",
      reason: "visibility_change",
      priority: "high",
    }]);
    const afterUpsert = getRow(sqlite, "video", "video-dirty");

    assert.equal(afterUpsert.status, "processing");
    assert.equal(afterUpsert.lease_token, "lease-dirty");
    assert.equal(afterUpsert.lease_expires_at, 9999);
    assert.equal(afterUpsert.attempt_count, 1);
    assert.equal(afterUpsert.processing_started_at, 200);
    assert.ok(afterUpsert.updated_at > before.updated_at);
    assert.ok(afterUpsert.updated_at > afterUpsert.processing_started_at);

    const markDone = runMarkDone(sqlite, {
      id: "srb-dirty",
      token: "lease-dirty",
      now: 500,
    });
    assert.equal(markDone.changes, 1);

    const afterMarkDone = getRow(sqlite, "video", "video-dirty");
    assert.equal(afterMarkDone.status, "pending");
    assert.equal(afterMarkDone.processed_at, null);
    assert.equal(afterMarkDone.lease_token, null);
    assert.equal(afterMarkDone.attempt_count, 0);
    sqlite.close();
  });
}
