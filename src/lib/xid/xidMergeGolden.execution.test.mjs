// MIG-0618 U01 golden: fixes the observable behaviour of the X ID merge / revert flow
// (executeApprovedXIdMergeRequest, restoreApprovedXIdMergeRevertRequest,
// captureXIdMergeRestoreSnapshot) BEFORE the pure parts move to packages/server-core.
// The same test must pass byte-for-byte afterwards.
//
// Every statement that reaches D1 (reads and the batch) is recorded as { sql, params },
// together with the rows that really land in a migrated SQLite database (audit_logs,
// static_rebuild_queue, public_visibility_fences, the moved relations), the R2 / Queue / KV side
// effects and their order. Time and random ids are frozen. Regenerate only on purpose:
// FLAMENODE_UPDATE_GOLDEN=1.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

const SNAPSHOT_URL = new URL("./xidMergeGolden.snapshot.json", import.meta.url);
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
              "export function getCloudflareContext() { return globalThis.__xidMergeGoldenContext; }",
            ),
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/d1");
  const schema = await import("../db/schema.ts");
  const merge = await import("./merge.ts");
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

  /** In-memory R2 with etag + onlyIf semantics, recording every call. */
  function createBucket(log) {
    const objects = new Map();
    let version = 0;
    return {
      objects,
      get: async (key) => {
        const stored = objects.get(key);
        log.push({ op: "r2.get", key, found: Boolean(stored) });
        if (!stored) return null;
        return { etag: stored.etag, size: stored.value.length, text: async () => stored.value };
      },
      put: async (key, value, options) => {
        const stored = objects.get(key);
        const onlyIf = options?.onlyIf;
        const describe =
          onlyIf instanceof Headers ? { headers: Object.fromEntries(onlyIf.entries()) } : onlyIf ?? null;
        const failed =
          (onlyIf instanceof Headers && stored) ||
          (onlyIf && !(onlyIf instanceof Headers) && onlyIf.etagMatches && stored?.etag !== onlyIf.etagMatches);
        if (failed) {
          log.push({ op: "r2.put", key, value, onlyIf: describe, result: "precondition_failed" });
          return null;
        }
        version += 1;
        objects.set(key, { value, etag: `etag-${version}` });
        log.push({ op: "r2.put", key, value, onlyIf: describe, result: `etag-${version}` });
        return { etag: `etag-${version}` };
      },
      delete: async (keys) => {
        log.push({ op: "r2.delete", keys });
        for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
      },
    };
  }

  const CORE_SEED = `
    INSERT INTO "user" (id, name, email, role, is_banned, discord_id, active_x_user_id, created_at) VALUES
      ('admin-1', 'Admin', 'admin@example.test', 'admin', 0, 'discord-admin', NULL, 50),
      ('u-src', 'Src User', 'src@example.test', 'user', 0, 'discord-src', 'x_src', 50),
      ('u-tgt', 'Tgt User', 'tgt@example.test', 'user', 0, 'discord-tgt', 'x_tgt', 50);
    INSERT INTO x_users (id, x_name, approval_status) VALUES
      ('x_src', 'Source X', 'approved'),
      ('x_tgt', 'Target X', 'approved');
    INSERT INTO x_user_account_links (x_user_id, auth_user_id, link_role, created_at, updated_at) VALUES
      ('x_src', 'u-src', 'owner', 100, 100),
      ('x_tgt', 'u-tgt', 'owner', 100, 100);
    INSERT INTO x_user_aliases (x_user_id, alias_x_id) VALUES
      ('x_src', 'old_a'), ('x_src', 'shared_a'), ('x_tgt', 'shared_a');
    INSERT INTO x_identity_requests
      (id, request_type, requested_by_auth_user_id, source_x_user_id, target_x_user_id, status, requested_at, updated_at)
      VALUES ('req-merge', 'merge', 'admin-1', 'x_src', 'x_tgt', 'approved', 900, 1000);
  `;

  const RELATION_SEED = `
    INSERT INTO events (id, title, event_type, visibility_status, created_at, updated_at) VALUES
      ('evt-1', 'Event One', 'event', 'public', 100, 100),
      ('evt-2', 'Event Two', 'event', 'public', 100, 100);
    INSERT INTO videos (id, primary_event_id, creator_x_user_id, submitted_by_user_id, creator_display_name, title, created_at, updated_at) VALUES
      ('vid-1', 'evt-1', 'x_src', 'u-src', 'Src', 'Video One', 100, 500),
      ('vid-2', NULL, 'x_tgt', 'u-tgt', 'Tgt', 'Video Two', 100, 500);
    INSERT INTO video_events (video_id, event_id) VALUES ('vid-1', 'evt-1'), ('vid-1', 'evt-2');
    INSERT INTO video_chapters (id, video_id, x_user_id, chapter_time, chapter_label, created_at, updated_at) VALUES
      ('chap-1', 'vid-1', 'x_src', 10, 'Intro', 100, 500);
    INSERT INTO video_members (id, video_id, x_user_id, name, role, order_index) VALUES
      ('mem-1', 'vid-1', 'x_src', 'Source Member', 'dancer', 0),
      ('mem-2', 'vid-2', 'x_tgt', 'Target Member', 'dancer', 0);
    INSERT INTO slot_reservation_groups (id, event_id, x_user_id, display_name, created_at, updated_at, version) VALUES
      ('grp-1', 'evt-1', 'x_src', 'Group', 100, 500, 1);
    INSERT INTO slots (id, event_id, x_user_id, display_name, status, updated_at, version, reserved_x_id_snapshot) VALUES
      ('slot-1', 'evt-1', 'x_src', 'Slot 1', 'reserved', 500, 1, ' @X_Src '),
      ('slot-2', 'evt-2', NULL, 'Slot 2', 'open', 500, 1, 'X_SRC');
    INSERT INTO video_moderation_cases (id, video_id, case_type, status, related_x_user_id, created_at) VALUES
      ('case-1', 'vid-1', 'rights', 'open', 'x_src', 100);
    INSERT INTO video_interactions (x_user_id, video_id, interaction_type, created_at) VALUES
      ('x_src', 'vid-1', 'like', 100), ('x_tgt', 'vid-1', 'like', 100), ('x_src', 'vid-2', 'like', 100);
    INSERT INTO event_staff (id, event_id, x_user_id, display_name, permission_preset, created_at, updated_at) VALUES
      ('staff-1', 'evt-1', 'x_src', 'Src Owner', 'owner', 100, 500),
      ('staff-2', 'evt-1', 'x_tgt', 'Tgt Manager', 'manager', 100, 500),
      ('staff-3', 'evt-2', 'x_src', 'Src Manager', 'manager', 100, 500);
  `;

  const DUMPS = [
    "x_users",
    "x_user_account_links",
    "x_user_aliases",
    '"user"',
    "videos",
    "video_events",
    "video_chapters",
    "video_members",
    "slot_reservation_groups",
    "slots",
    "video_moderation_cases",
    "video_interactions",
    "event_staff",
    "x_identity_requests",
    "static_rebuild_queue",
    "public_visibility_fences",
    "audit_logs",
  ];

  /**
   * CURRENT behaviour finding: the merge AFTER-state assertion compiles to 141 bound parameters
   * (97 for the before-state), above D1's limit of 100, whatever the data. So the shipped
   * executeApprovedXIdMergeRequest throws in assertAtomicAuditMutationBindLimits before it ever
   * writes. The scenario `merge_as_shipped_exceeds_d1_bind_limit` pins that. Every other
   * scenario relaxes ONLY the pre-flight bind count (the in-memory SQLite has no such limit), by
   * hiding the extra params from the caller named getStatementBindCount, so the batch SQL, params,
   * audits, queue rows and ordering are still pinned. Execution itself is untouched.
   */
  function relaxBindPreflight(db) {
    const dialect = db.dialect;
    const original = dialect.sqlToQuery.bind(dialect);
    dialect.sqlToQuery = (query) => {
      const compiled = original(query);
      if (new Error().stack.includes("getStatementBindCount")) {
        return { ...compiled, params: compiled.params.slice(0, 1) };
      }
      return compiled;
    };
  }

  async function runScenario(
    name,
    body,
    { seedRelations = true, extraSeed = "", relaxBindCheck = true } = {},
  ) {
    const sqlite = new DatabaseSync(":memory:");
    for (const migration of migrations) sqlite.exec(migration);
    // The migrations seed a system user stamped with the real clock.
    sqlite.exec(`UPDATE "user" SET created_at = 0 WHERE id = 'system_db_migration'`);
    sqlite.exec(CORE_SEED);
    if (seedRelations) sqlite.exec(RELATION_SEED);
    if (extraSeed) sqlite.exec(extraSeed);
    const log = [];
    const d1 = createD1(sqlite, log);
    const db = drizzle(d1, { schema });
    if (relaxBindCheck) relaxBindPreflight(db);
    const bucket = createBucket(log);
    const pendingWaitUntil = [];
    const queue = (binding) => ({
      send: async (message) => {
        log.push({ op: "queue.send", binding, message });
      },
    });
    globalThis.__xidMergeGoldenContext = {
      env: {
        DB: d1,
        BUCKET: bucket,
        KV: {
          get: async () => null,
          delete: async () => {},
          put: async (key, value, options) => {
            log.push({ op: "kv.put", key, value, options });
          },
        },
        QUEUE_DISPATCH_ENABLED: "1",
        NOTIFICATION_WAKE_QUEUE: queue("NOTIFICATION_WAKE_QUEUE"),
        STATIC_REBUILD_WAKE_QUEUE: queue("STATIC_REBUILD_WAKE_QUEUE"),
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
    const realWarn = console.warn;
    console.warn = (...args) => log.push({ op: "console.warn", args });
    resetQueueWakeWarningStateForTests();
    resetQueueWakeFailureRecordStateForTests();

    const readRequest = (id) => ({
      ...sqlite.prepare("SELECT * FROM x_identity_requests WHERE id = ?").get(id),
    });
    let outcome;
    try {
      outcome = { returned: await body({ db, sqlite, readRequest }) };
    } catch (error) {
      outcome = { threw: String(error?.message ?? error) };
    } finally {
      await Promise.allSettled(pendingWaitUntil);
      Date.now = realNow;
      globalThis.crypto.randomUUID = realRandomUUID;
      console.warn = realWarn;
      delete globalThis.__xidMergeGoldenContext;
    }

    const tables = {};
    for (const table of DUMPS) {
      tables[table.replaceAll('"', "")] = sqlite
        .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
        .all()
        .map((row) => ({ ...row }));
    }
    sqlite.close();
    return [name, { outcome, log, r2: Object.fromEntries(bucket.objects), tables }];
  }

  const mergeInput = (request) => ({ request, actorAuthUserId: "admin-1" });

  const scenarios = [
    ["capture_snapshot_only", ({ db }) => merge.captureXIdMergeRestoreSnapshot(db, "x_src", "x_tgt")],
    [
      "merge_full_with_fence_rebuild_queue_and_audits",
      ({ db, readRequest }) =>
        merge.executeApprovedXIdMergeRequest(
          db,
          mergeInput({ ...readRequest("req-merge"), source_x_user_id: " @X_Src ", target_x_user_id: "X_TGT" }),
        ),
    ],
    [
      "merge_as_shipped_exceeds_d1_bind_limit",
      ({ db, readRequest }) =>
        merge.executeApprovedXIdMergeRequest(db, mergeInput(readRequest("req-merge"))),
      { relaxBindCheck: false },
    ],
    [
      "merge_then_revert",
      async ({ db, sqlite, readRequest }) => {
        const merged = await merge.executeApprovedXIdMergeRequest(db, mergeInput(readRequest("req-merge")));
        sqlite.exec(`
          INSERT INTO x_identity_requests
            (id, request_type, requested_by_auth_user_id, source_x_user_id, target_x_user_id, parent_request_id, status, revert_deadline_at, requested_at, updated_at)
            VALUES ('req-revert', 'revert_merge', 'admin-1', 'x_src', 'x_tgt', 'req-merge', 'approved', ${merged.revertDeadlineAt}, 2000, 2000);
        `);
        const reverted = await merge.restoreApprovedXIdMergeRevertRequest(db, {
          request: readRequest("req-revert"),
          parentRequest: readRequest("req-merge"),
          actorAuthUserId: "admin-1",
        });
        return {
          merged: { counts: merged.counts, revertDeadlineAt: merged.revertDeadlineAt },
          reverted,
        };
      },
    ],
    [
      "merge_without_relations_has_no_staff_audit",
      ({ db, readRequest }) =>
        merge.executeApprovedXIdMergeRequest(db, mergeInput(readRequest("req-merge"))),
      { seedRelations: false },
    ],
    [
      "merge_stale_request_rolls_back_and_compensates_fence",
      ({ db, readRequest }) =>
        merge.executeApprovedXIdMergeRequest(
          db,
          mergeInput({ ...readRequest("req-merge"), updated_at: 999 }),
        ),
    ],
    [
      "merge_request_guards",
      async ({ db, readRequest }) => {
        const base = readRequest("req-merge");
        const outcomes = {};
        const attempt = async (key, request) => {
          try {
            outcomes[key] = await merge.executeApprovedXIdMergeRequest(db, mergeInput(request));
          } catch (error) {
            outcomes[key] = `threw: ${error?.message ?? error}`;
          }
        };
        await attempt("not_approved", { ...base, status: "pending" });
        await attempt("not_merge", { ...base, request_type: "revert_merge" });
        await attempt("missing_source", { ...base, source_x_user_id: null });
        await attempt("unnormalizable_target", { ...base, target_x_user_id: "   " });
        await attempt("same_after_normalisation", {
          ...base,
          source_x_user_id: " @X_TGT ",
          target_x_user_id: "x_tgt",
        });
        return outcomes;
      },
    ],
    [
      "revert_request_guards",
      async ({ db, readRequest }) => {
        const parent = {
          ...readRequest("req-merge"),
          status: "done",
          restore_snapshot_json: JSON.stringify({ version: 1 }),
        };
        const child = {
          ...readRequest("req-merge"),
          id: "req-revert",
          request_type: "revert_merge",
          status: "approved",
          parent_request_id: "req-merge",
          revert_deadline_at: 2_000_000_000,
        };
        const outcomes = {};
        const attempt = async (key, request, parentRequest) => {
          try {
            outcomes[key] = await merge.restoreApprovedXIdMergeRevertRequest(db, {
              request,
              parentRequest,
              actorAuthUserId: "admin-1",
            });
          } catch (error) {
            outcomes[key] = `threw: ${error?.message ?? error}`;
          }
        };
        await attempt("not_revert", { ...child, request_type: "merge" }, parent);
        await attempt("bad_child_status", { ...child, status: "done" }, parent);
        await attempt("parent_not_done", child, { ...parent, status: "approved" });
        await attempt("parent_mismatch", { ...child, parent_request_id: "other" }, parent);
        await attempt("no_deadline", { ...child, revert_deadline_at: null }, parent);
        await attempt("no_snapshot", child, { ...parent, restore_snapshot_json: null });
        await attempt("deadline_passed", { ...child, revert_deadline_at: 1 }, parent);
        await attempt("snapshot_not_json", child, { ...parent, restore_snapshot_json: "{" });
        await attempt("snapshot_wrong_version", child, parent);
        return outcomes;
      },
    ],
    [
      "budget_helper_and_exported_constants",
      () => ({
        planned: merge.planXIdMergeD1Budget({
          mutationStatements: [],
          expectedMutationChanges: [],
          audits: [
            {
              table_name: "x_users",
              target_id: "x_src",
              operation: "MERGE",
              before: { a: 1 },
              after: { a: 2 },
              actor_user_id: "admin-1",
              retention_class: "long_audit",
              restore_strategy: "none",
            },
          ],
          callerQueryCount: merge.X_ID_MERGE_CALLER_D1_QUERY_COUNT,
        }),
        constants: {
          revert_window: merge.X_ID_MERGE_REVERT_WINDOW_SECONDS,
          snapshot_max_bytes: merge.X_ID_MERGE_SNAPSHOT_MAX_BYTES,
          rows_per_relation: merge.X_ID_MERGE_SNAPSHOT_MAX_ROWS_PER_RELATION,
          total_rows: merge.X_ID_MERGE_SNAPSHOT_MAX_TOTAL_ROWS,
          rebuild_target_limit: merge.X_ID_MERGE_STATIC_REBUILD_TARGET_LIMIT,
          merge_caller_queries: merge.X_ID_MERGE_CALLER_D1_QUERY_COUNT,
          revert_caller_queries: merge.X_ID_REVERT_CALLER_D1_QUERY_COUNT,
        },
      }),
    ],
  ];

  test("golden: X ID merge / revert SQL, params, audits, queue rows, R2 fence and ordering", async () => {
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
    assert.equal(serialized, readFileSync(SNAPSHOT_URL, "utf8"));
    assert.equal(Object.keys(actual).length, scenarios.length);
  });
}
