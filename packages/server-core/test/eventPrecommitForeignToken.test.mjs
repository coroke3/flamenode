import assert from "node:assert/strict";
import { test } from "node:test";
import {
  preCommitEventVisibilityTransition,
  preCommitEventVisibilityFenceRename,
  preCommitEventVisibilityRenameTombstone,
  compensateEventVisibilityFenceRenameOnD1Failure,
  compensateEventVisibilityRenameTombstoneOnD1Failure,
} from "@flamenode/server-core/visibility/eventTransition";
import { preCommitPublicVisibilityFence } from "@flamenode/server-core/visibility/fenceTransition";
import { preCommitVideoVisibilityDepublicization } from "@flamenode/server-core/visibility/videoTransition";
import { releaseBlockedEntityInManifest } from "@flamenode/server-core/visibility/manifestCore";

import {
  planEventVisibilityTransition,
} from "@flamenode/server-core/visibility/eventTransition";
import { planPublicVisibilityFenceTransition } from "@flamenode/server-core/visibility/fenceTransition";

// Exercise the actual shared core imported by both CURRENT Next and TARGET Hono.
// The fake manifest host models R2 conditional PUT and mutateOnConflict retries.
const entry = (entity_type, entity_id, fence_token) => ({
  entity_type, entity_id, fence_token, blocked_at: 100, reason: null,
});
const manifestOf = (...entities) => ({
  schema_version: 1, revision: 1, generated_at: 100, entities,
});
function hostOf(initial, race = null, afterWrite = null) {
  let current = structuredClone(initial);
  let etag = 1;
  let attemptedWrites = 0;
  let appliedWrites = 0;
  let reads = 0;
  let callbacks = 0;
  const host = {
    manifest: {
      async read() {
        reads += 1;
        return { manifest: structuredClone(current), etag: String(etag) };
      },
      async write(next, options) {
        attemptedWrites += 1;
        // A different writer can land between the caller's initial GET and PUT.
        if (race && attemptedWrites === 1) {
          current = race(structuredClone(current));
          etag += 1;
        }
        const resolved = options?.ifMatchEtag === String(etag)
          ? next
          : (() => {
              callbacks += 1;
              if (!options?.mutateOnConflict) throw new Error("etag_conflict");
              return options.mutateOnConflict(structuredClone(current));
            })();
        current = structuredClone(resolved);
        etag += 1;
        appliedWrites += 1;
        // Simulate an unrelated R2 writer changing the manifest after our
        // successful CAS but before the confirm GET.
        if (afterWrite && appliedWrites === 1) {
          current = afterWrite(structuredClone(current));
          etag += 1;
        }
      },
    },
  };
  return { host, get manifest() { return current; },
    get attemptedWrites() { return attemptedWrites; },
    get appliedWrites() { return appliedWrites; },
    get reads() { return reads; },
    get callbacks() { return callbacks; },
  };
}
const write = (state, token = "incoming") =>
  preCommitEventVisibilityTransition(
    { eventId: "event-one", fenceToken: token, reason: "private" }, state.host,
  );
const foreign = entry("event", "event-one", "earlier-writer");
const other = entry("video", "video-one", "video-fence");


function planningDb(existingFence, { failRead = false } = {}) {
  const calls = { selects: 0, upserts: [] };
  const db = {
    select() {
      return { from() {
        return { where() {
          return { async limit() {
            calls.selects += 1;
            if (failRead) throw new Error("authoritative D1 fence unavailable");
            return existingFence ? [existingFence] : [];
          } };
        } };
      } };
    },
    insert() {
      return { values(values) {
        return { onConflictDoUpdate({ set }) {
          calls.upserts.push({ values, set });
          return { kind: "fence_upsert" };
        } };
      } };
    },
  };
  return { db, calls };
}

