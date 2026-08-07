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

test("depublicization keeps R2 block before D1 and compensates only when safe", () => {
  assert.match(source, /preCommitVideoVisibilityDepublicization/);
  assert.match(source, /writePublicVisibilityBlockedEntitiesManifest/);
  assert.match(source, /compensateDepublicizationFenceOnD1Failure/);
  assert.match(source, /releaseBlockedEntityInManifest/);
  assert.match(source, /r2_token_mismatch/);
  assert.match(source, /video_not_public/);
});
