import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function readLayout(routeGroup) {
  return readFileSync(join(root, "app", routeGroup, "layout.tsx"), "utf8");
}

test("route group layouts use canonical data-fn-surface values", () => {
  assert.match(readLayout("(public)"), /data-fn-surface="public"/);
  assert.match(readLayout("(auth)"), /data-fn-surface="personal"/);
  assert.match(readLayout("(manage)"), /data-fn-surface="manage"/);
  assert.match(readLayout("(admin)"), /data-fn-surface="admin"/);
});

test("admin and manage layouts do not masquerade as public surface", () => {
  assert.doesNotMatch(readLayout("(admin)"), /data-fn-surface="public"/);
  assert.doesNotMatch(readLayout("(manage)"), /data-fn-surface="public"/);
  assert.doesNotMatch(readLayout("(auth)"), /data-fn-surface="public"/);
});
