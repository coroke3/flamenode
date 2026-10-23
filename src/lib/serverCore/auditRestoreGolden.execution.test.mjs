// MIG-0616 U01 golden: fixes the observable behaviour of restoreAuditLog (audit restore, D-10)
// BEFORE the code moves to packages/server-core. The same test must pass byte-for-byte after the move.
//
// D1 statements are recorded as { sql, params } and the rows that really land in a migrated SQLite
// database are dumped. R2 (manifest get/put with etag CAS), Cache API deletes, Queue sends, KV puts,
// waitUntil and console output are recorded in call order. Time and random ids are frozen.
// Regenerate only on purpose: FLAMENODE_UPDATE_GOLDEN=1.
//
// Not covered because restoreAuditLog cannot reach them from its public inputs: the non-permanent
// branch of the capability failure (every capability reasonCode is in PERMANENT_RESTORE_REASONS)
// and the `!registration` branch (evaluateRestoreCapability checks the registry first). The YouTube
// eligibility rejection is unreachable too: validateVideoPublicEligibility currently always returns
// ok, so video_snapshot_null_youtube_id_is_not_rejected pins that (no precommit skip, restore succeeds).
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

const SNAPSHOT_URL = new URL("./auditRestoreGolden.snapshot.json", import.meta.url);
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
              "export function getCloudflareContext() { return globalThis.__auditRestoreGoldenContext; }",
            ),
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  process.env.NEXT_PUBLIC_SITE_URL = "https://flamenode.example.test";
  delete process.env.PUBLIC_VISIBILITY_GUARD_MODE;

  const { drizzle } = await import("drizzle-orm/d1");
  const { eq } = await import("drizzle-orm");
  const schema = await import("../db/schema.ts");
  const { restoreAuditLog } = await import("../audit/restore.ts");
  const { getAdapter } = await import("../audit/adapters.ts");
  const manifestCore = await import("../publicData/publicVisibilityManifestCore.ts");
  const isolate = await import("../publicData/publicCacheIsolate.ts");
  const { resetQueueWakeWarningStateForTests } = await import("../queues/sendQueueWakeBestEffort.ts");
  const { resetQueueWakeFailureRecordStateForTests } = await import("../queues/wakeFailureRecord.ts");

  const MANIFEST_KEY = manifestCore.PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY;
  const migrationsDir = new URL("../../../migrations/", import.meta.url);
  const migrations = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(new URL(name, migrationsDir), "utf8"));

  /**
   * Fake D1. hooks.beforeBatch(sqlite) runs once right before the first batch (a concurrent writer);
   * hooks.failRun (RegExp) makes a non-batch run throw when its SQL matches.
   */
  function createD1(sqlite, log, state, hooks) {
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
        log.push({ op: "d1", sql: query, params });
        if (method === "run" && hooks.failRun?.test(query)) throw new Error("d1 run failed");
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
    let beforeBatchDone = false;
    return {
      prepare: (query) => prepared(query),
      async batch(statements) {
        if (hooks.beforeBatch && !beforeBatchDone) {
          beforeBatchDone = true;
          hooks.beforeBatch(sqlite);
        }
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
          log.push({ op: "batch.commit", changes: results.map((result) => result.meta.changes) });
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          state.rolledBack = true;
          log.push({ op: "batch.rollback", error: String(error?.message ?? error) });
          throw error;
        }
      },
    };
  }

  function seed(sqlite) {
    sqlite.exec(`
      INSERT INTO "user" (id, name, email, role, is_banned, discord_id, active_x_user_id, is_notification_enabled)
        VALUES ('u-recipient', 'Recipient', 'r@example.test', 'user', 0, 'discord-r', NULL, 1);
      INSERT INTO "user" (id, name, email, role, is_banned, discord_id, active_x_user_id)
        VALUES ('u-actor', 'Actor', 'a@example.test', 'admin', 0, 'discord-a', 'x_actor');
      INSERT INTO x_users (id, x_name, approval_status) VALUES ('x_actor', 'Actor X', 'approved');
      INSERT INTO x_users (id, x_name, approval_status) VALUES ('x_creator', 'Creator X', 'approved');
      INSERT INTO events (id, title, visibility_status, created_at, updated_at)
        VALUES ('evt-1', 'Event One', 'public', 1000, 1000);
      INSERT INTO events (id, title, visibility_status, created_at, updated_at)
        VALUES ('evt-private', 'Event Private', 'private', 1000, 1000);
    `);
  }

  function insertRow(sqlite, table, row) {
    const columns = Object.keys(row);
    sqlite
      .prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
      .run(...Object.values(row));
  }

  function dump(sqlite, query) {
    return sqlite.prepare(query).all().map((row) => ({ ...row }));
  }

  const printable = (value) =>
    value instanceof Error
      ? { error: value.message, name: value.name }
      : typeof value === "object" && value !== null
        ? JSON.parse(JSON.stringify(value, (_k, v) => (v instanceof Error ? { error: v.message } : v)))
        : value;

  /**
   * Fake R2 bucket with etag CAS semantics; every call is recorded.
   * options.failGetsWhen(): the get throws while it returns true.
   */
  function createBucket(log, initial = {}, options = {}) {
    const objects = new Map(Object.entries(initial));
    let etagCounter = 0;
    const describeOptions = (putOptions) => {
      if (!putOptions) return null;
      const out = {};
      if (putOptions.httpMetadata) out.httpMetadata = putOptions.httpMetadata;
      if (putOptions.onlyIf instanceof Headers) out.onlyIf = { headers: [...putOptions.onlyIf.entries()] };
      else if (putOptions.onlyIf) out.onlyIf = putOptions.onlyIf;
      return out;
    };
    return {
      objects,
      delete: async () => {},
      get: async (key) => {
        log.push({ op: "r2.get", key });
        if (options.failGetsWhen?.()) throw new Error("r2 get failed");
        const found = objects.get(key);
        if (!found) return null;
        return {
          etag: found.etag,
          size: new TextEncoder().encode(found.text).byteLength,
          text: async () => found.text,
        };
      },
      put: async (key, value, putOptions) => {
        log.push({ op: "r2.put", key, value, options: describeOptions(putOptions) });
        const existing = objects.get(key);
        const onlyIf = putOptions?.onlyIf;
        if (onlyIf instanceof Headers && onlyIf.get("If-None-Match") === "*" && existing) return null;
        if (onlyIf && !(onlyIf instanceof Headers) && onlyIf.etagMatches && existing?.etag !== onlyIf.etagMatches) {
          return null;
        }
        etagCounter += 1;
        objects.set(key, { text: value, etag: `etag-${etagCounter}` });
        return { key };
      },
    };
  }

  const cacheRecorder = (behaviour = {}) => (log) => ({
    delete: async (request) => {
      const key = typeof request === "string" ? request : request.url;
      log.push({ op: "cache.delete", key });
      if (behaviour.failOn?.(key)) throw new Error("cache api unavailable");
      return true;
    },
    match: async () => undefined,
    put: async () => undefined,
  });

  async function runScenario(name, spec) {
    const { setup, arrange, options = {}, bucket: bucketSpec, caches: cachesOption, hooks = {}, env = {} } = spec;
    const sqlite = new DatabaseSync(":memory:");
    for (const migration of migrations) sqlite.exec(migration);
    seed(sqlite);
    setup?.(sqlite);
    const log = [];
    const state = { rolledBack: false };
    const d1 = createD1(sqlite, log, state, hooks);
    const db = drizzle(d1, { schema });
    const pendingWaitUntil = [];
    const queue = (binding) => ({
      send: async (message) => {
        log.push({ op: "queue.send", binding, message });
      },
    });
    const bucket = createBucket(log, bucketSpec?.initial ?? {}, {
      failGetsWhen: bucketSpec?.failGetsAfterRollback ? () => state.rolledBack : undefined,
    });
    globalThis.__auditRestoreGoldenContext = {
      env: {
        DB: d1,
        BUCKET: bucket,
        KV: {
          get: async () => null,
          delete: async () => {},
          put: async (key, value, putOptions) => {
            log.push({ op: "kv.put", key, value, options: putOptions });
          },
        },
        QUEUE_DISPATCH_ENABLED: "1",
        NOTIFICATION_WAKE_QUEUE: queue("NOTIFICATION_WAKE_QUEUE"),
        STATIC_REBUILD_WAKE_QUEUE: queue("STATIC_REBUILD_WAKE_QUEUE"),
        ...env,
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
    const realConsole = { warn: console.warn, info: console.info, log: console.log, error: console.error };
    for (const level of ["warn", "info", "log", "error"]) {
      console[level] = (...args) => {
        log.push({ op: `console.${level}`, args: args.map(printable) });
      };
    }
    const realCaches = globalThis.caches;
    globalThis.caches = { default: (cachesOption ?? cacheRecorder())(log) };
    resetQueueWakeWarningStateForTests();
    resetQueueWakeFailureRecordStateForTests();
    isolate.resetPublicJsonIsolateCacheForTests();

    let outcome;
    try {
      // arrange reads rows through drizzle to build snapshots; its reads are not part of the golden.
      await arrange?.({ db, sqlite });
      log.length = 0;
      outcome = {
        returned: printable(
          await restoreAuditLog(db, {
            auditId: "aud-1",
            userId: "u-actor",
            reason: "restore because",
            confirmText: "RESTORE aud-1",
            ...options,
          }),
        ),
      };
    } catch (error) {
      outcome = { threw: String(error?.message ?? error) };
    } finally {
      await Promise.allSettled(pendingWaitUntil);
      Date.now = realNow;
      globalThis.crypto.randomUUID = realRandomUUID;
      Object.assign(console, realConsole);
      if (realCaches === undefined) delete globalThis.caches;
      else globalThis.caches = realCaches;
      delete globalThis.__auditRestoreGoldenContext;
      isolate.resetPublicJsonIsolateCacheForTests();
    }

    const manifestObject = bucket.objects.get(MANIFEST_KEY);
    const result = {
      outcome,
      log,
      manifest_after: manifestObject ? JSON.parse(manifestObject.text) : null,
      audit_logs: dump(sqlite, "SELECT * FROM audit_logs ORDER BY id"),
      audit_restore_runs: dump(sqlite, "SELECT * FROM audit_restore_runs ORDER BY id"),
      announcements: dump(sqlite, "SELECT * FROM announcements ORDER BY id"),
      events: dump(sqlite, "SELECT * FROM events ORDER BY id"),
      videos: dump(sqlite, "SELECT * FROM videos ORDER BY id"),
      event_staff: dump(sqlite, "SELECT * FROM event_staff ORDER BY id"),
      video_members: dump(sqlite, "SELECT * FROM video_members ORDER BY id"),
      public_visibility_fences: dump(sqlite, "SELECT * FROM public_visibility_fences ORDER BY entity_type, entity_id"),
      static_rebuild_queue: dump(
        sqlite,
        "SELECT target_type, target_id, reason, priority, status, requested_by_user_id FROM static_rebuild_queue ORDER BY target_type, target_id",
      ),
    };
    sqlite.close();
    return [name, result];
  }

  // ---- fixtures -----------------------------------------------------------------------------

  const seedAnnouncement = (sqlite, over = {}) =>
    insertRow(sqlite, "announcements", {
      id: "ann-1",
      title: "Current title",
      body: "Current body",
      created_at: 1000,
      updated_at: 2000,
      ...over,
    });
  const seedVideo = (sqlite, over = {}) =>
    insertRow(sqlite, "videos", {
      id: "vid-1",
      primary_event_id: "evt-1",
      creator_x_user_id: "x_creator",
      submitted_by_user_id: "u-recipient",
      creator_display_name: "Creator",
      title: "Video One",
      youtube_video_id: "yt123",
      visibility_status: "public",
      created_at: 1000,
      updated_at: 1000,
      ...over,
    });
  const seedVideoWithEvents = (over = {}) => (sqlite) => {
    seedVideo(sqlite, over);
    insertRow(sqlite, "video_events", { video_id: "vid-1", event_id: "evt-1" });
    insertRow(sqlite, "video_events", { video_id: "vid-1", event_id: "evt-private" });
  };
  const seedStaff = (sqlite, rows) => {
    for (const row of rows) {
      insertRow(sqlite, "event_staff", {
        event_id: "evt-1",
        display_name: row.id,
        permission_preset: "public_staff",
        is_public: 0,
        created_at: 1000,
        updated_at: 1000,
        ...row,
      });
    }
  };

  async function snap(db, table, id) {
    const row = await db.select().from(table).where(eq(table.id, id)).get();
    return JSON.parse(JSON.stringify(row));
  }

  function addAudit(sqlite, { before = null, after = null, ...over }) {
    insertRow(sqlite, "audit_logs", {
      id: "aud-1",
      table_name: "announcements",
      target_id: "ann-1",
      operation: "UPDATE",
      before_json: before === null ? null : JSON.stringify(before),
      after_json: after === null ? null : JSON.stringify(after),
      actor_user_id: "u-actor",
      reason: "earlier edit",
      retention_class: "restorable",
      restore_strategy: "update_before",
      restore_status: "restorable",
      payload_size_bytes: 10,
      expires_at: 1760100000,
      created_at: 1759999000,
      ...over,
    });
  }

  /** update_before audit whose "after" equals the current row unless afterPatch says otherwise. */
  const arrangeUpdate =
    (table, tableName, id, { beforePatch = {}, afterPatch = {}, omitBefore = [], auditOver = {}, extra } = {}) =>
    async ({ db, sqlite }) => {
      const current = await snap(db, table, id);
      const before = { ...current, ...beforePatch };
      for (const key of omitBefore) delete before[key];
      addAudit(sqlite, {
        table_name: tableName,
        target_id: id,
        before,
        after: { ...current, ...afterPatch },
        ...auditOver,
      });
      extra?.(sqlite);
    };
  const arrangeAnn = (opts) => arrangeUpdate(schema.announcements, "announcements", "ann-1", opts);
  const arrangeEvent = (id, opts) => arrangeUpdate(schema.events, "events", id, opts);
  const arrangeVideo = (opts) => arrangeUpdate(schema.videos, "videos", "vid-1", opts);
  const withAnn = { setup: (sqlite) => seedAnnouncement(sqlite) };
  const staleAnn = { beforePatch: { title: "Old title", body: "Old body" } };
  const conflictAnn = {
    beforePatch: { title: "Old title" },
    afterPatch: { title: "Mid title", body: "Mid body", is_published: 1 },
  };

  const raceAnn = (sqlite) => sqlite.exec("UPDATE announcements SET title = 'raced' WHERE id = 'ann-1'");
  const raceEvent = (sqlite) => sqlite.exec("UPDATE events SET title = 'raced' WHERE id = 'evt-1'");
  const raceVideo = (sqlite) => sqlite.exec("UPDATE videos SET title = 'raced' WHERE id = 'vid-1'");

  const videoPublicToPrivate = {
    beforePatch: {
      visibility_status: "private",
      youtube_video_id: "yt-target",
      creator_x_user_id: "x_actor",
      primary_event_id: "evt-private",
    },
  };

  const memberRows = (sqlite) => {
    seedVideo(sqlite);
    insertRow(sqlite, "video_members", { id: "vm-1", video_id: "vid-1", name: "Member A", order_index: 0 });
    insertRow(sqlite, "video_members", { id: "vm-2", video_id: "vid-1", name: "Member B", order_index: 1 });
  };

  const scenarios = [
    // ---- entry rejections ----
    ["confirm_text_mismatch", { ...withAnn, arrange: arrangeAnn(staleAnn), options: { confirmText: "RESTORE nope" } }],
    ["reason_blank", { ...withAnn, arrange: arrangeAnn(staleAnn), options: { reason: "   " } }],
    ["non_admin_user", { ...withAnn, arrange: arrangeAnn(staleAnn), options: { userId: "u-recipient" } }],
    ["audit_log_missing", { options: { auditId: "aud-missing", confirmText: "RESTORE aud-missing" } }],
    [
      "already_restored",
      {
        ...withAnn,
        arrange: arrangeAnn({
          ...staleAnn,
          extra: (sqlite) =>
            insertRow(sqlite, "audit_restore_runs", {
              id: "rst-prior",
              audit_log_id: "aud-1",
              executed_by_user_id: "u-actor",
              reason: "earlier restore",
              status: "success",
              executed_at: 1759999500,
            }),
        }),
      },
    ],
    // ---- expiry ----
    [
      "expired_dry_run",
      { ...withAnn, arrange: arrangeAnn({ ...staleAnn, auditOver: { expires_at: 1759000000 } }), options: { dry_run: true } },
    ],
    [
      "expired_persists_permanent_failure",
      { ...withAnn, arrange: arrangeAnn({ ...staleAnn, auditOver: { expires_at: 1759000000 } }) },
    ],
    // ---- capability ----
    [
      "payload_exceeded_permanent",
      {
        ...withAnn,
        arrange: arrangeAnn({
          ...staleAnn,
          auditOver: { restore_unavailable_reason_code: "payload_exceeded", restore_status: "not_restorable" },
        }),
      },
    ],
    [
      "snapshot_redacted_permanent",
      { ...withAnn, arrange: arrangeAnn({ beforePatch: { title: "[REDACTED]" } }) },
    ],
    [
      "strategy_none_dry_run",
      { ...withAnn, arrange: arrangeAnn({ ...staleAnn, auditOver: { restore_strategy: "none" } }), options: { dry_run: true } },
    ],
    [
      "strategy_unsupported_permanent",
      {
        setup: (sqlite) => seedVideo(sqlite),
        arrange: ({ sqlite }) =>
          addAudit(sqlite, {
            table_name: "videos",
            target_id: "vid-1",
            operation: "DELETE",
            before: { id: "vid-1", title: "Video One" },
            restore_strategy: "recreate_deleted",
          }),
      },
    ],
    // ---- snapshot ----
    ["target_id_mismatch", { ...withAnn, arrange: arrangeAnn({ beforePatch: { id: "ann-other" } }) }],
    // ---- conflicts ----
    ["dry_run_no_conflict", { ...withAnn, arrange: arrangeAnn(staleAnn), options: { dry_run: true } }],
    ["dry_run_with_conflicts", { ...withAnn, arrange: arrangeAnn(conflictAnn), options: { dry_run: true } }],
    ["conflict_without_force_records_failed_run", { ...withAnn, arrange: arrangeAnn(conflictAnn) }],
    [
      "recreate_target_already_exists",
      {
        ...withAnn,
        arrange: async ({ db, sqlite }) =>
          addAudit(sqlite, {
            operation: "DELETE",
            before: await snap(db, schema.announcements, "ann-1"),
            restore_strategy: "recreate_deleted",
          }),
      },
    ],
    // ---- successes without visibility ----
    ["announcements_update_before", { ...withAnn, arrange: arrangeAnn(staleAnn) }],
    [
      "announcements_recreate_deleted",
      {
        arrange: ({ sqlite }) =>
          addAudit(sqlite, {
            operation: "DELETE",
            before: {
              id: "ann-1",
              title: "Deleted title",
              body: "Deleted body",
              severity: "info",
              is_published: 0,
              publish_at: null,
              expire_at: null,
              target_audience: "all",
              created_by_user_id: null,
              created_at: 1000,
              updated_at: 2000,
            },
            restore_strategy: "recreate_deleted",
          }),
      },
    ],
    [
      "event_staff_delete_created",
      {
        setup: (sqlite) => seedStaff(sqlite, [{ id: "es-1", x_user_id: "x_creator" }]),
        arrange: async ({ db, sqlite }) =>
          addAudit(sqlite, {
            table_name: "event_staff",
            target_id: "es-1",
            operation: "CREATE",
            after: await snap(db, schema.eventStaff, "es-1"),
            restore_strategy: "delete_created",
          }),
      },
    ],
    [
      "video_members_set_custom_adapter",
      {
        setup: memberRows,
        arrange: async ({ db, sqlite }) => {
          const current = await getAdapter("video_members_set").fetchCurrent(db, "vid-1");
          const first = { ...current.rows[0], name: "Member A (before)" };
          addAudit(sqlite, {
            table_name: "video_members_set",
            target_id: "vid-1",
            before: { id: "vid-1", rows: [first, { ...current.rows[1], id: "vm-3", name: "Member C", order_index: 2 }] },
            after: current,
            restore_strategy: "custom_adapter",
          });
        },
      },
    ],
    ["conflict_with_force_overwrite", { ...withAnn, arrange: arrangeAnn(conflictAnn), options: { forceOverwrite: true } }],
    // ---- mutation creation failure ----
    [
      "build_mutation_throws",
      {
        setup: (sqlite) => seedVideo(sqlite),
        arrange: ({ sqlite }) =>
          addAudit(sqlite, {
            table_name: "video_members_set",
            target_id: "vid-1",
            before: { id: "vid-1", rows: "broken" },
            restore_strategy: "custom_adapter",
          }),
      },
    ],
    // ---- owner protection ----
    [
      "event_staff_sole_owner_rolls_back",
      {
        setup: (sqlite) =>
          seedStaff(sqlite, [
            { id: "es-owner", x_user_id: "x_actor", permission_preset: "owner" },
          ]),
        arrange: arrangeUpdate(schema.eventStaff, "event_staff", "es-owner", {
          beforePatch: { permission_preset: "manager" },
        }),
      },
    ],
    // ---- events ----
    ["event_public_to_private", { arrange: arrangeEvent("evt-1", { beforePatch: { visibility_status: "private" } }) }],
    ["event_private_to_public", { arrange: arrangeEvent("evt-private", { beforePatch: { visibility_status: "public" } }) }],
    ["event_title_only", { arrange: arrangeEvent("evt-1", { beforePatch: { title: "Event One (old)" } }) }],
    // ---- videos ----
    [
      "video_public_to_private",
      { setup: seedVideoWithEvents(), arrange: arrangeVideo(videoPublicToPrivate) },
    ],
    [
      "video_private_to_public",
      {
        setup: seedVideoWithEvents({ visibility_status: "private" }),
        arrange: arrangeVideo({ beforePatch: { visibility_status: "public", youtube_video_id: "yt-target" } }),
      },
    ],
    [
      "video_snapshot_without_source_keys_uses_current",
      {
        setup: seedVideoWithEvents({ visibility_status: "private" }),
        arrange: arrangeVideo({
          beforePatch: { visibility_status: "public" },
          omitBefore: ["source_type", "youtube_video_id", "creator_x_user_id", "primary_event_id"],
        }),
      },
    ],
    [
      "video_snapshot_null_youtube_id_is_not_rejected",
      {
        setup: seedVideoWithEvents({ visibility_status: "private" }),
        arrange: arrangeVideo({ beforePatch: { visibility_status: "public", youtube_video_id: null } }),
      },
    ],
    [
      "video_event_limit_exceeded",
      {
        setup: (sqlite) => {
          seedVideo(sqlite, { visibility_status: "private" });
          for (let index = 1; index <= 9; index += 1) {
            insertRow(sqlite, "events", {
              id: `evt-l${index}`,
              title: `Limit ${index}`,
              visibility_status: "private",
              created_at: 1000,
              updated_at: 1000,
            });
            insertRow(sqlite, "video_events", { video_id: "vid-1", event_id: `evt-l${index}` });
          }
        },
        arrange: arrangeVideo({ beforePatch: { visibility_status: "public" } }),
      },
    ],
    // ---- CAS / rollback ----
    [
      "event_cas_conflict_rolls_back_and_compensates",
      {
        arrange: arrangeEvent("evt-1", { beforePatch: { visibility_status: "private" } }),
        hooks: { beforeBatch: raceEvent },
      },
    ],
    [
      "video_cas_conflict_rolls_back_and_compensates",
      {
        setup: seedVideoWithEvents(),
        arrange: arrangeVideo(videoPublicToPrivate),
        hooks: { beforeBatch: raceVideo },
      },
    ],
    [
      "compensation_failure_is_warned",
      {
        arrange: arrangeEvent("evt-1", { beforePatch: { visibility_status: "private" } }),
        hooks: { beforeBatch: raceEvent },
        bucket: { failGetsAfterRollback: true },
      },
    ],
    [
      "failed_run_record_failure_is_logged",
      {
        ...withAnn,
        arrange: arrangeAnn(staleAnn),
        hooks: { beforeBatch: raceAnn, failRun: /insert into "audit_restore_runs"/i },
      },
    ],
    // ---- post-commit failures ----
    [
      "cache_delete_failure_is_swallowed",
      {
        arrange: arrangeEvent("evt-1", { beforePatch: { visibility_status: "private" } }),
        caches: cacheRecorder({ failOn: () => true }),
      },
    ],
    [
      "wake_dispatch_disabled",
      {
        arrange: arrangeEvent("evt-1", { beforePatch: { visibility_status: "private" } }),
        env: { QUEUE_DISPATCH_ENABLED: undefined },
      },
    ],
  ];

  test("golden: restoreAuditLog (audit restore)", async () => {
    const actual = {};
    for (const [name, spec] of scenarios) {
      const [key, value] = await runScenario(name, spec);
      assert.ok(!(key in actual), `duplicate scenario name ${key}`);
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
