import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { reconcilePendingXIdSlotBinds } from "../../../workers/content-jobs/xIdSlotBindRecovery.ts";

function createD1Fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE x_users (id TEXT PRIMARY KEY, approval_status TEXT);
    CREATE TABLE x_user_aliases (x_user_id TEXT NOT NULL, alias_x_id TEXT NOT NULL);
    CREATE TABLE x_user_account_links (x_user_id TEXT NOT NULL, auth_user_id TEXT NOT NULL);
    CREATE TABLE x_identity_requests (
      id TEXT PRIMARY KEY, request_type TEXT NOT NULL,
      requested_by_auth_user_id TEXT NOT NULL, requested_x_id TEXT,
      target_x_user_id TEXT, status TEXT NOT NULL,
      slot_bind_status TEXT NOT NULL, slot_bind_attempt_count INTEGER NOT NULL,
      slot_bind_updated_at INTEGER, updated_at INTEGER NOT NULL
    );
    CREATE TABLE slots (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL,
      reserved_by_user_id TEXT, reserved_x_id_snapshot TEXT,
      version INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      status TEXT NOT NULL, x_user_id TEXT, start_time INTEGER, sort_order INTEGER
    );
    CREATE TABLE static_rebuild_queue (
      id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
      reason TEXT, priority TEXT NOT NULL, status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL, requested_by_user_id TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX static_rebuild_queue_target_pending_uniq
      ON static_rebuild_queue(target_type, target_id)
      WHERE status IN ('pending', 'processing');
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY, table_name TEXT NOT NULL, target_id TEXT NOT NULL,
      operation TEXT NOT NULL, before_json TEXT, after_json TEXT,
      changed_keys_json TEXT, actor_user_id TEXT NOT NULL,
      actor_x_user_id TEXT, reason TEXT, context TEXT,
      retention_class TEXT NOT NULL, restore_strategy TEXT NOT NULL,
      restore_status TEXT NOT NULL, payload_size_bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    INSERT INTO x_users VALUES ('x1', 'approved');
    INSERT INTO x_user_account_links VALUES ('x1', 'u1');
    INSERT INTO x_identity_requests VALUES
      ('req1', 'new_link', 'u1', 'x1', NULL, 'approved', 'pending', 0, 100, 100);
  `);
  for (let index = 0; index < 31; index += 1) {
    sqlite
      .prepare(
        `INSERT INTO slots
         VALUES (?, 'event-1', 'u1', NULL, 1, 1, 'reserved', NULL, ?, ?)`,
      )
      .run(`slot-${index}`, index, index);
  }

  function statement(sql, bindings = []) {
    return {
      bind(...next) {
        return statement(sql, next);
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...bindings), meta: { changes: 0 } };
      },
      async first() {
        return sqlite.prepare(sql).get(...bindings) ?? null;
      },
      async run() {
        const result = sqlite.prepare(sql).run(...bindings);
        return { meta: { changes: Number(result.changes ?? 0) } };
      },
    };
  }

  const DB = {
    prepare(sql) {
      return statement(sql);
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const prepared of statements) results.push(await prepared.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sqlite, DB };
}

test("31件の予約枠は30件batch後に次回recoveryで残りをbindしてcompleteにする", async () => {
  const { sqlite, DB } = createD1Fixture();
  const first = await reconcilePendingXIdSlotBinds({ DB });
  assert.equal(first.bound, 30);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM slots WHERE x_user_id = 'x1'").get().count,
    30,
  );
  assert.equal(
    sqlite.prepare("SELECT slot_bind_status FROM x_identity_requests WHERE id = 'req1'").get().slot_bind_status,
    "pending",
  );

  const second = await reconcilePendingXIdSlotBinds({ DB });
  assert.equal(second.bound, 1);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM slots WHERE x_user_id = 'x1'").get().count,
    31,
  );
  assert.equal(
    sqlite.prepare("SELECT slot_bind_status FROM x_identity_requests WHERE id = 'req1'").get().slot_bind_status,
    "complete",
  );
  assert.ok(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count >= 2);
  sqlite.close();
});

test("0057適用前のapproved linkも一度だけboundedに再検査する", async () => {
  const { sqlite, DB } = createD1Fixture();
  await reconcilePendingXIdSlotBinds({ DB });
  await reconcilePendingXIdSlotBinds({ DB });
  sqlite
    .prepare(
      `INSERT INTO x_identity_requests
       VALUES ('legacy-1', 'new_link', 'u1', 'x1', NULL, 'approved', 'complete', 0, NULL, 100)`,
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO slots
       VALUES ('legacy-slot', 'event-legacy', 'u1', NULL, 1, 1, 'reserved', NULL, 1, 1)`,
    )
    .run();

  const first = await reconcilePendingXIdSlotBinds({ DB });
  assert.equal(first.bound, 1);
  assert.equal(
    sqlite
      .prepare("SELECT x_user_id FROM slots WHERE id = 'legacy-slot'")
      .get().x_user_id,
    "x1",
  );
  assert.equal(
    sqlite
      .prepare("SELECT slot_bind_status FROM x_identity_requests WHERE id = 'legacy-1'")
      .get().slot_bind_status,
    "complete",
  );
  const auditCount = sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count;

  const second = await reconcilePendingXIdSlotBinds({ DB });
  assert.equal(second.bound, 0);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count,
    auditCount,
  );
  sqlite.close();
});
