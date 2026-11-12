import assert from "node:assert/strict";
import { test } from "node:test";
import { preCommitEventVisibilityTransition } from "@flamenode/server-core/visibility/eventTransition";

// Exercise the actual shared core imported by both CURRENT Next and TARGET Hono.
// The fake manifest host models R2 conditional PUT and mutateOnConflict retries.
const entry = (entity_type, entity_id, fence_token) => ({
  entity_type, entity_id, fence_token, blocked_at: 100, reason: null,
});
const manifestOf = (...entities) => ({
  schema_version: 1, revision: 1, generated_at: 100, entities,
});
function hostOf(initial, race = null) {
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
