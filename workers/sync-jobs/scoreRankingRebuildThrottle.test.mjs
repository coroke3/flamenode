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

function endedEvent() {
  return {
    id: "evt-ended",
    title: "Ended Event",
    visibility_status: "public",
    start_time: T0 - 200,
    end_time: T0 - 10,
    entry_start_time: null,
    entry_end_time: null,
  };
}

function buildEventsIndexPayload(events, generatedAt = T0) {
  return {
    generated_at: generatedAt,
    items: events,
    group_sections: [],
  };
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
      return {
        async json() {
          return value;
        },
      };
    },
  };
}

function createDb({
  rows = [],
  batchChanges = 1,
  failAll = false,
  failReads = false,
  usersIndexInFlight = false,
} = {}) {
  let batchCalls = 0;
  let lastBatchStatementCount = 0;
  return {
    batchCalls: () => batchCalls,
    lastBatchStatementCount: () => lastBatchStatementCount,
    db: {
      prepare(sql) {
        const statement = {
          args: [],
          bind(...args) {
            statement.args = args;
            return statement;
          },
          async all() {
            if (failReads) {
              throw new Error("d1_read_failed");
            }
            if (sql.includes("FROM events")) {
              return { results: rows };
            }
            return { results: [] };
          },
          async first() {
            if (failReads) {
              throw new Error("d1_read_failed");
            }
            if (sql.includes("users_index")) {
              return usersIndexInFlight ? { active: 1 } : null;
            }
            return null;
          },
          async run() {
            return { meta: { changes: batchChanges } };
          },
        };
        return statement;
      },
      async batch(statements = []) {
        batchCalls += 1;
        lastBatchStatementCount = statements.length;
        if (failAll) throw new Error("d1_batch_failed");
        return statements.map(() => ({ meta: { changes: batchChanges } }));
      },
    },
  };
}

test("score rebuild throttle intervals follow active/inactive event presence", () => {
  assert.equal(scoreRebuildThrottleIntervalSec(true), SCORE_REBUILD_ACTIVE_INTERVAL_SEC);
  assert.equal(scoreRebuildThrottleIntervalSec(false), SCORE_REBUILD_INACTIVE_INTERVAL_SEC);
  assert.equal(SCORE_REBUILD_ACTIVE_INTERVAL_SEC, 3600);
  assert.equal(SCORE_REBUILD_INACTIVE_INTERVAL_SEC, 10800);
});

test("shouldSkipScoreRebuildEnqueue skips only inside the interval", () => {
  assert.equal(shouldSkipScoreRebuildEnqueue(null, T0, 3600), false);
  assert.equal(shouldSkipScoreRebuildEnqueue(T0 - 1800, T0, 3600), true);
  assert.equal(shouldSkipScoreRebuildEnqueue(T0 - 3600, T0, 3600), false);
  assert.equal(shouldSkipScoreRebuildEnqueue(T0 - 7200, T0, 10800), true);
  assert.equal(shouldSkipScoreRebuildEnqueue(T0 - 10800, T0, 10800), false);
});

test("active ongoing event detection uses computeEventStatus active only", () => {
  assert.equal(hasActiveOngoingEventStatus(activeEvent(), T0), true);
  assert.equal(hasActiveOngoingEventStatus(endedEvent(), T0), false);
  assert.equal(
    hasActiveOngoingEventStatus(
      { visibility_status: "public", start_time: T0 + 100, end_time: T0 + 200 },
      T0,
    ),
    false,
  );
  assert.equal(
    indexHasActiveOngoingEvent(
      [endedEvent(), activeEvent()],
      T0,
    ),
    true,
  );
});

test("resolveHasActiveOngoingEvent reads R2 events/index.json first", async () => {
  const resolution = await resolveHasActiveOngoingEvent(
    {
      R2: createR2(
        new Map([
          [
            EVENTS_INDEX_R2_KEY,
            buildEventsIndexPayload([activeEvent()]),
          ],
        ]),
      ),
      DB: createDb().db,
    },
    T0,
  );
  assert.deepEqual(resolution, {
    hasActiveOngoingEvent: true,
    source: "r2",
  });
});

test("stale R2 events/index.json falls back to D1", async () => {
  const staleGeneratedAt = T0 - EVENTS_INDEX_STALE_MAX_AGE_SEC - 1;
  assert.equal(isEventsIndexPayloadStale(staleGeneratedAt, T0), true);

  const { db } = createDb({ rows: [endedEvent()] });
  const resolution = await resolveHasActiveOngoingEvent(
    {
      R2: createR2(
        new Map([
          [
            EVENTS_INDEX_R2_KEY,
            {
              ...buildEventsIndexPayload([activeEvent()]),
              generated_at: staleGeneratedAt,
            },
          ],
        ]),
      ),
      DB: db,
    },
    T0,
  );
  assert.deepEqual(resolution, {
    hasActiveOngoingEvent: false,
    source: "d1_fallback",
  });
});

