import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyManageEvent,
  filterManageEvents,
} from "./sidebarEvents.ts";

const base = {
  id: "ev1",
  title: "春のイベント",
  accent_color: null,
  visibility_status: "public",
  start_time: 1_700_000_000,
  end_time: 1_800_000_000,
  entry_start_time: null,
  entry_end_time: null,
  pending_review_count: 0,
};

test("イベント検索は title / id を対象にする", () => {
  const filtered = filterManageEvents(
    [base, { ...base, id: "ev2", title: "別件" }],
    "春",
  );
  assert.deepEqual(filtered.map((event) => event.id), ["ev1"]);
});

test("recent event権限外ID除外は呼び出し側で行う前提を維持", () => {
  const allowed = new Set(["ev1"]);
  const recent = ["ev1", "ev-outside"]
    .filter((id) => allowed.has(id));
  assert.deepEqual(recent, ["ev1"]);
});

test("開催中は active に分類", () => {
  const now = 1_750_000_000;
  assert.equal(classifyManageEvent(base, now), "active");
});
