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
  const { directEnqueueStaticRebuild } = await import("./directEnqueue.ts");

  const PUBLIC_MISS_CAUSE = { kind: "public_miss", cooldownSeconds: 300 };
  const BASE_INPUT = {
    targetType: "video",
    targetId: "video-public",
    reason: "public_video_detail_miss",
    priority: "normal",
  };

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
      const rows = statement.all(...params);
      return {
        success: true,
        results: rows,
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
    const baseline = readFileSync(
      new URL("../../../migrations/0000_flame_node_baseline.sql", import.meta.url),
      "utf8",
    );
    sqlite.exec(baseline);

    let wakeSendCalls = 0;
    const wakeOptions = {
      envFlags: { QUEUE_DISPATCH_ENABLED: "1" },
      queue: {
        async send() {
          wakeSendCalls += 1;
        },
      },
    };

    const db = drizzle(createD1Client(sqlite), { schema });
    t.after(() => sqlite.close());

    return {
      sqlite,
      db,
      wakeOptions,
      getWakeSendCalls: () => wakeSendCalls,
      insertRow(row) {
        sqlite
          .prepare(
            `INSERT INTO static_rebuild_queue (
              id, target_type, target_id, reason, priority, status,
              attempt_count, created_at, updated_at, lease_token,
              requested_by_user_id, processed_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
          )
          .run(
            row.id,
            row.targetType ?? BASE_INPUT.targetType,
            row.targetId ?? BASE_INPUT.targetId,
            row.reason ?? BASE_INPUT.reason,
            row.priority ?? "normal",
            row.status,
            row.createdAt ?? 100,
            row.updatedAt ?? 100,
            row.leaseToken ?? null,
            row.requestedByUserId ?? null,
            row.processedAt ?? null,
          );
      },
      readRow(id) {
        return sqlite
          .prepare(
            `SELECT id, priority, reason, status, updated_at, requested_by_user_id
             FROM static_rebuild_queue WHERE id = ?`,
          )
          .get(id);
      },
    };
  }

  test("public_miss + processing は UPDATE も wake もしない", async (t) => {
    const harness = createHarness(t);
    harness.insertRow({
      id: "queue-processing",
      status: "processing",
      updatedAt: 200,
      leaseToken: "lease-1",
    });

    const result = await directEnqueueStaticRebuild(
      harness.db,
      BASE_INPUT,
      PUBLIC_MISS_CAUSE,
      harness.wakeOptions,
    );

    assert.deepEqual(result, {
      ok: true,
      action: "active_updated",
      rebuildState: "already_active",
    });
    const row = harness.readRow("queue-processing");
    assert.equal(row.priority, "normal");
    assert.equal(row.reason, BASE_INPUT.reason);
    assert.equal(row.updated_at, 200);
    assert.equal(harness.getWakeSendCalls(), 0);
  });

  test("public_miss + pending 同一 priority/reason は UPDATE も wake もしない", async (t) => {
    const harness = createHarness(t);
    harness.insertRow({
      id: "queue-pending",
      status: "pending",
      updatedAt: 150,
    });

    const result = await directEnqueueStaticRebuild(
      harness.db,
      BASE_INPUT,
      PUBLIC_MISS_CAUSE,
      harness.wakeOptions,
    );

    assert.deepEqual(result, {
      ok: true,
      action: "active_updated",
      rebuildState: "already_active",
    });
    const row = harness.readRow("queue-pending");
    assert.equal(row.priority, "normal");
    assert.equal(row.reason, BASE_INPUT.reason);
    assert.equal(row.updated_at, 150);
    assert.equal(harness.getWakeSendCalls(), 0);
  });

  test("public_miss + pending 高優先度入力は priority を UPDATE して wake する", async (t) => {
    const harness = createHarness(t);
    harness.insertRow({
      id: "queue-pending",
      status: "pending",
      updatedAt: 150,
    });

    const result = await directEnqueueStaticRebuild(
      harness.db,
      { ...BASE_INPUT, priority: "high" },
      PUBLIC_MISS_CAUSE,
      harness.wakeOptions,
    );

    assert.deepEqual(result, {
      ok: true,
      action: "active_updated",
      rebuildState: "already_active",
    });
    const row = harness.readRow("queue-pending");
    assert.equal(row.priority, "high");
    assert.equal(row.reason, BASE_INPUT.reason);
    assert.ok(row.updated_at > 150);
    assert.equal(harness.getWakeSendCalls(), 1);
  });

  test("cooldown 中の done 行は direct enqueue を抑止する", async (t) => {
    const harness = createHarness(t);
    const now = Math.floor(Date.now() / 1000);
    harness.insertRow({
      id: "queue-done",
      status: "done",
      updatedAt: now - 10,
      processedAt: now - 10,
    });

    const result = await directEnqueueStaticRebuild(
      harness.db,
      BASE_INPUT,
      PUBLIC_MISS_CAUSE,
      harness.wakeOptions,
    );

    assert.deepEqual(result, {
      ok: true,
      action: "cooldown_skipped",
      rebuildState: "cooldown_suppressed",
    });
    assert.equal(
      harness.sqlite
        .prepare("SELECT COUNT(*) AS count FROM static_rebuild_queue")
        .get().count,
      1,
    );
    assert.equal(harness.getWakeSendCalls(), 0);
  });

  test("active 行が無ければ insert して wake する", async (t) => {
    const harness = createHarness(t);
    const now = Math.floor(Date.now() / 1000);
    harness.insertRow({
      id: "queue-done-old",
      status: "done",
      updatedAt: now - 400,
      processedAt: now - 400,
    });

    const result = await directEnqueueStaticRebuild(
      harness.db,
      BASE_INPUT,
      PUBLIC_MISS_CAUSE,
      harness.wakeOptions,
    );

    assert.deepEqual(result, {
      ok: true,
      action: "inserted",
      rebuildState: "requested",
    });
    assert.equal(
      harness.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM static_rebuild_queue WHERE status = 'pending'",
        )
        .get().count,
      1,
    );
    assert.equal(harness.getWakeSendCalls(), 1);
  });
}
