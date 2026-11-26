import test from "node:test";
import assert from "node:assert/strict";
import { compareEventsByUpcomingPriority as compareCurrent } from "./eventOrdering.ts";
import { compareEventsByUpcomingPriority as compareManage } from "../../../apps/api/src/routes/manage/eventOrder.ts";
import { compareSidebarRows } from "../../../apps/api/src/routes/manage/eventOrder.ts";
import { readFileSync } from "node:fs";
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
  const negative = { id: "c", visibility_status: "public", start_time: -Infinity, end_time: 300 };
  const active = { id: "d", visibility_status: "public", start_time: 50, end_time: 300 };
  for (const [surface, compare] of comparators) {
    assert.equal(compare(invalid, valid, 100), 1, surface);
    assert.equal(compare(valid, invalid, 100), -1, surface);
    assert.equal(compare(negative, active, 100), 1, surface);
    assert.equal(compare(active, negative, 100), -1, surface);
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

test("manage sidebar descending comparator ignores invalid start and creation times", () => {
  const badStart = { id: "a", start_time: NaN, created_at: 1 };
  const goodStart = { id: "b", start_time: 100, created_at: 1 };
  assert.equal(compareSidebarRows(badStart, goodStart), 1);
  assert.equal(compareSidebarRows(goodStart, badStart), -1);

  const badCreated = { id: "a", start_time: null, created_at: NaN };
  const goodCreated = { id: "b", start_time: null, created_at: 10 };
  assert.equal(compareSidebarRows(badCreated, goodCreated), 1);
  assert.equal(compareSidebarRows(goodCreated, badCreated), -1);

  const infiniteStart = { id: "a", start_time: Infinity, created_at: 99 };
  assert.equal(compareSidebarRows(infiniteStart, goodStart), 1);
  assert.equal(compareSidebarRows(goodStart, infiniteStart), -1);
  assert.equal(
    compareSidebarRows(
      { id: "b", start_time: null, created_at: null },
      { id: "a", start_time: null, created_at: null },
    ),
    -1,
    "same missing timestamps retain SQLite id DESC tie-break",
  );
});

test("CURRENT and Hono sidebar comparators both normalize non-finite timestamps", () => {
  const currentSource = readFileSync(new URL("../manage/navigationEvents.ts", import.meta.url), "utf8");
  assert.match(currentSource, /function finiteSidebarTimestamp\(/);
  for (const key of ["start_time", "created_at"]) {
    assert.ok(currentSource.includes("finiteSidebarTimestamp(left." + key + ")"));
    assert.ok(currentSource.includes("finiteSidebarTimestamp(right." + key + ")"));
  }
});
