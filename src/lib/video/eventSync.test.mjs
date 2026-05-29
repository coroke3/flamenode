import { test } from "node:test";
import assert from "node:assert/strict";

import { computeVideoEventSyncTarget } from "./eventSync.ts";

test("computeVideoEventSyncTarget deduplicates admin event ids", () => {
  assert.deepEqual(
    computeVideoEventSyncTarget({
      current: ["old"],
      requested: ["a", "a", "b"],
      alwaysInclude: ["primary", "a"],
      isAdmin: true,
    }),
    ["primary", "a", "b"],
  );
});

test("computeVideoEventSyncTarget preserves locked current events for non-admin", () => {
  assert.deepEqual(
    computeVideoEventSyncTarget({
      current: ["locked", "editable"],
      requested: ["new"],
      alwaysInclude: ["primary"],
      isAdmin: false,
      modifiableEventIds: ["editable", "new"],
    }),
    ["primary", "locked", "new"],
  );
});

test("computeVideoEventSyncTarget removes modifiable current events when not requested", () => {
  assert.deepEqual(
    computeVideoEventSyncTarget({
      current: ["editable", "locked"],
      requested: [],
      isAdmin: false,
      modifiableEventIds: ["editable"],
    }),
    ["locked"],
  );
});

test("computeVideoEventSyncTarget ignores unmodifiable requested events", () => {
  assert.deepEqual(
    computeVideoEventSyncTarget({
      current: [],
      requested: ["allowed", "denied"],
      isAdmin: false,
      modifiableEventIds: ["allowed"],
    }),
    ["allowed"],
  );
});
