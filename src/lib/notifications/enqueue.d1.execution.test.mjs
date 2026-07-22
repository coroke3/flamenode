import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
      return nextResolve(specifier, context);
    },
  });

  const { and, eq, sql } = await import("drizzle-orm");
  const { drizzle } = await import("drizzle-orm/d1");
  const schema = await import("../db/schema.ts");
  const { xIdentityRequests } = schema;
  const { mutateWithAudit } = await import("../audit/mutate.ts");
  const { buildPendingXIdRequestInsert } = await import(
    "../actions/xidPendingInsert.ts"
  );
  const { buildNotificationOutboxStatement } = await import("./enqueue.ts");

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
    const state = { batchCalls: 0 };

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
      state,
      client: {
        prepare(query) {
          return prepared(query);
        },
        async batch(statements) {
          state.batchCalls += 1;
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
      },
    };
  }

  function makeContext(t) {
    const sqlite = new DatabaseSync(":memory:");
    for (const migration of readdirSync(
      new URL("../../../migrations", import.meta.url),
    )
      .filter((entry) => entry.endsWith(".sql"))
      .sort()) {
      sqlite.exec(
        readFileSync(
          new URL(`../../../migrations/${migration}`, import.meta.url),
          "utf8",
        ),
      );
    }
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite
      .prepare(
        "INSERT INTO user (id, discord_id, is_notification_enabled) VALUES (?, ?, 1)",
      )
      .run("auth-user-1", "discord-user-1");
    const { client, state } = createD1Client(sqlite);
    const db = drizzle(client, { schema });
    t.after(() => sqlite.close());
    return { sqlite, db, state };
  }

  function notificationCount(sqlite) {
    return Number(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM notification_outbox")
        .get().count,
    );
  }

  test("通知statementはasync返却時に実行されずD1 batchまで保留される", async (t) => {
    const { sqlite, db, state } = makeContext(t);
    const envelope = await buildNotificationOutboxStatement(db, {
      recipientUserId: "auth-user-1",
      type: "discord_webhook",
      payload: { content: "D1 notification batch test" },
      dedupeKey: "d1-notification-test",
      force: true,
    });

    assert.ok(envelope);
    assert.equal(typeof envelope.statement?._prepare, "function");
    assert.equal(notificationCount(sqlite), 0);
    assert.equal(state.batchCalls, 0);

    await db.batch([envelope.statement]);

    assert.equal(state.batchCalls, 1);
    assert.equal(notificationCount(sqlite), 1);
  });

  test("X ID申請と通知を実D1互換batchで監査込み原子実行できる", async (t) => {
    const { sqlite, db, state } = makeContext(t);
    const request = {
      id: "xreq-d1-request",
      request_type: "new_link",
      requested_by_auth_user_id: "auth-user-1",
      requested_x_id: "creator_x",
      source_x_user_id: null,
      target_x_user_id: null,
      parent_request_id: null,
      restore_snapshot_json: null,
      revert_deadline_at: null,
      status: "pending",
      requested_at: 100,
      updated_at: 100,
    };
    const notification = await buildNotificationOutboxStatement(db, {
      recipientUserId: "auth-user-1",
      type: "discord_webhook",
      payload: { content: "X ID request" },
      dedupeKey: `xid_request_webhook:${request.id}`,
      force: true,
    });
    assert.ok(notification);
    assert.equal(notificationCount(sqlite), 0);

    await mutateWithAudit(db, {
      mutationStatements: [
        db.run(buildPendingXIdRequestInsert(request)),
        notification.statement,
      ],
      expectedMutationChanges: [1, null],
      audits: [
        {
          table_name: "x_identity_requests",
          target_id: request.id,
          operation: "CREATE",
          before: null,
          after: { ...request },
          actor_user_id: "auth-user-1",
          retention_class: "long_audit",
        },
      ],
    });

    assert.equal(state.batchCalls, 1);
    assert.equal(
      sqlite
        .prepare("SELECT status FROM x_identity_requests WHERE id = ?")
        .get(request.id).status,
      "pending",
    );
    assert.equal(notificationCount(sqlite), 1);
    assert.equal(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_logs WHERE table_name = 'x_identity_requests' AND target_id = ?",
        )
        .get(request.id).count,
      1,
    );
  });

  test("X ID申請batchの後段失敗時は申請・通知・監査をすべてrollbackする", async (t) => {
    const { sqlite, db } = makeContext(t);
    const request = {
      id: "xreq-d1-rollback",
      request_type: "new_link",
      requested_by_auth_user_id: "auth-user-1",
      requested_x_id: "rollback_x",
      source_x_user_id: null,
      target_x_user_id: null,
      parent_request_id: null,
      restore_snapshot_json: null,
      revert_deadline_at: null,
      status: "pending",
      requested_at: 100,
      updated_at: 100,
    };
    const notification = await buildNotificationOutboxStatement(db, {
      recipientUserId: "auth-user-1",
      type: "discord_webhook",
      payload: { content: "rollback request" },
      dedupeKey: `xid_request_webhook:${request.id}`,
      force: true,
    });
    assert.ok(notification);

    await assert.rejects(
      mutateWithAudit(db, {
        mutationStatements: [
          db.run(buildPendingXIdRequestInsert(request)),
          notification.statement,
        ],
        expectedMutationChanges: [1, null],
        audits: [
          {
            table_name: "x_identity_requests",
            target_id: request.id,
            operation: "CREATE",
            before: null,
            after: { ...request },
            actor_user_id: "auth-user-1",
            retention_class: "long_audit",
          },
        ],
        postAuditStatements: [
          db.run(
            sql`SELECT json_extract('not-valid-json', '$')`.inlineParams(),
          ),
        ],
      }),
      /malformed JSON/i,
    );

    assert.equal(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM x_identity_requests WHERE id = ?")
        .get(request.id).count,
      0,
    );
    assert.equal(notificationCount(sqlite), 0);
    assert.equal(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_logs WHERE table_name = 'x_identity_requests' AND target_id = ?",
        )
        .get(request.id).count,
      0,
    );
  });

  for (const status of ["approved", "rejected"]) {
    test(`X ID管理の${status}更新と通知を実D1互換batchで監査込み原子実行できる`, async (t) => {
      const { sqlite, db, state } = makeContext(t);
      const request = {
        id: `xreq-d1-${status}`,
        request_type: "existing_link",
        requested_by_auth_user_id: "auth-user-1",
        requested_x_id: "creator_x",
        source_x_user_id: null,
        target_x_user_id: null,
        parent_request_id: null,
        restore_snapshot_json: null,
        revert_deadline_at: null,
        status: "pending",
        requested_at: 100,
        updated_at: 100,
      };
      sqlite
        .prepare(
          `INSERT INTO x_identity_requests (
            id, request_type, requested_by_auth_user_id, requested_x_id,
            source_x_user_id, target_x_user_id, parent_request_id,
            restore_snapshot_json, revert_deadline_at, status,
            requested_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...Object.values(request));
      const after = { ...request, status, updated_at: 200 };
      const notification = await buildNotificationOutboxStatement(db, {
        recipientUserId: "auth-user-1",
        type: status === "approved" ? "x_id_approved" : "x_id_rejected",
        payload: { content: `X ID ${status}`, request_id: request.id },
        dedupeKey: `xid_${status}:${request.id}`,
      });
      assert.ok(notification);
      assert.equal(notificationCount(sqlite), 0);

      await mutateWithAudit(db, {
        mutationStatements: [
          db
            .update(xIdentityRequests)
            .set({ status, updated_at: 200 })
            .where(
              and(
                eq(xIdentityRequests.id, request.id),
                eq(xIdentityRequests.status, "pending"),
              ),
            ),
          notification.statement,
        ],
        expectedMutationChanges: [1, null],
        audits: [
          {
            table_name: "x_identity_requests",
            target_id: request.id,
            operation: "UPDATE",
            before: { ...request },
            after,
            actor_user_id: "auth-user-1",
            reason: `X ID ${status}`,
            context: "x-identity-request",
            retention_class: "long_audit",
          },
        ],
      });

      assert.equal(state.batchCalls, 1);
      assert.equal(
        sqlite
          .prepare("SELECT status FROM x_identity_requests WHERE id = ?")
          .get(request.id).status,
        status,
      );
      assert.equal(notificationCount(sqlite), 1);
    });
  }
}