test("Issue #659: event D1 fence planner preserves active tokens and rotates released tokens", async () => {
  for (const [state, expectedReuse] of [
    ["blocked", true], ["release_pending", true],
    ["released", false], [null, false],
  ]) {
    const { db, calls } = planningDb(
      state ? { state, fence_token: "vf_existing", entity_type: "event", entity_id: "event-one" } : null,
    );
    const plan = await planEventVisibilityTransition({
      db, eventId: "event-one", previousStatus: "private", nextStatus: "public",
      actorUserId: "actor", now: 1760000100,
    });
    assert.equal(calls.selects, 1, "one authoritative read before deciding token ownership");
    assert.equal(calls.upserts.length, 1);
    assert.equal(plan.mutationStatements.length, 1);
    assert.deepEqual(plan.expectedMutationChanges, [1]);
    assert.equal(calls.upserts[0].set.state, "release_pending");
    assert.equal(calls.upserts[0].set.fence_token, plan.fenceToken);
    assert.equal(plan.fenceToken === "vf_existing", expectedReuse, state ?? "missing");
    assert.match(plan.fenceToken, /^vf_/);
  }
});

test("Issue #659: generic event-group D1 planner preserves active token, not released token", async () => {
  for (const state of ["blocked", "release_pending", "released"]) {
    const { db, calls } = planningDb({
      state, fence_token: "vf_existing", entity_type: "event_group", entity_id: "group-one",
    });
    const plan = await planPublicVisibilityFenceTransition({
      db, entityType: "event_group", entityId: "group-one",
      previousStatus: "public", nextStatus: "private",
      isPublic: (status) => status === "public",
      actorUserId: "actor", now: 1760000100,
    });
    assert.equal(calls.selects, 1);
    assert.equal(plan.mutationStatements.length, 1);
    assert.equal(calls.upserts[0].set.state, "blocked");
    assert.equal(calls.upserts[0].set.fence_token, plan.fenceToken);
    assert.equal(plan.fenceToken === "vf_existing", state !== "released");
  }
});

test("Issue #659: no public boundary means no D1 read, and failed fence read is fail-closed", async () => {
  const { db, calls } = planningDb({ state: "blocked", fence_token: "vf_existing" });
  const same = await planEventVisibilityTransition({
    db, eventId: "event-one", previousStatus: "private", nextStatus: "private",
    actorUserId: "actor", now: 1760000100,
  });
  assert.equal(same.fenceToken, null);
  assert.equal(calls.selects, 0);
  assert.equal(calls.upserts.length, 0);
  const generic = await planPublicVisibilityFenceTransition({
    db, entityType: "event_group", entityId: "group-one",
    previousStatus: "private", nextStatus: "draft",
    isPublic: (status) => status === "public",
    actorUserId: "actor", now: 1760000100,
  });
  assert.equal(generic.fenceToken, null);
  assert.equal(calls.selects, 0);
  assert.equal(calls.upserts.length, 0);

  const failing = planningDb(null, { failRead: true });
  await assert.rejects(
    planEventVisibilityTransition({
      db: failing.db, eventId: "event-one", previousStatus: "public", nextStatus: "private",
      actorUserId: "actor", now: 1760000100,
    }),
    /authoritative D1 fence unavailable/,
  );
  assert.equal(failing.calls.selects, 1);
  assert.equal(failing.calls.upserts.length, 0, "never plan a D1 write from an unknown owner");
});

test("Issue #659: initial R2 snapshot with another event token is rejected before ANY PUT", async () => {
  const state = hostOf(manifestOf(foreign, other));
  const before = structuredClone(state.manifest);
  await assert.rejects(write(state), /public_visibility_fence_token_mismatch/);
  assert.equal(state.reads, 1, "only the initial manifest GET");
  assert.equal(state.attemptedWrites, 0, "no conditional PUT even attempted");
  assert.equal(state.appliedWrites, 0);
  assert.equal(state.callbacks, 0, "cannot depend on the conflict callback in the first-CAS-success case");
  assert.deepEqual(state.manifest, before, "previous blocking token and unrelated entries remain intact");
});

test("Issue #659: idempotent reuse of the SAME token remains permitted", async () => {
  const state = hostOf(manifestOf(entry("event", "event-one", "incoming"), other));
  await write(state);
  assert.equal(state.attemptedWrites, 1);
  assert.equal(state.appliedWrites, 1);
  assert.equal(state.reads, 2, "write is followed by token confirmation GET");
  assert.equal(state.manifest.entities.find(x => x.entity_id === "event-one").fence_token, "incoming");
  assert.deepEqual(state.manifest.entities.find(x => x.entity_id === "video-one"), other);
});

