import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  DEPLOY_GLOBAL_REBUILD_TARGETS,
  ensureDeployGlobalRebuilds,
} from "./deployGlobalRebuildEnqueue.ts";

function createSqliteEnv() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE static_rebuild_queue (
      id TEXT PRIMARY KEY NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX static_rebuild_queue_target_pending_uniq
      ON static_rebuild_queue (target_type, target_id)
      WHERE status IN ('pending', 'processing');
  `);

  const DB = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async all() {
              return { results: sqlite.prepare(sql).all(...values) };
            },
            async first() {
              return sqlite.prepare(sql).get(...values) ?? null;
            },
            async run() {
              const result = sqlite.prepare(sql).run(...values);
              return { meta: { changes: Number(result.changes ?? 0) } };
            },
          };
        },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => {
          const result = sqlite.prepare(statement.sql).run(...statement.values);
          return { meta: { changes: Number(result.changes ?? 0) } };
        });
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };

  // Keep the small D1 wrapper above introspectable for batch execution.
  const originalPrepare = DB.prepare;
  DB.prepare = (sql) => {
    const statement = originalPrepare(sql);
    const originalBind = statement.bind;
    statement.bind = (...values) => {
      const bound = originalBind(...values);
      return Object.assign(bound, { sql, values });
    };
    return statement;
  };

  const kv = new Map();
  return {
    env: {
      DB,
      KV: {
        async get(key) {
          return kv.get(key) ?? null;
        },
        async put(key, value) {
          kv.set(key, value);
        },
      },
    },
    sqlite,
  };
}

test("deploy global enqueue uses one JSON1 upsert statement for all targets", async () => {
  const { env, sqlite } = createSqliteEnv();
  const first = await ensureDeployGlobalRebuilds(env, {
    commitSha: "a".repeat(40),
  });
  assert.equal(first, DEPLOY_GLOBAL_REBUILD_TARGETS.length);
  assert.equal(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM static_rebuild_queue WHERE target_id = 'global' AND status = 'pending'",
      )
      .get().count,
    DEPLOY_GLOBAL_REBUILD_TARGETS.length,
  );

  sqlite
    .prepare(
      "UPDATE static_rebuild_queue SET status = 'done' WHERE target_type = ? AND target_id = 'global'",
    )
    .run(DEPLOY_GLOBAL_REBUILD_TARGETS[0]);

  const second = await ensureDeployGlobalRebuilds(env, {
    commitSha: "b".repeat(40),
  });
  assert.equal(second, DEPLOY_GLOBAL_REBUILD_TARGETS.length);
  assert.equal(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM static_rebuild_queue WHERE target_id = 'global' AND status = 'pending'",
      )
      .get().count,
    DEPLOY_GLOBAL_REBUILD_TARGETS.length,
  );
});

function countRows(sqlite, where) {
  return sqlite
    .prepare(`SELECT COUNT(*) AS count FROM static_rebuild_queue WHERE ${where}`)
    .get().count;
}

test("同一commitのfailed deploy行は該当targetだけを1回retryし、ループしない", async () => {
  const { env, sqlite } = createSqliteEnv();
  const commitSha = "c".repeat(40);
  const first = await ensureDeployGlobalRebuilds(env, { commitSha });
  assert.equal(first, DEPLOY_GLOBAL_REBUILD_TARGETS.length);

  // 全件完了させ、1件だけ永続failedにする。
  sqlite.exec("UPDATE static_rebuild_queue SET status = 'done'");
  sqlite
    .prepare(
      "UPDATE static_rebuild_queue SET status = 'failed', attempt_count = 4 WHERE target_type = 'search_index'",
    )
    .run();

  // (a) failed target だけがretry reasonで再enqueueされ、failed行はretried化される。
  const retry = await ensureDeployGlobalRebuilds(env, { commitSha });
  assert.equal(retry, 1);
  assert.deepEqual(
    sqlite
      .prepare(
        "SELECT target_type, reason, priority, status FROM static_rebuild_queue WHERE status = 'pending'",
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        target_type: "search_index",
        reason: "deploy_generator_change_retry",
        priority: "high",
        status: "pending",
      },
    ],
  );
  assert.equal(
    countRows(
      sqlite,
      "status = 'failed' AND reason = 'deploy_generator_change_retried' AND target_type = 'search_index'",
    ),
    1,
  );
  assert.equal(countRows(sqlite, "status = 'failed' AND reason = 'deploy_generator_change'"), 0);

  // (b) retry行がpending中に再実行しても追加enqueueされない（count>0はwake用の既存契約ではなく
  // failed検出が0件であることを確認する）。
  const rowsBefore = countRows(sqlite, "1 = 1");
  assert.equal(await ensureDeployGlobalRebuilds(env, { commitSha }), 0);
  assert.equal(countRows(sqlite, "1 = 1"), rowsBefore);

  // (c) retry行も失敗しても自動再enqueueしない。
  sqlite
    .prepare(
      "UPDATE static_rebuild_queue SET status = 'failed', attempt_count = 4 WHERE reason = 'deploy_generator_change_retry'",
    )
    .run();
  assert.equal(await ensureDeployGlobalRebuilds(env, { commitSha }), 0);
  assert.equal(countRows(sqlite, "status = 'pending'"), 0);
  assert.equal(countRows(sqlite, "1 = 1"), rowsBefore);

  // (d) 新commit（deploy）では従来どおり全targetを通常reasonでenqueueする。
  const next = await ensureDeployGlobalRebuilds(env, { commitSha: "d".repeat(40) });
  assert.equal(next, DEPLOY_GLOBAL_REBUILD_TARGETS.length);
  assert.equal(
    countRows(sqlite, "status = 'pending' AND reason = 'deploy_generator_change'"),
    DEPLOY_GLOBAL_REBUILD_TARGETS.length,
  );
});
