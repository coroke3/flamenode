import assert from "node:assert/strict";
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

  const { drizzle } = await import("drizzle-orm/d1");
  const schema = await import("../db/schema.ts");
  const {
    buildReservationLimitGuardStatement,
    loadLogicalReservationCountForXId,
  } = await import("./slotReservationLimitGuard.ts");

  function createD1Client(sqlite) {
    function execute(query, params, method) {
      const statement = sqlite.prepare(query);
      if (method === "run") {
        const info = statement.run(...params);
        return {
          success: true,
          results: [],
          meta: { changes: Number(info.changes ?? 0) },
        };
      }
      return {
        success: true,
        results: statement.all(...params),
        meta: { changes: 0 },
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
          return execute(query, params, "all").results.map((row) =>
            Object.values(row),
          );
        },
        async first(columnName) {
          const row = execute(query, params, "all").results[0];
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
          const results = [];
          for (const statement of statements) {
            const preparedStatement = sqlite.prepare(statement.query);
            const method = preparedStatement.columns().length > 0 ? "all" : "run";
            results.push(execute(statement.query, statement.params, method));
          }
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    };
  }

  function makeContext() {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE x_users (id TEXT PRIMARY KEY);
      CREATE TABLE slots (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        reserved_x_id_snapshot TEXT,
        status TEXT NOT NULL,
        reservation_group_id TEXT
      );
      CREATE INDEX slots_event_x_snapshot_active_group_idx
        ON slots (event_id, reserved_x_id_snapshot, status, reservation_group_id, id)
        WHERE reserved_x_id_snapshot IS NOT NULL
          AND status IN ('reserved', 'submitted');
      INSERT INTO x_users (id) VALUES ('foo');
      INSERT INTO slots (id, event_id, reserved_x_id_snapshot, status, reservation_group_id) VALUES
        ('raw-at', 'event-1', '@Foo', 'reserved', ' group-a '),
        ('raw-space', 'event-1', ' FOO ', 'submitted', 'group-a'),
        ('canonical-solo', 'event-1', 'foo', 'reserved', NULL),
        ('other-x', 'event-1', 'bar', 'reserved', 'group-b'),
        ('available', 'event-1', '@Foo', 'available', 'group-c');
    `);
    const db = drizzle(createD1Client(sqlite), { schema });
    return { db, sqlite };
  }

  test("logical reservation count normalizes legacy raw snapshots and group ids", async (t) => {
    const { db, sqlite } = makeContext();
    t.after(() => sqlite.close());

    const count = await loadLogicalReservationCountForXId(db, {
      eventId: "event-1",
      xIdSnapshot: "foo",
    });

    assert.equal(count, 2);
  });

  test("atomic guard rejects a reserve that exceeds the normalized legacy count", async (t) => {
    const { db, sqlite } = makeContext();
    t.after(() => sqlite.close());

    const guard = buildReservationLimitGuardStatement(db, {
      eventId: "event-1",
      xIdSnapshot: "@FOO",
      limit: 1,
    });
    assert.ok(guard);
    await assert.rejects(() => db.batch([guard]));
  });
}