test("Issue #659: first precommit for a missing event entry still writes and confirms", async () => {
  const state = hostOf(manifestOf(other));
  await write(state);
  assert.equal(state.appliedWrites, 1);
  assert.equal(state.manifest.entities.find(x => x.entity_type === "event").fence_token, "incoming");
  assert.deepEqual(state.manifest.entities.find(x => x.entity_id === "video-one"), other);
});

test("Issue #659: a racing foreign token at CAS failure is denied, without overwrite", async () => {
  const state = hostOf(manifestOf(other), latest => ({
    ...latest, revision: latest.revision + 1,
    entities: [...latest.entities, foreign],
  }));
  await assert.rejects(write(state), /public_visibility_fence_token_mismatch/);
  assert.equal(state.attemptedWrites, 1);
  assert.equal(state.callbacks, 1, "conflict callback still checks the latest token");
  assert.equal(state.appliedWrites, 0);
  assert.deepEqual(state.manifest.entities.find(x => x.entity_id === "event-one"), foreign);
  assert.deepEqual(state.manifest.entities.find(x => x.entity_id === "video-one"), other);
});

test("Issue #659: nonconflicting concurrent manifest additions survive ETag retry", async () => {
  const added = entry("event_group", "group-two", "another-token");
  const state = hostOf(manifestOf(other), latest => ({
    ...latest, revision: latest.revision + 1,
    entities: [...latest.entities, added],
  }));
  await write(state);
  assert.equal(state.callbacks, 1);
  assert.equal(state.appliedWrites, 1);
  assert.equal(state.manifest.entities.find(x => x.entity_id === "event-one").fence_token, "incoming");
  assert.deepEqual(state.manifest.entities.find(x => x.entity_id === "group-two"), added);
  assert.deepEqual(state.manifest.entities.find(x => x.entity_id === "video-one"), other);
});

test("Issue #659: generic event_group precommit rejects an existing foreign token before PUT", async () => {
  const prior = entry("event_group", "group-one", "older-group-owner");
  const state = hostOf(manifestOf(other, prior));
  await assert.rejects(
    preCommitPublicVisibilityFence(
      { entityType: "event_group", entityId: "group-one", fenceToken: "incoming" },
      state.host,
    ),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.attemptedWrites, 0);
  assert.deepEqual(state.manifest.entities, [other, prior]);
});

test("Issue #659: generic X user fence comparison is case insensitive and preserves the previous token", async () => {
  const prior = entry("x_user", "UserX", "older-user-owner");
  const state = hostOf(manifestOf(prior));
  await assert.rejects(
    preCommitPublicVisibilityFence(
      { entityType: "x_user", entityId: "USERX", fenceToken: "incoming" },
      state.host,
    ),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.attemptedWrites, 0);
  assert.deepEqual(state.manifest.entities, [prior]);
});

test("Issue #659: generic same-token retry and nonconflicting CAS still work", async () => {
  const prior = entry("event_group", "group-one", "incoming");
  const added = entry("video", "video-two", "another-writer");
  const state = hostOf(manifestOf(prior), latest => ({
    ...latest,
    entities: [...latest.entities, added],
  }));
  await preCommitPublicVisibilityFence(
    { entityType: "event_group", entityId: "group-one", fenceToken: "incoming" },
    state.host,
  );
  assert.equal(state.callbacks, 1);
  assert.equal(state.appliedWrites, 1);
  assert.equal(state.manifest.entities.find(x => x.entity_id === "group-one").fence_token, "incoming");
  assert.deepEqual(state.manifest.entities.find(x => x.entity_id === "video-two"), added);
});

test("Issue #659: duplicate same-ID manifest entries cannot hide a prior foreign event token", async () => {
  const state = hostOf(manifestOf(entry("event", "event-one", "incoming"), foreign, other));
  const before = structuredClone(state.manifest);
  await assert.rejects(write(state), /public_visibility_fence_token_mismatch/);
  assert.equal(state.attemptedWrites, 0);
  assert.deepEqual(state.manifest, before);
});

test("Issue #659: CAS retry rejects a later duplicate foreign token after a matching first entry", async () => {
  const state = hostOf(manifestOf(other), latest => ({
    ...latest,
    entities: [...latest.entities, entry("event", "event-one", "incoming"), foreign],
  }));
  await assert.rejects(write(state), /public_visibility_fence_token_mismatch/);
  assert.equal(state.callbacks, 1);
  assert.equal(state.appliedWrites, 0);
  assert.deepEqual(state.manifest.entities.slice(1), [entry("event", "event-one", "incoming"), foreign]);
});

