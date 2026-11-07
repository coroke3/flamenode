import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventVisibilityFenceHost } from "../src/visibility/eventTransitionHost.ts";
import {
  preCommitEventVisibilityTransition,
  preCommitEventVisibilityFenceRename,
  preCommitEventVisibilityRenameTombstone,
} from "@flamenode/server-core/visibility/eventTransition";
import {
  PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
} from "@flamenode/server-core/visibility/manifestCore";

function manifest(entities = []) {
  return { schema_version: 1, revision: 1, generated_at: 100, entities };
}

function fakeR2(initial = null) {
  let saved = initial === null ? null : JSON.stringify(initial);
  let etag = saved ? "v1" : null;
  let version = 1;
  const calls = [];
  let rejectWrites = false;
  return {
    calls,
    get saved() { return saved === null ? null : JSON.parse(saved); },
    set rejectWrites(value) { rejectWrites = value; },
    async get(key) {
      assert.equal(key, PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY);
      calls.push({ op: "get", key });
      if (saved === null) return null;
      return { text: async () => saved, size: new TextEncoder().encode(saved).byteLength, etag };
    },
    async put(key, value, options) {
      assert.equal(key, PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY);
      calls.push({ op: "put", options });
      if (rejectWrites) return null;
      const onlyIf = options?.onlyIf;
      if (onlyIf instanceof Headers) {
        assert.equal(onlyIf.get("If-None-Match"), "*");
        if (saved !== null) return null;
      } else if (onlyIf?.etagMatches !== etag) {
        return null;
      }
      assert.equal(options?.httpMetadata?.cacheControl, "no-store");
      saved = value;
      etag = "v" + ++version;
      return { etag };
    },
  };
}

test("MIG-0652 U02 T01: absent BUCKET and unconditional writes fail closed", async () => {
  const host = createEventVisibilityFenceHost({});
  await assert.rejects(host.manifest.read(), /public_visibility_manifest_bucket_missing/);
  await assert.rejects(host.manifest.write(manifest(), { ifMatchEtag: null }), /public_visibility_manifest_bucket_missing/);
  const r2 = fakeR2();
  const safe = createEventVisibilityFenceHost({ BUCKET: r2 });
  await assert.rejects(safe.manifest.write(manifest()), /public_visibility_manifest_cas_required/);
  assert.equal(r2.calls.length, 0);
});

test("MIG-0652 U02 T02: first precommit creates a blocked event with create-if-absent CAS and verifies it", async () => {
  const r2 = fakeR2();
  const host = createEventVisibilityFenceHost({ BUCKET: r2 });
  await preCommitEventVisibilityTransition({ eventId: "old", fenceToken: "vf1", reason: "archive" }, host);
  assert.deepEqual(r2.calls.map(x => x.op), ["get", "put", "get"]);
  const put = r2.calls.find(x => x.op === "put");
  assert.ok(put.options.onlyIf instanceof Headers);
  assert.equal(put.options.onlyIf.get("If-None-Match"), "*");
  assert.equal(r2.saved.entities.length, 1);
  assert.deepEqual(r2.saved.entities[0], {
    entity_type: "event", entity_id: "old", fence_token: "vf1",
    blocked_at: r2.saved.entities[0].blocked_at, reason: "archive",
  });
});

test("MIG-0652 U02 T03: current manifest ETag is used; unrelated fences remain blocked", async () => {
  const other = { entity_type: "video", entity_id: "v1", fence_token: "vt1", blocked_at: 1 };
  const r2 = fakeR2(manifest([other]));
  const host = createEventVisibilityFenceHost({ BUCKET: r2 });
  await preCommitEventVisibilityTransition({ eventId: "event1", fenceToken: "et1" }, host);
  const put = r2.calls.find(x => x.op === "put");
  assert.equal(put.options.onlyIf.etagMatches, "v1");
  assert.equal(r2.saved.entities.length, 2);
  assert.ok(r2.saved.entities.some(x => x.entity_type === "video" && x.entity_id === "v1"));
  assert.ok(r2.saved.entities.some(x => x.entity_type === "event" && x.entity_id === "event1" && x.fence_token === "et1"));
});

test("MIG-0652 U02 T04: rename retains the old blocked URL until tombstone is persisted", async () => {
  const old = { entity_type: "event", entity_id: "old", fence_token: "vf2", blocked_at: 10 };
  const r2 = fakeR2(manifest([old]));
  const host = createEventVisibilityFenceHost({ BUCKET: r2 });
  const copied = await preCommitEventVisibilityFenceRename({
    oldEventId: "old", newEventId: "new", fenceToken: "vf2",
  }, host);
  assert.equal(copied.oldEventId, "old");
  assert.deepEqual(r2.saved.entities.filter(x => x.entity_type === "event").map(x=>x.entity_id).sort(), ["new", "old"]);
  await preCommitEventVisibilityRenameTombstone({
    eventId: "old", fenceToken: "vf2", reason: "event_id_rename_old_cleanup",
  }, host);
  assert.equal(r2.saved.entities.find(x=>x.entity_id==="old").fence_token, "vf2");
  await assert.rejects(preCommitEventVisibilityFenceRename({
    oldEventId: "old", newEventId: "another", fenceToken: "wrong",
  }, host), /public_visibility_fence_token_mismatch/);
  assert.equal(r2.saved.entities.find(x=>x.entity_id==="another"), undefined);
});

test("MIG-0652 U02 T05: malformed manifests abort before any R2 write", async () => {
  const r2 = fakeR2({ schema_version: 99, revision: 1, generated_at: 1, entities: [] });
  const host = createEventVisibilityFenceHost({ BUCKET: r2 });
  await assert.rejects(preCommitEventVisibilityTransition({
    eventId: "ev", fenceToken: "vf3",
  }, host), /public_visibility_manifest_malformed/);
  assert.deepEqual(r2.calls.map(x=>x.op), ["get"]);
});

test("MIG-0652 U02 T06: lost CAS fails closed without reporting a successful precommit", async () => {
  const r2 = fakeR2(manifest());
  r2.rejectWrites = true;
  const host = createEventVisibilityFenceHost({ BUCKET: r2 });
  await assert.rejects(preCommitEventVisibilityTransition({
    eventId: "event1", fenceToken: "vf4",
  }, host), /public_visibility_manifest_put_failed|public_visibility_manifest_precondition_failed/);
  assert.equal(r2.saved.entities.length, 0);
  assert.ok(r2.calls.some(x=>x.op === "put"));
});
