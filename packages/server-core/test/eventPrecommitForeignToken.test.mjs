import assert from "node:assert/strict";
import { test } from "node:test";
import {
  preCommitEventVisibilityTransition,
  preCommitEventVisibilityFenceRename,
  preCommitEventVisibilityRenameTombstone,
  compensateEventVisibilityFenceRenameOnD1Failure,
  compensateEventVisibilityRenameTombstoneOnD1Failure,
} from "@flamenode/server-core/visibility/eventTransition";
import { preCommitPublicVisibilityFence, compensatePublicVisibilityFenceOnD1Failure } from "@flamenode/server-core/visibility/fenceTransition";
import { preCommitVideoVisibilityDepublicization, planVideoVisibilityFenceTransition } from "@flamenode/server-core/visibility/videoTransition";
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
        return { onConflictDoNothing() {
          calls.upserts.push({ kind: "insert-only", values });
          return { kind: "fence_insert_only" };
        } };
      } };
    },
    update() {
      return { set(set) {
        return { where(setWhere) {
          calls.upserts.push({ kind: "guarded-update", set, setWhere });
          return { kind: "fence_conditional_update" };
        } };
      } };
    },
  };
  return { db, calls };
}

test("Issue #659: audit-restore and legacy-import video fence planner respects observed D1 owner", async () => {
  for (const state of ["blocked", "release_pending", "released", null]) {
    const { db, calls } = planningDb(
      state ? { state, fence_token: "vf_video_existing", entity_type: "video", entity_id: "vid-one" } : null,
    );
    const plan = await planVideoVisibilityFenceTransition(db, {
      videoId: "vid-one",
      previousStatus: "private",
      nextStatus: "public",
      actorUserId: "actor",
      reason: "audit_restore_visibility",
      now: 1760000100,
    });
    assert.equal(calls.selects, 1, "only one authoritative D1 fence read for a public boundary");
    assert.deepEqual(plan.expectedMutationChanges, [1]);
    assert.equal(plan.mutationStatements.length, 1);
    assert.equal(plan.depublicizedFromPublic, false);
    assert.equal(calls.upserts.length, 1);
    assert.equal(calls.upserts[0].kind, state === null ? "insert-only" : "guarded-update");
    assert.equal(calls.upserts[0].set?.state ?? calls.upserts[0].values.state, "release_pending");
    assert.equal(plan.fenceToken === "vf_video_existing",
      state === "blocked" || state === "release_pending",
      "active token is reused; released/absent token must not be reused");
    assert.equal(calls.upserts[0].set?.fence_token ?? calls.upserts[0].values.fence_token,
      plan.fenceToken);
    assert.match(plan.fenceToken, /^vf_/);
  }
});

test("Issue #659: no video public boundary does not query D1; read errors fail closed", async () => {
  const { db, calls } = planningDb({ state: "blocked", fence_token: "vf_video_existing" });
  for (const [previousStatus, nextStatus] of [
    ["private", "pending"],
    ["pending", "voided"],
    ["public", "public"],
  ]) {
    const plan = await planVideoVisibilityFenceTransition(db, {
      videoId: "vid-one", previousStatus, nextStatus, actorUserId: "actor", now: 1760000100,
    });
    assert.deepEqual(plan.expectedMutationChanges, []);
    assert.equal(plan.fenceToken, null);
    assert.deepEqual(plan.mutationStatements, []);
  }
  assert.equal(calls.selects, 0);
  assert.equal(calls.upserts.length, 0);
  const failing = planningDb(null, { failRead: true });
  await assert.rejects(
    planVideoVisibilityFenceTransition(failing.db, {
      videoId: "vid-one", previousStatus: "public", nextStatus: "private",
      actorUserId: "actor", now: 1760000100,
    }),
    /authoritative D1 fence unavailable/,
  );
  assert.equal(failing.calls.selects, 1);
  assert.equal(failing.calls.upserts.length, 0, "unknown owner must not produce an unconditional UPSERT");
});

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
    assert.equal(calls.upserts[0].set?.state ?? calls.upserts[0].values.state, "release_pending");
    if (state === null) {
      assert.equal(calls.upserts[0].kind, "insert-only",
        "a new D1 claim cannot overwrite another writer who inserted after planning");
    } else {
      assert.equal(calls.upserts[0].kind, "guarded-update");
      assert.ok(calls.upserts[0].setWhere,
        "existing D1 fence must be guarded by observed token and state");
    }
    assert.equal(calls.upserts[0].set?.fence_token ?? calls.upserts[0].values.fence_token, plan.fenceToken);
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
    assert.equal(calls.upserts[0].kind, "guarded-update");
    assert.ok(calls.upserts[0].setWhere,
      "generic event_group/X fences must also preserve the observed D1 owner");
    assert.equal(calls.upserts[0].set?.fence_token ?? calls.upserts[0].values.fence_token, plan.fenceToken);
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