test("Issue #659: generic case-folded duplicate X-ID tokens fail closed", async () => {
  const state = hostOf(manifestOf(
    entry("x_user", "userx", "incoming"),
    entry("x_user", "USERX", "foreign"),
  ));
  await assert.rejects(
    preCommitPublicVisibilityFence(
      { entityType: "x_user", entityId: "UserX", fenceToken: "incoming" },
      state.host,
    ),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.attemptedWrites, 0);
});

test("Visibility CAS: video precommit rejects an existing foreign token before any PUT", async () => {
  const older = entry("video", "video-one", "earlier-video-writer");
  const unrelated = entry("event", "event-two", "event-owner");
  const state = hostOf(manifestOf(older, unrelated));
  const previous = structuredClone(state.manifest);
  await assert.rejects(
    preCommitVideoVisibilityDepublicization(
      { videoId: "video-one", fenceToken: "incoming" }, state.host,
    ),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.attemptedWrites, 0);
  assert.deepEqual(state.manifest, previous);
});

test("Visibility CAS: video duplicate same-ID foreign token cannot hide behind a matching first entry", async () => {
  const state = hostOf(manifestOf(
    entry("video", "video-one", "incoming"),
    entry("video", "video-one", "foreign"),
  ));
  await assert.rejects(
    preCommitVideoVisibilityDepublicization(
      { videoId: "video-one", fenceToken: "incoming" }, state.host,
    ),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.attemptedWrites, 0);
});

test("Visibility CAS: video race introduces a foreign token; conflict callback must fail closed", async () => {
  const prior = entry("event", "event-two", "event-owner");
  const newer = entry("video", "video-one", "second-writer");
  const state = hostOf(manifestOf(prior), latest => ({
    ...latest, entities: [...latest.entities, newer],
  }));
  await assert.rejects(
    preCommitVideoVisibilityDepublicization(
      { videoId: "video-one", fenceToken: "incoming" }, state.host,
    ),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.callbacks, 1);
  assert.equal(state.appliedWrites, 0);
  assert.deepEqual(state.manifest.entities, [prior, newer]);
});

test("Visibility CAS: same-token video retry preserves unrelated manifest entries", async () => {
  const old = entry("video", "video-one", "incoming");
  const extra = entry("event_group", "group-two", "another-owner");
  const state = hostOf(manifestOf(old, extra));
  await preCommitVideoVisibilityDepublicization(
    { videoId: "video-one", fenceToken: "incoming" }, state.host,
  );
  assert.equal(state.appliedWrites, 1);
  assert.equal(state.reads, 2);
  assert.equal(state.manifest.entities.find(x => x.entity_id === "video-one").fence_token, "incoming");
  assert.deepEqual(state.manifest.entities.find(x => x.entity_id === "group-two"), extra);
});

test("Visibility compensation: release refuses to remove a duplicate foreign event token", () => {
  const prior = manifestOf(
    entry("event", "event-one", "incoming"),
    entry("event", "event-one", "other-writer"),
    entry("video", "video-two", "safe-owner"),
  );
  const before = structuredClone(prior);
  const released = releaseBlockedEntityInManifest(prior, "event", "event-one", "incoming", 200);
  assert.equal(released, null, "must fail closed instead of deleting the other owner's fence");
  assert.deepEqual(prior, before, "the R2 manifest input must remain unchanged");
});

test("Visibility compensation: case-folded duplicate X user with foreign token is protected", () => {
  const prior = manifestOf(
    entry("x_user", "USERX", "incoming"),
    entry("x_user", "userx", "foreign"),
  );
  assert.equal(releaseBlockedEntityInManifest(prior, "x_user", "UserX", "incoming", 200), null);
});

test("Visibility compensation: same-token duplicates can be released without removing other entities", () => {
  const unrelated = entry("event_group", "group-two", "keep");
  const prior = manifestOf(
    entry("video", "video-one", "incoming"),
    entry("video", "video-one", "incoming"),
    unrelated,
  );
  const released = releaseBlockedEntityInManifest(prior, "video", "video-one", "incoming", 200);
  assert.ok(released);
  assert.deepEqual(released.entities, [unrelated]);
  assert.equal(released.revision, 2);
  assert.equal(released.generated_at, 200);
});

