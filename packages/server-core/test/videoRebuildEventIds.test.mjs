import assert from "node:assert/strict";
import { test } from "node:test";

import { loadVideoRebuildEventIds } from "../src/video/rebuildEventIds.ts";
import { MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS } from "../src/staticRebuild/hooks.ts";

function makeDb(eventIds, fail = false) {
  const limits = [];
  const db = {
    select(columns) {
      assert.ok(columns.event_id, "select only event id");
      return {
        from() {
          return {
            where() {
              return {
                async limit(count) {
                  limits.push(count);
                  if (fail) throw new Error("D1 unavailable");
                  return eventIds.slice(0, count).map((event_id) => ({ event_id }));
                },
              };
            },
          };
        },
      };
    },
  };
  return { db, limits };
}

test("rebuild events: primary comes first, linked order and dedup match CURRENT", async () => {
  const { db, limits } = makeDb(["linked", "primary", "linked", "last"]);
  assert.deepEqual(await loadVideoRebuildEventIds(db, "video-1", "primary"), {
    ok: true,
    eventIds: ["primary", "linked", "last"],
  });
  assert.deepEqual(limits, [MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS + 1]);
});

test("rebuild events: exactly eight unique targets remain permitted", async () => {
  const { db } = makeDb(Array.from({ length: 8 }, (_, index) => `evt-${index}`));
  const result = await loadVideoRebuildEventIds(db, "video-2", null);
  assert.equal(result.ok, true);
  assert.equal(result.eventIds.length, MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS);
});

test("rebuild events: a distinct primary beyond eight linked targets fails closed", async () => {
  const { db } = makeDb(Array.from({ length: 8 }, (_, index) => `evt-${index}`));
  assert.deepEqual(await loadVideoRebuildEventIds(db, "video-3", "primary"), {
    ok: false,
    message: "関連イベント数が処理上限を超えています。",
  });
});

test("rebuild events: ninth unique linked event fails closed", async () => {
  const { db, limits } = makeDb(Array.from({ length: 12 }, (_, index) => `evt-${index}`));
  assert.deepEqual(await loadVideoRebuildEventIds(db, "video-4", null), {
    ok: false,
    message: "関連イベント数が処理上限を超えています。",
  });
  assert.deepEqual(limits, [9]);
});

test("rebuild events: duplicates do not count as distinct event targets", async () => {
  const { db } = makeDb(Array(9).fill("same"));
  assert.deepEqual(await loadVideoRebuildEventIds(db, "video-5", "same"), {
    ok: true,
    eventIds: ["same"],
  });
});

test("rebuild events: no linked or primary event produces an empty list", async () => {
  const { db } = makeDb([]);
  assert.deepEqual(await loadVideoRebuildEventIds(db, "video-6", null), {
    ok: true,
    eventIds: [],
  });
});

test("rebuild events: D1 failure is propagated, never returned as an empty list", async () => {
  const { db } = makeDb([], true);
  await assert.rejects(loadVideoRebuildEventIds(db, "video-7", null), /D1 unavailable/);
});
