// MIG-0613 U01 golden: fixes the observable behaviour of mutateWithAudit /
// prepareAuditLogEntries / the queue wake chain BEFORE the code moves to
// packages/server-core. The same test must pass byte-for-byte afterwards.
//
// Every statement that reaches D1 (reads and the batch) is recorded as
// { sql, params }, together with the audit_logs rows that really land in a
// migrated SQLite database, the Queue/KV/waitUntil side effects and their
// order. Time and random ids are frozen, so even id/created_at are compared.
// Regenerate only on purpose: FLAMENODE_UPDATE_GOLDEN=1.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

const SNAPSHOT_URL = new URL("./auditGolden.snapshot.json", import.meta.url);
const FROZEN_NOW_MS = 1_760_000_000_000;

if (runTestWithTsx(import.meta.url)) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      }
      if (specifier === "@opennextjs/cloudflare") {
        return {
          url:
            "data:text/javascript," +
            encodeURIComponent(
              "export function getCloudflareContext() { return globalThis.__auditGoldenContext; }",
            ),
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  const { sql } = await import("drizzle-orm");
  const { drizzle } = await import("drizzle-orm/d1");
  const schema = await import("../db/schema.ts");
  const { mutateWithAudit } = await import("./mutate.ts");
  const { expectedRowCondition } = await import("./expectedRowCondition.ts");
  const { prepareAuditLogEntries, writeAuditLog } = await import("./logger.ts");
  const { resetQueueWakeWarningStateForTests } = await import(
    "../queues/sendQueueWakeBestEffort.ts"
  );
  const { resetQueueWakeFailureRecordStateForTests } = await import(
    "../queues/wakeFailureRecord.ts"
  );

  const migrationsDir = new URL("../../../migrations/", import.meta.url);
  const migrations = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(new URL(name, migrationsDir), "utf8"));

  function createD1(sqlite, log) {
    const meta = (changes = 0) => ({ duration: 0, changes, last_row_id: 0, changed_db: changes > 0 });
    function execute(query, params, method) {
      const statement = sqlite.prepare(query);
      if (method === "run") {
        const info = statement.run(...params);
        return { success: true, results: [], meta: meta(Number(info.changes)) };
      }
      return { success: true, results: statement.all(...params), meta: meta() };
    }
    function prepared(query, params = []) {
      const read = (method) => {
        log.push({ op: "read", sql: query, params });
        return execute(query, params, method);
      };
      return {
        query,
        params,
        bind: (...values) => prepared(query, values),
        run: async () => read("run"),
        all: async () => read("all"),
        raw: async () => read("all").results.map((row) => Object.values(row)),
        first: async (column) => {
          const row = read("all").results[0];
          return row ? (column ? row[column] : row) : null;
        },
      };
    }
    return {
      prepare: (query) => prepared(query),
      async batch(statements) {
        log.push({
          op: "batch",
          statements: statements.map((statement) => ({ sql: statement.query, params: statement.params })),
        });
        sqlite.exec("BEGIN");
        try {
          const results = statements.map((statement) =>
            execute(
              statement.query,
              statement.params,
              sqlite.prepare(statement.query).columns().length > 0 ? "all" : "run",
            ),
          );
          sqlite.exec("COMMIT");
          log.push({ op: "batch.commit" });
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          log.push({ op: "batch.rollback", error: String(error?.message ?? error) });
          throw error;
        }
      },
    };
  }

  function seed(sqlite) {
    const user = sqlite.prepare(
      `INSERT INTO "user" (id, name, email, role, is_banned, discord_id, active_x_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    user.run("actor-1", "Actor One", "actor1@example.test", "admin", 0, "discord-1", "x_actor");
    user.run("actor-2", "Actor Two", "actor2@example.test", "user", 0, null, null);
    sqlite.exec(`
      INSERT INTO x_users (id, x_name, icon_url, approval_status)
        VALUES ('x_actor', 'Actor X', 'https://img.example.test/x.png', 'approved');
      INSERT INTO x_users (id, x_name, approval_status) VALUES ('x_pending', 'Pending X', 'pending');
      INSERT INTO x_user_account_links (x_user_id, auth_user_id, link_role)
        VALUES ('x_actor', 'actor-1', 'owner');
      INSERT INTO x_user_account_links (x_user_id, auth_user_id, link_role)
        VALUES ('x_pending', 'actor-1', 'owner');
      INSERT INTO announcements (id, title, body, severity, target_audience, is_published, created_at, updated_at)
        VALUES ('ann-1', 'Hello', 'Body', 'info', 'all', 1, 1000, 1000);
      INSERT INTO events (id, title, event_type, visibility_status, created_at, updated_at)
        VALUES ('evt-1', 'Event One', 'event', 'private', 1000, 1000);
    `);
  }

  function dumpTable(sqlite, query) {
    return sqlite.prepare(query).all().map((row) => ({ ...row }));
  }

  /** Runs one scenario against a fresh migrated database and returns everything observable. */
  async function runScenario(name, body, { env: envOverrides = {}, systemSettings } = {}) {
    const sqlite = new DatabaseSync(":memory:");
    for (const migration of migrations) sqlite.exec(migration);
    seed(sqlite);
    if (systemSettings) sqlite.exec(systemSettings);
    const log = [];
    const d1 = createD1(sqlite, log);
    const db = drizzle(d1, { schema });
    const pendingWaitUntil = [];
    const queue = (binding, fail = false) => ({
      send: async (message) => {
        log.push({ op: "queue.send", binding, message });
        if (fail) throw new Error("queue unavailable");
      },
    });
    const storage = { get: async () => null, put: async () => {}, delete: async () => {} };
    const kv = {
      ...storage,
      put: async (key, value, options) => {
        log.push({ op: "kv.put", key, value, options });
      },
    };
    globalThis.__auditGoldenContext = {
      env: {
        DB: d1,
        BUCKET: storage,
        KV: kv,
        QUEUE_DISPATCH_ENABLED: "1",
        NOTIFICATION_WAKE_QUEUE: queue("NOTIFICATION_WAKE_QUEUE"),
        STATIC_REBUILD_WAKE_QUEUE: queue("STATIC_REBUILD_WAKE_QUEUE"),
        ...envOverrides,
      },
      ctx: {
        waitUntil: (promise) => {
          log.push({ op: "waitUntil" });
          pendingWaitUntil.push(promise);
        },
      },
    };

    const realNow = Date.now;
    Date.now = () => FROZEN_NOW_MS;
    let uuidCounter = 0;
    const realRandomUUID = globalThis.crypto.randomUUID;
    globalThis.crypto.randomUUID = () =>
      `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`;
    resetQueueWakeWarningStateForTests();
    resetQueueWakeFailureRecordStateForTests();

    let outcome;
    try {
      outcome = { returned: await body({ db, sqlite, log, sql, schema }) };
    } catch (error) {
      outcome = { threw: String(error?.message ?? error) };
    } finally {
      await Promise.allSettled(pendingWaitUntil);
      Date.now = realNow;
      globalThis.crypto.randomUUID = realRandomUUID;
      delete globalThis.__auditGoldenContext;
    }

    const result = {
      outcome,
      log,
      audit_logs: dumpTable(sqlite, "SELECT * FROM audit_logs ORDER BY created_at, id"),
      events: dumpTable(sqlite, "SELECT id, title, visibility_status, updated_at FROM events ORDER BY id"),
      announcements: dumpTable(sqlite, "SELECT id, title, is_published, updated_at FROM announcements ORDER BY id"),
    };
    sqlite.close();
    return [name, result];
  }

  const announcementAudit = (overrides = {}) => ({
    table_name: "announcements",
    target_id: "ann-1",
    operation: "UPDATE",
    before: { id: "ann-1", title: "Hello", is_published: 1, updated_at: 1000 },
    after: { id: "ann-1", title: "Hello v2", is_published: 1, updated_at: 2000 },
    actor_user_id: "actor-1",
    reason: "announcement_update",
    retention_class: "restorable",
    restore_strategy: "update_before",
    strict: true,
    context: "announcement_update",
    ...overrides,
  });

  const touchEvent = (db, eventId = "evt-1", updatedAt = 2000) =>
    db.run(sql`UPDATE events SET updated_at = ${updatedAt} WHERE id = ${eventId}`);

  const scenarios = [
    [
      "announcement_update_with_static_rebuild_and_notification_wake",
      ({ db }) =>
        mutateWithAudit(db, {
          mutationStatements: [
            db.run(sql`UPDATE announcements SET title = ${"Hello v2"}, updated_at = ${2000} WHERE id = ${"ann-1"} AND updated_at = ${1000}`),
            db.run(sql`INSERT INTO static_rebuild_queue (id, target_type, target_id, reason, status, priority, attempt_count, created_at, updated_at) VALUES (${"srq-1"}, ${"announcements"}, ${"all"}, ${"announcement_update"}, ${"pending"}, ${"normal"}, ${0}, ${1000}, ${1000})`),
          ],
          expectedMutationChanges: [1, 1],
          audits: [announcementAudit()],
          staticRebuildWakeSource: "admin",
          notificationWakeSource: "web",
        }),
    ],
    [
      "events_cas_update_succeeds_with_builder",
      ({ db }) => {
        const expectedCurrent = { id: "evt-1", title: "Event One", visibility_status: "private", updated_at: 1000 };
        return mutateWithAudit(db, {
          mutationStatements: [
            db
              .update(schema.events)
              .set({ title: "Event Renamed", updated_at: 2000 })
              .where(sql`${schema.events.id} = ${"evt-1"} AND ${expectedRowCondition({ expectedCurrent })}`),
          ],
          expectedMutationChanges: 1,
          audits: [
            {
              table_name: "events",
              target_id: "evt-1",
              operation: "UPDATE",
              before: expectedCurrent,
              after: { ...expectedCurrent, title: "Event Renamed", updated_at: 2000 },
              actor_user_id: "actor-1",
              retention_class: "restorable",
              restore_strategy: "update_before",
              strict: true,
              context: "event_rename",
            },
          ],
        });
      },
    ],
    [
      "events_cas_conflict_rolls_back_without_audit_or_wake",
      ({ db }) => {
        const stale = { id: "evt-1", title: "Stale Title", visibility_status: "private", updated_at: 999 };
        return mutateWithAudit(db, {
          mutationStatements: [
            db
              .update(schema.events)
              .set({ title: "Event Renamed", updated_at: 2000 })
              .where(sql`${schema.events.id} = ${"evt-1"} AND ${expectedRowCondition({ expectedCurrent: stale })}`),
          ],
          expectedMutationChanges: 1,
          audits: [
            {
              table_name: "events",
              target_id: "evt-1",
              operation: "UPDATE",
              before: stale,
              after: { ...stale, title: "Event Renamed" },
              actor_user_id: "actor-1",
              restore_strategy: "update_before",
              strict: true,
            },
          ],
          staticRebuildWakeSource: "manage",
        });
      },
    ],
    [
      "payload_exceeded_drops_snapshots_and_marks_not_restorable",
      ({ db }) =>
        mutateWithAudit(db, {
          mutationStatements: [touchEvent(db)],
          expectedMutationChanges: 1,
          audits: [
            {
              table_name: "events",
              target_id: "evt-1",
              operation: "UPDATE",
              before: { id: "evt-1", note: "a".repeat(300) },
              after: { id: "evt-1", note: "b".repeat(300) },
              actor_user_id: "actor-1",
              retention_class: "restorable",
              restore_strategy: "update_before",
              strict: true,
            },
          ],
        }),
      { systemSettings: "UPDATE system_settings SET audit_max_payload_bytes = 400 WHERE id = 'default'" },
    ],
    [
      "redaction_masks_secrets_and_keeps_changed_keys",
      ({ db }) =>
        mutateWithAudit(db, {
          mutationStatements: [touchEvent(db)],
          expectedMutationChanges: 1,
          audits: [
            {
              table_name: "api_endpoints",
              target_id: "api-1",
              operation: "UPDATE",
              before: { id: "api-1", name: "old", api_key: "KEY-OLD", nested: { password: "pw-old", ok: 1 }, refresh_token: "r1" },
              after: { id: "api-1", name: "new", api_key: "KEY-NEW", nested: { password: "pw-new", ok: 2 }, refresh_token: "r2", gone: undefined },
              actor_user_id: "actor-1",
              retention_class: "long_audit",
              restore_strategy: "none",
              strict: true,
              reason: "redaction",
            },
          ],
        }),
    ],
    [
      "restore_strategy_variants_in_one_batch_chunk_boundary",
      ({ db }) =>
        mutateWithAudit(db, {
          mutationStatements: [touchEvent(db)],
          expectedMutationChanges: 1,
          audits: [
            { table_name: "event_staff", target_id: "staff-1", operation: "CREATE", before: null, after: { id: "staff-1", event_id: "evt-1", permission_preset: "manager" }, actor_user_id: "actor-1", restore_strategy: "delete_created", retention_class: "restorable", strict: true },
            { table_name: "announcements", target_id: "ann-9", operation: "DELETE", before: { id: "ann-9", title: "Gone" }, after: null, actor_user_id: "actor-1", restore_strategy: "recreate_deleted", retention_class: "restorable", strict: true },
            { table_name: "video_members_set", target_id: "vid-1", operation: "UPDATE", before: { id: "vid-1", rows: [] }, after: { id: "vid-1", rows: [] }, actor_user_id: "actor-1", restore_strategy: "custom_adapter", retention_class: "restorable", strict: true },
            { table_name: "slots", target_id: "slot-1", operation: "UPDATE", before: { id: "slot-1", event_id: "evt-1" }, after: { id: "slot-1", event_id: "evt-1", version: 2 }, actor_user_id: "actor-1", restore_strategy: "update_before", retention_class: "restorable", strict: true },
            { table_name: "unregistered_table", target_id: "u-1", operation: "UPDATE", before: { id: "u-1" }, after: { id: "u-1", v: 2 }, actor_user_id: "actor-1", restore_strategy: "update_before", strict: true },
          ],
        }),
    ],
    [
      "actor_x_linked_is_normalised_and_unlinked_strict_is_rejected",
      async ({ db }) => {
        const linked = await mutateWithAudit(db, {
          mutationStatements: [touchEvent(db)],
          expectedMutationChanges: 1,
          audits: [announcementAudit({ actor_x_user_id: "  X_Actor " })],
        });
        let unlinkedStrict;
        try {
          await mutateWithAudit(db, {
            mutationStatements: [touchEvent(db, "evt-1", 3000)],
            expectedMutationChanges: 1,
            audits: [announcementAudit({ actor_x_user_id: "x_pending" })],
          });
        } catch (error) {
          unlinkedStrict = String(error?.message ?? error);
        }
        return { linked, unlinkedStrict };
      },
    ],
    [
      "prepare_and_write_audit_log_without_batch",
      async ({ db }) => {
        const prepared = await prepareAuditLogEntries(db, [
          announcementAudit({ strict: false, actor_x_user_id: "x_pending" }),
          announcementAudit({ strict: false, table_name: "session" }),
        ]);
        const written = await writeAuditLog(db, announcementAudit({ strict: false, actor_x_user_id: "x_actor", actor_user_id: "actor-2" }));
        return { prepared: prepared.map((entry) => entry && { ...entry }), written };
      },
    ],
    [
      "wake_send_failure_records_last_failure_in_kv",
      ({ db }) =>
        mutateWithAudit(db, {
          mutationStatements: [touchEvent(db)],
          expectedMutationChanges: 1,
          audits: [announcementAudit()],
          staticRebuildWakeSource: "admin",
        }),
      { env: { STATIC_REBUILD_WAKE_QUEUE: { send: async () => { throw new Error("queue unavailable"); } } } },
    ],
    [
      "wake_binding_missing_and_dispatch_disabled",
      async ({ db }) => {
        const missing = await mutateWithAudit(db, {
          mutationStatements: [touchEvent(db)],
          expectedMutationChanges: 1,
          audits: [announcementAudit()],
          staticRebuildWakeSource: "web",
        });
        return missing;
      },
      { env: { STATIC_REBUILD_WAKE_QUEUE: undefined } },
    ],
    [
      "wake_dispatch_disabled_sends_nothing",
      ({ db }) =>
        mutateWithAudit(db, {
          mutationStatements: [touchEvent(db)],
          expectedMutationChanges: 1,
          audits: [announcementAudit()],
          notificationWakeSource: "web",
          staticRebuildWakeSource: "web",
        }),
      { env: { QUEUE_DISPATCH_ENABLED: "0" } },
    ],
    [
      "five_audits_split_into_two_insert_chunks",
      ({ db }) =>
        mutateWithAudit(db, {
          mutationStatements: [touchEvent(db)],
          expectedMutationChanges: 1,
          audits: Array.from({ length: 5 }, (_, index) =>
            announcementAudit({ target_id: `ann-${index}`, after: { id: `ann-${index}`, n: index } }),
          ),
        }),
    ],
    [
      "guards_reject_empty_audits_wrong_counts_and_post_audit_statements",
      async ({ db }) => {
        const outcomes = {};
        const attempt = async (key, input) => {
          try {
            outcomes[key] = await mutateWithAudit(db, input);
          } catch (error) {
            outcomes[key] = `threw: ${error?.message ?? error}`;
          }
        };
        await attempt("no_audits", { mutationStatements: [touchEvent(db)], expectedMutationChanges: 1, audits: [] });
        await attempt("no_statements", { mutationStatements: [], expectedMutationChanges: 1, audits: [announcementAudit()] });
        await attempt("count_mismatch", { mutationStatements: [touchEvent(db)], expectedMutationChanges: [1, 1], audits: [announcementAudit()] });
        await attempt("post_audit_and_assertions", {
          mutationStatements: [touchEvent(db)],
          expectedMutationChanges: [null],
          preMutationAssertions: [db.run(sql`SELECT 1`)],
          postMutationAssertions: [db.run(sql`SELECT 1`)],
          postAuditStatements: [db.run(sql`UPDATE events SET title = ${"Post Audit"} WHERE id = ${"evt-1"}`)],
          audits: [announcementAudit()],
        });
        return outcomes;
      },
    ],
  ];

  test("golden: mutateWithAudit / logger / queue wake observable behaviour", async () => {
    const actual = {};
    for (const [name, body, options] of scenarios) {
      const [key, value] = await runScenario(name, body, options);
      actual[key] = value;
    }
    const serialized = JSON.stringify(actual, null, 2) + "\n";
    if (process.env.FLAMENODE_UPDATE_GOLDEN === "1" || !existsSync(SNAPSHOT_URL)) {
      assert.equal(
        process.env.CI,
        undefined,
        "golden snapshot is missing in CI; generate it locally and commit it",
      );
      writeFileSync(SNAPSHOT_URL, serialized);
    }
    const expected = readFileSync(SNAPSHOT_URL, "utf8");
    assert.equal(serialized, expected);
    assert.equal(Object.keys(actual).length, scenarios.length);
  });
}
