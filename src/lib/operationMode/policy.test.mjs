import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getPublicDataStrategy,
  getStaticRebuildPolicy,
  STATIC_REBUILD_ITEMS_PER_RUN,
  isLiveApiEnabled,
  isStaticRebuildEnabled,
  isWriteBlocked,
} from "./policy.ts";

test("getPublicDataStrategy: static_only switches public reads to static JSON only", () => {
  assert.equal(getPublicDataStrategy("normal"), "static_json_with_live_overlay");
  assert.equal(getPublicDataStrategy("economy"), "static_json_with_live_overlay");
  assert.equal(getPublicDataStrategy("read_only"), "static_json_with_live_overlay");
  assert.equal(getPublicDataStrategy("static_only"), "static_json_only");
  assert.equal(getPublicDataStrategy("maintenance"), "maintenance");
});

test("isWriteBlocked: read_only and stricter modes block writes", () => {
  assert.equal(isWriteBlocked("normal"), false);
  assert.equal(isWriteBlocked("economy"), false);
  assert.equal(isWriteBlocked("read_only"), true);
  assert.equal(isWriteBlocked("static_only"), true);
  assert.equal(isWriteBlocked("maintenance"), true);
});

test("isLiveApiEnabled: static_only and maintenance disable live API", () => {
  assert.equal(isLiveApiEnabled("normal"), true);
  assert.equal(isLiveApiEnabled("economy"), true);
  assert.equal(isLiveApiEnabled("read_only"), true);
  assert.equal(isLiveApiEnabled("static_only"), false);
  assert.equal(isLiveApiEnabled("maintenance"), false);
});

test("isStaticRebuildEnabled: maintenance is the only static rebuild stop", () => {
  assert.equal(isStaticRebuildEnabled("normal"), true);
  assert.equal(isStaticRebuildEnabled("economy"), true);
  assert.equal(isStaticRebuildEnabled("read_only"), true);
  assert.equal(isStaticRebuildEnabled("static_only"), true);
  assert.equal(isStaticRebuildEnabled("maintenance"), false);
});

test("getStaticRebuildPolicy: mirrors worker queue mode behavior", () => {
  assert.equal(STATIC_REBUILD_ITEMS_PER_RUN, 1);
  assert.deepEqual(getStaticRebuildPolicy("normal"), {
    maxItemsPerRun: 1,
    highPriorityOnly: false,
    allowedTargetTypes: null,
    skipTargetTypesUnlessHighPriority: [],
    reconcileStaleQueue: true,
  });
  assert.deepEqual(getStaticRebuildPolicy("economy"), {
    maxItemsPerRun: 1,
    highPriorityOnly: false,
    allowedTargetTypes: null,
    skipTargetTypesUnlessHighPriority: ["search_index", "list_popular"],
    reconcileStaleQueue: true,
  });
  assert.deepEqual(getStaticRebuildPolicy("read_only"), {
    maxItemsPerRun: 1,
    highPriorityOnly: false,
    allowedTargetTypes: ["event", "event_base", "event_slots", "video", "user"],
    skipTargetTypesUnlessHighPriority: [],
    reconcileStaleQueue: false,
  });
  assert.deepEqual(getStaticRebuildPolicy("static_only"), {
    maxItemsPerRun: 1,
    highPriorityOnly: true,
    allowedTargetTypes: null,
    skipTargetTypesUnlessHighPriority: [],
    reconcileStaleQueue: false,
  });
  assert.deepEqual(getStaticRebuildPolicy("maintenance"), {
    maxItemsPerRun: 0,
    highPriorityOnly: true,
    allowedTargetTypes: [],
    skipTargetTypesUnlessHighPriority: [],
    reconcileStaleQueue: false,
  });
});

test("normal mode keeps full write/live/rebuild behavior enabled", () => {
  assert.equal(getPublicDataStrategy("normal"), "static_json_with_live_overlay");
  assert.equal(isWriteBlocked("normal"), false);
  assert.equal(isLiveApiEnabled("normal"), true);
  assert.equal(isStaticRebuildEnabled("normal"), true);
  assert.deepEqual(getStaticRebuildPolicy("normal"), {
    maxItemsPerRun: 1,
    highPriorityOnly: false,
    allowedTargetTypes: null,
    skipTargetTypesUnlessHighPriority: [],
    reconcileStaleQueue: true,
  });
});
