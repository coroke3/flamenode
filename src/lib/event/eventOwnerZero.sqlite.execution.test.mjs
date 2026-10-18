// FN-X-001: an event never loses its last operable owner, even when two
// removals race. Both requests pass the read-side pre-check (each sees two
// owners); the conditional SQL inside the single D1 batch must let exactly one
// of them commit. Runs the real eventOwnership.ts + mutateWithAudit against
// the real migrations/ schema through a transactional sqlite-proxy.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const {
    deleteEventStaffWithProtection,
    updateEventStaffWithProtection,
    LAST_OWNER_ERROR,
  } = await import("./eventOwnership.ts");

  const NOW = 1_700_000_000;

  function createDatabase() {
    const sqlite = new DatabaseSync(":memory:");
    const migrations = new URL("../../../migrations/", import.meta.url);
    for (const name of readdirSync(migrations).filter((entry) => entry.endsWith(".sql")).sort()) {
      sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
    }
    sqlite.exec("PRAGMA foreign_keys = OFF");
    for (const xUserId of ["owner_a", "owner_b"]) {
      sqlite.prepare(
        "INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, 'approved')",
      ).run(xUserId, `@${xUserId}`);
      sqlite.prepare(
        `INSERT INTO x_user_account_links (x_user_id, auth_user_id, link_role, created_at, updated_at)
         VALUES (?, ?, 'owner', ?, ?)`,
      ).run(xUserId, `usr_${xUserId}`, NOW, NOW);
    }
    for (const [id, xUserId] of [["staff-a", "owner_a"], ["staff-b", "owner_b"]]) {
      sqlite.prepare(`
        INSERT INTO event_staff (
          id, event_id, x_user_id, display_name, permission_preset,
          custom_permission_keys_json, is_public, public_role_label,
          approved_by_auth_user_id, approved_at, created_at, updated_at
        ) VALUES (?, 'event-1', ?, ?, 'owner', NULL, 0, NULL, NULL, NULL, ?, ?)
      `).run(id, xUserId, xUserId, NOW, NOW);
    }
    return sqlite;
  }

  function rowsOf(statement, params, method) {
    if (method === "run") {
      statement.run(...params);
      return [];
    }
    const rows = statement.all(...params).map((row) => Object.values(row));
    return method === "get" ? rows[0] : rows;
  }

  /**
   * Proxy DB whose batch() is one SQLite transaction. Batches are held until
   * `expectedBatches` of them are pending, so every racer has finished its
   * read-side pre-checks before any write commits.
   */
  function createRacingDb(sqlite, expectedBatches) {
    const pending = [];
    let release;
    const allPending = new Promise((resolve) => {
      release = resolve;
    });
    let chain = Promise.resolve();
    return drizzle(
      async (sql, params, method) => ({ rows: rowsOf(sqlite.prepare(sql), params, method) }),
      async (queries) => {
        pending.push(queries);
        if (pending.length === expectedBatches) release();
        await allPending;
        const run = chain.then(() => {
          sqlite.exec("BEGIN IMMEDIATE");
          try {
            const results = queries.map(({ sql, params, method }) => ({
              rows: rowsOf(sqlite.prepare(sql), params, method),
            }));
            sqlite.exec("COMMIT");
            return results;
          } catch (error) {
            sqlite.exec("ROLLBACK");
            throw error;
          }
        });
        chain = run.catch(() => undefined);
        return run;
      },
    );
  }

  function staffRow(sqlite, id) {
    return sqlite.prepare("SELECT * FROM event_staff WHERE id = ?").get(id);
  }

  function ownerCount(sqlite) {
    return sqlite
      .prepare("SELECT COUNT(*) AS n FROM event_staff WHERE event_id = 'event-1' AND permission_preset = 'owner'")
      .get().n;
  }

  function auditCount(sqlite) {
    return sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'event_staff'").get().n;
  }

  test("two concurrent owner removals: exactly one commits and one owner remains", async () => {
    const sqlite = createDatabase();
    const db = createRacingDb(sqlite, 2);
    const [a, b] = [staffRow(sqlite, "staff-a"), staffRow(sqlite, "staff-b")];
    const remove = (existing) =>
      deleteEventStaffWithProtection({
        db,
        existing,
        actorUserId: "usr_site_admin",
        reason: "race test",
        confirmText: null,
      });

    const results = await Promise.allSettled([remove(a), remove(b)]);

    assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
    assert.equal(ownerCount(sqlite), 1);
    assert.equal(auditCount(sqlite), 1, "the losing batch must roll back its audit row");
    sqlite.close();
  });

  test("concurrent owner demotion and removal never leave zero owners", async () => {
    const sqlite = createDatabase();
    const db = createRacingDb(sqlite, 2);
    const [a, b] = [staffRow(sqlite, "staff-a"), staffRow(sqlite, "staff-b")];

    const results = await Promise.allSettled([
      updateEventStaffWithProtection({
        db,
        existing: a,
        values: {
          x_user_id: a.x_user_id,
          display_name: a.display_name,
          permission_preset: "manager",
          custom_permission_keys_json: null,
          is_public: 0,
          public_role_label: null,
        },
        actorUserId: "usr_site_admin",
        reason: "race test",
        confirmText: null,
        now: NOW + 1,
      }),
      deleteEventStaffWithProtection({
        db,
        existing: b,
        actorUserId: "usr_site_admin",
        reason: "race test",
        confirmText: null,
      }),
    ]);

    assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
    assert.equal(ownerCount(sqlite), 1);
    assert.equal(auditCount(sqlite), 1);
    sqlite.close();
  });

  test("removing the sole owner is rejected before any write", async () => {
    const sqlite = createDatabase();
    sqlite.prepare("DELETE FROM event_staff WHERE id = 'staff-b'").run();
    const db = createRacingDb(sqlite, 1);

    await assert.rejects(
      deleteEventStaffWithProtection({
        db,
        existing: staffRow(sqlite, "staff-a"),
        actorUserId: "usr_site_admin",
        reason: "race test",
        confirmText: null,
      }),
      new RegExp(LAST_OWNER_ERROR),
    );
    assert.equal(ownerCount(sqlite), 1);
    assert.equal(auditCount(sqlite), 0);
    sqlite.close();
  });
}
