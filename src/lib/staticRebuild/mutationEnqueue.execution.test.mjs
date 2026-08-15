import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return {
          url: "data:text/javascript,export%20{}",
          shortCircuit: true,
        };
      }
      if (specifier === "@opennextjs/cloudflare") {
        return {
          url: "data:text/javascript,export%20function%20getCloudflareContext()%20%7B%20throw%20new%20Error(%22no%20context%22)%3B%20%7D",
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/d1");
  const schema = await import("../db/schema.ts");
  const { enqueueStaticRebuild, directEnqueueStaticRebuild } = await import(
    "./enqueue.ts",
  );

  const baseline = readFileSync(
    new URL("../../../migrations/0000_flame_node_baseline.sql", import.meta.url),
    "utf8",
  );

  function resultMeta(changes = 0, lastRowId = 0) {
    return {
      duration: 0,
      changes,
      last_row_id: lastRowId,
      changed_db: changes > 0,
      rows_read: 0,
      rows_written: changes,
      size_after: 0,
    };
  }

  function createD1Client(sqlite) {
    function execute(query, params, method) {
      const statement = sqlite.prepare(query);
      if (method === "run") {
        const info = statement.run(...params);
        return {
          success: true,
          results: [],
          meta: resultMeta(Number(info.changes), Number(info.lastInsertRowid)),
        };
      }
      return {
        success: true,
        results: statement.all(...params),
        meta: resultMeta(),
      };
    }

    function prepared(query, params = []) {
      return {
        query,
        params,
        bind(...values) {
          return prepared(query, values);
        },
        async run() {
          return execute(query, params, "run");
        },
        async all() {
          return execute(query, params, "all");
        },
        async raw() {
          const result = execute(query, params, "all");
          return result.results.map((row) => Object.values(row));
        },
        async first(columnName) {
          const result = execute(query, params, "all");
          const row = result.results[0];
          if (!row) return null;
          return columnName ? row[columnName] : row;
        },
      };
    }

    return {
      prepare(query) {
        return prepared(query);
      },
      async batch(statements) {
        sqlite.exec("BEGIN");
        try {
          const results = statements.map((statement) => {
            const sqliteStatement = sqlite.prepare(statement.query);
            return execute(
              statement.query,
              statement.params,
              sqliteStatement.columns().length > 0 ? "all" : "run",
            );
          });
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    };
  }

  function createHarness(t) {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(baseline);
    const db = drizzle(createD1Client(sqlite), { schema });
    t.after(() => sqlite.close());
    return { sqlite, db };
  }

  function insertRow(sqlite, row) {
    sqlite
      .prepare(
        `INSERT INTO static_rebuild_queue (
           id, target_type, target_id, reason, priority, status,
           attempt_count, created_at, updated_at, processing_started_at,
           lease_token, lease_expires_at, processed_at, next_retry_at
         ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.targetType ?? "video",
        row.targetId ?? "video-1",
        row.reason ?? "old_reason",
        row.priority ?? "normal",
        row.status,
        row.createdAt ?? 100,
        row.updatedAt ?? 100,
        row.processingStartedAt ?? null,
        row.leaseToken ?? null,
        row.leaseExpiresAt ?? null,
        row.processedAt ?? null,
        row.nextRetryAt ?? null,
      );
  }

  function rowsFor(sqlite, targetId) {
    return sqlite
      .prepare(
        `SELECT id, status, reason, priority, updated_at, processing_started_at,
                lease_token, processed_at, next_retry_at
           FROM static_rebuild_queue
          WHERE target_type = 'video' AND target_id = ?
          ORDER BY id`,
      )
      .all(targetId);
  }

  const enqueueOptions = {
    envFlags: { QUEUE_DISPATCH_ENABLED: "0" },
  };

  test("A: mutation enqueue does not suppress a recent done row", async (t) => {
    const harness = createHarness(t);
    const now = Math.floor(Date.now() / 1000);
    insertRow(harness.sqlite, {
      id: "done-recent",
      status: "done",
      updatedAt: now - 1,
      processedAt: now - 1,
    });

    await enqueueStaticRebuild(
      harness.db,
      {
        targetType: "video",
        targetId: "video-1",
        reason: "video_mutation_after_done",
      },
      enqueueOptions,
    );

    const rows = rowsFor(harness.sqlite, "video-1");
    assert.equal(rows.filter((row) => row.status === "pending").length, 1);
  });

  test("B: mutation enqueue does not suppress a failed row awaiting retry", async (t) => {
    const harness = createHarness(t);
    const now = Math.floor(Date.now() / 1000);
    insertRow(harness.sqlite, {
      id: "failed-retry",
      status: "failed",
      updatedAt: now - 1,
      nextRetryAt: now + 300,
    });

    await enqueueStaticRebuild(
      harness.db,
      {
        targetType: "video",
        targetId: "video-1",
        reason: "video_mutation_after_failure",
      },
      enqueueOptions,
    );

    const rows = rowsFor(harness.sqlite, "video-1");
    assert.equal(rows.filter((row) => row.status === "pending").length, 1);
  });

  test("C: mutation enqueue keeps a pending row and advances its generation", async (t) => {
    const harness = createHarness(t);
    insertRow(harness.sqlite, {
      id: "pending-generation",
      status: "pending",
      updatedAt: 100,
    });

    await enqueueStaticRebuild(
      harness.db,
      {
        targetType: "video",
        targetId: "video-1",
        reason: "video_mutation_pending",
        priority: "high",
      },
      enqueueOptions,
    );

    const [row] = rowsFor(harness.sqlite, "video-1");
    assert.equal(row.status, "pending");
    assert.equal(row.priority, "high");
    assert.ok(row.updated_at > 100);
  });

  test("D: mutation enqueue keeps a processing lease and marks it dirty", async (t) => {
    const harness = createHarness(t);
    insertRow(harness.sqlite, {
      id: "processing-generation",
      status: "processing",
      updatedAt: 100,
      processingStartedAt: 100,
      leaseToken: "lease-1",
      leaseExpiresAt: 9999,
    });

    await enqueueStaticRebuild(
      harness.db,
      {
        targetType: "video",
        targetId: "video-1",
        reason: "video_mutation_processing",
      },
      enqueueOptions,
    );

    const [row] = rowsFor(harness.sqlite, "video-1");
    assert.equal(row.status, "processing");
    assert.equal(row.lease_token, "lease-1");
    assert.ok(row.updated_at > row.processing_started_at);
  });

  test("E: public miss keeps its done cooldown", async (t) => {
    const harness = createHarness(t);
    const now = Math.floor(Date.now() / 1000);
    insertRow(harness.sqlite, {
      id: "public-done-recent",
      status: "done",
      updatedAt: now - 1,
      processedAt: now - 1,
    });

    const result = await directEnqueueStaticRebuild(
      harness.db,
      {
        targetType: "video",
        targetId: "video-1",
        reason: "public_video_detail_miss",
      },
      { kind: "public_miss", cooldownSeconds: 300 },
      enqueueOptions,
    );

    assert.equal(result.action, "cooldown_skipped");
    assert.equal(rowsFor(harness.sqlite, "video-1").length, 1);
  });

  test("F: periodic refresh keeps its configured done cooldown", async (t) => {
    const harness = createHarness(t);
    const now = Math.floor(Date.now() / 1000);
    insertRow(harness.sqlite, {
      id: "periodic-done-recent",
      status: "done",
      updatedAt: now - 1,
      processedAt: now - 1,
    });

    const result = await directEnqueueStaticRebuild(
      harness.db,
      {
        targetType: "video",
        targetId: "video-1",
        reason: "periodic_event_refresh",
      },
      { kind: "periodic", cooldownSeconds: 60 },
      enqueueOptions,
    );

    assert.equal(result.action, "cooldown_skipped");
    assert.equal(rowsFor(harness.sqlite, "video-1").length, 1);
  });

  test("G: manual repair bypasses a recent done cooldown", async (t) => {
    const harness = createHarness(t);
    const now = Math.floor(Date.now() / 1000);
    insertRow(harness.sqlite, {
      id: "manual-done-recent",
      status: "done",
      updatedAt: now - 1,
      processedAt: now - 1,
    });

    const result = await directEnqueueStaticRebuild(
      harness.db,
      {
        targetType: "video",
        targetId: "video-1",
        reason: "manual_repair",
      },
      { kind: "manual_repair", cooldownSeconds: 0 },
      enqueueOptions,
    );

    assert.equal(result.action, "inserted");
    assert.equal(
      rowsFor(harness.sqlite, "video-1").filter((row) => row.status === "pending")
        .length,
      1,
    );
  });

  test("H: mutation callsites use the non-cooldown path", async () => {
    const [rules, xid, eventStaff] = await Promise.all([
      readFileSync(new URL("../actions/rules.ts", import.meta.url), "utf8"),
      readFileSync(new URL("../actions/xid.ts", import.meta.url), "utf8"),
      readFileSync(new URL("../actions/event-staff-admin.ts", import.meta.url), "utf8"),
    ]);
    assert.match(rules, /buildStaticRebuildQueueBatch/);
    assert.match(xid, /buildAfterXUserPublicUpdateQueueBatch/);
    assert.match(eventStaff, /enqueueStaticRebuildMany/);
    assert.doesNotMatch(rules, /directEnqueueStaticRebuild/);
    assert.doesNotMatch(xid, /directEnqueueStaticRebuild/);
    assert.doesNotMatch(eventStaff, /directEnqueueStaticRebuild/);
  });
}
