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

test("deploy global enqueue uses two atomic JSON1 statements for all targets", async () => {
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