test("stale R2 with D1 unavailable defaults to safe enqueue interval", async () => {
  const staleGeneratedAt = T0 - EVENTS_INDEX_STALE_MAX_AGE_SEC - 1;
  const resolution = await resolveHasActiveOngoingEvent(
    {
      R2: createR2(
        new Map([
          [
            EVENTS_INDEX_R2_KEY,
            {
              ...buildEventsIndexPayload([endedEvent()]),
              generated_at: staleGeneratedAt,
            },
          ],
        ]),
      ),
      DB: createDb({ failReads: true }).db,
    },
    T0,
  );
  assert.deepEqual(resolution, {
    hasActiveOngoingEvent: true,
    source: "safe_default",
  });
});

test("R2 artifact missing falls back to bounded D1 public events", async () => {
  const { db } = createDb({ rows: [endedEvent()] });
  const resolution = await resolveHasActiveOngoingEvent(
    {
      R2: createR2(),
      DB: db,
    },
    T0,
  );
  assert.deepEqual(resolution, {
    hasActiveOngoingEvent: false,
    source: "d1_fallback",
  });
});

test("R2 and D1 both unavailable default to safe enqueue interval", async () => {
  const resolution = await resolveHasActiveOngoingEvent(
    {
      R2: createR2(),
      DB: createDb({ failReads: true }).db,
    },
    T0,
  );
  assert.deepEqual(resolution, {
    hasActiveOngoingEvent: true,
    source: "safe_default",
  });
});

test("active events throttle: skip under 1h and enqueue after 1h", async () => {
  const now = Math.floor(Date.now() / 1000);
  const { kv } = createKvStore(
    new Map([[RANKING_LAST_SCORE_REBUILD_KV_KEY, String(now - 1800)]]),
  );
  const env = {
    KV: kv,
    R2: createR2(
      new Map([[EVENTS_INDEX_R2_KEY, buildEventsIndexPayload([activeEvent({ start_time: now - 100, end_time: now + 100 })], now)]]),
    ),
    DB: createDb().db,
  };

  assert.equal(await shouldThrottleScoreDependentRebuild(env, now), true);

  const recent = await enqueueScoreDependentRebuilds(env);
  assert.equal(recent.processed, 0);
  assert.equal(recent.skipped, 1);
  assert.equal(recent.d1_changes, 0);

  const { kv: kvLater, store } = createKvStore(
    new Map([[RANKING_LAST_SCORE_REBUILD_KV_KEY, String(now - 3600)]]),
  );
  const { db, batchCalls } = createDb({ batchChanges: 1 });
  const laterEnv = {
    KV: kvLater,
    R2: createR2(
      new Map([[EVENTS_INDEX_R2_KEY, buildEventsIndexPayload([activeEvent({ start_time: now - 100, end_time: now + 100 })], now)]]),
    ),
    DB: db,
  };

  assert.equal(await shouldThrottleScoreDependentRebuild(laterEnv, now), false);
  const enqueued = await enqueueScoreDependentRebuilds(laterEnv);
  assert.equal(enqueued.processed, 3);
  assert.equal(enqueued.d1_changes, 3);
  assert.equal(batchCalls(), 1);
  assert.equal(store.get(RANKING_LAST_SCORE_REBUILD_KV_KEY), String(Math.floor(Date.now() / 1000)));
});

test("inactive events throttle: skip under 3h and enqueue after 3h", async () => {
  const now = Math.floor(Date.now() / 1000);
  const { kv } = createKvStore(
    new Map([[RANKING_LAST_SCORE_REBUILD_KV_KEY, String(now - 7200)]]),
  );
  const env = {
    KV: kv,
    R2: createR2(
      new Map([[EVENTS_INDEX_R2_KEY, buildEventsIndexPayload([endedEvent({ start_time: now - 200, end_time: now - 10 })], now)]]),
    ),
    DB: createDb().db,
  };

  assert.equal(await shouldThrottleScoreDependentRebuild(env, now), true);

  const recent = await enqueueScoreDependentRebuilds(env);
  assert.equal(recent.processed, 0);
  assert.equal(recent.skipped, 1);

  const { kv: kvLater, store } = createKvStore(
    new Map([[RANKING_LAST_SCORE_REBUILD_KV_KEY, String(now - 10800)]]),
  );
  const { db } = createDb({ batchChanges: 1 });
  const laterEnv = {
    KV: kvLater,
    R2: createR2(
      new Map([[EVENTS_INDEX_R2_KEY, buildEventsIndexPayload([endedEvent({ start_time: now - 200, end_time: now - 10 })], now)]]),
    ),
    DB: db,
  };

  assert.equal(await shouldThrottleScoreDependentRebuild(laterEnv, now), false);
  const enqueued = await enqueueScoreDependentRebuilds(laterEnv);
  assert.equal(enqueued.processed, 3);
  assert.equal(store.get(RANKING_LAST_SCORE_REBUILD_KV_KEY), String(Math.floor(Date.now() / 1000)));
});