test("Issue #659: generic compensation must preserve R2 while a foreign D1 fence is active", async () => {
  // Our failed D1 mutation did not land, but a newer writer has already
  // installed its own canonical D1 block. Removing our still-active R2
  // entry would briefly expose the entity until the new writer publishes.
  for (const state of ["blocked", "release_pending"]) {
    const { db, calls } = planningDb({
      entity_type: "event_group", entity_id: "group-one",
      fence_token: "foreign-writer", state,
    });
    const initial = manifestOf(
      entry("event_group", "group-one", "incoming"),
      entry("video", "unrelated", "untouched"),
    );
    const host = hostOf(initial);
    await compensatePublicVisibilityFenceOnD1Failure({
      db, entityType: "event_group", entityId: "group-one",
      fenceToken: "incoming", flow: "foreign_d1_claim",
    }, host.host);
    assert.equal(calls.selects, 1, "one authoritative D1 fence read");
    assert.equal(host.reads, 0, "R2 must not be read for a foreign active D1 fence");
    assert.equal(host.attemptedWrites, 0, "no R2 DELETE/PUT may release its block");
    assert.deepEqual(host.manifest, initial, state);
  }
});

test("Issue #659: generic compensation still releases orphan R2 after failed D1 commit", async () => {
  // Preserve cleanup of our exact R2 precommit when there is no canonical
  // active D1 fence; unrelated entities must remain blocked.
  const { db, calls } = planningDb(null);
  const other = entry("video", "other-video", "keep");
  const state = hostOf(manifestOf(
    entry("event_group", "group-one", "incoming"), other,
  ));
  await compensatePublicVisibilityFenceOnD1Failure({
    db, entityType: "event_group", entityId: "group-one",
    fenceToken: "incoming", flow: "orphan_cleanup",
  }, state.host);
  assert.equal(calls.selects, 1);
  assert.equal(state.reads, 1);
  assert.equal(state.appliedWrites, 1);
  assert.deepEqual(state.manifest.entities, [other]);
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

test("Visibility rename copy: a pre-existing same-token destination must not be overwritten", async () => {
  const old = entry("event", "event-old", "incoming");
  const priorNew = { ...entry("event", "event-new", "incoming"),
    blocked_at: 10, reason: "another-pending-copy" };
  const unrelated = entry("video", "video-safe", "video-owner");
  const state = hostOf(manifestOf(old, priorNew, unrelated));
  const before = structuredClone(state.manifest);
  await assert.rejects(
    preCommitEventVisibilityFenceRename(
      { oldEventId: "event-old", newEventId: "event-new", fenceToken: "incoming" },
      state.host,
    ),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.attemptedWrites, 0, "already blocked destination cannot be copied over");
  assert.deepEqual(state.manifest, before);
});

test("Visibility rename copy: CAS race adding same-token new-ID owner fails closed", async () => {
  const old = entry("event", "event-old", "incoming");
  const racedNew = { ...entry("event", "event-new", "incoming"),
    blocked_at: 15, reason: "racing-same-token-owner" };
  const state = hostOf(manifestOf(old), (manifest) => ({
    ...manifest, entities: [...manifest.entities, racedNew],
  }));
  await assert.rejects(
    preCommitEventVisibilityFenceRename(
      { oldEventId: "event-old", newEventId: "event-new", fenceToken: "incoming" },
      state.host,
    ),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.callbacks, 1, "the ETag retry must inspect target ownership");
  assert.equal(state.appliedWrites, 0, "the previously claimed target remains untouched");
  assert.deepEqual(state.manifest.entities, [old, racedNew]);
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
      fenceToken: "incoming", previousOldEntry: null, writtenNewEntry: ownNew }, state.host,
  );
  assert.equal(state.appliedWrites, 0);
  assert.deepEqual(state.manifest, before);
});

