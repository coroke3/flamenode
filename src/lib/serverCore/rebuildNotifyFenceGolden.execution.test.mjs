// MIG-0614 U01 golden: fixes the observable behaviour of the static rebuild
// enqueue/hooks, the video status notification batch, the visibility fence
// store/manifest R2 chain and the public JSON cache deletes BEFORE the code
// moves to packages/server-core. The same test must pass byte-for-byte after.
//
// D1 statements are recorded as { sql, params } and the rows that really land
// in a migrated SQLite database are dumped. R2 and Cache API calls are
// recorded with their keys/options and order. Time and random ids are frozen.
// Regenerate only on purpose: FLAMENODE_UPDATE_GOLDEN=1.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

const SNAPSHOT_URL = new URL("./rebuildNotifyFenceGolden.snapshot.json", import.meta.url);
const FROZEN_NOW_MS = 1_760_000_000_000;
const FROZEN_NOW_SEC = Math.floor(FROZEN_NOW_MS / 1000);

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
              "export function getCloudflareContext() { return globalThis.__rebuildGoldenContext; }",
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
  const schema = await import("../db/schema.ts");
  const enqueue = await import("../staticRebuild/enqueue.ts");
  const direct = await import("../staticRebuild/directEnqueue.ts");
  const hooks = await import("../staticRebuild/hooks.ts");
  const activeLookup = await import("../staticRebuild/activeLookupColumns.ts");
  const priorityCore = await import("../staticRebuild/priorityCore.ts");
  const { asBatchRunnable } = await import("../audit/mutate.ts");
  const videoStatusNotify = await import("../notifications/videoStatusNotify.ts");
  const actor = await import("../notifications/actor.ts");
  const fenceStore = await import("../publicData/publicVisibilityFenceStore.ts");
  const manifestCore = await import("../publicData/publicVisibilityManifestCore.ts");
  const manifestR2 = await import("../publicData/publicVisibilityManifestR2.ts");
  const manifest = await import("../publicData/publicVisibilityManifest.ts");
  const publicCache = await import("../publicData/publicCache.ts");
  const isolate = await import("../publicData/publicCacheIsolate.ts");
  const { resetQueueWakeWarningStateForTests } = await import("../queues/sendQueueWakeBestEffort.ts");
  const { resetQueueWakeFailureRecordStateForTests } = await import("../queues/wakeFailureRecord.ts");

  const migrationsDir = new URL("../../../migrations/", import.meta.url);
  const migrations = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(new URL(name, migrationsDir), "utf8"));

  function createD1(sqlite, log, hooksOption) {
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
        const result = execute(query, params, method);
        hooksOption?.afterStatement?.(query, sqlite);
        return result;
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
    sqlite.exec(`
      INSERT INTO "user" (id, name, email, role, is_banned, discord_id, active_x_user_id, is_notification_enabled)
        VALUES ('u-recipient', 'Recipient', 'r@example.test', 'user', 0, 'discord-r', NULL, 1);
      INSERT INTO "user" (id, name, email, role, is_banned, discord_id, active_x_user_id, is_notification_enabled)
        VALUES ('u-muted', 'Muted', 'm@example.test', 'user', 0, 'discord-m', NULL, 0);
      INSERT INTO "user" (id, name, email, role, is_banned, discord_id, active_x_user_id)
        VALUES ('u-actor', 'Actor', 'a@example.test', 'admin', 0, 'discord-a', 'x_actor');
      INSERT INTO x_users (id, x_name, approval_status) VALUES ('x_actor', 'Actor X', 'approved');
    `);
  }

  function dump(sqlite, query) {
    return sqlite.prepare(query).all().map((row) => ({ ...row }));
  }

  const printable = (value) =>
    value instanceof Error
      ? { error: value.message }
      : typeof value === "object" && value !== null
        ? JSON.parse(JSON.stringify(value, (_k, v) => (v instanceof Error ? { error: v.message } : v)))
        : value;

  /** Fake R2 bucket with etag CAS semantics; every call is recorded. */
  function createBucket(log, initial = {}) {
    const objects = new Map(Object.entries(initial));
    let etagCounter = 0;
    const describeOptions = (options) => {
      if (!options) return null;
      const out = {};
      if (options.httpMetadata) out.httpMetadata = options.httpMetadata;
      if (options.onlyIf instanceof Headers) out.onlyIf = { headers: [...options.onlyIf.entries()] };
      else if (options.onlyIf) out.onlyIf = options.onlyIf;
      return out;
    };
    return {
      objects,
      delete: async () => {},
      get: async (key) => {
        log.push({ op: "r2.get", key });
        const found = objects.get(key);
        if (!found) return null;
        return {
          etag: found.etag,
          size: "size" in found ? found.size : new TextEncoder().encode(found.text).byteLength,
          text: async () => found.text,
        };
      },
      put: async (key, value, options) => {
        log.push({ op: "r2.put", key, value, options: describeOptions(options) });
        const existing = objects.get(key);
        const onlyIf = options?.onlyIf;
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

  async function runScenario(name, body, { hooks: hooksOption, caches: cachesOption } = {}) {
    const sqlite = new DatabaseSync(":memory:");
    for (const migration of migrations) sqlite.exec(migration);
    seed(sqlite);
    const log = [];
    const d1 = createD1(sqlite, log, hooksOption);
    const db = drizzle(d1, { schema });
    const pendingWaitUntil = [];
    const queue = (binding) => ({
      send: async (message) => {
        log.push({ op: "queue.send", binding, message });
      },
    });
    const kv = {
      get: async () => null,
      delete: async () => {},
      put: async (key, value, options) => {
        log.push({ op: "kv.put", key, value, options });
      },
    };
    globalThis.__rebuildGoldenContext = {
      env: {
        DB: d1,
        BUCKET: createBucket(log),
        KV: kv,
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
    console.warn = (...args) => {
      log.push({ op: "console.warn", args: args.map(printable) });
    };
    const realCaches = globalThis.caches;
    if (cachesOption) {
      globalThis.caches = { default: cachesOption(log) };
    }
    resetQueueWakeWarningStateForTests();
    resetQueueWakeFailureRecordStateForTests();
    isolate.resetPublicJsonIsolateCacheForTests();

    let outcome;
    try {
      outcome = { returned: printable(await body({ db, sqlite, log })) };
    } catch (error) {
      outcome = { threw: String(error?.message ?? error) };
    } finally {
      await Promise.allSettled(pendingWaitUntil);
      Date.now = realNow;
      globalThis.crypto.randomUUID = realRandomUUID;
      console.warn = realWarn;
      if (cachesOption) {
        if (realCaches === undefined) delete globalThis.caches;
        else globalThis.caches = realCaches;
      }
      delete globalThis.__rebuildGoldenContext;
      isolate.resetPublicJsonIsolateCacheForTests();
    }

    const result = {
      outcome,
      log,
      static_rebuild_queue: dump(sqlite, "SELECT * FROM static_rebuild_queue ORDER BY target_type, target_id, id"),
      notification_outbox: dump(sqlite, "SELECT * FROM notification_outbox ORDER BY id"),
      public_visibility_fences: dump(sqlite, "SELECT * FROM public_visibility_fences ORDER BY entity_type, entity_id"),
      audit_logs: dump(sqlite, "SELECT * FROM audit_logs ORDER BY created_at, id"),
    };
    sqlite.close();
    return [name, result];
  }

  /** Executes a built queue batch the way enqueueStaticRebuildMany / mutateWithAudit would. */
  const runBatch = async (db, batch) => {
    if (batch.statements.length === 0) return { ran: false };
    await db.batch(batch.statements.map((statement) => asBatchRunnable(db, statement)));
    return { ran: true };
  };
  const summarizeBatch = (batch) => ({
    statementCount: batch.statements.length,
    expectedChanges: batch.expectedChanges,
    acceptedTargetCount: batch.acceptedTargetCount,
  });

  const insertQueueRow = (sqlite, row) => {
    const full = {
      id: "srb_seed",
      target_type: "video",
      target_id: "vid-1",
      reason: "seed",
      priority: "normal",
      status: "pending",
      attempt_count: 0,
      requested_by_user_id: null,
      lease_token: null,
      next_retry_at: null,
      processed_at: null,
      created_at: 1000,
      updated_at: 1000,
      ...row,
    };
    const columns = Object.keys(full);
    sqlite
      .prepare(`INSERT INTO static_rebuild_queue (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
      .run(...Object.values(full));
  };

  /** Bumps updated_at right after every static_rebuild_queue SELECT so each CAS loses. */
  const conflictOnQueueSelect = {
    afterStatement: (query, sqlite) => {
      if (/^select/i.test(query) && query.includes('"static_rebuild_queue"') && /limit/i.test(query)) {
        sqlite.exec("UPDATE static_rebuild_queue SET updated_at = updated_at + 5");
      }
    },
  };

  const statusArgs = (overrides = {}) => ({
    videoId: "vid-1",
    videoTitle: "Video One",
    youtubeVideoId: "yt123",
    prevStatus: "pending",
    nextStatus: "public",
    reason: "ok",
    recipientUserId: "u-recipient",
    eventId: "evt-1",
    ...overrides,
  });

  const manifestWith = (entities, revision = 3) => ({
    schema_version: 1,
    revision,
    generated_at: 1_700_000_000,
    entities,
  });
  const blockedEntity = (overrides = {}) => ({
    entity_type: "video",
    entity_id: "vid-1",
    fence_token: "fence-1",
    blocked_at: 1_700_000_000,
    reason: "visibility",
    ...overrides,
  });
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

  const scenarios = [
    // ---------------------------------------------------------------- staticRebuild
    [
      "rebuild_pure_helpers",
      () => ({
        priorityRank: priorityCore.PRIORITY_RANK,
        higher: [
          priorityCore.pickHigherPriority("low", "normal"),
          priorityCore.pickHigherPriority("high", "low"),
          priorityCore.pickHigherPriority("normal", "normal"),
        ],
        reasons: [
          priorityCore.resolveQueueReason("video_visibility_update", "video_update", "high", "low"),
          priorityCore.resolveQueueReason("video_update", "video_visibility_update", "high", "low"),
          priorityCore.resolveQueueReason("old", "new", "low", "high"),
          priorityCore.resolveQueueReason("old", "new", "high", "low"),
          priorityCore.resolveQueueReason(null, "new", "high", "low"),
        ],
        safety: [
          priorityCore.isSafetyQueueReason("event_id_rename_old_cleanup"),
          priorityCore.isSafetyQueueReason("other"),
        ],
        activeLookupColumns: Object.keys(activeLookup.staticRebuildActiveLookupSelect),
        limits: [
          enqueue.MAX_STATIC_REBUILD_BATCH_TARGETS,
          enqueue.STATIC_REBUILD_BATCH_PREFETCH_QUERY_COUNT,
          enqueue.STATIC_REBUILD_BULK_UPSERT_ROWS,
        ],
        hookTargets: {
          score: hooks.topScoreRebuildTargets("r"),
          visibility: hooks.topVideoVisibilityTargets("r", "low"),
          card: hooks.topVideoCardTargets("r"),
          event: hooks.topEventChangeTargets("r"),
          announcement: hooks.topAnnouncementTarget("r", "high"),
          fanOut: hooks.buildVideoCardChangeFanOutTargets({ reason: "r", requestedByUserId: "u-actor" }),
          memberSuggestions: hooks.memberSuggestionsTarget("r"),
          slotStats: hooks.topSlotStatsGlobalTarget("r"),
          top: hooks.topGlobalTarget("r"),
          maxEventTargets: hooks.MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS,
        },
      }),
    ],
    [
      "build_batch_dedupes_merges_priority_and_chunks_at_100_rows",
      async ({ db }) => {
        const items = Array.from({ length: 101 }, (_, index) => ({
          targetType: "video",
          targetId: `v${index}`,
          reason: "video_update",
        }));
        items.push(
          { targetType: "video", targetId: "v0", reason: "video_visibility_update", priority: "high", requestedByUserId: "u-actor" },
          { targetType: "video", targetId: "v1", reason: "later", priority: "low" },
        );
        const batch = await enqueue.buildStaticRebuildQueueBatch(db, items);
        const ran = await runBatch(db, batch);
        return { summary: summarizeBatch(batch), ran };
      },
    ],
    [
      "build_batch_empty_and_over_limit",
      async ({ db }) => {
        const empty = await enqueue.buildStaticRebuildQueueBatch(db, []);
        let overLimit;
        try {
          await enqueue.buildStaticRebuildQueueBatch(
            db,
            Array.from({ length: 257 }, (_, index) => ({ targetType: "video", targetId: `v${index}`, reason: "r" })),
          );
        } catch (error) {
          overLimit = error.message;
        }
        return { empty, overLimit };
      },
    ],
    [
      "enqueue_many_upserts_existing_rows_and_wakes_once",
      async ({ db, sqlite }) => {
        insertQueueRow(sqlite, { id: "srb_a", target_id: "v0", reason: "video_visibility_update", priority: "normal" });
        insertQueueRow(sqlite, { id: "srb_b", target_id: "v1", reason: "old", priority: "low", status: "processing", lease_token: "lease" });
        await enqueue.enqueueStaticRebuildMany(db, [
          { targetType: "video", targetId: "v0", reason: "video_update", priority: "high" },
          { targetType: "video", targetId: "v1", reason: "new", priority: "high", requestedByUserId: "u-actor" },
          { targetType: "user", targetId: "x_actor", reason: "xuser" },
        ]);
        await enqueue.enqueueStaticRebuildMany(db, []);
        return "done";
      },
    ],
    [
      "enqueue_many_failure_is_swallowed_with_warn",
      async ({ db }) => {
        await enqueue.enqueueStaticRebuildMany(
          db,
          Array.from({ length: 257 }, (_, index) => ({ targetType: "video", targetId: `v${index}`, reason: "r" })),
        );
        return "swallowed";
      },
    ],
    [
      "enqueue_single_insert_then_update_pending_then_processing_with_lease",
      async ({ db, sqlite }) => {
        const sentKinds = new Set();
        await enqueue.enqueueStaticRebuild(db, { targetType: "video", targetId: "v1", reason: "video_update" }, { wakeSource: "admin", sentKinds });
        await enqueue.enqueueStaticRebuild(
          db,
          { targetType: "video", targetId: "v1", reason: "later", priority: "high", requestedByUserId: "u-actor" },
          { wakeSource: "admin", sentKinds },
        );
        insertQueueRow(sqlite, { id: "srb_p", target_id: "v2", status: "processing", lease_token: "lease-1", reason: "video_visibility_update" });
        await enqueue.enqueueStaticRebuild(db, { targetType: "video", targetId: "v2", reason: "video_update", priority: "high" }, { wakeSource: "web" });
        insertQueueRow(sqlite, { id: "srb_q", target_id: "v3", status: "processing", lease_token: null });
        await enqueue.enqueueStaticRebuild(db, { targetType: "video", targetId: "v3", reason: "again" }, { queue: { send: async () => {} }, envFlags: { QUEUE_DISPATCH_ENABLED: "0" } });
        return { sentKinds: [...sentKinds] };
      },
    ],
    [
      "enqueue_single_retry_exhaustion_warns_and_writes_audit_history",
      async ({ db, sqlite }) => {
        insertQueueRow(sqlite, { id: "srb_c", target_id: "v1" });
        await enqueue.enqueueStaticRebuild(db, { targetType: "video", targetId: "v1", reason: "video_update", requestedByUserId: "u-actor" });
        return "swallowed";
      },
      { hooks: conflictOnQueueSelect },
    ],
    [
      "direct_enqueue_cause_mismatch_and_inserts",
      async ({ db }) => {
        const results = {};
        results.mismatch = await direct.directEnqueueStaticRebuild(
          db,
          { targetType: "video", targetId: "v1", reason: "video_update" },
          { kind: "public_miss", cooldownSeconds: 300 },
        );
        results.publicMiss = await direct.directEnqueueStaticRebuild(
          db,
          { targetType: "video", targetId: "v1", reason: "public_miss_video" },
          { kind: "public_miss", cooldownSeconds: 300 },
          { wakeSource: "web" },
        );
        results.periodic = await direct.directEnqueueStaticRebuild(
          db,
          { targetType: "top", targetId: "global", reason: "periodic_refresh", priority: "low" },
          { kind: "periodic", cooldownSeconds: 600 },
        );
        results.manual = await direct.directEnqueueStaticRebuild(
          db,
          { targetType: "rules", targetId: "global", reason: "rules_manual_repair", requestedByUserId: "u-actor" },
          { kind: "manual_repair", cooldownSeconds: 0 },
        );
        return results;
      },
    ],
    [
      "direct_enqueue_active_rows_cooldown_and_retry_backoff",
      async ({ db, sqlite }) => {
        const results = {};
        insertQueueRow(sqlite, { id: "srb_pr", target_id: "proc", status: "processing", lease_token: "lease", reason: "r" });
        results.publicMissOnProcessing = await direct.directEnqueueStaticRebuild(
          db,
          { targetType: "video", targetId: "proc", reason: "public_miss_video" },
          { kind: "public_miss", cooldownSeconds: 300 },
        );
        insertQueueRow(sqlite, { id: "srb_pe", target_id: "pend", status: "pending", reason: "public_x", priority: "normal" });
        results.noopPending = await direct.directEnqueueStaticRebuild(
          db,
          { targetType: "video", targetId: "pend", reason: "public_x", priority: "low" },
          { kind: "public_miss", cooldownSeconds: 300 },
        );
        results.escalatePending = await direct.directEnqueueStaticRebuild(
          db,
          { targetType: "video", targetId: "pend", reason: "public_x", priority: "high" },
          { kind: "public_miss", cooldownSeconds: 300 },
        );
        insertQueueRow(sqlite, { id: "srb_d", target_id: "done", status: "done", processed_at: FROZEN_NOW_SEC - 10, updated_at: FROZEN_NOW_SEC - 10 });
        results.cooldownSkipped = await direct.directEnqueueStaticRebuild(
          db,
          { targetType: "video", targetId: "done", reason: "public_miss_video" },
          { kind: "public_miss", cooldownSeconds: 300 },
        );
        results.manualBypassesCooldown = await direct.directEnqueueStaticRebuild(
          db,
          { targetType: "video", targetId: "done", reason: "video_manual_repair" },
          { kind: "manual_repair", cooldownSeconds: 0 },
        );
        insertQueueRow(sqlite, { id: "srb_f", target_id: "failed", status: "failed", next_retry_at: FROZEN_NOW_SEC + 600, updated_at: 1500 });
        results.failedBackoffSuppresses = await direct.directEnqueueStaticRebuild(
          db,
          { targetType: "video", targetId: "failed", reason: "periodic_x" },
          { kind: "periodic", cooldownSeconds: 100 },
        );
        insertQueueRow(sqlite, { id: "srb_old", target_id: "old", status: "done", processed_at: 100, updated_at: 100 });
        results.cooldownElapsedInserts = await direct.directEnqueueStaticRebuild(
          db,
          { targetType: "video", targetId: "old", reason: "periodic_x" },
          { kind: "periodic", cooldownSeconds: 100 },
        );
        return results;
      },
    ],
    [
      "direct_enqueue_conflict_retries_exhausted",
      ({ db, sqlite }) => {
        insertQueueRow(sqlite, { id: "srb_c", target_id: "v1", reason: "public_a" });
        return direct.directEnqueueStaticRebuild(
          db,
          { targetType: "video", targetId: "v1", reason: "public_b", priority: "high" },
          { kind: "public_miss", cooldownSeconds: 300 },
        );
      },
      { hooks: conflictOnQueueSelect },
    ],
    [
      "hooks_queue_batches_and_enqueue_after",
      async ({ db }) => {
        const out = {};
        const named = {
          xUser: () => hooks.buildAfterXUserPublicUpdateQueueBatch(db, { xUserId: "x_actor", reason: "x_profile", requestedByUserId: "u-actor" }),
          videoStatus: () =>
            hooks.buildAfterVideoStatusChangeQueueBatch(db, {
              videoId: "vid-1",
              eventIds: ["evt-1", "evt-2"],
              creatorXUserId: "x_actor",
              primaryEventId: "evt-1",
              requestedByUserId: "u-actor",
            }),
          eventGroup: () => hooks.buildEventGroupChangeQueueBatch(db, { reason: "group", requestedByUserId: "u-actor" }),
          slot: () => hooks.buildSlotChangeQueueBatch(db, { eventId: "evt-1", reason: "slot", requestedByUserId: "u-actor" }),
          event: () => hooks.buildEventChangeQueueBatch(db, { eventId: "evt-1", reason: "event", includeComposedCleanup: true }),
          pvsfEvent: () => hooks.buildEventChangeQueueBatch(db, { eventId: "PVSFSummary", reason: "event", priority: "low" }),
          announcement: () => hooks.buildAnnouncementChangeQueueBatch(db, { reason: "announce", requestedByUserId: "u-actor" }),
        };
        for (const [key, build] of Object.entries(named)) {
          const batch = await build();
          out[key] = { summary: summarizeBatch(batch), ran: await runBatch(db, batch) };
        }
        try {
          hooks.buildAfterVideoStatusChangeQueueBatch(db, {
            videoId: "vid-1",
            eventIds: Array.from({ length: 9 }, (_, index) => `evt-${index}`),
          });
        } catch (error) {
          out.statusEventLimit = error.message;
        }
        await hooks.enqueueAfterVideoCreate(db, {
          videoId: "vid-2",
          creatorXUserId: "x_actor",
          primaryEventId: "evt-1",
          eventIds: ["evt-1", "evt-3"],
          requestedByUserId: "u-actor",
        });
        await hooks.enqueueAfterVideoUpdate(db, {
          videoId: "vid-3",
          creatorXUserId: "x_actor",
          primaryEventId: "evt-1",
          eventIds: ["evt-2"],
          visibilityChanged: true,
          identityChanged: true,
          eventMembershipChanged: true,
          requestedByUserId: "u-actor",
        });
        await hooks.enqueueAfterVideoUpdate(db, {
          videoId: "vid-4",
          creatorXUserId: null,
          primaryEventId: null,
          eventIds: [],
          visibilityChanged: false,
          identityChanged: false,
          eventMembershipChanged: false,
        });
        await hooks.enqueueAfterXUserPublicUpdate(db, { xUserId: "x_actor", reason: "x_icon" });
        return out;
      },
    ],
    // ---------------------------------------------------------------- notifications
    [
      "video_status_notification_batches",
      async ({ db, sqlite }) => {
        const out = {};
        const run = async (key, args) => {
          const batch = await videoStatusNotify.buildVideoStatusChangeNotificationBatch(db, args);
          out[key] = { statementCount: batch.statements.length, expectedChanges: batch.expectedChanges };
          if (batch.statements.length > 0) {
            try {
              await db.batch(batch.statements.map((statement) => asBatchRunnable(db, statement)));
            } catch (error) {
              out[key].batchError = String(error?.message ?? error);
            }
          }
        };
        await run("approved", statusArgs());
        await run("approvedAgainDeduped", statusArgs());
        await run("approvedAgainForced", statusArgs({ forceNotify: true }));
        sqlite.exec("DELETE FROM notification_outbox");
        await run("voided", statusArgs({ nextStatus: "voided", reason: "rule violation" }));
        await run("silentPrivate", statusArgs({ nextStatus: "private" }));
        await run("silentLimited", statusArgs({ nextStatus: "limited", forceNotify: true }));
        await run("pending", statusArgs({ nextStatus: "pending", prevStatus: "public" }));
        await run("unchanged", statusArgs({ prevStatus: "public", nextStatus: "public" }));
        await run("noRecipient", statusArgs({ recipientUserId: "  " }));
        await run("nullRecipient", statusArgs({ recipientUserId: null }));
        await run("unknownRecipient", statusArgs({ recipientUserId: "nobody", videoId: "vid-9" }));
        await run("mutedRecipient", statusArgs({ recipientUserId: "u-muted", videoId: "vid-8" }));
        out.prefetchQueryCount = videoStatusNotify.VIDEO_STATUS_NOTIFICATION_PREFETCH_QUERY_COUNT;
        return out;
      },
    ],
    [
      "notification_actor_resolution_and_formatting",
      async ({ db }) => {
        const resolved = await actor.resolveNotificationActor(db, "u-actor");
        const missing = await actor.resolveNotificationActor(db, "nobody");
        const overlay = actor.overlayNotificationActorActiveX(
          { userId: "u", discordId: null, discordName: null, activeXId: null, activeXName: null },
          { activeXId: "x1", activeXName: "X <@one>" },
        );
        return {
          resolved,
          missing,
          overlay,
          keptExisting: actor.overlayNotificationActorActiveX(resolved, { activeXId: "x2", activeXName: "n" }),
          labels: [
            actor.formatActiveXLabel({ activeXId: "abc", activeXName: "Name @here" }),
            actor.formatActiveXLabel({ activeXId: "abc" }),
            actor.formatActiveXLabel({ activeXName: "Only <Name>" }),
            actor.formatActiveXLabel({}),
          ],
          opsSection: actor.formatOpsActorSection(resolved),
          opsSectionMissing: actor.formatOpsActorSection(null, "■ 見出し"),
          opsSectionPartial: actor.formatOpsActorSection({ userId: "u", discordId: "d1", discordName: null, activeXId: null, activeXName: null }),
        };
      },
    ],
    // ---------------------------------------------------------------- visibility fence
    [
      "fence_store_upsert_insert_update_get_delete",
      async ({ db }) => {
        const out = {};
        const input = {
          entityType: "x_user",
          entityId: "X_Actor",
          fenceToken: "tok-1",
          state: "blocked",
          reason: "visibility",
          requirementsJson: "{\"a\":1}",
          blockedAt: 100,
          requestedByAuthUserId: "u-actor",
          updatedAt: 200,
        };
        await fenceStore.upsertPublicVisibilityFence(db, input);
        out.afterInsert = await fenceStore.getPublicVisibilityFence(db, "x_user", "x_ACTOR");
        await fenceStore.upsertPublicVisibilityFence(db, {
          ...input,
          entityId: "x_actor",
          fenceToken: "tok-2",
          state: "release_pending",
          releaseRequestedAt: 300,
          reason: null,
          updatedAt: 400,
        });
        out.afterUpdate = await fenceStore.getPublicVisibilityFence(db, "x_user", "X_ACTOR");
        await fenceStore.upsertPublicVisibilityFence(db, {
          entityType: "video",
          entityId: "Vid-1",
          fenceToken: "tok-v",
          state: "blocked",
          updatedAt: 500,
        });
        out.videoKeepsCase = await fenceStore.getPublicVisibilityFence(db, "video", "Vid-1");
        out.videoLowerMissing = await fenceStore.getPublicVisibilityFence(db, "video", "vid-1");
        out.deleteWrongToken = await fenceStore.deletePublicVisibilityFence(db, "x_user", "X_Actor", "tok-1");
        out.deleteRightToken = await fenceStore.deletePublicVisibilityFence(db, "x_user", "X_Actor", "tok-2");
        out.deleteAgain = await fenceStore.deletePublicVisibilityFence(db, "x_user", "x_actor", "tok-2");
        out.afterDelete = await fenceStore.getPublicVisibilityFence(db, "x_user", "x_actor");
        return out;
      },
    ],
    [
      "manifest_core_pure_transforms",
      () => {
        const base = manifestWith([blockedEntity(), blockedEntity({ entity_type: "x_user", entity_id: "X_One", fence_token: "f-x" })]);
        return {
          mode: ["off", "enforce", "observe", "weird", undefined, null].map(manifestCore.resolvePublicVisibilityGuardMode),
          empty: manifestCore.emptyPublicVisibilityBlockedEntitiesManifest(5),
          blocked: [
            manifestCore.isEntityBlockedInManifest(base, "video", "vid-1"),
            manifestCore.isEntityBlockedInManifest(base, "x_user", "x_one"),
            manifestCore.isEntityBlockedInManifest(base, "event", "vid-1"),
          ],
          upserted: manifestCore.upsertBlockedEntityInManifest(base, blockedEntity({ entity_type: "x_user", entity_id: "X_ONE", fence_token: "f-new" }), 9),
          releasedOk: manifestCore.releaseBlockedEntityInManifest(base, "video", "vid-1", "fence-1", 10),
          releasedWrongToken: manifestCore.releaseBlockedEntityInManifest(base, "video", "vid-1", "nope", 10),
          releasedMissing: manifestCore.releaseBlockedEntityInManifest(base, "event", "evt-9", "fence-1", 10),
          normalized: manifestCore.normalizePublicVisibilityBlockedEntitiesManifest(JSON.parse(JSON.stringify(base))),
          normalizedBad: [null, [], { schema_version: 2 }, { schema_version: 1, revision: -1, generated_at: 1, entities: [] }].map(
            (value) => manifestCore.normalizePublicVisibilityBlockedEntitiesManifest(value),
          ),
          constants: [
            manifestCore.PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
            manifestCore.PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES,
            manifestCore.PUBLIC_VISIBILITY_MANIFEST_SCHEMA_VERSION,
          ],
        };
      },
    ],
    [
      "manifest_r2_read_and_cas_put",
      async ({ log }) => {
        const out = {};
        const key = manifestCore.PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY;
        const emptyBucket = createBucket(log);
        out.readMissing = await manifestR2.readVisibilityManifestObject(emptyBucket);

        const bucket = createBucket(log);
        await manifestR2.putVisibilityManifestWithCas(bucket, manifestWith([blockedEntity()], 1), null);
        out.afterCreate = bucket.objects.get(key);
        out.readExisting = await manifestR2.readVisibilityManifestObject(bucket);

        await manifestR2.putVisibilityManifestWithCas(bucket, manifestWith([blockedEntity(), blockedEntity({ entity_id: "vid-2", fence_token: "f2" })], 2), out.readExisting.etag);
        out.afterEtagMatch = bucket.objects.get(key);

        await manifestR2.putVisibilityManifestWithCas(bucket, manifestWith([], 9), undefined);
        out.afterUnconditional = bucket.objects.get(key);

        // A competing first producer already created the object: merge lossless.
        const racing = createBucket(log, { [key]: { text: JSON.stringify(manifestWith([blockedEntity({ entity_id: "other", fence_token: "f-other" })], 4)), etag: "etag-race" } });
        await manifestR2.putVisibilityManifestWithCas(racing, manifestWith([blockedEntity({ entity_id: "mine", fence_token: "f-mine" })], 1), null);
        out.afterCreateMerge = racing.objects.get(key);

        // Stale etag with a mutator re-applies on the latest manifest.
        await manifestR2.putVisibilityManifestWithCas(
          racing,
          manifestWith([], 0),
          "etag-stale",
          (latest) => manifestCore.upsertBlockedEntityInManifest(latest, blockedEntity({ entity_id: "mutated", fence_token: "f-m" }), 77),
        );
        out.afterMutateOnConflict = racing.objects.get(key);

        try {
          await manifestR2.putVisibilityManifestWithCas(racing, manifestWith([], 0), "etag-stale-again");
        } catch (error) {
          out.stalePreconditionFailed = error.message;
        }
        out.maxRetries = manifestR2.MANIFEST_PUT_MAX_RETRIES;
        return out;
      },
    ],
    [
      "manifest_r2_rejects_oversized_and_malformed",
      async ({ log }) => {
        const key = manifestCore.PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY;
        const attempt = async (object) => {
          const bucket = createBucket(log, { [key]: object });
          try {
            return await manifestR2.readVisibilityManifestObject(bucket);
          } catch (error) {
            return `threw: ${error.message}`;
          }
        };
        const max = manifestCore.PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES;
        const out = {
          knownSizeTooLarge: await attempt({ text: "{}", etag: "e", size: max + 1 }),
          negativeSize: await attempt({ text: "{}", etag: "e", size: -1 }),
          unknownSizeBodyTooLarge: await attempt({ text: " ".repeat(max + 1), etag: "e", size: undefined }),
          malformed: await attempt({ text: JSON.stringify({ schema_version: 1, revision: "x" }), etag: "e" }),
        };
        const bucket = createBucket(log);
        try {
          await manifestR2.putVisibilityManifestWithCas(
            bucket,
            manifestWith([blockedEntity({ reason: "x".repeat(max) })]),
            undefined,
          );
        } catch (error) {
          out.putTooLarge = error.message;
        }
        return out;
      },
    ],
    [
      "manifest_host_reader_and_writer_with_explicit_bucket",
      async ({ log }) => {
        const out = {};
        const bucket = createBucket(log);
        out.missingBucketDefaultsToObserve = await manifest.readPublicVisibilityBlockedEntitiesManifest(null);
        process.env.PUBLIC_VISIBILITY_GUARD_MODE = "enforce";
        try {
          await manifest.readPublicVisibilityBlockedEntitiesManifest(null);
        } catch (error) {
          out.missingBucketEnforce = error.message;
        }
        process.env.PUBLIC_VISIBILITY_GUARD_MODE = "off";
        out.missingBucketOff = await manifest.readPublicVisibilityBlockedEntitiesManifest(null);
        delete process.env.PUBLIC_VISIBILITY_GUARD_MODE;

        await manifest.writePublicVisibilityBlockedEntitiesManifest(manifestWith([blockedEntity()], 1), { bucket, ifMatchEtag: undefined });
        out.afterCreateIfAbsent = (await manifest.readPublicVisibilityBlockedEntitiesManifest(bucket)).etag;
        await manifest.writePublicVisibilityBlockedEntitiesManifest(manifestWith([blockedEntity()], 2), { bucket });
        out.afterUnconditional = (await manifest.readPublicVisibilityBlockedEntitiesManifest(bucket)).etag;
        out.guardModes = [
          manifest.resolvePublicVisibilityGuardModeFromEnv({ PUBLIC_VISIBILITY_GUARD_MODE: "enforce" }),
          manifest.resolvePublicVisibilityGuardModeFromEnv({}),
          manifest.resolvePublicVisibilityGuardModeFromEnv(null),
        ];
        out.blocked = {
          enforce: await manifest.isPublicEntityVisibilityBlocked({ entityType: "video", entityId: "vid-1", guardMode: "enforce", manifest: manifestWith([blockedEntity()]) }),
          observe: await manifest.isPublicEntityVisibilityBlocked({ entityType: "video", entityId: "vid-1", guardMode: "observe", manifest: manifestWith([blockedEntity()]) }),
          off: await manifest.isPublicEntityVisibilityBlocked({ entityType: "video", entityId: "vid-1", guardMode: "off", manifest: manifestWith([blockedEntity()]) }),
          other: await manifest.isPublicEntityVisibilityBlocked({ entityType: "event", entityId: "vid-1", guardMode: "enforce", manifest: manifestWith([blockedEntity()]) }),
        };
        return out;
      },
    ],
    // ---------------------------------------------------------------- publicCache deletes
    [
      "public_cache_key_and_deletes_keep_order",
      async () => {
        const keys = ["static/events/a b.json", "static/videos/あ.json", "x/y?z#1"];
        await publicCache.deletePublicJsonCaches(keys);
        await publicCache.deletePublicJsonCache("single/key.json");
        await publicCache.deletePublicJsonCaches([]);
        return { cacheKeys: keys.map((key) => publicCache.publicJsonCacheKey(key).url) };
      },
      { caches: cacheRecorder() },
    ],
    [
      "public_cache_delete_failure_is_swallowed_and_continues",
      async () => {
        await publicCache.deletePublicJsonCaches(["k/1.json", "k/2.json", "k/3.json"]);
        return "swallowed";
      },
      { caches: cacheRecorder({ failOn: (key) => key.endsWith("k%2F2.json") }) },
    ],
    [
      "public_cache_delete_drops_isolate_entry_even_without_cache_api",
      async () => {
        publicCache.writePublicJsonCacheBestEffort("iso/key.json", { n: 1 }, 30);
        const before = await publicCache.readPublicJsonCache("iso/key.json");
        await publicCache.deletePublicJsonCache("iso/key.json");
        const after = await publicCache.readPublicJsonCache("iso/key.json");
        return { before, after };
      },
      { caches: cacheRecorder() },
    ],
  ];

  test("golden: staticRebuild / notifications / visibility fence / public cache observable behaviour", async () => {
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
