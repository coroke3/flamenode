import assert from "node:assert/strict";
import { test } from "node:test";
import { isHeroCandidate, pickHeroEvents } from "./pickHeroEvents.ts";

const NOW = 1_700_000_000;

function event(id, title = id, overrides = {}) {
  return {
    id,
    title,
    visibility_status: "public",
    start_time: NOW + 3600,
    end_time: NOW + 7200,
    entry_start_time: null,
    entry_end_time: null,
    created_at: NOW - 86400,
    ...overrides,
  };
}

test("pickHeroEventsは0件なら空配列", () => {
  assert.deepEqual(pickHeroEvents([], 3, NOW), []);
});

test("pickHeroEventsは最大3件に制限する", () => {
  const events = [
    event("e1", { start_time: NOW + 1000 }),
    event("e2", { start_time: NOW + 2000 }),
    event("e3", { start_time: NOW + 3000 }),
    event("e4", { start_time: NOW + 4000 }),
    event("e5", { start_time: NOW + 5000 }),
  ];
  const heroes = pickHeroEvents(events, 3, NOW);
  assert.equal(heroes.length, 3);
  assert.deepEqual(heroes.map((row) => row.id), ["e1", "e2", "e3"]);
});

test("pickHeroEventsは終了・点イベントを除外する", () => {
  const events = [
    event("active", { start_time: NOW + 1000 }),
    event("ended", { start_time: NOW - 7200, end_time: NOW - 3600 }),
    event("point", { start_time: NOW + 1000, end_time: null }),
  ];
  const heroes = pickHeroEvents(events, 3, NOW);
  assert.deepEqual(heroes.map((row) => row.id), ["active"]);
  assert.equal(isHeroCandidate(events[1], NOW), false);
  assert.equal(isHeroCandidate(events[2], NOW), false);
});

test("pickHeroEventsは1件と2件でも正しく返す", () => {
  const one = pickHeroEvents([event("only")], 3, NOW);
  assert.equal(one.length, 1);
  const two = pickHeroEvents([event("a"), event("b", { start_time: NOW + 5000 })], 3, NOW);
  assert.equal(two.length, 2);
});