test("Visibility rename copy compensation: same-token new-ID metadata updates survive D1 rollback", async () => {
  for (const oldEntry of [entry("event", "event-old", "incoming"), null]) {
    const state = hostOf(oldEntry ? manifestOf(oldEntry) : manifestOf());
    const precommit = await preCommitEventVisibilityFenceRename({
      oldEventId: "event-old", newEventId: "event-new", fenceToken: "incoming",
    }, state.host);
    const { manifest, etag } = await state.host.manifest.read();
    const refreshed = { ...precommit.writtenNewEntry,
      blocked_at: precommit.writtenNewEntry.blocked_at + 37,
      reason: "new-owner-refresh",
    };
    await state.host.manifest.write({
      ...manifest,
      entities: manifest.entities.map((row) =>
        row.entity_type === "event" && row.entity_id === "event-new" ? refreshed : row),
    }, { ifMatchEtag: etag });
    const beforeRollback = structuredClone(state.manifest);
    const writesBefore = state.appliedWrites;
    await compensateEventVisibilityFenceRenameOnD1Failure(precommit, state.host);
    assert.equal(state.appliedWrites, writesBefore,
      "do not remove another same-token writer's updated new-ID fence");
    assert.deepEqual(state.manifest, beforeRollback);
  }
});

test("Visibility rename copy compensation: post-PUT same-token refresh is not the CAS rollback lease", async () => {
  const oldEntry = entry("event", "event-old", "incoming");
  const state = hostOf(manifestOf(oldEntry), null, (manifest) => ({
    ...manifest,
    entities: manifest.entities.map((row) =>
      row.entity_type === "event" && row.entity_id === "event-new"
        ? { ...row, blocked_at: row.blocked_at + 42, reason: "after-write-refresh" }
        : row),
  }));
  const precommit = await preCommitEventVisibilityFenceRename({
    oldEventId: "event-old", newEventId: "event-new", fenceToken: "incoming",
  }, state.host);
  const newRow = state.manifest.entities.find((row) => row.entity_id === "event-new");
  assert.equal(precommit.writtenNewEntry.reason, null,
    "precommit records the actual CAS candidate, not the later confirmation value");
  assert.equal(newRow.reason, "after-write-refresh");
  const beforeRollback = structuredClone(state.manifest);
  const writesBefore = state.appliedWrites;
  await compensateEventVisibilityFenceRenameOnD1Failure(precommit, state.host);
  assert.equal(state.appliedWrites, writesBefore);
  assert.deepEqual(state.manifest, beforeRollback);
});

