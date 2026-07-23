import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [staff, notifications, mutationResult] = await Promise.all([
  readFile(new URL("./event-staff-admin.ts", import.meta.url), "utf8"),
  readFile(new URL("./notification-admin.ts", import.meta.url), "utf8"),
  readFile(new URL("./mutationResult.ts", import.meta.url), "utf8"),
]);

test("event-staff-admin uses post-commit revalidate and unstable_rethrow", () => {
  assert.match(staff, /runPostCommitBestEffort/);
  assert.match(staff, /revalidateEventStaffPathsBestEffort/);
  assert.match(staff, /unstable_rethrow\(error\)/);
  assert.doesNotMatch(
    staff,
    /catch \(error\) \{\s*return \{\s*ok: false/m,
  );
});

test("notification-admin uses post-commit revalidate and unstable_rethrow", () => {
  assert.match(notifications, /runPostCommitBestEffort/);
  assert.match(notifications, /unstable_rethrow\(error\)/);
  assert.match(notifications, /既に\$\{row\.status\}です/);
});

test("MutationResult shared type is available for gradual adoption", () => {
  assert.match(mutationResult, /export type MutationResult/);
  assert.match(mutationResult, /kind: "committed"/);
  assert.match(mutationResult, /kind: "noop"/);
  assert.match(mutationResult, /kind: "rejected"/);
});