test("Visibility CAS: event confirmation refuses a foreign duplicate added after successful PUT", async () => {
  const state = hostOf(manifestOf(other), null, latest => ({
    ...latest, entities: [...latest.entities, foreign],
  }));
  await assert.rejects(write(state), /public_visibility_fence_token_mismatch/);
  assert.equal(state.attemptedWrites, 1);
  assert.equal(state.appliedWrites, 1);
  assert.equal(state.reads, 2);
  assert.deepEqual(state.manifest.entities.find(x => x.fence_token === "earlier-writer"), foreign);
});

test("Visibility CAS: generic event-group confirmation refuses a post-PUT foreign duplicate", async () => {
  const state = hostOf(manifestOf(), null, latest => ({
    ...latest, entities: [...latest.entities, entry("event_group", "group-one", "foreign")],
  }));
  await assert.rejects(
    preCommitPublicVisibilityFence(
      { entityType: "event_group", entityId: "group-one", fenceToken: "incoming" },
      state.host,
    ),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.attemptedWrites, 1);
  assert.equal(state.reads, 2);
});

test("Visibility CAS: video confirmation refuses a post-PUT foreign duplicate", async () => {
  const state = hostOf(manifestOf(), null, latest => ({
    ...latest, entities: [...latest.entities, entry("video", "video-one", "foreign")],
  }));
  await assert.rejects(
    preCommitVideoVisibilityDepublicization(
      { videoId: "video-one", fenceToken: "incoming" }, state.host,
    ),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.attemptedWrites, 1);
  assert.equal(state.reads, 2);
});

test("Visibility rename copy: a foreign duplicate on old or new event ID stops the first PUT", async () => {
  const owned = entry("event", "event-old", "incoming");
  const irrelevant = entry("video", "video-safe", "video-owner");
  const rename = { oldEventId: "event-old", newEventId: "event-new", fenceToken: "incoming" };
  for (const conflictingId of ["event-old", "event-new"]) {
    const state = hostOf(manifestOf(owned, irrelevant, entry("event", conflictingId, "foreign")));
    const before = structuredClone(state.manifest);
    await assert.rejects(
      preCommitEventVisibilityFenceRename(rename, state.host),
      /public_visibility_fence_token_mismatch/,
    );
    assert.equal(state.attemptedWrites, 0, `foreign duplicate at ${conflictingId} must not be overwritten`);
    assert.deepEqual(state.manifest, before);
  }
});

test("Visibility rename copy: a racing foreign new-ID token during CAS prevents overwrite", async () => {
  const owned = entry("event", "event-old", "incoming");
  const foreignNew = entry("event", "event-new", "other-writer");
  const state = hostOf(manifestOf(owned), latest => ({
    ...latest, entities: [...latest.entities, foreignNew],
  }));
  await assert.rejects(
    preCommitEventVisibilityFenceRename(
      { oldEventId: "event-old", newEventId: "event-new", fenceToken: "incoming" }, state.host,
    ),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.callbacks, 1);
  assert.equal(state.appliedWrites, 0);
  assert.deepEqual(state.manifest.entities, [owned, foreignNew]);
});

test("Visibility rename copy: confirmation catches a new foreign duplicate after successful PUT", async () => {
  const owned = entry("event", "event-old", "incoming");
  const foreignNew = entry("event", "event-new", "other-writer");
  const state = hostOf(manifestOf(owned), null, latest => ({
    ...latest, entities: [...latest.entities, foreignNew],
  }));
  await assert.rejects(
    preCommitEventVisibilityFenceRename(
      { oldEventId: "event-old", newEventId: "event-new", fenceToken: "incoming" }, state.host,
    ),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.appliedWrites, 1);
  assert.equal(state.reads, 2);
  assert.deepEqual(state.manifest.entities.find(x => x.fence_token === "other-writer"), foreignNew);
});

test("Visibility rename compensation: a foreign duplicate on new ID prevents wholesale deletion", async () => {
  const ownNew = entry("event", "event-new", "incoming");
  const foreignNew = entry("event", "event-new", "other-writer");
  const unrelated = entry("video", "video-safe", "other-video");
  const state = hostOf(manifestOf(ownNew, foreignNew, unrelated));
  const before = structuredClone(state.manifest);
  await compensateEventVisibilityFenceRenameOnD1Failure(
    { oldEventId: "event-old", newEventId: "event-new",
      fenceToken: "incoming", previousOldEntry: null }, state.host,
  );
  assert.equal(state.appliedWrites, 0);
  assert.deepEqual(state.manifest, before);
});