test("Visibility tombstone compensation: a duplicate foreign old-ID token cannot be removed", async () => {
  const own = entry("event", "event-old", "incoming");
  const foreign = entry("event", "event-old", "other-writer");
  const state = hostOf(manifestOf(own, foreign));
  const before = structuredClone(state.manifest);
  await compensateEventVisibilityRenameTombstoneOnD1Failure(
    { eventId: "event-old", fenceToken: "incoming", previousEntry: null,
      writtenEntry: own }, state.host,
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

test("Visibility rename copy: CAS retry carries latest same-token old-ID metadata into rollback", async () => {
  const stale = { ...entry("event", "event-old", "incoming"), blocked_at: 20, reason: "stale" };
  const latest = { ...stale, blocked_at: 55, reason: "latest-owner-state" };
  const state = hostOf(manifestOf(stale), (manifest) => ({
    ...manifest, entities: [latest],
  }));
  const prior = await preCommitEventVisibilityFenceRename(
    { oldEventId: "event-old", newEventId: "event-new", fenceToken: "incoming" },
    state.host,
  );
  assert.equal(state.callbacks, 1, "read/PUT race must run the CAS conflict callback");
  assert.deepEqual(prior.previousOldEntry, latest, "rollback must remember the state actually replaced");
  await compensateEventVisibilityFenceRenameOnD1Failure(prior, state.host);
  assert.deepEqual(state.manifest.entities, [latest], "rollback must not resurrect stale old-ID metadata");
});

test("Visibility rename compensation: a live same-token old-ID update survives rollback", async () => {
  const stale = { ...entry("event", "event-old", "incoming"), blocked_at: 20, reason: "stale" };
  const current = { ...stale, blocked_at: 75, reason: "updated-after-copy" };
  const state = hostOf(manifestOf(stale), null, (latest) => ({
    ...latest,
    entities: latest.entities.map((item) =>
      item.entity_type === "event" && item.entity_id === "event-old" ? current : item),
  }));
  const precommit = await preCommitEventVisibilityFenceRename({
    oldEventId: "event-old", newEventId: "event-new", fenceToken: "incoming",
  }, state.host);
  assert.deepEqual(precommit.previousOldEntry, stale,
    "the first CAS did not race, so the precommit remembers the initial metadata");
  assert.deepEqual(state.manifest.entities.find(x => x.entity_id === "event-old"), current,
    "another same-owner update may arrive before confirmation");
  await compensateEventVisibilityFenceRenameOnD1Failure(precommit, state.host);
  assert.deepEqual(state.manifest.entities, [current],
    "compensation must remove only the new-ID copy, not clobber current old-ID metadata");
});

test("Visibility rename copy: same-token old-ID inserted during CAS becomes expected tombstone owner", async () => {
  const latest = { ...entry("event", "event-old", "incoming"), blocked_at: 66 };
  const state = hostOf(manifestOf(), (manifest) => ({
    ...manifest, entities: [latest],
  }));
  const prior = await preCommitEventVisibilityFenceRename(
    { oldEventId: "event-old", newEventId: "event-new", fenceToken: "incoming" },
    state.host,
  );
  assert.equal(state.callbacks, 1);
  assert.deepEqual(prior.previousOldEntry, latest, "same-owner race must not be recorded as absent");
  const tombstone = await preCommitEventVisibilityRenameTombstone({
    eventId: "event-old", fenceToken: "rotated",
    expectedPreviousFenceToken: prior.previousOldEntry?.fence_token ?? null,
  }, state.host);
  assert.deepEqual(tombstone.previousEntry, latest);
  assert.equal(state.manifest.entities.find(x => x.entity_id === "event-old").fence_token, "rotated");
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
        writtenNewEntry: ownNew,
      },
      state.host,
    );
    assert.equal(state.appliedWrites, 0, "must not replace a later writer's old-ID fence");
    assert.equal(state.attemptedWrites, 0, "must fail closed without attempting R2 PUT");
    assert.deepEqual(state.manifest, before, "both old and new visibility blocks stay intact");
  }
});

test("Visibility tombstone: CAS retry restores latest same-token metadata after D1 rollback", async () => {
  const stale = { ...entry("event", "event-old", "trusted"), blocked_at: 30, reason: "stale" };
  const latest = { ...stale, blocked_at: 80, reason: "updated-during-race" };
  const state = hostOf(manifestOf(stale), (manifest) => ({
    ...manifest, entities: [latest],
  }));
  const precommit = await preCommitEventVisibilityRenameTombstone({
    eventId: "event-old", fenceToken: "rotated",
    expectedPreviousFenceToken: "trusted",
  }, state.host);
  assert.equal(state.callbacks, 1);
  assert.deepEqual(precommit.previousEntry, latest, "compensation must restore the CAS snapshot");
  await compensateEventVisibilityRenameTombstoneOnD1Failure(precommit, state.host);
  assert.deepEqual(state.manifest.entities, [latest], "D1 failure restores latest old-ID ownership metadata");
});

