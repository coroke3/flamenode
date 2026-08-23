import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  EVENTS_INDEX_R2_KEY,
  EVENTS_INDEX_STALE_MAX_AGE_SEC,
  RANKING_LAST_SCORE_REBUILD_KV_KEY,
  SCORE_REBUILD_ACTIVE_INTERVAL_SEC,
  SCORE_REBUILD_INACTIVE_INTERVAL_SEC,
  enqueueScoreDependentRebuilds,
  hasActiveOngoingEventStatus,
  indexHasActiveOngoingEvent,
  isEventsIndexPayloadStale,
  resolveHasActiveOngoingEvent,
  scoreRebuildThrottleIntervalSec,
  shouldSkipScoreRebuildEnqueue,
  shouldThrottleScoreDependentRebuild,
} from "./scoreRankingRebuildThrottle.ts";

const T0 = 1_700_000_000;

function activeEvent(overrides = {}) {
  return {
    id: "evt-active",
    title: "Active Event",
    visibility_status: "public",
    start_time: T0 - 100,
    end_time: T0 + 100,
    entry_start_time: null,
    entry_end_time: null,
    ...overrides,
  };
}

function endedEvent(overrides = {}) {
  return {
    id: "evt-ended",
    title: "Ended Event",
    visibility_status: "public",
    start_time: T0 - 200,
    end_time: T0 - 10,
    entry_start_time: null,
    entry_end_time: null,
    ...overrides,
  };
}

function buildEventsIndexPayload(events, generatedAt = T0) {
  return { generated_at: generatedAt, items: events, group_sections: [] };
}

function createKvStore(initial = new Map()) {
  const store = new Map(initial);
  return {
    store,
    kv: {
      async get(key) {
        return store.get(key) ?? null;
      },
      async put(key, value) {
        store.set(key, value);
      },
    },
  };
}

function createR2(objects = new Map()) {
  return {
    async get(key) {
      const value = objects.get(key);
      if (value == null) return null;
      return { async json() { return value; } };
    },
  };
}

function createDb({
  rows = [],
  insertChanges = 3,
  failReads = false,
  usersIndexInFlight = false,
  usersIndexLeaseExpiresAt = null,
} = {}) {
  let runCalls = 0;
  let batchCalls = 0;
  let lastRunSql = "";
  let lastRunArgs = [];

  return {
    runCalls: () => runCalls,
    batchCalls: () => batchCalls,
    lastRunSql: () => lastRunSql,
    lastRunArgs: () => lastRunArgs,
    db: {
      prepare(sql) {
        const statement = {
          args: [],
          bind(...args) {
            statement.args = args;
            return statement;
          },
          async all() {
            if (failReads) throw new Error("d1_read_failed");
            if (sql.includes("FROM events")) return { results: rows };
            return { results: [] };
          },
          async first() {
            if (failReads) throw new Error("d1_read_failed");
            if (sql.includes("users_index")) {
              if (!usersIndexInFlight) return null;
              const nowUnix = Number(statement.args[0]);
              if (
                usersIndexLeaseExpiresAt != null &&
                usersIndexLeaseExpiresAt <= nowUnix
              ) {
                return null;
              }
              return { active: 1 };
            }
            if (sql.includes("FROM events") && sql.includes("LIMIT 1")) {
              const nowUnix = Number(statement.args[0]);
              return rows.find((row) => {
                if (row.visibility_status !== "public") return false;
                const start = row.start_time ?? null;
                const end = row.end_time ?? null;
                const isPoint =
                  (start != null && end == null) || (start == null && end != null);
                if (isPoint || (start == null && end == null)) return false;
                if (end != null && end <= nowUnix) return false;
                if (start != null && start > nowUnix) return false;
                return true;
              }) ?? null;
            }
            return null;
          },
          async run() {
            runCalls += 1;
            lastRunSql = sql;
            lastRunArgs = [...statement.args];
            return { meta: { changes: insertChanges } };
          },
        };
        return statement;
      },
      async batch() {
        batchCalls += 1;
        throw new Error("score rebuild enqueue must not use D1 batch");
      },
    },
  };
}

function assertKvMarkerRecent(store, beforeSec, afterSec) {
  const marker = Number(store.get(RANKING_LAST_SCORE_REBUILD_KV_KEY));
  assert.ok(Number.isFinite(marker));
  assert.ok(marker >= beforeSec && marker <= afterSec);
}

test("score rebuild throttle intervals follow active/inactive event presence", () => {
  assert.equal(scoreRebuildThrottleIntervalSec(true), SCORE_REBUILD_ACTIVE_INTERVAL_SEC);
  assert.equal(scoreRebuildThrottleIntervalSec(false), SCORE_REBUILD_INACTIVE_INTERVAL_SEC);
  assert.equal(SCORE_REBUILD_ACTIVE_INTERVAL_SEC, 3600);
  assert.equal(SCORE_REBUILD_INACTIVE_INTERVAL_SEC, 10800);
  assert.equal(shouldSkipScoreRebuildEnqueue(T0 - 1800, T0, 3600), true);
  assert.equal(shouldSkipScoreRebuildEnqueue(T0 - 3600, T0, 3600), false);
});

test("active event detection uses computeEventStatus active only", () => {
  assert.equal(hasActiveOngoingEventStatus(activeEvent(), T0), true);
  assert.equal(hasActiveOngoingEventStatus(endedEvent(), T0), false);
  assert.equal(indexHasActiveOngoingEvent([endedEvent(), activeEvent()], T0), true);
});

