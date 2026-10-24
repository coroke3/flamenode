import test from "node:test";
import assert from "node:assert/strict";
import {
  adminEventEditPermissions,
  delegatedEventEditPermissions,
  hasAnyEventEditPermission,
  planEventVisibilityFence,
} from "@flamenode/domain/event";

test("planEventVisibilityFence: unchanged status writes no fence", () => {
  for (const status of ["public", "private", "draft", "archived"]) {
    assert.equal(planEventVisibilityFence({ previousStatus: status, nextStatus: status }), null);
  }
});

test("planEventVisibilityFence: leaving public blocks and reports depublicize", () => {
  assert.deepEqual(planEventVisibilityFence({ previousStatus: "public", nextStatus: "private" }), {
    state: "blocked",
    depublicizedFromPublic: true,
  });
});

test("planEventVisibilityFence: (re)publishing goes through release_pending", () => {
  assert.deepEqual(planEventVisibilityFence({ previousStatus: "private", nextStatus: "public" }), {
    state: "release_pending",
    depublicizedFromPublic: false,
  });
});

test("planEventVisibilityFence: non-public to non-public stays blocked (fail closed)", () => {
  assert.deepEqual(planEventVisibilityFence({ previousStatus: "draft", nextStatus: "private" }), {
    state: "blocked",
    depublicizedFromPublic: false,
  });
});

test("admin edits every section; delegated staff only granted sections", () => {
  assert.deepEqual(adminEventEditPermissions(), {
    basic: true,
    publish: true,
    questions: true,
    slots: true,
  });
  assert.deepEqual(delegatedEventEditPermissions(new Set()), {
    basic: false,
    publish: false,
    questions: false,
    slots: false,
  });
  assert.deepEqual(delegatedEventEditPermissions(new Set(["event.publish", "event.slots"])), {
    basic: false,
    publish: true,
    questions: false,
    slots: true,
  });
});

test("delegated permissions ignore unrelated keys and fresh objects are returned", () => {
  const permissions = delegatedEventEditPermissions(new Set(["video.title", "slot.reserve"]));
  assert.equal(hasAnyEventEditPermission(permissions), false);
  assert.notEqual(adminEventEditPermissions(), adminEventEditPermissions());
  assert.equal(hasAnyEventEditPermission(adminEventEditPermissions()), true);
});