test("Visibility tombstone compensation: same-token R2 metadata refresh survives D1 rollback", async () => {
  for (const previousEntry of [
    { ...entry("event", "event-old", "previous"), blocked_at: 30, reason: "prior" },
    null,
  ]) {
    const state = hostOf(previousEntry ? manifestOf(previousEntry) : manifestOf());
    const precommit = await preCommitEventVisibilityRenameTombstone({
      eventId: "event-old", fenceToken: "rotated",
      expectedPreviousFenceToken: previousEntry?.fence_token ?? null,
    }, state.host);
    assert.deepEqual(precommit.previousEntry, previousEntry);
    const { manifest, etag } = await state.host.manifest.read();
    const updated = {
      ...precommit.writtenEntry, blocked_at: precommit.writtenEntry.blocked_at + 15,
      reason: "newer-same-token-block",
    };
    await state.host.manifest.write({
      ...manifest,
      entities: manifest.entities.map((row) =>
        row.entity_type === "event" && row.entity_id === "event-old" ? updated : row),
    }, { ifMatchEtag: etag });
    const beforeRollback = structuredClone(state.manifest);
    const appliedBefore = state.appliedWrites;
    await compensateEventVisibilityRenameTombstoneOnD1Failure(precommit, state.host);
    assert.equal(state.appliedWrites, appliedBefore,
      "rollback must not restore a stale previous entry or erase a refreshed same-token block");
    assert.deepEqual(state.manifest, beforeRollback);
    assert.deepEqual(state.manifest.entities, [updated]);
  }
});

test("Visibility tombstone compensation: post-PUT same-owner refresh is not our rollback lease", async () => {
  const previous = { ...entry("event", "event-old", "prior-token"), blocked_at: 11, reason: "before" };
  const updated = { ...entry("event", "event-old", "rotated"), blocked_at: 222, reason: "after-own-put" };
  const state = hostOf(manifestOf(previous), null, (manifest) => ({
    ...manifest,
    entities: manifest.entities.map((row) =>
      row.entity_type === "event" && row.entity_id === "event-old" ? updated : row),
  }));
  const precommit = await preCommitEventVisibilityRenameTombstone({
    eventId: "event-old", fenceToken: "rotated",
    expectedPreviousFenceToken: "prior-token",
  }, state.host);
  assert.deepEqual(precommit.previousEntry, previous);
  assert.equal(precommit.writtenEntry.blocked_at, 11,
    "the rollback lease must come from the actual CAS PUT, not a later readback");
  assert.deepEqual(state.manifest.entities, [updated],
    "a same-token writer updated metadata after PUT but before confirmation");
  const applied = state.appliedWrites;
  await compensateEventVisibilityRenameTombstoneOnD1Failure(precommit, state.host);
  assert.equal(state.appliedWrites, applied,
    "a stale compensation must not overwrite metadata refreshed after our PUT");
  assert.deepEqual(state.manifest.entities, [updated]);
});

test("Visibility tombstone compensation: original snapshot still rolls back safely", async () => {
  for (const previousEntry of [entry("event", "event-old", "previous"), null]) {
    const state = hostOf(previousEntry ? manifestOf(previousEntry) : manifestOf());
    const precommit = await preCommitEventVisibilityRenameTombstone({
      eventId: "event-old", fenceToken: "rotated",
      expectedPreviousFenceToken: previousEntry?.fence_token ?? null,
    }, state.host);
    assert.equal(state.appliedWrites, 1);
    await compensateEventVisibilityRenameTombstoneOnD1Failure(precommit, state.host);
    assert.equal(state.appliedWrites, 2, "the unchanged own tombstone must still be reversible");
    assert.deepEqual(state.manifest.entities, previousEntry ? [previousEntry] : []);
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
      { eventId: "event-old", fenceToken: "rotated", expectedPreviousFenceToken: "existing-owner" }, state.host,
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
      { eventId: "event-old", fenceToken: "rotated", expectedPreviousFenceToken: "original" }, state.host,
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
      { eventId: "event-old", fenceToken: "rotated", expectedPreviousFenceToken: "original" }, state.host,
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
    { eventId: "event-old", fenceToken: "rotated", expectedPreviousFenceToken: "previous" }, state.host,
  );
  assert.equal(state.appliedWrites, 1);
  assert.deepEqual(precommit.previousEntry, prior);
  const rotated = state.manifest.entities.find((x) => x.entity_id === "event-old");
  assert.equal(rotated.fence_token, "rotated");
  assert.equal(rotated.blocked_at, 55);
  assert.equal(rotated.reason, "preserve");
  assert.deepEqual(state.manifest.entities.find((x) => x.entity_id === "video-safe"), video);
});

