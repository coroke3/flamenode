import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const transition = fs.readFileSync(
  new URL("./eventGroupVisibilityTransition.ts", import.meta.url),
  "utf8",
);
const action = fs.readFileSync(
  new URL("../actions/event-group-admin.ts", import.meta.url),
  "utf8",
);
const rebuild = fs.readFileSync(
  new URL("../../../workers/json-generator/rebuild.ts", import.meta.url),
  "utf8",
);

test("event group visibility uses the existing event_group fence lifecycle", () => {
  // fence の lifecycle 本体は publicVisibilityFenceTransition の実行 test が検査する。
  assert.match(transition, /entityType: "event_group"/);
  assert.match(transition, /planPublicVisibilityFenceTransition\(/);
  assert.match(transition, /preCommitEventGroupVisibilityTransition/);
  assert.match(transition, /compensateEventGroupVisibilityOnD1Failure/);
  assert.match(action, /visibilityFence/);
  assert.match(action, /\.\.\.\(fence\?\.mutationStatements/);
  assert.match(action, /preCommitEventGroupVisibilityTransition/);
  assert.match(rebuild, /releaseVisibilityFenceAfterRebuild\(\s*env,\s*"event_group"/s);
});
