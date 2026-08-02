import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./videoVisibilityTransition.ts", import.meta.url)),
  "utf8",
);

test("video visibility transition uses full fan-out helpers", () => {
  assert.match(source, /buildAfterVideoStatusChangeQueueBatch/);
  assert.match(source, /buildVideoStatusChangeNotificationBatch/);
});

test("depublicization keeps R2 block before D1 and does not auto-unblock", () => {
  assert.match(source, /preCommitVideoVisibilityDepublicization/);
  assert.match(source, /writePublicVisibilityBlockedEntitiesManifest/);
  assert.doesNotMatch(source, /releaseBlockedEntityInManifest/);
});
