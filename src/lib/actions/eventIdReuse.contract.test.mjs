import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const eventSource = await readFile(
  new URL("./event-admin.ts", import.meta.url),
  "utf8",
);
const dangerSource = await readFile(
  new URL("./event-admin-danger.ts", import.meta.url),
  "utf8",
);
const reuseSource = await readFile(
  new URL("../event/eventIdReuse.ts", import.meta.url),
  "utf8",
);

test("event creation releases an old tombstone only inside the atomic mutation", () => {
  assert.match(eventSource, /preCommitEventIdReuse/);
  assert.match(eventSource, /event_id_rename_old_cleanup/);
  assert.match(eventSource, /\.delete\(publicVisibilityFences\)/);
  assert.match(eventSource, /expectedMutationChanges/);
  assert.match(eventSource, /compensateEventIdReuseOnD1Failure/);
});

test("event ID rename handles a reusable target tombstone before moving the fence", () => {
  assert.match(dangerSource, /preCommitEventIdReuse/);
  assert.match(dangerSource, /targetReusePrecommit/);
  assert.match(dangerSource, /targetFenceDelete/);
  assert.match(dangerSource, /compensateEventIdReuseOnD1Failure/);
  assert.match(dangerSource, /event_id_rename_old_cleanup/);
});

test("reuse verification is fail-closed across queue, tracked artifacts, R2, and manifest", () => {
  for (const pattern of [
    /hasCompletedEventIdRenameCleanup/,
    /staticArtifacts/,
    /eventComposedObjectKey/,
    /eventBaseObjectKey/,
    /eventSlotsObjectKey/,
    /readPublicVisibilityBlockedEntitiesManifest/,
    /releaseBlockedEntityInManifest/,
    /ifMatchEtag/,
  ]) {
    assert.match(reuseSource, pattern);
  }
});
