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
        if (options.failGetsWhen?.()) {
          if (options.secretOnFailure) {
            const error = new Error(`r2 get failed ${options.secretOnFailure}`);
            error.providerDetails = { headers: { authorization: options.secretOnFailure } };
            error.cause = new Error(`upstream ${options.secretOnFailure}`);
            throw error;
          }
          throw new Error("r2 get failed");
        }
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
      // Inject a provider-shaped failure without serializing the Error into
      // the harness log. Production code must not log its message or metadata.
      const injected = behaviour.errorOn?.(key);
      if (injected) throw injected;
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
      secretOnFailure: bucketSpec?.secretOnFailure,
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

      // Local D1 budget regression for the tested audit-restore video paths.
      // Count all direct D1 operations and statements inside each D1 batch;
      // unlike a production workerd probe this does NOT include HTTP auth,
      // CostGuard, or unrelated pre/post-commit caller work.
      const guardedVideoRestores = new Set([
        "video_public_to_private",
        "video_private_to_public",
        "video_snapshot_without_source_keys_uses_current",
        "video_snapshot_null_youtube_id_is_not_rejected",
        "video_cas_conflict_rolls_back_and_compensates",
      ]);
      if (guardedVideoRestores.has(key)) {
        const directD1 = value.log.filter((entry) => entry.op === "d1");
        const batchD1 = value.log
          .filter((entry) => entry.op === "batch")
          .reduce((count, entry) => count + entry.statements.length, 0);
        const fenceReads = directD1.filter((entry) =>
          entry.sql.includes('from "public_visibility_fences"')
        ).length;
        const expectedFenceReads =
          key === "video_cas_conflict_rolls_back_and_compensates" ? 2 : 1;
        assert.equal(fenceReads, expectedFenceReads,
          `${key}: one authoritative fence pre-read per transition; compensation adds one`);
        assert.ok(directD1.length + batchD1 <= 30,
          `${key}: synthetic D1 budget exceeded: ${directD1.length} direct + ${batchD1} batched`);
      }
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

  test("SEC-731: video audit restore rebuilds both primary events without video_events", async () => {
    // Legacy videos may have no membership rows. The audit snapshot can still
    // restore a different primary event; both old and new static artifacts
    // must be enqueued in the same successful D1 audit batch.
    const spec = {
      setup: (sqlite) => seedVideo(sqlite),
      arrange: arrangeVideo({
        beforePatch: {
          visibility_status: "private", primary_event_id: "evt-private", creator_x_user_id: "x_actor",
        },
      }),
    };
    const [, result] = await runScenario("sec731_primary_event_fanout", spec);
    assert.equal(result.outcome.returned?.ok, true);
    assert.equal(result.videos.find((row) => row.id === "vid-1")?.primary_event_id, "evt-private");
    assert.equal(result.audit_restore_runs.filter((row) => row.status === "success").length, 1);
    assert.equal(result.log.filter((entry) => entry.op === "batch").length, 1,
      "restore, audit and all rebuild targets must use one atomic D1 batch");
    assert.equal(result.log.filter((entry) => entry.op === "d1").length, 8,
      "rebuild target discovery must not add a D1 pre-read");
    const eventTargets = result.static_rebuild_queue
      .filter((row) => row.target_type === "event_base" || row.target_type === "event_release")
      .map((row) => `${row.target_type}:${row.target_id}`);
    assert.deepEqual(eventTargets, [
      "event_base:evt-1", "event_base:evt-private",
      "event_release:evt-1", "event_release:evt-private",
    ], "old and restored parents are both invalidated, with no unrelated events");
    assert.deepEqual(result.static_rebuild_queue
      .filter((row) => row.target_type === "user").map((row) => row.target_id),
    ["x_actor", "x_creator"],
    "both restored and previous creators must have user profile rebuilds");
    assert.equal(result.static_rebuild_queue.filter((row) =>
      row.target_type === "users_index" && row.target_id === "global").length, 1,
    "creator transition must not duplicate the global users index target");
    assert.ok(result.manifest_after?.entities?.some((entry) =>
      entry.entity_type === "video" && entry.entity_id === "vid-1"),
    "a successful public-to-private restore preserves the R2 video block");
    // SEC-718: each of the prior/restored event parents requires exactly the
    // four refresh buckets for BOTH public export formats (16 total deletes).
    // A single matching cache key is insufficient parity evidence.
    const evictedExportTokens = result.log
      .filter((entry) => entry.op === "cache.delete" &&
        entry.key.includes("public-event-export%3A"))
      .map((entry) => decodeURIComponent(entry.key.slice(entry.key.lastIndexOf("/") + 1)))
      .sort();
    const requiredExportTokens = ["evt-1", "evt-private"].flatMap((eventId) =>
      ["v5", "legacy"].flatMap((format) =>
        [15, 60, 360, 1440].map((minutes) =>
          `public-event-export:9:${eventId}:${format}:${minutes}`)))
      .sort();
    assert.deepEqual(evictedExportTokens, requiredExportTokens,
      "both event parents must invalidate all 16 scheduled export variants once, without unrelated keys");

    const [, rolledBack] = await runScenario("sec731_primary_event_rollback", {
      ...spec,
      hooks: { beforeBatch: raceVideo },
    });
    assert.equal(rolledBack.outcome.returned?.ok, false);
    assert.equal(rolledBack.static_rebuild_queue.length, 0,
      "a failed audited D1 mutation may not persist any rebuild target");
    assert.equal(rolledBack.log.filter((entry) => entry.op === "cache.delete").length, 0,
      "a D1 rollback may not trigger public cache invalidation");

    const [, dryRun] = await runScenario("sec731_primary_event_dry_run", {
      ...spec,
      options: { dry_run: true },
    });
    assert.equal(dryRun.outcome.returned?.ok, true);
    assert.equal(dryRun.static_rebuild_queue.length, 0);
    assert.equal(dryRun.log.filter((entry) => entry.op === "batch").length, 0);
    assert.equal(dryRun.log.filter((entry) => entry.op === "r2.put").length, 0);
  });

  test("SEC-718: primary-event-only video restore invalidates both event exports without an R2 fence", async () => {
    // No visibility transition: a historical primary-event reassignment still
    // moves the video between scheduled exports and must invalidate BOTH.
    const spec = {
      setup: (sqlite) => seedVideo(sqlite),
      arrange: arrangeVideo({
        beforePatch: { primary_event_id: "evt-private" },
      }),
    };
    const [, result] = await runScenario("sec718_primary_only_reassignment", spec);
    assert.equal(result.outcome.returned?.ok, true);
    assert.equal(result.videos.find((row) => row.id === "vid-1")?.primary_event_id, "evt-private");
    assert.equal(result.videos.find((row) => row.id === "vid-1")?.visibility_status, "public",
      "primary reassignment must not alter visibility");
    assert.equal(result.audit_restore_runs.filter((row) => row.status === "success").length, 1);
    assert.equal(result.log.filter((entry) => entry.op === "batch").length, 1,
      "parent reassignment and queue targets must commit atomically");
    assert.equal(result.log.filter((entry) => entry.op === "d1").length, 7,
      "unchanged visibility avoids the fence pre-read (one less than the public-to-private path)");
    assert.equal(result.log.filter((entry) => entry.op === "r2.put").length, 0,
      "unchanged public visibility must not write an unrelated R2 fence");
    const parents = result.static_rebuild_queue
      .filter((row) => row.target_type === "event_base" || row.target_type === "event_release")
      .map((row) => `${row.target_type}:${row.target_id}`)
      .sort();
    assert.deepEqual(parents, [
      "event_base:evt-1", "event_base:evt-private",
      "event_release:evt-1", "event_release:evt-private",
    ].sort(), "old/new primary event builds must both be queued");
    const actualExportKeys = result.log
      .filter((entry) => entry.op === "cache.delete" &&
        entry.key.includes("public-event-export%3A"))
      .map((entry) => decodeURIComponent(entry.key.slice(entry.key.lastIndexOf("/") + 1)))
      .sort();
    const expectedExportKeys = ["evt-1", "evt-private"].flatMap((eventId) =>
      ["v5", "legacy"].flatMap((format) =>
        [15, 60, 360, 1440].map((minutes) =>
          `public-event-export:9:${eventId}:${format}:${minutes}`)))
      .sort();
    assert.deepEqual(actualExportKeys, expectedExportKeys,
      "reassignment without visibility change still evicts exactly 16 old/new export keys");

    const [, failed] = await runScenario("sec718_primary_only_rollback", {
      ...spec, hooks: { beforeBatch: raceVideo },
    });
    assert.equal(failed.outcome.returned?.ok, false);
    assert.equal(failed.videos.find((row) => row.id === "vid-1")?.primary_event_id, "evt-1");
    assert.equal(failed.static_rebuild_queue.length, 0);
    assert.equal(failed.log.filter((entry) => entry.op === "cache.delete").length, 0,
      "failed reassignment must not remove old or new export cache keys");
    assert.equal(failed.log.filter((entry) => entry.op === "r2.put").length, 0);

    const [, dryRun] = await runScenario("sec718_primary_only_dry_run", {
      ...spec, options: { dry_run: true },
    });
    assert.equal(dryRun.outcome.returned?.ok, true);
    assert.equal(dryRun.static_rebuild_queue.length, 0);
    assert.equal(dryRun.log.filter((entry) => entry.op === "cache.delete").length, 0);
    assert.equal(dryRun.log.filter((entry) => entry.op === "batch").length, 0);
    assert.equal(dryRun.log.filter((entry) => entry.op === "r2.put").length, 0);
  });

  test("SEC-731: restored primary outside eight relations fails closed; exactly eight unique events succeed", async () => {
    const specForRelationCount = (count) => ({
      setup: (sqlite) => {
        seedVideo(sqlite);
        insertRow(sqlite, "video_events", { video_id: "vid-1", event_id: "evt-1" });
        for (let i = 1; i < count; i += 1) {
          const eventId = `evt-extra-${i}`;
          insertRow(sqlite, "events", {
            id: eventId, title: `Extra ${i}`, visibility_status: "public",
            created_at: 1000, updated_at: 1000,
          });
          insertRow(sqlite, "video_events", { video_id: "vid-1", event_id: eventId });
        }
      },
      arrange: arrangeVideo({
        beforePatch: { visibility_status: "private", primary_event_id: "evt-private" },
      }),
    });
    const [, atLimit] = await runScenario("sec731_eight_unique_targets", specForRelationCount(7));
    assert.equal(atLimit.outcome.returned?.ok, true,
      "seven related events plus the restored primary must fit the eight-event cap");
    assert.equal(atLimit.log.filter((entry) => entry.op === "d1").length, 8,
      "checking the union of parent events must not add a D1 pre-read");
    assert.equal(atLimit.log.filter((entry) => entry.op === "batch").length, 1,
      "the successful restore and rebuild fanout must share one atomic batch");
    const eventTargets = atLimit.static_rebuild_queue
      .filter((row) => row.target_type === "event_base" || row.target_type === "event_release");
    assert.equal(eventTargets.length, 16,
      "all eight distinct event parents must have both rebuild target types");
    assert.equal(new Set(eventTargets.map((row) => `${row.target_type}:${row.target_id}`)).size, 16,
      "no event-target duplicates may consume the bounded queue");
    const scheduledExportDeletes = atLimit.log.filter((entry) =>
      entry.op === "cache.delete" && entry.key.includes("public-event-export%3A"));
    assert.equal(scheduledExportDeletes.length, 64,
      "eight parents × two export formats × four cache buckets must all be evicted");
    assert.equal(new Set(scheduledExportDeletes.map((entry) => entry.key)).size, 64);

    const [, overLimit] = await runScenario("sec731_ninth_restored_parent", specForRelationCount(8));
    assert.equal(overLimit.outcome.returned?.ok, false,
      "eight related events plus a different restored primary must be rejected");
    assert.equal(overLimit.outcome.returned?.reason_code, "mutation_failed");
    assert.match(overLimit.outcome.returned?.message ?? "",
      /video_status_rebuild_event_limit_exceeded/);
    assert.equal(overLimit.static_rebuild_queue.length, 0,
      "over-limit fanout must leave the queue entirely untouched");
    assert.equal(overLimit.log.filter((entry) => entry.op === "batch").length, 0,
      "an over-limit restore must never begin the atomic mutation");
    assert.equal(overLimit.log.filter((entry) => entry.op === "r2.put").length, 0,
      "an over-limit restore must not write the visibility fence");
    assert.equal(overLimit.log.filter((entry) => entry.op === "cache.delete").length, 0,
      "failed restore must not evict any public event export");
  });

  test("SEC-730: unregistered audit table data never reaches HTTP or failed-run diagnostics", async () => {
    const secret = "SEC730_UNTRUSTED_AUDIT_TABLE_PRIVATE_CANARY";
    for (const dry_run of [true, false]) {
      const [, actual] = await runScenario(`sec730_unknown_table_${dry_run ? "dry" : "write"}`, {
        arrange: ({ sqlite }) => addAudit(sqlite, {
          table_name: `unregistered_${secret}`,
          target_id: "ann-1",
          before: { id: "ann-1", title: "Before" },
          after: { id: "ann-1", title: "After" },
        }),
        options: { dry_run },
      });
      const returned = actual.outcome.returned;
      assert.equal(returned?.ok, false, "unknown table cannot be restored");
      assert.equal(returned?.reason_code, "adapter_missing");
      assert.equal(returned?.message, "復元アダプターが見つかりません。",
        "never include a database-sourced table name in a response");
      assert.ok(!JSON.stringify(returned).includes(secret));
      assert.ok(!JSON.stringify(actual.log.filter((entry) =>
        entry.op.startsWith("console."))).includes(secret),
      "console output must not echo the table name");
      if (dry_run) {
        assert.equal(actual.audit_restore_runs.length, 0, "dry-run writes no failed-run audit");
        assert.equal(actual.log.filter((entry) => entry.op === "batch").length, 0);
        assert.equal(actual.audit_logs[0].restore_unavailable_message, null);
      } else {
        assert.equal(actual.audit_restore_runs.length, 1);
        assert.equal(actual.audit_restore_runs[0].status, "failed");
        assert.ok(!JSON.stringify(actual.audit_restore_runs).includes(secret),
          "persisted failure diagnostics must not include the untrusted table name");
        assert.equal(actual.audit_logs[0].restore_unavailable_reason_code, "adapter_missing");
        assert.equal(actual.audit_logs[0].restore_unavailable_message, "復元アダプターが見つかりません。");
        assert.equal(actual.announcements.length, 0, "no target mutation for an unknown table");
      }
    }
  });

  test("SEC-730: adapter mutation-build exceptions never expose SQL/provider data", async () => {
    const secret = "SEC730_BUILD_SQL_PARAMETER_PRIVATE_CANARY";
    const adapter = getAdapter("announcements");
    assert.ok(adapter, "announcements restore adapter is registered");
    const originalBuild = adapter.buildRestoreMutation;
    adapter.buildRestoreMutation = () => {
      const error = new Error(`Failed query: SELECT secret; params: ${secret}`);
      error.cause = new Error(`upstream provider ${secret}`);
      error.providerDetails = { headers: { authorization: secret } };
      throw error;
    };
    try {
      const [, result] = await runScenario("sec730_adapter_build_unknown", {
        ...withAnn,
        arrange: arrangeAnn(staleAnn),
      });
      assert.equal(result.outcome.returned?.ok, false);
      assert.equal(result.outcome.returned?.reason_code, "mutation_failed");
      assert.equal(result.outcome.returned?.message, "復元mutationを作成できません。",
        "untrusted adapter exceptions must map to a fixed user-facing message");
      assert.equal(result.audit_restore_runs.length, 1,
        "failed adapter construction still records an audited failure");
      assert.equal(result.audit_restore_runs[0].status, "failed");
      assert.equal(result.log.filter((entry) => entry.op === "batch").length, 0,
        "an adapter construction failure cannot begin the audited D1 mutation");
      assert.equal(result.log.filter((entry) => entry.op === "r2.put").length, 0);
      assert.ok(!JSON.stringify(result.outcome).includes(secret),
        "HTTP-visible result must never include the private SQL parameter");
      assert.ok(!JSON.stringify(result.audit_restore_runs).includes(secret),
        "failed-run audit must store only the safe diagnostic");
      assert.ok(!JSON.stringify(result.log.filter((entry) => entry.op.startsWith("console."))).includes(secret),
        "external logs must not contain the provider error or nested metadata");
    } finally {
      adapter.buildRestoreMutation = originalBuild;
    }
  });

  test("SEC-717: event/video restore compensation logs no nested provider canary", async () => {
    const secret = "SEC717_PRIVATE_PROVIDER_CANARY";
    const scenariosWithCompensationFailure = [
      ["event", {
        arrange: arrangeEvent("evt-1", { beforePatch: { visibility_status: "private" } }),
        hooks: { beforeBatch: raceEvent },
        bucket: { failGetsAfterRollback: true, secretOnFailure: secret },
      }],
      ["video", {
        setup: seedVideoWithEvents(),
        arrange: arrangeVideo(videoPublicToPrivate),
        hooks: { beforeBatch: raceVideo },
        bucket: { failGetsAfterRollback: true, secretOnFailure: secret },
      }],
    ];
    for (const [entityType, spec] of scenariosWithCompensationFailure) {
      const [, result] = await runScenario(`secret_compensation_${entityType}`, spec);
      const warnings = result.log.filter((entry) =>
        entry.op === "console.warn" &&
        entry.args[0] === "[audit-restore] visibility compensation failed"
      );
      assert.equal(warnings.length, 1, `${entityType}: exactly one fixed-code warning`);
      assert.deepEqual(warnings[0].args,
        ["[audit-restore] visibility compensation failed", "provider_error"]);
      assert.ok(!JSON.stringify(result).includes(secret),
        `${entityType}: provider message, cause and nested fields must not escape`);
      assert.equal(result.outcome.returned?.ok, false,
        `${entityType}: failed D1 restore remains failed`);
      assert.equal(result.audit_restore_runs.filter((run) => run.status === "success").length, 0);
      assert.ok(result.audit_restore_runs.some((run) => run.status === "failed"),
        `${entityType}: failed restore remains audited`);
      assert.ok(result.manifest_after?.entities?.some((entry) => entry.entity_type === entityType),
        `${entityType}: failed compensation leaves the R2 safety block intact`);
    }
  });

  test("SEC-717: failed audit-run persistence never logs SQL parameters or restore reason", async () => {
    const secret = "SEC717_FAILED_RUN_SQL_PARAMETER_PRIVATE_CANARY";
    const [, result] = await runScenario("failed_run_private_sql_params", {
      ...withAnn,
      arrange: arrangeAnn(staleAnn),
      options: { reason: secret },
      hooks: {
        beforeBatch: raceAnn,
        failRun: /insert into "audit_restore_runs"/i,
      },
    });
    assert.equal(result.outcome.returned?.ok, false,
      "failed atomic restoration and failed error-run write must not report success");
    assert.equal(result.audit_restore_runs.length, 0,
      "injected failed-run write must not create false audit success");
    const emitted = result.log.filter((entry) => entry.op.startsWith("console."));
    assert.deepEqual(emitted, [{
      op: "console.error",
      args: [JSON.stringify({
        event: "restore_failure_record_failed",
        code: "d1_write_failed",
      })],
    }], "only the fixed failure event/code is emitted; no user IDs or SQL");
    assert.ok(!JSON.stringify(emitted).includes(secret),
      "a Drizzle SQL-parameter error cannot leak the user-supplied restore reason");
    assert.ok(!JSON.stringify(emitted).includes("aud-1") &&
      !JSON.stringify(emitted).includes("u-actor"),
    "audit and actor IDs must not be logged");
  });

  test("SEC-730: failed D1 mutation never reflects SQL/provider secrets in HTTP or audit rows", async () => {
    const secret = "SEC730_PRIVATE_SQL_PROVIDER_CANARY";
    const expectedMessage = "復元を確定できませんでした。変更はロールバックされました。";
    for (const [entityType, spec] of [
      ["event", {
        arrange: arrangeEvent("evt-1", { beforePatch: { visibility_status: "private" } }),
      }],
      ["video", {
        setup: seedVideoWithEvents(),
        arrange: arrangeVideo(videoPublicToPrivate),
      }],
    ]) {
      const [, result] = await runScenario(`private_mutation_error_${entityType}`, {
        ...spec,
        hooks: {
          beforeBatch: () => {
            const err = new Error(`Failed query: UPDATE audit_thing; params: ${secret}`);
            err.cause = new Error(`upstream provider ${secret}`);
            err.providerDetails = { headers: { authorization: secret } };
            throw err;
          },
        },
      });
      assert.equal(result.outcome.returned?.ok, false, entityType);
      assert.equal(result.outcome.returned?.reason_code, "mutation_failed", entityType);
      assert.equal(result.outcome.returned?.message, expectedMessage,
        `${entityType}: unknown SQL errors cannot appear in HTTP responses`);
      assert.ok(result.audit_restore_runs.some((row) => row.status === "failed"),
        `${entityType}: failed restore remains audited`);
      assert.equal(result.audit_restore_runs.filter((row) => row.status === "success").length, 0);
      assert.ok(!JSON.stringify(result.outcome).includes(secret),
        `${entityType}: response must not reflect the secret-bearing error`);
      assert.ok(!JSON.stringify(result.audit_restore_runs).includes(secret),
        `${entityType}: persisted failure history must not reflect provider metadata`);
      assert.ok(!JSON.stringify(result.log.filter((entry) =>
        entry.op.startsWith("console."))).includes(secret),
      `${entityType}: external console must never contain SQL/provider canaries`);
    }
  });

  test("SEC-718: successful video audit restore invalidates all bounded related exports", async () => {
    const formats = ["v5", "legacy"];
    const windows = [15, 60, 360, 1440];
    const expected = ["evt-1", "evt-private"].flatMap((eventId) =>
      formats.flatMap((format) => windows.map((minutes) =>
        `https://flamenode.internal/public-json/${encodeURIComponent(
          `public-event-export:9:${encodeURIComponent(eventId)}:${format}:${minutes}`
        )}`
      ))
    );
    for (const [label, setup, arrange] of [
      ["normal", seedVideoWithEvents(), arrangeVideo(videoPublicToPrivate)],
      ["primary-only", (sqlite) => seedVideo(sqlite), arrangeVideo(videoPublicToPrivate)],
    ]) {
      const [, actual] = await runScenario(`video_export_${label}`, { setup, arrange });
      assert.equal(actual.outcome.returned?.ok, true, label);
      const urls = actual.log.filter((entry) =>
        entry.op === "cache.delete" && entry.key.includes("public-event-export%3A")
      ).map((entry) => entry.key);
      assert.deepEqual(urls, expected, `${label}: complete v5+legacy x4 for both relation and primary IDs`);
      assert.equal(new Set(urls).size, 16, `${label}: no duplicate deletions`);
    }

    const [, rollback] = await runScenario("video_export_failed_commit", {
      setup: seedVideoWithEvents(),
      arrange: arrangeVideo(videoPublicToPrivate),
      hooks: { beforeBatch: raceVideo },
    });
    assert.equal(rollback.outcome.returned?.ok, false);
    assert.equal(rollback.log.filter((entry) =>
      entry.op === "cache.delete" && entry.key.includes("public-event-export%3A")
    ).length, 0, "D1 rollback cannot evict committed exports");
  });

  test("SEC-718: export cache provider failure logs only fixed code and preserves committed video restore", async () => {
    // Cache API is colo-local and an eviction can fail after an irreversible
    // D1 restore commit. This regression pins the best-effort boundary and
    // proves provider exceptions cannot leak nested credentials into logs.
    const secret = "SEC718_PRIVATE_CACHE_PROVIDER_CANARY";
    const [, result] = await runScenario("video_export_provider_failure", {
      setup: seedVideoWithEvents(),
      arrange: arrangeVideo(videoPublicToPrivate),
      caches: cacheRecorder({
        errorOn(key) {
          if (!key.includes("public-event-export%3A")) return null;
          const error = new Error(`cache provider failure ${secret}`);
          error.cause = new Error(`upstream ${secret}`);
          error.providerDetails = { headers: { authorization: secret } };
          return error;
        },
      }),
    });
    assert.equal(result.outcome.returned?.ok, true,
      "a completed D1 commit must not be falsely reported as rolled back");
    assert.equal(result.audit_restore_runs.filter((row) => row.status === "success").length, 1);
    assert.equal(result.videos.find((row) => row.id === "vid-1")?.visibility_status,
      "private", "the restored private state must be durable");
    // The real CURRENT host calls deletePublicJsonCaches(), which catches
    // each individual Cache API exception before audit-restoration can see it.
    // Two event IDs x (v5,legacy) x four windows = 16 fixed-code warnings.
    const warnings = result.log.filter((entry) =>
      entry.op === "console.warn" &&
      entry.args[0] === "[public-cache] cache_api_delete_failed"
    );
    assert.equal(warnings.length, 16,
      "cache failures are logged once per scheduled export key without provider details");
    for (const warning of warnings) {
      assert.deepEqual(warning.args, ["[public-cache] cache_api_delete_failed"]);
    }
    assert.equal(result.log.filter((entry) =>
      entry.op === "console.warn" &&
      entry.args[0] === "[audit-restore] event export invalidation failed"
    ).length, 0, "inner best-effort cache deletion must not throw to the audit caller");
    assert.ok(!JSON.stringify(result).includes(secret),
      "provider message/cause/nested Authorization header must not reach the log or response");
    assert.ok(result.log.some((entry) =>
      entry.op === "cache.delete" && entry.key.includes("public-event-export%3A")),
    "the scheduled export eviction must actually be attempted");
    assert.ok(result.log.some((entry) =>
      entry.op === "cache.delete" && !entry.key.includes("public-event-export%3A")),
    "other public JSON cache evictions must still run");
  });

  test("SEC-718: dry-run video restore never invalidates related scheduled exports", async () => {
    const [, result] = await runScenario("video_export_dry_run", {
      setup: seedVideoWithEvents(),
      arrange: arrangeVideo(videoPublicToPrivate),
      options: { dry_run: true },
    });
    assert.ok(result.outcome.returned && !result.outcome.threw, "dry-run must return normally");
    assert.equal(result.log.filter((entry) => entry.op === "cache.delete").length, 0);
    assert.equal(result.log.filter((entry) => entry.op === "r2.put").length, 0);
    assert.equal(result.log.filter((entry) => entry.op === "batch").length, 0);
    assert.equal(result.audit_restore_runs.length, 0, "dry-run cannot persist success/failure");
  });

  test("SEC-718: eight relations plus new primary must reject nine export targets before writes", async () => {
    const setup = (sqlite) => {
      seedVideo(sqlite);
      insertRow(sqlite, "video_events", { video_id: "vid-1", event_id: "evt-1" });
      for (let i = 0; i < 7; i += 1) {
        const id = `evt-extra-${i}`;
        insertRow(sqlite, "events", {
          id, title: `Extra Event ${i}`, visibility_status: "public",
          created_at: 1000, updated_at: 1000,
        });
        insertRow(sqlite, "video_events", { video_id: "vid-1", event_id: id });
      }
      // The snapshot's old/new primary IDs are evt-private / evt-1.
      // evt-private is outside the eight video_events relations.
    };
    const [, result] = await runScenario("video_export_union_overflow", {
      setup,
      arrange: arrangeVideo(videoPublicToPrivate),
    });
    assert.equal(result.outcome.returned?.ok, false, "nine distinct export targets must fail closed");
    assert.equal(result.log.filter((entry) => entry.op === "batch").length, 0,
      "reject before an atomic mutation");
    assert.equal(result.log.filter((entry) => entry.op === "r2.put").length, 0,
      "reject before public visibility precommit");
    assert.equal(result.log.filter((entry) => entry.op === "cache.delete").length, 0,
      "never partially invalidate an over-budget target set");
    assert.ok(result.audit_restore_runs.every((row) => row.status !== "success"));
  });
}
