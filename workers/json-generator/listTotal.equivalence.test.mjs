import assert from "node:assert/strict";
import { test } from "node:test";
import { capStaticListTotal } from "./rebuild.ts";
import {
  PVSF_SUMMARY_EVENT_ID,
  createEquivalenceDb,
  insertEvent,
  insertVideo,
  insertVideoEvent,
  legacyListPopular,
  legacyListRecent,
  normalizeRows,
  optimizedListPopular,
  optimizedListRecent,
} from "./queryEquivalenceFixtures.mjs";

function assertListTotalEquivalence(legacy, optimized, label) {
  const legacyTotal = capStaticListTotal(legacy.counted, legacy.items);
  const optimizedTotal = capStaticListTotal(optimized.counted, optimized.items);
  assert.deepEqual(
    normalizeRows(optimized.items),
    normalizeRows(legacy.items),
    `${label}: items`,
  );
  assert.equal(optimizedTotal, legacyTotal, `${label}: total`);
  assert.equal(optimizedTotal, optimized.items.length, `${label}: total equals items.length`);
}

test("list recent/popular total: 0件", () => {
  const db = createEquivalenceDb();
  const recentLegacy = legacyListRecent(db, 10);
  const recentOptimized = optimizedListRecent(db, 10);
  assertListTotalEquivalence(recentLegacy, recentOptimized, "recent-empty");

  const popularLegacy = legacyListPopular(db, 10);
  const popularOptimized = optimizedListPopular(db, 10);
  assertListTotalEquivalence(popularLegacy, popularOptimized, "popular-empty");
  db.close();
});

test("list recent/popular total: 1件・複数件", () => {
  const db = createEquivalenceDb();
  insertEvent(db, { id: "evt-1", title: "Event 1" });
  insertVideo(db, { id: "v1", scheduled_time: 30, score: 1 });
  insertVideo(db, { id: "v2", scheduled_time: 20, score: 5 });
  insertVideo(db, { id: "v3", scheduled_time: 10, score: 3 });

  assertListTotalEquivalence(
    legacyListRecent(db, 10),
    optimizedListRecent(db, 10),
    "recent-many",
  );
  assertListTotalEquivalence(
    legacyListPopular(db, 10),
    optimizedListPopular(db, 10),
    "popular-many",
  );
  db.close();
});

test("list recent/popular total: PVSF と非公開を除外", () => {
  const db = createEquivalenceDb();
  insertVideo(db, { id: "public", scheduled_time: 10, score: 1 });
  insertVideo(db, {
    id: "private",
    visibility_status: "private",
    scheduled_time: 20,
    score: 9,
  });
  insertVideo(db, {
    id: "pvsf-primary",
    primary_event_id: PVSF_SUMMARY_EVENT_ID,
    scheduled_time: 15,
    score: 8,
  });
  insertVideo(db, { id: "pvsf-link", scheduled_time: 12, score: 7 });
  insertVideoEvent(db, "pvsf-link", PVSF_SUMMARY_EVENT_ID);

  assertListTotalEquivalence(
    legacyListRecent(db, 10),
    optimizedListRecent(db, 10),
    "recent-filtered",
  );
  assertListTotalEquivalence(
    legacyListPopular(db, 10),
    optimizedListPopular(db, 10),
    "popular-filtered",
  );
  db.close();
});

test("list recent: scheduled_time 同値の並びは従来どおり", () => {
  const db = createEquivalenceDb();
  insertVideo(db, { id: "a", scheduled_time: 100 });
  insertVideo(db, { id: "b", scheduled_time: 100 });
  insertVideo(db, { id: "c", scheduled_time: 50 });

  const legacy = legacyListRecent(db, 10);
  const optimized = optimizedListRecent(db, 10);
  assertListTotalEquivalence(legacy, optimized, "recent-ties");
  assert.ok(legacy.items[0].scheduled_time >= legacy.items[1].scheduled_time);
  db.close();
});

test("list popular: score 同値は scheduled_time DESC", () => {
  const db = createEquivalenceDb();
  insertVideo(db, { id: "high-time", scheduled_time: 200, score: 5 });
  insertVideo(db, { id: "low-time", scheduled_time: 100, score: 5 });

  const legacy = legacyListPopular(db, 10);
  const optimized = optimizedListPopular(db, 10);
  assertListTotalEquivalence(legacy, optimized, "popular-ties");
  assert.equal(legacy.items[0].id, "high-time");
  db.close();
});

test("list total: limit より多い件数でも total は items.length と一致", () => {
  const db = createEquivalenceDb();
  for (let index = 0; index < 15; index += 1) {
    insertVideo(db, {
      id: `v-${index}`,
      scheduled_time: 1000 - index,
      score: index,
    });
  }

  assertListTotalEquivalence(
    legacyListRecent(db, 5),
    optimizedListRecent(db, 5),
    "recent-over-limit",
  );
  assertListTotalEquivalence(
    legacyListPopular(db, 5),
    optimizedListPopular(db, 5),
    "popular-over-limit",
  );
  db.close();
});
