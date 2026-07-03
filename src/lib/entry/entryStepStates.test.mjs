import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEntryStepStates } from "./entryStepStates.ts";

test("resolveEntryStepStates highlights login first for guests", () => {
  const states = resolveEntryStepStates({
    isLoggedIn: false,
    needsTosAccept: false,
    activeX: null,
    activeXApprovalStatus: null,
    hasReservedSlots: false,
    canPost: false,
  });
  assert.equal(states.login, "current");
  assert.equal(states.post, "pending");
});

test("resolveEntryStepStates moves to post when slot is ready", () => {
  const states = resolveEntryStepStates({
    isLoggedIn: true,
    needsTosAccept: false,
    activeX: "creator",
    activeXApprovalStatus: "approved",
    hasReservedSlots: true,
    canPost: true,
  });
  assert.equal(states.event, "done");
  assert.equal(states.post, "current");
});
