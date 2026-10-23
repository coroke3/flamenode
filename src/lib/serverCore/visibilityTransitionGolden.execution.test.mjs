// MIG-0615 U01 golden: fixes the observable behaviour of the video / event / event_group / x_user
// visibility transition planners, the shared fence lifecycle, the blocked-entities manifest
// pre-commit / compensation chain and the moderation open-case planners BEFORE the code moves
// to packages/server-core. The same test must pass byte-for-byte after the move.
//
// D1 statements are recorded as { sql, params } and the rows that really land in a migrated
// SQLite database are dumped. R2 (manifest get/put with etag CAS), Cache API deletes, Queue
// sends, console output and revalidate callbacks are recorded in call order. Time and random ids
// are frozen. Regenerate only on purpose: FLAMENODE_UPDATE_GOLDEN=1.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

const SNAPSHOT_URL = new URL("./visibilityTransitionGolden.snapshot.json", import.meta.url);
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
              "export function getCloudflareContext() { return globalThis.__visibilityGoldenContext; }",
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
  const { asBatchRunnable, AuditMutationError } = await import("../audit/mutate.ts");
  const videoTransition = await import("../video/videoVisibilityTransition.ts");
  const eventTransition = await import("../event/eventVisibilityTransition.ts");
  const eventGroupTransition = await import("../event/eventGroupVisibilityTransition.ts");
  const xUserTransition = await import("../xid/xUserVisibilityTransition.ts");
  const openCases = await import("../moderation/openCases.ts");
  const videoStatusNotify = await import("../notifications/videoStatusNotify.ts");
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
        log.push({ op: "d1", sql: query, params });
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
          log.push({ op: "batch.commit", changes: results.map((result) => result.meta.changes) });
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

  function seedVideo(sqlite, overrides = {}) {
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
      ...overrides,
    });
  }

  function seedFence(sqlite, row) {
    insertRow(sqlite, "public_visibility_fences", {
      entity_type: "video",
      entity_id: "vid-1",
      fence_token: "vf_d1",
      state: "blocked",
      reason: null,
      requirements_json: null,
      blocked_at: 500,
      release_requested_at: null,
      requested_by_auth_user_id: "u-actor",
      updated_at: 500,
      ...row,
    });
  }

  function seedCase(sqlite, row) {
    insertRow(sqlite, "video_moderation_cases", {
      video_id: "vid-1",
      case_type: "void",
      status: "open",
      public_reason: "old",
      private_note: null,
      created_by_user_id: "u-actor",
      created_at: 900,
      ...row,
    });
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

  const manifestOf = (entities, revision = 1) =>
    JSON.stringify({ schema_version: 1, revision, generated_at: 1, entities });
  const entity = (entity_type, entity_id, fence_token, extra = {}) => ({
    entity_type,
    entity_id,
    fence_token,
    blocked_at: 100,
    ...extra,
  });

  /**
   * Fake R2 bucket with etag CAS semantics; every call is recorded.
   * options.onFirstPutConflict(objects): another writer lands first and the CAS put returns null.
   * options.afterPut(objects): tampers with the object right after a successful put.
   * options.failPuts / options.failGets: the call throws.
   */
  function createBucket(log, initial = {}, options = {}) {
    const objects = new Map(Object.entries(initial));
    let etagCounter = 0;
    let conflictDone = false;
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
        if (options.failGets) throw new Error("r2 get failed");
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
        if (options.failPuts) throw new Error("r2 put failed");
        if (options.onFirstPutConflict && !conflictDone) {
          conflictDone = true;
          options.onFirstPutConflict(objects);
          return null;
        }
        const existing = objects.get(key);
        const onlyIf = putOptions?.onlyIf;
        if (onlyIf instanceof Headers && onlyIf.get("If-None-Match") === "*" && existing) return null;
        if (onlyIf && !(onlyIf instanceof Headers) && onlyIf.etagMatches && existing?.etag !== onlyIf.etagMatches) {
          return null;
        }
        etagCounter += 1;
        objects.set(key, { text: value, etag: `etag-${etagCounter}` });
        options.afterPut?.(objects);
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

  async function runScenario(name, body, { bucket: bucketSpec, caches: cachesOption, setup } = {}) {
    const sqlite = new DatabaseSync(":memory:");
    for (const migration of migrations) sqlite.exec(migration);
    seed(sqlite);
    setup?.(sqlite);
    const log = [];
    const d1 = createD1(sqlite, log);
    const db = drizzle(d1, { schema });
    const pendingWaitUntil = [];
    const queue = (binding) => ({
      send: async (message) => {
        log.push({ op: "queue.send", binding, message });
      },
    });
    const bucket = createBucket(log, bucketSpec?.initial ?? {}, bucketSpec?.options ?? {});
    globalThis.__visibilityGoldenContext = {
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
    const realConsole = { warn: console.warn, info: console.info, log: console.log, error: console.error };
    for (const level of ["warn", "info", "log", "error"]) {
      console[level] = (...args) => {
        log.push({ op: `console.${level}`, args: args.map(printable) });
      };
    }
    const realCaches = globalThis.caches;
    if (cachesOption) {
      globalThis.caches = { default: cachesOption(log) };
    }
    resetQueueWakeWarningStateForTests();
    resetQueueWakeFailureRecordStateForTests();
    isolate.resetPublicJsonIsolateCacheForTests();

    let outcome;
    try {
      outcome = { returned: printable(await body({ db, sqlite, log, bucket })) };
    } catch (error) {
      outcome = { threw: String(error?.message ?? error) };
    } finally {
      await Promise.allSettled(pendingWaitUntil);
      Date.now = realNow;
      globalThis.crypto.randomUUID = realRandomUUID;
      Object.assign(console, realConsole);
      if (cachesOption) {
        if (realCaches === undefined) delete globalThis.caches;
        else globalThis.caches = realCaches;
      }
      delete globalThis.__visibilityGoldenContext;
      isolate.resetPublicJsonIsolateCacheForTests();
    }

    const manifestObject = bucket.objects.get(MANIFEST_KEY);
    const result = {
      outcome,
      log,
      manifest_after: manifestObject ? JSON.parse(manifestObject.text) : null,
      public_visibility_fences: dump(sqlite, "SELECT * FROM public_visibility_fences ORDER BY entity_type, entity_id"),
      videos: dump(sqlite, "SELECT id, visibility_status, updated_at FROM videos ORDER BY id"),
      static_rebuild_queue: dump(
        sqlite,
        "SELECT target_type, target_id, reason, priority, status, requested_by_user_id FROM static_rebuild_queue ORDER BY target_type, target_id",
      ),
      notification_outbox: dump(sqlite, "SELECT * FROM notification_outbox ORDER BY id"),
      video_moderation_cases: dump(sqlite, "SELECT * FROM video_moderation_cases ORDER BY id"),
    };
    sqlite.close();
    return [name, result];
  }

  const exec = async (db, statements) => {
    if (statements.length === 0) return { ran: false };
    await db.batch(statements.map((statement) => asBatchRunnable(db, statement)));
    return { ran: true };
  };
  const loadVideo = async (db, id = "vid-1") =>
    (await db.select().from(schema.videos).where(eq(schema.videos.id, id)).limit(1))[0];
  const summarizePlan = (plan) => ({
    statementCount: plan.mutationStatements.length,
    expectedMutationChanges: plan.expectedMutationChanges,
    fenceToken: plan.fenceToken,
    depublicizedFromPublic: plan.depublicizedFromPublic,
  });
  const summarizeVideoPlan = (plan) => ({
    ...summarizePlan(plan),
    audits: plan.audits,
    notificationBatch: {
      statementCount: plan.notificationBatch.statements.length,
      expectedChanges: plan.notificationBatch.expectedChanges,
    },
    queueBatch: {
      statementCount: plan.queueBatch.statements.length,
      expectedChanges: plan.queueBatch.expectedChanges,
      acceptedTargetCount: plan.queueBatch.acceptedTargetCount,
    },
    visibilityChanged: plan.visibilityChanged,
    publicCacheKeys: plan.publicCacheKeys,
    exportEventIds: plan.exportEventIds,
    validationError: plan.validationError ?? null,
  });

  const flow = { flow: "manage_video_status", traceId: "trace-golden", wakeSource: "manage" };
  const seededManifest = (entities) => ({
    initial: { [MANIFEST_KEY]: { text: manifestOf(entities), etag: "etag-seed" } },
  });
  const withVideo = (overrides) => (sqlite) => seedVideo(sqlite, overrides);
  const raceTo = (entities) => (objects) =>
    objects.set(MANIFEST_KEY, { text: manifestOf(entities, 2), etag: "etag-raced" });
  const tamperTo = (entities) => (objects) =>
    objects.set(MANIFEST_KEY, { text: manifestOf(entities, 3), etag: "etag-tampered" });

  const planVideo = (db, video, overrides) =>
    videoTransition.planVideoVisibilityTransition(db, {
      video,
      actorUserId: "u-actor",
      context: "admin_video_status",
      eventIds: [],
      now: 1760000100,
      ...overrides,
    });
  const compensateVideo = (db, extra = {}) =>
    videoTransition.compensateDepublicizationFenceOnD1Failure(db, {
      videoId: "vid-1",
      fenceToken: "vf_tok",
      traceId: "trace-c",
      ...extra,
    });

  const videoScenarios = [
    [
      "video_fence_only_planner_all_transitions",
      async ({ db }) => {
        const base = { videoId: "vid-1", actorUserId: "u-actor", reason: "why", now: 1760000100 };
        const out = {};
        for (const [key, previousStatus, nextStatus] of [
          ["public_to_private", "public", "private"],
          ["private_to_public", "private", "public"],
          ["public_to_public", "public", "public"],
          ["pending_to_private", "pending", "private"],
        ]) {
          const plan = videoTransition.planVideoVisibilityFenceTransition(db, { ...base, previousStatus, nextStatus });
          out[key] = summarizePlan(plan);
          if (plan.mutationStatements.length > 0) await exec(db, plan.mutationStatements);
        }
        return out;
      },
      { setup: withVideo({}) },
    ],
    [
      "video_plan_public_to_private_with_reason_and_event_ids",
      async ({ db }) => {
        const plan = await planVideo(db, await loadVideo(db), {
          nextStatus: "private",
          reason: "takedown",
          eventIds: ["evt-1", "evt-1", "", "evt-2"],
        });
        const batch = await exec(db, plan.mutationStatements);
        return { plan: summarizeVideoPlan(plan), batch };
      },
      { setup: withVideo({}) },
    ],
    [
      "video_plan_private_to_public_without_reason_and_creator",
      async ({ db }) => {
        const plan = await planVideo(db, await loadVideo(db), {
          nextStatus: "public",
          context: "manage_video_status",
          notificationEventId: "evt-1",
          forceNotify: true,
        });
        const batch = await exec(db, plan.mutationStatements);
        return { plan: summarizeVideoPlan(plan), batch };
      },
      { setup: withVideo({ visibility_status: "private", creator_x_user_id: null, youtube_video_id: null }) },
    ],
    [
      "video_plan_public_to_voided_is_long_audit",
      async ({ db }) => {
        const plan = await planVideo(db, await loadVideo(db), {
          nextStatus: "voided",
          context: "admin_moderation_create",
          reason: "rights",
          eventIds: ["evt-1"],
        });
        const batch = await exec(db, plan.mutationStatements);
        return { plan: summarizeVideoPlan(plan), batch };
      },
      { setup: withVideo({}) },
    ],
    [
      "video_plan_unchanged_status_returns_empty_plan",
      async ({ db }) =>
        summarizeVideoPlan(await planVideo(db, await loadVideo(db), { nextStatus: "public", eventIds: ["evt-1"] })),
      { setup: withVideo({}) },
    ],
    [
      "video_plan_default_now_uses_max_of_clock_and_updated_at_plus_one",
      async ({ db }) => {
        const plan = await planVideo(db, await loadVideo(db), { nextStatus: "private", now: undefined });
        await exec(db, plan.mutationStatements);
        return summarizeVideoPlan(plan);
      },
      { setup: withVideo({ updated_at: 1760000500 }) },
    ],
    [
      "video_precommit_depublicization_writes_block_and_confirms",
      async () => {
        await videoTransition.preCommitVideoVisibilityDepublicization({
          videoId: "vid-1",
          fenceToken: "vf_tok",
          reason: "takedown",
        });
        return "done";
      },
    ],
    [
      "video_precommit_depublicization_merges_on_cas_conflict",
      async () => {
        await videoTransition.preCommitVideoVisibilityDepublicization({ videoId: "vid-1", fenceToken: "vf_tok" });
        return "done";
      },
      {
        bucket: {
          ...seededManifest([entity("video", "vid-9", "vf_other")]),
          options: {
            onFirstPutConflict: raceTo([entity("video", "vid-9", "vf_other"), entity("video", "vid-1", "vf_tok")]),
          },
        },
      },
    ],
    [
      "video_precommit_depublicization_rejects_other_token_on_conflict",
      async () => {
        await videoTransition.preCommitVideoVisibilityDepublicization({ videoId: "vid-1", fenceToken: "vf_tok" });
        return "done";
      },
      { bucket: { options: { onFirstPutConflict: raceTo([entity("video", "vid-1", "vf_newer")]) } } },
    ],
    [
      "video_precommit_depublicization_fails_when_confirmation_token_differs",
      async () => {
        await videoTransition.preCommitVideoVisibilityDepublicization({ videoId: "vid-1", fenceToken: "vf_tok" });
        return "done";
      },
      { bucket: { options: { afterPut: tamperTo([entity("video", "vid-1", "vf_tampered")]) } } },
    ],
    [
      "video_postcommit_deletes_export_caches_then_public_keys_then_revalidates",
      async ({ log }) => {
        await videoTransition.runVideoVisibilityTransitionPostCommit({
          publicCacheKeys: ["videos/vid-1.json", "top.json"],
          exportEventIds: ["evt-1", "evt-1", "", "evt-2"],
          revalidate: () => log.push({ op: "revalidate" }),
        });
        return "done";
      },
      { caches: cacheRecorder() },
    ],
    [
      "video_postcommit_without_work_only_revalidates",
      async ({ log }) => {
        await videoTransition.runVideoVisibilityTransitionPostCommit({
          publicCacheKeys: [],
          exportEventIds: [],
          revalidate: () => log.push({ op: "revalidate" }),
        });
        return "done";
      },
      { caches: cacheRecorder() },
    ],
    [
      "video_postcommit_cache_api_failure_is_swallowed_and_revalidate_runs",
      async ({ log }) => {
        await videoTransition.runVideoVisibilityTransitionPostCommit({
          publicCacheKeys: ["a.json", "b.json"],
          exportEventIds: ["evt-1"],
          revalidate: () => log.push({ op: "revalidate" }),
        });
        return "done";
      },
      { caches: cacheRecorder({ failOn: () => true }) },
    ],
    [
      "video_postcommit_revalidate_error_propagates_after_cache_deletes",
      async () => {
        await videoTransition.runVideoVisibilityTransitionPostCommit({
          publicCacheKeys: ["a.json"],
          exportEventIds: [],
          revalidate: () => {
            throw new Error("revalidate boom");
          },
        });
        return "done";
      },
      { caches: cacheRecorder() },
    ],
    [
      "video_compensate_skips_when_d1_fence_confirmed",
      async ({ db }) => {
        await compensateVideo(db);
        return "done";
      },
      {
        setup: (sqlite) => {
          seedVideo(sqlite, { visibility_status: "private" });
          seedFence(sqlite, { fence_token: "vf_tok" });
        },
        bucket: seededManifest([entity("video", "vid-1", "vf_tok")]),
      },
    ],
    [
      "video_compensate_skips_when_video_not_public",
      async ({ db }) => {
        await compensateVideo(db);
        return "done";
      },
      { setup: withVideo({ visibility_status: "private" }), bucket: seededManifest([entity("video", "vid-1", "vf_tok")]) },
    ],
    [
      "video_compensate_skips_when_video_missing",
      async ({ db }) => {
        await compensateVideo(db, { videoId: "vid-missing" });
        return "done";
      },
    ],
    [
      "video_compensate_skips_when_manifest_entry_missing",
      async ({ db }) => {
        await compensateVideo(db);
        return "done";
      },
      { setup: withVideo({}) },
    ],
    [
      "video_compensate_skips_when_manifest_token_mismatch",
      async ({ db }) => {
        await compensateVideo(db);
        return "done";
      },
      { setup: withVideo({}), bucket: seededManifest([entity("video", "vid-1", "vf_newer")]) },
    ],
    [
      "video_compensate_releases_exact_token_when_video_still_public",
      async ({ db }) => {
        await compensateVideo(db);
        return "done";
      },
      {
        setup: withVideo({}),
        bucket: seededManifest([entity("video", "vid-1", "vf_tok"), entity("event", "evt-1", "ef")]),
      },
    ],
    [
      "video_compensate_non_public_rollback_allowed_releases_token",
      async ({ db }) => {
        await compensateVideo(db, { allowNonPublicRollback: true });
        return "done";
      },
      { setup: withVideo({ visibility_status: "private" }), bucket: seededManifest([entity("video", "vid-1", "vf_tok")]) },
    ],
    [
      "video_compensate_gives_up_after_three_write_failures_and_logs_stuck_fence",
      async ({ db }) => {
        await compensateVideo(db);
        return "done";
      },
      {
        setup: withVideo({}),
        bucket: { ...seededManifest([entity("video", "vid-1", "vf_tok")]), options: { failPuts: true } },
      },
    ],
    [
      "video_notifications_postcommit_inserts_outbox_then_wakes_queue",
      async ({ db }) => {
        const batch = await videoStatusNotify.buildVideoStatusChangeNotificationBatch(db, {
          videoId: "vid-1",
          videoTitle: "Video One",
          youtubeVideoId: "yt123",
          prevStatus: "pending",
          nextStatus: "public",
          reason: "ok",
          recipientUserId: "u-recipient",
          eventId: "evt-1",
        });
        await videoTransition.enqueueVideoVisibilityNotificationsPostCommit(db, batch, flow);
        return { statementCount: batch.statements.length, expectedChanges: batch.expectedChanges };
      },
      { setup: withVideo({}) },
    ],
    [
      "video_notifications_postcommit_empty_batch_does_nothing",
      async ({ db }) => {
        await videoTransition.enqueueVideoVisibilityNotificationsPostCommit(
          db,
          { statements: [], expectedChanges: [] },
          flow,
        );
        return "done";
      },
    ],
    [
      "video_notifications_postcommit_statement_failure_skips_wake",
      async ({ db }) => {
        await videoTransition.enqueueVideoVisibilityNotificationsPostCommit(
          db,
          {
            statements: [
              {
                then(_resolve, reject) {
                  reject(new Error("notification_statement_failed"));
                },
              },
            ],
            expectedChanges: [1],
          },
          flow,
        );
        return "done";
      },
    ],
    ["video_mutation_failure_message", () => videoTransition.visibilityStatusMutationFailureMessage()],
    [
      "video_mutation_failure_without_fence_logs_and_returns_message",
      ({ db }) =>
        videoTransition.handleVideoVisibilityMutationFailure(db, new AuditMutationError("conflict"), {
          flow: "admin_video_status",
          traceId: "trace-f1",
          videoId: "vid-1",
          eventId: "evt-1",
          depublicizedFromPublic: true,
          fenceToken: null,
        }),
    ],
    [
      "video_mutation_failure_with_fence_compensates_before_logging",
      ({ db }) =>
        videoTransition.handleVideoVisibilityMutationFailure(db, new Error("d1 down"), {
          flow: "manage_video_status",
          traceId: "trace-f2",
          videoId: "vid-1",
          depublicizedFromPublic: false,
          fenceToken: "vf_tok",
        }),
      { setup: withVideo({ visibility_status: "private" }), bucket: seededManifest([entity("video", "vid-1", "vf_tok")]) },
    ],
    [
      "video_mutation_failure_compensation_error_logs_stuck_fence_candidate",
      ({ db }) =>
        videoTransition.handleVideoVisibilityMutationFailure(db, new Error("d1 down"), {
          flow: "manage_video_status",
          traceId: "trace-f3",
          videoId: "vid-1",
          eventId: "evt-1",
          depublicizedFromPublic: true,
          fenceToken: "vf_tok",
        }),
      { setup: withVideo({}), bucket: { options: { failGets: true } } },
    ],
    [
      "video_mutation_failure_rethrows_framework_redirect_without_logging_or_compensating",
      ({ db }) =>
        videoTransition.handleVideoVisibilityMutationFailure(
          db,
          Object.assign(new Error("redirect"), { digest: "NEXT_REDIRECT;replace;/admin;307;" }),
          {
            flow: "admin_video_status",
            traceId: "trace-f4",
            videoId: "vid-1",
            depublicizedFromPublic: false,
            fenceToken: "vf_tok",
          },
        ),
      { setup: withVideo({ visibility_status: "private" }), bucket: seededManifest([entity("video", "vid-1", "vf_tok")]) },
    ],
    [
      "video_mutation_failure_rethrows_framework_not_found",
      ({ db }) =>
        videoTransition.handleVideoVisibilityMutationFailure(
          db,
          Object.assign(new Error("not found"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }),
          {
            flow: "admin_video_status",
            traceId: "trace-f5",
            videoId: "vid-1",
            depublicizedFromPublic: false,
            fenceToken: null,
          },
        ),
    ],
  ];

  const renameInput = (extra = {}) => ({
    oldEventId: "evt-old",
    newEventId: "evt-new",
    fenceToken: "ef_tok",
    ...extra,
  });
  const compensateEvent = (db, eventId, extra = {}) =>
    eventTransition.compensateEventVisibilityFenceOnD1Failure(db, { eventId, fenceToken: "ef_tok", ...extra });
  const done = async (promise) => {
    await promise;
    return "done";
  };

  const eventScenarios = [
    [
      "event_plan_all_transitions",
      async ({ db }) => {
        const base = { db, eventId: "evt-1", actorUserId: "u-actor", reason: "r", now: 1760000100 };
        const out = {};
        for (const [key, previousStatus, nextStatus] of [
          ["public_to_private", "public", "private"],
          ["private_to_public", "private", "public"],
          ["draft_to_archived", "draft", "archived"],
          ["unchanged", "public", "public"],
        ]) {
          const plan = eventTransition.planEventVisibilityTransition({ ...base, previousStatus, nextStatus });
          out[key] = summarizePlan(plan);
          if (plan.mutationStatements.length > 0) await exec(db, plan.mutationStatements);
        }
        return out;
      },
    ],
    [
      "event_precommit_blocks_and_confirms",
      () => done(eventTransition.preCommitEventVisibilityTransition({ eventId: "evt-1", fenceToken: "ef_tok", reason: "r" })),
    ],
    [
      "event_precommit_rejects_other_token_on_cas_conflict",
      () => done(eventTransition.preCommitEventVisibilityTransition({ eventId: "evt-1", fenceToken: "ef_tok" })),
      { bucket: { options: { onFirstPutConflict: raceTo([entity("event", "evt-1", "ef_newer")]) } } },
    ],
    [
      "event_precommit_merges_on_cas_conflict_with_same_token",
      () => done(eventTransition.preCommitEventVisibilityTransition({ eventId: "evt-1", fenceToken: "ef_tok" })),
      {
        bucket: {
          options: { onFirstPutConflict: raceTo([entity("event", "evt-1", "ef_tok", { reason: "earlier" })]) },
        },
      },
    ],
    [
      "event_fence_rename_precommit_moves_old_entry_to_new_id",
      () => eventTransition.preCommitEventVisibilityFenceRename(renameInput({ reason: "rename" })),
      { bucket: seededManifest([entity("event", "evt-old", "ef_tok", { blocked_at: 77, reason: "kept" })]) },
    ],
    [
      "event_fence_rename_precommit_without_old_entry_blocks_new_id",
      () => eventTransition.preCommitEventVisibilityFenceRename(renameInput({ reason: "rename" })),
    ],
    [
      "event_fence_rename_precommit_rejects_token_mismatch",
      () => eventTransition.preCommitEventVisibilityFenceRename(renameInput()),
      { bucket: seededManifest([entity("event", "evt-old", "ef_other")]) },
    ],
    [
      "event_fence_rename_precommit_cas_conflict_rewrites_from_latest",
      () => eventTransition.preCommitEventVisibilityFenceRename(renameInput()),
      {
        bucket: {
          ...seededManifest([entity("event", "evt-old", "ef_tok", { blocked_at: 77 })]),
          options: {
            onFirstPutConflict: raceTo([
              entity("event", "evt-old", "ef_tok", { blocked_at: 88 }),
              entity("event", "evt-new", "ef_tok"),
            ]),
          },
        },
      },
    ],
    [
      "event_rename_tombstone_precommit_keeps_previous_entry_details",
      () => eventTransition.preCommitEventVisibilityRenameTombstone({ eventId: "evt-old", fenceToken: "ef_tok" }),
      { bucket: seededManifest([entity("event", "evt-old", "ef_prev", { blocked_at: 55, reason: "old reason" })]) },
    ],
    [
      "event_rename_tombstone_precommit_defaults_reason",
      () => eventTransition.preCommitEventVisibilityRenameTombstone({ eventId: "evt-old", fenceToken: "ef_tok" }),
    ],
    [
      "event_rename_tombstone_precommit_cas_conflict_uses_latest_entry",
      () => eventTransition.preCommitEventVisibilityRenameTombstone({ eventId: "evt-old", fenceToken: "ef_tok" }),
      {
        bucket: {
          options: { onFirstPutConflict: raceTo([entity("event", "evt-old", "ef_x", { blocked_at: 66, reason: "latest" })]) },
        },
      },
    ],
    [
      "event_rename_tombstone_precommit_fails_when_confirmation_token_differs",
      () => eventTransition.preCommitEventVisibilityRenameTombstone({ eventId: "evt-old", fenceToken: "ef_tok" }),
      { bucket: { options: { afterPut: tamperTo([entity("event", "evt-old", "ef_tampered")]) } } },
    ],
    [
      "event_compensate_fence_rename_restores_previous_old_entry",
      () =>
        done(
          eventTransition.compensateEventVisibilityFenceRenameOnD1Failure({
            ...renameInput(),
            previousOldEntry: entity("event", "evt-old", "ef_tok", { blocked_at: 77 }),
          }),
        ),
      { bucket: seededManifest([entity("event", "evt-new", "ef_tok")]) },
    ],
    [
      "event_compensate_fence_rename_without_previous_entry_bumps_revision",
      () =>
        done(
          eventTransition.compensateEventVisibilityFenceRenameOnD1Failure({ ...renameInput(), previousOldEntry: null }),
        ),
      { bucket: seededManifest([entity("event", "evt-new", "ef_tok")]) },
    ],
    [
      "event_compensate_fence_rename_leaves_newer_token_alone",
      () =>
        done(
          eventTransition.compensateEventVisibilityFenceRenameOnD1Failure({ ...renameInput(), previousOldEntry: null }),
        ),
      { bucket: seededManifest([entity("event", "evt-new", "ef_newer")]) },
    ],
    [
      "event_compensate_fence_rename_logs_stuck_after_three_failures",
      () =>
        done(
          eventTransition.compensateEventVisibilityFenceRenameOnD1Failure({ ...renameInput(), previousOldEntry: null }),
        ),
      { bucket: { ...seededManifest([entity("event", "evt-new", "ef_tok")]), options: { failPuts: true } } },
    ],
    [
      "event_compensate_rename_tombstone_restores_previous_entry",
      () =>
        done(
          eventTransition.compensateEventVisibilityRenameTombstoneOnD1Failure({
            eventId: "evt-old",
            fenceToken: "ef_tok",
            previousEntry: entity("event", "evt-old", "ef_prev", { blocked_at: 55 }),
          }),
        ),
      { bucket: seededManifest([entity("event", "evt-old", "ef_tok")]) },
    ],
    [
      "event_compensate_rename_tombstone_logs_stuck_after_three_failures",
      () =>
        done(
          eventTransition.compensateEventVisibilityRenameTombstoneOnD1Failure({
            eventId: "evt-old",
            fenceToken: "ef_tok",
            previousEntry: null,
          }),
        ),
      { bucket: { ...seededManifest([entity("event", "evt-old", "ef_tok")]), options: { failPuts: true } } },
    ],
    [
      "event_compensate_fence_releases_exact_token_when_event_public",
      ({ db }) => done(compensateEvent(db, "evt-1")),
      { bucket: seededManifest([entity("event", "evt-1", "ef_tok")]) },
    ],
    [
      "event_compensate_fence_skips_when_event_not_public",
      ({ db }) => done(compensateEvent(db, "evt-private")),
      { bucket: seededManifest([entity("event", "evt-private", "ef_tok")]) },
    ],
    [
      "event_compensate_fence_non_public_rollback_allowed",
      ({ db }) => done(compensateEvent(db, "evt-private", { allowNonPublicRollback: true })),
      { bucket: seededManifest([entity("event", "evt-private", "ef_tok")]) },
    ],
    [
      "event_compensate_fence_skips_when_d1_fence_confirmed",
      ({ db }) => done(compensateEvent(db, "evt-1")),
      {
        setup: (sqlite) => seedFence(sqlite, { entity_type: "event", entity_id: "evt-1", fence_token: "ef_tok" }),
        bucket: seededManifest([entity("event", "evt-1", "ef_tok")]),
      },
    ],
    [
      "event_compensate_fence_logs_stuck_after_three_failures",
      ({ db }) => done(compensateEvent(db, "evt-1")),
      { bucket: { ...seededManifest([entity("event", "evt-1", "ef_tok")]), options: { failPuts: true } } },
    ],
  ];

  const summarizeFencePlan = (plan) => ({
    statementCount: plan.mutationStatements.length,
    expectedMutationChanges: plan.expectedMutationChanges,
    fenceToken: plan.fenceToken,
    previousStatus: plan.previousStatus,
    nextStatus: plan.nextStatus,
  });
  const planXUser = (db, xUserId, previousStatus, nextStatus) =>
    xUserTransition.planXUserVisibilityFenceTransition({
      db,
      xUserId,
      previousStatus,
      nextStatus,
      actorUserId: "u-actor",
      reason: "r",
      now: 1760000100,
    });

  const fenceScenarios = [
    [
      "event_group_fence_plan_precommit_compensate",
      async ({ db }) => {
        const out = {};
        for (const [key, previousStatus, nextStatus] of [
          ["public_to_private", "public", "private"],
          ["private_to_public", "private", "public"],
          ["unchanged", "private", "draft"],
        ]) {
          const plan = await eventGroupTransition.planEventGroupVisibilityFenceTransition({
            db,
            groupId: "grp-1",
            previousStatus,
            nextStatus,
            actorUserId: "u-actor",
            reason: "r",
            now: 1760000100,
          });
          out[key] = summarizeFencePlan(plan);
          if (plan.mutationStatements.length > 0) await exec(db, plan.mutationStatements);
        }
        await eventGroupTransition.preCommitEventGroupVisibilityTransition({
          groupId: "grp-1",
          fenceToken: "gf_tok",
          reason: "r",
        });
        await eventGroupTransition.compensateEventGroupVisibilityOnD1Failure({
          db,
          groupId: "grp-1",
          fenceToken: "gf_tok",
        });
        return out;
      },
    ],
    [
      "x_user_plan_lowercases_id_and_flips_listable_state",
      async ({ db }) => {
        const out = {};
        for (const [key, previousStatus, nextStatus] of [
          ["approved_to_rejected", "approved", "rejected"],
          ["rejected_to_approved", "rejected", "approved"],
          ["pending_to_approved_still_listable", "pending", "approved"],
          ["unchanged", "rejected", "rejected"],
        ]) {
          const plan = await planXUser(db, "X_Creator", previousStatus, nextStatus);
          out[key] = summarizeFencePlan(plan);
          if (plan.mutationStatements.length > 0) await exec(db, plan.mutationStatements);
        }
        return out;
      },
    ],
    [
      "x_user_plan_reuses_existing_blocked_token",
      async ({ db }) => {
        const plan = await planXUser(db, "x_creator", "rejected", "approved");
        await exec(db, plan.mutationStatements);
        return { fenceToken: plan.fenceToken };
      },
      { setup: (sqlite) => seedFence(sqlite, { entity_type: "x_user", entity_id: "x_creator", fence_token: "xf_existing" }) },
    ],
    [
      "x_user_precommit_blocks_lowercased_id_and_confirms",
      () => done(xUserTransition.preCommitXUserVisibilityTransition({ xUserId: "X_Creator", fenceToken: "xf_tok", reason: "r" })),
      { bucket: seededManifest([entity("x_user", "x_other", "xf_o")]) },
    ],
    [
      "x_user_precommit_rejects_other_token_on_cas_conflict",
      () => done(xUserTransition.preCommitXUserVisibilityTransition({ xUserId: "x_creator", fenceToken: "xf_tok" })),
      { bucket: { options: { onFirstPutConflict: raceTo([entity("x_user", "x_creator", "xf_newer")]) } } },
    ],
    [
      "x_user_compensate_releases_exact_token",
      ({ db }) => done(xUserTransition.compensateXUserVisibilityOnD1Failure({ db, xUserId: "X_Creator", fenceToken: "xf_tok" })),
      { bucket: seededManifest([entity("x_user", "x_creator", "xf_tok")]) },
    ],
    [
      "x_user_compensate_skips_when_d1_fence_confirmed",
      ({ db }) => done(xUserTransition.compensateXUserVisibilityOnD1Failure({ db, xUserId: "x_creator", fenceToken: "xf_tok" })),
      {
        setup: (sqlite) => seedFence(sqlite, { entity_type: "x_user", entity_id: "x_creator", fence_token: "xf_tok" }),
        bucket: seededManifest([entity("x_user", "x_creator", "xf_tok")]),
      },
    ],
    [
      "x_user_compensate_leaves_newer_token_alone",
      ({ db }) => done(xUserTransition.compensateXUserVisibilityOnD1Failure({ db, xUserId: "x_creator", fenceToken: "xf_tok" })),
      { bucket: seededManifest([entity("x_user", "x_creator", "xf_newer")]) },
    ],
    [
      "x_user_compensate_logs_stuck_after_three_write_failures",
      ({ db }) => done(xUserTransition.compensateXUserVisibilityOnD1Failure({ db, xUserId: "x_creator", fenceToken: "xf_tok" })),
      { bucket: { ...seededManifest([entity("x_user", "x_creator", "xf_tok")]), options: { failPuts: true } } },
    ],
    [
      "x_user_compensate_swallows_manifest_read_failure_and_logs_stuck",
      ({ db }) => done(xUserTransition.compensateXUserVisibilityOnD1Failure({ db, xUserId: "x_creator", fenceToken: "xf_tok" })),
      { bucket: { options: { failGets: true } } },
    ],
  ];

  const newCaseRow = (overrides = {}) => ({
    id: "vmc-new",
    video_id: "vid-1",
    case_type: "void",
    status: "open",
    public_reason: "pub",
    private_note: "note",
    due_at: null,
    locked_until: null,
    attempt_count: 0,
    related_x_user_id: null,
    created_by_user_id: "u-actor",
    resolved_by_user_id: null,
    created_at: 1760000100,
    resolved_at: null,
    ...overrides,
  });
  const voidOpenInput = (overrides = {}) => ({
    videoId: "vid-1",
    caseType: "void",
    publicReason: "rights holder",
    privateNote: "private",
    actorUserId: "u-actor",
    now: 1760000100,
    auditContext: "admin_moderation_create",
    ...overrides,
  });
  const withOpenCase = (overrides = {}) => (sqlite) => {
    seedVideo(sqlite, {});
    seedCase(sqlite, { id: "vmc-open", ...overrides });
  };

  const moderationScenarios = [
    [
      "moderation_find_open_case_by_video_and_by_id",
      async ({ db }) => ({
        open: await openCases.findOpenModerationCase(db, "vid-1", "void"),
        otherType: await openCases.findOpenModerationCase(db, "vid-1", "rights"),
        byIdOpen: await openCases.findOpenModerationCaseById(db, "vmc-open"),
        byIdResolved: await openCases.findOpenModerationCaseById(db, "vmc-resolved"),
        byIdMissing: await openCases.findOpenModerationCaseById(db, "vmc-missing"),
      }),
      {
        setup: (sqlite) => {
          seedVideo(sqlite, {});
          seedCase(sqlite, { id: "vmc-open", public_reason: "pub" });
          seedCase(sqlite, {
            id: "vmc-resolved",
            case_type: "rights",
            status: "resolved",
            public_reason: "pub",
            created_at: 800,
            resolved_at: 850,
          });
        },
      },
    ],
    [
      "moderation_insert_statement_is_idempotent_per_open_case",
      async ({ db }) => {
        await exec(db, [openCases.buildInsertOpenModerationCaseStatement(db, newCaseRow())]);
        await exec(db, [openCases.buildInsertOpenModerationCaseStatement(db, newCaseRow({ id: "vmc-dup" }))]);
        return "done";
      },
      { setup: withVideo({}) },
    ],
    [
      "moderation_plan_void_open_creates_new_case_with_audit",
      async ({ db }) => {
        const plan = await openCases.planVoidModerationCaseOpen(db, voidOpenInput());
        await exec(db, plan.statements);
        return { expectedChanges: plan.expectedChanges, audits: plan.audits };
      },
      { setup: withVideo({}) },
    ],
    [
      "moderation_plan_void_open_creates_new_case_with_default_reasons",
      async ({ db }) => {
        const plan = await openCases.planVoidModerationCaseOpen(
          db,
          voidOpenInput({ publicReason: null, privateNote: null, caseType: "rights" }),
        );
        await exec(db, plan.statements);
        return { expectedChanges: plan.expectedChanges, audits: plan.audits };
      },
      { setup: withVideo({}) },
    ],
    [
      "moderation_plan_void_open_reuses_existing_open_case",
      async ({ db }) => {
        const plan = await openCases.planVoidModerationCaseOpen(
          db,
          voidOpenInput({ publicReason: null, privateNote: null, auditContext: "admin_moderation_update" }),
        );
        await exec(db, plan.statements);
        return { expectedChanges: plan.expectedChanges, audits: plan.audits };
      },
      { setup: withOpenCase({ private_note: "keep me" }) },
    ],
    [
      "moderation_plan_void_open_reuses_existing_open_case_and_replaces_note",
      async ({ db }) => {
        const plan = await openCases.planVoidModerationCaseOpen(db, voidOpenInput());
        await exec(db, plan.statements);
        return { expectedChanges: plan.expectedChanges, audits: plan.audits };
      },
      { setup: withOpenCase({ private_note: "keep me" }) },
    ],
    [
      "moderation_plan_void_resolve_cas_updates_open_case",
      async ({ db }) => {
        const current = await openCases.findOpenModerationCaseById(db, "vmc-open");
        const plan = openCases.planVoidModerationCaseResolve(db, current, {
          actorUserId: "u-actor",
          now: 1760000100,
          privateNote: "explicit",
          auditContext: "admin_moderation_update",
          reason: "why",
        });
        await exec(db, plan.statements);
        return { expectedChanges: plan.expectedChanges, audits: plan.audits };
      },
      { setup: withOpenCase() },
    ],
    [
      "moderation_plan_void_resolve_defaults_note_and_reason",
      async ({ db }) => {
        const current = await openCases.findOpenModerationCaseById(db, "vmc-open");
        const plan = openCases.planVoidModerationCaseResolve(db, current, {
          actorUserId: "u-actor",
          now: 1760000100,
          auditContext: "admin_video_status",
        });
        await exec(db, plan.statements);
        return { expectedChanges: plan.expectedChanges, audits: plan.audits };
      },
      { setup: withOpenCase() },
    ],
  ];

  const scenarios = [...videoScenarios, ...eventScenarios, ...fenceScenarios, ...moderationScenarios];

  test("golden: video / event / event_group / x_user visibility transition planners and open cases", async () => {
    const actual = {};
    for (const [name, body, options] of scenarios) {
      const [key, value] = await runScenario(name, body, options);
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