test("Visibility tombstone compensation: a duplicate foreign old-ID token cannot be removed", async () => {
  const own = entry("event", "event-old", "incoming");
  const foreign = entry("event", "event-old", "other-writer");
  const state = hostOf(manifestOf(own, foreign));
  const before = structuredClone(state.manifest);
  await compensateEventVisibilityRenameTombstoneOnD1Failure(
    { eventId: "event-old", fenceToken: "incoming", previousEntry: null }, state.host,
  );
  assert.equal(state.appliedWrites, 0);
  assert.deepEqual(state.manifest, before);
});

test("Visibility rename copy: matching token still carries old and new blocks safely", async () => {
  const owned = entry("event", "event-old", "incoming");
  const unrelated = entry("video", "video-safe", "unrelated");
  const state = hostOf(manifestOf(owned, unrelated));
  const precommit = await preCommitEventVisibilityFenceRename(
    { oldEventId: "event-old", newEventId: "event-new", fenceToken: "incoming" }, state.host,
  );
  assert.equal(state.appliedWrites, 1);
  assert.equal(state.reads, 2);
  assert.deepEqual(precommit.previousOldEntry, owned);
  assert.deepEqual(state.manifest.entities.find(x => x.entity_id === "event-old"), owned);
  assert.equal(state.manifest.entities.find(x => x.entity_id === "event-new").fence_token, "incoming");
  assert.deepEqual(state.manifest.entities.find(x => x.entity_id === "video-safe"), unrelated);
});

test("Visibility compensation: D1 rename rollback does not overwrite a concurrent old-ID owner", async () => {
  const originalOld = entry("event", "old-event", "incoming");
  const foreignOld = entry("event", "old-event", "other-writer");
  const ownNew = entry("event", "new-event", "incoming");
  for (const oldEntries of [[foreignOld], [originalOld, foreignOld]]) {
    const state = hostOf(manifestOf(...oldEntries, ownNew, other));
    const before = structuredClone(state.manifest);
    await compensateEventVisibilityFenceRenameOnD1Failure(
      {
        oldEventId: "old-event",
        newEventId: "new-event",
        fenceToken: "incoming",
        previousOldEntry: originalOld,
      },
      state.host,
    );
    assert.equal(state.appliedWrites, 0, "must not replace a later writer's old-ID fence");
    assert.equal(state.attemptedWrites, 0, "must fail closed without attempting R2 PUT");
    assert.deepEqual(state.manifest, before, "both old and new visibility blocks stay intact");
  }
});

test("Visibility tombstone: mixed old-ID tokens on initial GET must not be rotated or erased", async () => {
  const beforeEntries = [
    entry("event", "event-old", "existing-owner"),
    entry("event", "event-old", "foreign-owner"),
    entry("video", "video-safe", "unrelated"),
  ];
  const state = hostOf(manifestOf(...beforeEntries));
  await assert.rejects(
    preCommitEventVisibilityRenameTombstone(
      { eventId: "event-old", fenceToken: "rotated" }, state.host,
    ),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.attemptedWrites, 0, "never issue the first R2 CAS PUT");
  assert.deepEqual(state.manifest.entities, beforeEntries);
});

test("Visibility tombstone: ETag CAS conflict with a duplicate foreign old-ID token fails closed", async () => {
  const old = entry("event", "event-old", "original");
  const foreign = entry("event", "event-old", "concurrent-owner");
  const state = hostOf(manifestOf(old), (latest) => ({
    ...latest, entities: [...latest.entities, foreign],
  }));
  await assert.rejects(
    preCommitEventVisibilityRenameTombstone(
      { eventId: "event-old", fenceToken: "rotated" }, state.host,
    ),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.callbacks, 1, "CAS retry inspects new owners before overwriting");
  assert.equal(state.appliedWrites, 0);
  assert.deepEqual(state.manifest.entities, [old, foreign]);
});

