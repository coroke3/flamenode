import test from "node:test";
import assert from "node:assert/strict";
import { compareEventsByUpcomingPriority as compareCurrent } from "./eventOrdering.ts";
import { compareEventsByUpcomingPriority as compareManage } from "../../../apps/api/src/routes/manage/eventOrder.ts";
import { compareEventsByUpcomingPriority as compareEntry } from "../../../apps/api/src/routes/personal/entry/eventStatus.ts";

const comparators = [
  ["CURRENT", compareCurrent],
  ["Hono manage", compareManage],
  ["Hono personal entry", compareEntry],
];

test("non-finite event start times cannot violate comparator antisymmetry", () => {
  const invalid = { id: "a", visibility_status: "public", start_time: NaN, end_time: NaN };
  const valid = { id: "b", visibility_status: "public", start_time: 0, end_time: NaN };
  for (const [surface, compare] of comparators) {
    assert.equal(compare(invalid, valid, 100), 1, surface);
    assert.equal(compare(valid, invalid, 100), -1, surface);
    assert.equal(compare(invalid, { ...invalid, id: "b" }, 100) < 0, true, surface);
  }
});

test("private event descending recent-time order ignores malformed timestamps", () => {
  const invalid = { id: "a", visibility_status: "private", start_time: NaN, end_time: NaN };
  const valid = { id: "b", visibility_status: "private", start_time: 5, end_time: 5 };
  for (const [surface, compare] of comparators) {
    const forward = compare(invalid, valid, 100);
    const reverse = compare(valid, invalid, 100);
    assert.equal(Number.isFinite(forward), true, surface);
    assert.equal(Number.isFinite(reverse), true, surface);
    assert.equal(forward > 0, true, surface);
    assert.equal(reverse < 0, true, surface);
  }
});

test("infinite dates sort after finite upcoming events and all surfaces agree", () => {
  const invalid = { id: "a", visibility_status: "public", start_time: Infinity, end_time: Infinity };
  const valid = { id: "b", visibility_status: "public", start_time: 200, end_time: 200 };
  const negative = { id: "c", visibility_status: "public", start_time: -Infinity, end_time: Infinity };
  for (const [surface, compare] of comparators) {
    assert.equal(compare(invalid, valid, 100), 1, surface);
    assert.equal(compare(valid, invalid, 100), -1, surface);
    assert.equal(compare(negative, valid, 100), 1, surface);
  }
});

test("legacy finite/null timestamp ordering retains parity across consumers", () => {
  const events = [
    { id: "d", visibility_status: "public", start_time: null, end_time: null },
    { id: "b", visibility_status: "public", start_time: 220, end_time: 220 },
    { id: "c", visibility_status: "public", start_time: 180, end_time: 180 },
    { id: "a", visibility_status: "private", start_time: 100, end_time: 100 },
  ];
  const expected = [...events].sort((a, b) => compareCurrent(a, b, 100)).map((x) => x.id);
  for (const [surface, compare] of comparators) {
    const ordered = [...events].sort((a, b) => compare(a, b, 100)).map((x) => x.id);
    assert.deepEqual(ordered, expected, surface);
  }
});