test("Visibility tombstone: omitted owner expectation rejects direct JS calls before R2 PUT", async () => {
  for (const before of [manifestOf(), manifestOf(entry("event", "event-old", "unobserved"))]) {
    const state = hostOf(before);
    await assert.rejects(
      preCommitEventVisibilityRenameTombstone(
        { eventId: "event-old", fenceToken: "rotated" }, state.host,
      ),
      /public_visibility_fence_token_mismatch/,
      "even JS callers must explicitly declare the observed old-ID owner",
    );
    assert.equal(state.reads, 1);
    assert.equal(state.attemptedWrites, 0);
    assert.deepEqual(state.manifest, before);
  }
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

test("Visibility tombstone: absent old-ID expected owner rejects a new CAS contender", async () => {
  const foreign = entry("event", "event-old", "racing-foreign-owner");
  const unrelated = entry("video", "video-safe", "other-video-owner");
  const state = hostOf(manifestOf(unrelated), (latest) => ({
    ...latest, entities: [...latest.entities, foreign],
  }));
  await assert.rejects(
    preCommitEventVisibilityRenameTombstone({
      eventId: "event-old", fenceToken: "rotated", expectedPreviousFenceToken: null,
    }, state.host),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.callbacks, 1, "the ETag conflict must inspect the newly inserted owner");
  assert.equal(state.appliedWrites, 0, "the rotation cannot overwrite a raced block");
  assert.deepEqual(state.manifest.entities, [unrelated, foreign]);
});

test("Visibility tombstone: post-PUT single foreign owner invalidates explicit rotation", async () => {
  const trusted = entry("event", "event-old", "trusted-owner");
  const foreign = entry("event", "event-old", "post-put-owner");
  const state = hostOf(manifestOf(trusted), null, (latest) => ({
    ...latest, entities: [foreign],
  }));
  await assert.rejects(
    preCommitEventVisibilityRenameTombstone({
      eventId: "event-old", fenceToken: "rotated",
      expectedPreviousFenceToken: "trusted-owner",
    }, state.host),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(state.appliedWrites, 1);
  assert.equal(state.reads, 2, "post-write readback must reject a replaced owner");
  assert.deepEqual(state.manifest.entities, [foreign], "never remove a concurrent block");
});

// The WHERE condition runs atomically inside the canonical D1 batch. Ensure
// a conflicting writer contributes zero changes and triggers the expected
// row-count guard, rather than letting the earlier R2 owner overwrite it.
test("Issue #659: D1 fence CAS rejects raced row deletion, token/state changes and insertion", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  for (const scenario of [
    { name: "same observed token/state", old: ["vf_old", "blocked"], current: ["vf_old", "blocked"], expected: 1 },
    { name: "another owner changed token", old: ["vf_old", "blocked"], current: ["vf_new", "blocked"], expected: 0 },
    { name: "same token advanced state", old: ["vf_old", "blocked"], current: ["vf_old", "release_pending"], expected: 0 },
    { name: "released token still current", old: ["vf_old", "released"], current: ["vf_old", "released"], expected: 1 },
    { name: "row deleted after planning read", old: ["vf_old", "blocked"], current: null, expected: 0 },
    { name: "new row with no concurrent claimant", old: null, current: null, expected: 1 },
    { name: "concurrent row after empty read", old: null, current: ["vf_new", "blocked"], expected: 0 },
  ]) {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec("CREATE TABLE public_visibility_fences (entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, fence_token TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(entity_type,entity_id))");
      if (scenario.current) {
        sqlite.prepare("INSERT INTO public_visibility_fences VALUES ('event','event-one',?,?)").run(...scenario.current);
      }
      const sql = scenario.old === null
        ? "INSERT INTO public_visibility_fences VALUES ('event','event-one','vf_incoming','blocked') ON CONFLICT DO NOTHING"
        : "UPDATE public_visibility_fences SET fence_token='vf_incoming',state='blocked' WHERE entity_type='event' AND entity_id='event-one' AND fence_token = ? AND state = ?";
      const result = scenario.old === null
        ? sqlite.prepare(sql).run()
        : sqlite.prepare(sql).run(...scenario.old);
      assert.equal(Number(result.changes), scenario.expected, scenario.name);
      const row = sqlite.prepare("SELECT fence_token,state FROM public_visibility_fences WHERE entity_type='event' AND entity_id='event-one'").get();
      assert.equal(row?.fence_token ?? null,
        scenario.expected ? "vf_incoming" : scenario.current?.[0] ?? null, scenario.name);
    } finally {
      sqlite.close();
    }
  }
});