test("fresh R2 events index is preferred and stale R2 falls back to bounded D1", async () => {
  const fresh = await resolveHasActiveOngoingEvent(
    {
      R2: createR2(new Map([[EVENTS_INDEX_R2_KEY, buildEventsIndexPayload([activeEvent()])]])),
      DB: createDb({ rows: [endedEvent()] }).db,
    },
    T0,
  );
  assert.deepEqual(fresh, { hasActiveOngoingEvent: true, source: "r2" });

  const staleAt = T0 - EVENTS_INDEX_STALE_MAX_AGE_SEC - 1;
  assert.equal(isEventsIndexPayloadStale(staleAt, T0), true);
  const stale = await resolveHasActiveOngoingEvent(
    {
      R2: createR2(new Map([[EVENTS_INDEX_R2_KEY, buildEventsIndexPayload([activeEvent()], staleAt)]])),
      DB: createDb({ rows: [endedEvent()] }).db,
    },
    T0,
  );
  assert.deepEqual(stale, { hasActiveOngoingEvent: false, source: "d1_fallback" });
});

test("R2 and D1 unavailable defaults to safe enqueue instead of false throttle", async () => {
  const resolution = await resolveHasActiveOngoingEvent(
    { R2: createR2(), DB: createDb({ failReads: true }).db },
    T0,
  );
  assert.deepEqual(resolution, {
    hasActiveOngoingEvent: true,
    source: "safe_default",
  });

  const { kv } = createKvStore(
    new Map([[RANKING_LAST_SCORE_REBUILD_KV_KEY, String(T0 - 60)]]),
  );
  assert.equal(
    await shouldThrottleScoreDependentRebuild(
      { KV: kv, R2: createR2(), DB: createDb({ failReads: true }).db },
      T0,
    ),
    false,
  );
});

test("score rebuild targets are inserted by one JSON1 D1 statement", async () => {
  const now = Math.floor(Date.now() / 1000);
  const { kv, store } = createKvStore();
  const fake = createDb({ insertChanges: 3 });
  const env = {
    KV: kv,
    R2: createR2(new Map([[EVENTS_INDEX_R2_KEY, buildEventsIndexPayload([endedEvent()], now)]])),
    DB: fake.db,
  };

  const before = Math.floor(Date.now() / 1000);
  const result = await enqueueScoreDependentRebuilds(env);
  const after = Math.floor(Date.now() / 1000);

  assert.equal(result.processed, 3);
  assert.equal(result.d1_changes, 3);
  assert.equal(fake.runCalls(), 1);
  assert.equal(fake.batchCalls(), 0);
  assert.match(fake.lastRunSql(), /FROM json_each\(\?\)/);
  assert.match(fake.lastRunSql(), /'score_recalc', 'high', 'pending'/);
  const payload = JSON.parse(String(fake.lastRunArgs().at(-1)));
  assert.deepEqual(
    payload.map((row) => row.target_type).sort(),
    ["list_popular", "recommend_core", "top_recommended"],
  );
  assertKvMarkerRecent(store, before, after);
});

test("users_index in flight still enqueues all targets but does not advance marker", async () => {
  const now = Math.floor(Date.now() / 1000);
  const { kv, store } = createKvStore();
  const fake = createDb({
    insertChanges: 3,
    usersIndexInFlight: true,
  });
  const result = await enqueueScoreDependentRebuilds({
    KV: kv,
    R2: createR2(new Map([[EVENTS_INDEX_R2_KEY, buildEventsIndexPayload([endedEvent()], now)]])),
    DB: fake.db,
  });

  assert.equal(result.processed, 3);
  assert.equal(fake.runCalls(), 1);
  assert.equal(store.get(RANKING_LAST_SCORE_REBUILD_KV_KEY), undefined);
});

test("expired users_index lease is not treated as in-flight", async () => {
  const now = Math.floor(Date.now() / 1000);
  const { kv, store } = createKvStore();
  const fake = createDb({
    insertChanges: 3,
    usersIndexInFlight: true,
    usersIndexLeaseExpiresAt: now - 60,
  });
  const before = Math.floor(Date.now() / 1000);
  const result = await enqueueScoreDependentRebuilds({
    KV: kv,
    R2: createR2(new Map([[EVENTS_INDEX_R2_KEY, buildEventsIndexPayload([endedEvent()], now)]])),
    DB: fake.db,
  });
  const after = Math.floor(Date.now() / 1000);

  assert.equal(result.processed, 3);
  assertKvMarkerRecent(store, before, after);
});

test("deduped enqueue does not update KV marker", async () => {
  const now = Math.floor(Date.now() / 1000);
  const previous = String(now - 10_000);
  const { kv, store } = createKvStore(
    new Map([[RANKING_LAST_SCORE_REBUILD_KV_KEY, previous]]),
  );
  const fake = createDb({ insertChanges: 0 });
  const result = await enqueueScoreDependentRebuilds({
    KV: kv,
    R2: createR2(new Map([[EVENTS_INDEX_R2_KEY, buildEventsIndexPayload([endedEvent()], now)]])),
    DB: fake.db,
  });

  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(store.get(RANKING_LAST_SCORE_REBUILD_KV_KEY), previous);
});

test("user-driven static rebuild paths do not import score throttle", async () => {
  const syncJobsSource = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const hooksSource = await readFile(
    new URL("../../src/lib/staticRebuild/hooks.ts", import.meta.url),
    "utf8",
  );
  const videoSavePlanSource = await readFile(
    new URL("../../src/lib/video/videoSavePlan.ts", import.meta.url),
    "utf8",
  );

  assert.match(syncJobsSource, /scoreRankingRebuildThrottle/);
  assert.doesNotMatch(hooksSource, /scoreRankingRebuildThrottle/);
  assert.doesNotMatch(videoSavePlanSource, /scoreRankingRebuildThrottle/);
  assert.doesNotMatch(videoSavePlanSource, /score_recalc/);
});
