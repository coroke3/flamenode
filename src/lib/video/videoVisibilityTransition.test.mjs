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
  assert.match(source, /"list\/recent\.json"/);
  assert.match(source, /"list\/popular\.json"/);
  assert.match(source, /RANDOM_VIDEO_POOL_OBJECT_KEY/);
  assert.match(source, /videoPublicCacheKeys/);
  assert.match(source, /STATIC_USER_MAX_PAGES/);
  assert.match(source, /users\/\$\{xUserId\}\/works\/\$\{page\}\.json/);
  assert.match(source, /users\/\$\{xUserId\}\/collabs\/\$\{page\}\.json/);
});

test("depublicization keeps R2 block before D1 and compensates only when safe", () => {
  assert.match(source, /preCommitVideoVisibilityDepublicization/);
  assert.match(source, /writePublicVisibilityBlockedEntitiesManifest/);
  assert.match(source, /compensateDepublicizationFenceOnD1Failure/);
  assert.match(source, /releaseBlockedEntityInManifest/);
  assert.match(source, /r2_token_mismatch/);
  assert.match(source, /video_not_public/);
  assert.match(
    source,
    /handleVideoVisibilityMutationFailure[\s\S]*?stuck_fence_candidate/,
  );
  assert.match(source, /allowNonPublicRollback/);
});

test("再公開も artifact 完成までは同じ manifest block を維持する", async () => {
  const actionSource = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../actions/moderation-admin.ts", import.meta.url), "utf8"),
  );
  assert.match(source, /preCommitVideoVisibilityDepublicization/);
  assert.match(
    (await actionSource),
    /if \(transition\.fenceToken\)/,
  );
});
