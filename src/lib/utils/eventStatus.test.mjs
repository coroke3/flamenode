import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeEventStatus,
  eventStatusLabel,
  eventStatusBadgeClass,
  isAcceptingEntries,
  getEventVisibility,
  isPublicEventVisible,
  getEffectiveEventEnd,
  getEffectiveEventStart,
} from "./eventStatusCore.ts";

const T0 = 1700000000;

test("event visibility accepts only private/public", () => {
  assert.equal(getEventVisibility({ visibility_status: "private", start_time: null, end_time: null }), "private");
  assert.equal(getEventVisibility({ visibility_status: "draft", start_time: null, end_time: null }), "private");
  assert.equal(getEventVisibility({ visibility_status: "public", start_time: null, end_time: null }), "public");
  assert.equal(getEventVisibility({ visibility_status: "archived", start_time: null, end_time: null }), "private");
});

test("public visibility and timing states are independent", () => {
  assert.equal(isPublicEventVisible({ visibility_status: "public", start_time: null, end_time: null }), true);
  assert.equal(isPublicEventVisible({ visibility_status: "private", start_time: null, end_time: null }), false);
  assert.equal(computeEventStatus({ visibility_status: "private", start_time: null, end_time: null }, T0), "private");
  assert.equal(computeEventStatus({ visibility_status: "public", start_time: null, end_time: null }, T0), "published");
  assert.equal(computeEventStatus({ visibility_status: "public", start_time: T0 + 100, end_time: null }, T0), "scheduled");
  assert.equal(computeEventStatus({ visibility_status: "public", start_time: T0 - 100, end_time: null }, T0), "active");
  assert.equal(computeEventStatus({ visibility_status: "public", start_time: null, end_time: T0 + 100 }, T0), "active");
  assert.equal(computeEventStatus({ visibility_status: "public", start_time: null, end_time: T0 - 100 }, T0), "ended");
  assert.equal(computeEventStatus({ visibility_status: "public", start_time: T0 - 100, end_time: T0 + 100 }, T0), "active");
});

test("one-sided dates are not copied into the missing side", () => {
  assert.equal(getEffectiveEventEnd({ visibility_status: "public", start_time: T0, end_time: null }), null);
  assert.equal(getEffectiveEventStart({ visibility_status: "public", start_time: null, end_time: T0 }), null);
});

test("event status labels and badges match the simplified model", () => {
  assert.equal(eventStatusLabel("private"), "非公開");
  assert.equal(eventStatusLabel("published"), "公開");
  assert.equal(eventStatusLabel("scheduled"), "開始前");
  assert.equal(eventStatusLabel("active"), "開催中");
  assert.equal(eventStatusLabel("ended"), "終了済");
  assert.equal(eventStatusBadgeClass("private"), "fn-badge-soft");
  assert.equal(eventStatusBadgeClass("active"), "fn-badge-accent");
  assert.equal(eventStatusBadgeClass("scheduled"), "fn-badge-warning");
  assert.equal(eventStatusBadgeClass("ended"), "fn-badge-neutral");
});

test("entry acceptance is a separate date-window calculation", () => {
  assert.equal(isAcceptingEntries({ visibility_status: "public", start_time: null, end_time: null }, T0), false);
  assert.equal(isAcceptingEntries({ visibility_status: "public", start_time: null, end_time: null, entry_start_time: T0 - 10, entry_end_time: T0 + 10 }, T0), true);
  assert.equal(isAcceptingEntries({ visibility_status: "public", start_time: null, end_time: null, entry_start_time: T0 - 10, entry_end_time: T0 }, T0), false);
  assert.equal(isAcceptingEntries({ visibility_status: "public", start_time: null, end_time: T0 - 1, entry_start_time: T0 - 10, entry_end_time: T0 + 10 }, T0), false);
  assert.equal(isAcceptingEntries({ visibility_status: "private", start_time: null, end_time: null, entry_start_time: T0 - 10, entry_end_time: T0 + 10 }, T0), false);
});
