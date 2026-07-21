import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_LISTABLE_X_APPROVAL_STATUSES,
  PUBLIC_LISTABLE_X_APPROVAL_SQL_IN,
} from "./publicXUser.ts";

test("PUBLIC_LISTABLE_X_APPROVAL_STATUSES includes imported legacy X IDs", () => {
  assert.deepEqual(PUBLIC_LISTABLE_X_APPROVAL_STATUSES, [
    "approved",
    "pending",
    "imported",
  ]);
  assert.ok(PUBLIC_LISTABLE_X_APPROVAL_STATUSES.includes("imported"));
  assert.ok(!PUBLIC_LISTABLE_X_APPROVAL_STATUSES.includes("rejected"));
});

test("PUBLIC_LISTABLE_X_APPROVAL_SQL_IN matches listable statuses", () => {
  assert.equal(
    PUBLIC_LISTABLE_X_APPROVAL_SQL_IN,
    "'approved', 'pending', 'imported'",
  );
});