test("Visibility tombstone: post-PUT foreign duplicate is rejected at confirmation", async () => {
  const foreign = entry("event", "event-old", "post-put-owner");
  const state = hostOf(manifestOf(entry("event", "event-old", "original")), null, (latest) => ({
    ...latest, entities: [...latest.entities, foreign],
  }));
  await assert.rejects(
    preCommitEventVisibilityRenameTombstone(
      { eventId: "event-old", fenceToken: "rotated" }, state.host,
    ),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.appliedWrites, 1);
  assert.equal(state.reads, 2);
  assert.deepEqual(state.manifest.entities.find((x) => x.fence_token === "post-put-owner"), foreign);
});

test("Visibility tombstone: valid single-token rotation preserves previous entry and unrelated blocks", async () => {
  const prior = { ...entry("event", "event-old", "previous"), blocked_at: 55, reason: "preserve" };
  const video = entry("video", "video-safe", "unrelated");
  const state = hostOf(manifestOf(prior, video));
  const precommit = await preCommitEventVisibilityRenameTombstone(
    { eventId: "event-old", fenceToken: "rotated" }, state.host,
  );
  assert.equal(state.appliedWrites, 1);
  assert.deepEqual(precommit.previousEntry, prior);
  const rotated = state.manifest.entities.find((x) => x.entity_id === "event-old");
  assert.equal(rotated.fence_token, "rotated");
  assert.equal(rotated.blocked_at, 55);
  assert.equal(rotated.reason, "preserve");
  assert.deepEqual(state.manifest.entities.find((x) => x.entity_id === "video-safe"), video);
});

test("Visibility tombstone: expected prior token rejects a different single old-ID owner before R2 PUT", async () => {
  const foreign = entry("event", "event-old", "concurrent-owner");
  const state = hostOf(manifestOf(foreign));
  await assert.rejects(
    preCommitEventVisibilityRenameTombstone({
      eventId: "event-old", fenceToken: "rotated", expectedPreviousFenceToken: "trusted-owner",
    }, state.host),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.attemptedWrites, 0);
  assert.deepEqual(state.manifest.entities, [foreign]);
});

test("Visibility tombstone: expected prior token rejects a concurrent single-owner CAS replacement", async () => {
  const trusted = entry("event", "event-old", "trusted-owner");
  const foreign = entry("event", "event-old", "race-owner");
  const state = hostOf(manifestOf(trusted), (latest) => ({
    ...latest, entities: [foreign],
  }));
  await assert.rejects(
    preCommitEventVisibilityRenameTombstone({
      eventId: "event-old", fenceToken: "rotated", expectedPreviousFenceToken: "trusted-owner",
    }, state.host),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.callbacks, 1);
  assert.equal(state.appliedWrites, 0);
  assert.deepEqual(state.manifest.entities, [foreign]);
});

test("Visibility tombstone: expected no previous token rejects a stray R2 old-ID block", async () => {
  const foreign = entry("event", "event-old", "orphaned-owner");
  const state = hostOf(manifestOf(foreign));
  await assert.rejects(
    preCommitEventVisibilityRenameTombstone({
      eventId: "event-old", fenceToken: "rotated", expectedPreviousFenceToken: null,
    }, state.host),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.attemptedWrites, 0);
  assert.deepEqual(state.manifest.entities, [foreign]);
});

test("Visibility tombstone: matching explicit prior token permits safe rotation", async () => {
  const prior = entry("event", "event-old", "trusted-owner");
  const state = hostOf(manifestOf(prior));
  const result = await preCommitEventVisibilityRenameTombstone({
    eventId: "event-old", fenceToken: "rotated", expectedPreviousFenceToken: "trusted-owner",
  }, state.host);
  assert.deepEqual(result.previousEntry, prior);
  assert.equal(state.appliedWrites, 1);
  assert.equal(state.manifest.entities.find((x) => x.entity_id === "event-old").fence_token, "rotated");
});

test("Visibility tombstone: vanished expected token is not treated as permission to rotate", async () => {
  const prior = entry("event", "event-old", "trusted-owner");
  const state = hostOf(manifestOf(prior), (latest) => ({
    ...latest, entities: [],
  }));
  await assert.rejects(
    preCommitEventVisibilityRenameTombstone({
      eventId: "event-old", fenceToken: "rotated", expectedPreviousFenceToken: "trusted-owner",
    }, state.host),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.callbacks, 1);
  assert.equal(state.appliedWrites, 0);
});