test("users_index in flight enqueues only list_popular", async () => {
  const { kv, store } = createKvStore();
  const { db, batchCalls, lastBatchStatementCount } = createDb({
    batchChanges: 1,
    usersIndexInFlight: true,
  });
  const env = {
    KV: kv,
    R2: createR2(
      new Map([[EVENTS_INDEX_R2_KEY, buildEventsIndexPayload([endedEvent()], Math.floor(Date.now() / 1000))]]),
    ),
    DB: db,
  };

  const result = await enqueueScoreDependentRebuilds(env);
  assert.equal(result.processed, 1);
  assert.equal(result.d1_changes, 1);
  assert.equal(batchCalls(), 1);
  assert.equal(lastBatchStatementCount(), 1);
  assert.equal(store.get(RANKING_LAST_SCORE_REBUILD_KV_KEY), String(Math.floor(Date.now() / 1000)));
});

test("users_index in flight with deduped list_popular does not update KV marker", async () => {
  const { kv, store } = createKvStore(
    new Map([[RANKING_LAST_SCORE_REBUILD_KV_KEY, String(T0 - 10_000)]]),
  );
  const { db, lastBatchStatementCount } = createDb({
    batchChanges: 0,
    usersIndexInFlight: true,
  });
  const env = {
    KV: kv,
    R2: createR2(
      new Map([[EVENTS_INDEX_R2_KEY, buildEventsIndexPayload([endedEvent()], Math.floor(Date.now() / 1000))]]),
    ),
    DB: db,
  };

  const result = await enqueueScoreDependentRebuilds(env);
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(lastBatchStatementCount(), 1);
  assert.equal(store.get(RANKING_LAST_SCORE_REBUILD_KV_KEY), String(T0 - 10_000));
});

test("missing KV marker always enqueues score rebuild", async () => {
  const { kv, store } = createKvStore();
  const { db, batchCalls } = createDb({ batchChanges: 1 });
  const env = {
    KV: kv,
    R2: createR2(
      new Map([[EVENTS_INDEX_R2_KEY, buildEventsIndexPayload([endedEvent()], Math.floor(Date.now() / 1000))]]),
    ),
    DB: db,
  };

  const result = await enqueueScoreDependentRebuilds(env);
  assert.equal(result.processed, 3);
  assert.equal(batchCalls(), 1);
  assert.equal(store.get(RANKING_LAST_SCORE_REBUILD_KV_KEY), String(Math.floor(Date.now() / 1000)));
});

test("R2 artifact missing uses D1 fallback for inactive throttle", async () => {
  const { kv } = createKvStore(
    new Map([[RANKING_LAST_SCORE_REBUILD_KV_KEY, String(T0 - 7200)]]),
  );
  const { db } = createDb({ rows: [endedEvent()] });
  const env = {
    KV: kv,
    R2: createR2(),
    DB: db,
  };

  assert.equal(await shouldThrottleScoreDependentRebuild(env, T0), true);
});

test("R2 artifact missing with recent marker still enqueues when D1 is unavailable", async () => {
  const { kv } = createKvStore(
    new Map([[RANKING_LAST_SCORE_REBUILD_KV_KEY, String(T0 - 60)]]),
  );
  const { db, batchCalls } = createDb({ batchChanges: 1, failReads: true });
  const env = {
    KV: kv,
    R2: createR2(),
    DB: db,
  };

  assert.equal(await shouldThrottleScoreDependentRebuild(env, T0), false);
  const result = await enqueueScoreDependentRebuilds(env);
  assert.equal(result.processed, 3);
  assert.equal(batchCalls(), 1);
});

test("deduped enqueue does not update KV marker", async () => {
  const { kv, store } = createKvStore(
    new Map([[RANKING_LAST_SCORE_REBUILD_KV_KEY, String(T0 - 10_000)]]),
  );
  const { db } = createDb({ batchChanges: 0 });
  const env = {
    KV: kv,
    R2: createR2(
      new Map([[EVENTS_INDEX_R2_KEY, buildEventsIndexPayload([endedEvent()], Math.floor(Date.now() / 1000))]]),
    ),
    DB: db,
  };

  const result = await enqueueScoreDependentRebuilds(env);
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(store.get(RANKING_LAST_SCORE_REBUILD_KV_KEY), String(T0 - 10_000));
});

test("user-driven static rebuild paths do not import score throttle", async () => {
  const syncJobsSource = await readFile(
    new URL("./index.ts", import.meta.url),
    "utf8",
  );
  const hooksSource = await readFile(
    new URL("../../src/lib/staticRebuild/hooks.ts", import.meta.url),
    "utf8",
  );
  const videoSavePlanSource = await readFile(
    new URL("../../src/lib/video/videoSavePlan.ts", import.meta.url),
    "utf8",
  );

  assert.match(syncJobsSource, /from "\.\/scoreRankingRebuildThrottle\.ts"/);
  assert.match(syncJobsSource, /enqueueScoreDependentRebuilds\(env, signal\)/);
  assert.doesNotMatch(hooksSource, /scoreRankingRebuildThrottle/);
  assert.doesNotMatch(hooksSource, /shouldThrottleScoreDependentRebuild/);
  assert.doesNotMatch(videoSavePlanSource, /scoreRankingRebuildThrottle/);
  assert.doesNotMatch(videoSavePlanSource, /shouldThrottleScoreDependentRebuild/);
  assert.doesNotMatch(videoSavePlanSource, /score_recalc/);
});
