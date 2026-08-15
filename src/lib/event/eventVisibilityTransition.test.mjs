import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const transitionSource = await readFile(
  new URL("./eventVisibilityTransition.ts", import.meta.url),
  "utf8",
);
const actionSource = await readFile(
  new URL("../actions/event-admin.ts", import.meta.url),
  "utf8",
);
const dangerActionSource = await readFile(
  new URL("../actions/event-admin-danger.ts", import.meta.url),
  "utf8",
);

test("イベントの非公開化は D1 更新前に event fence を block する", () => {
  assert.match(transitionSource, /entity_type:\s*"event"/);
  assert.match(transitionSource, /upsertBlockedEntityInManifest/);
  assert.match(transitionSource, /preCommitEventVisibilityTransition/);
  assert.match(actionSource, /preCommitEventVisibilityTransition/);
  assert.match(actionSource, /compensateEventVisibilityFenceOnD1Failure/);
});

test("event ID rename moves the R2 visibility fence before D1 and restores it on failure", () => {
  assert.match(transitionSource, /preCommitEventVisibilityFenceRename/);
  assert.match(transitionSource, /compensateEventVisibilityFenceRenameOnD1Failure/);
  assert.match(transitionSource, /oldEventId/);
  assert.match(transitionSource, /newEventId/);
  assert.match(transitionSource, /withoutNewEventId/);
  assert.match(transitionSource, /previousOldEntry !== null/);
  assert.match(dangerActionSource, /getPublicVisibilityFence/);
  assert.match(dangerActionSource, /preCommitEventVisibilityFenceRename/);
  assert.match(dangerActionSource, /compensateEventVisibilityFenceRenameOnD1Failure/);
});

test("event ID rename leaves an old-id R2 tombstone and compensates it on D1 failure", () => {
  assert.match(transitionSource, /preCommitEventVisibilityRenameTombstone/);
  assert.match(
    transitionSource,
    /compensateEventVisibilityRenameTombstoneOnD1Failure/,
  );
  assert.match(dangerActionSource, /preCommitEventVisibilityRenameTombstone/);
  assert.match(
    dangerActionSource,
    /compensateEventVisibilityRenameTombstoneOnD1Failure/,
  );
  assert.match(dangerActionSource, /renameTombstoneToken = generateId\("vf"\)/);
  assert.match(dangerActionSource, /event_id_rename_old_cleanup/);
  assert.match(dangerActionSource, /includeComposedCleanup: true/);
});

test("イベント再公開も release_pending と manifest block を経由する", () => {
  assert.match(transitionSource, /state = input\.nextStatus === "public" \? "release_pending" : "blocked"/);
  assert.match(transitionSource, /expectedMutationChanges: \[1\]/);
  assert.match(actionSource, /planEventVisibilityTransition/);
});

test("イベント非公開化は静的 JSON Cache も削除する", () => {
  assert.match(actionSource, /deletePublicJsonCaches/);
  assert.match(actionSource, /eventComposedObjectKey/);
  assert.match(actionSource, /eventBaseObjectKey/);
  assert.match(actionSource, /eventSlotsObjectKey/);
  assert.match(actionSource, /"list\/recent\.json"/);
  assert.match(actionSource, /"list\/popular\.json"/);
});
