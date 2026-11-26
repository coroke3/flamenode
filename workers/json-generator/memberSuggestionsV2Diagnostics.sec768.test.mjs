import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import {
  buildMemberSuggestionsV2Artifacts,
  MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY as MANIFEST,
} from "../../src/lib/video/memberSuggestionsPostingsV2.ts";
import { publishMemberSuggestionsV2BestEffort } from "./memberSuggestionsV2Artifacts.ts";

const items = [{
  x_user_id: "alice", name: "Alice", xAliases: [], nameAliases: [],
  occurrenceCount: 1, lastSeenAt: null, approvalStatus: "approved",
}];

function makeError() {
  const error = new Error("SEC768_SECRET_PROVIDER_CAUSE", {
    cause: new Error("SEC768_SECRET_PROVIDER_NESTED_CAUSE"),
  });
  let reads = 0;
  Object.defineProperty(error, "name", {
    get() {
      reads++;
      throw new Error("SEC768_POISONED_PROVIDER_NAME");
    },
  });
  return { error, nameReads: () => reads };
}

function bucketWithFaults({ previous = null, failPut = false, failManifestDelete = false,
  failObjectDelete = false, failList = false, truncateList = false } = {}) {
  const objects = new Map();
  if (previous) {
    objects.set(MANIFEST, buildMemberSuggestionsV2Artifacts({
      items, generatedAt: 100, generation: previous,
    }).manifest);
  }
  const poison = makeError();
  let manifestDeletes = 0;
  let generationPuts = 0;
  let generationDeletes = 0;
  const bucket = {
    async get(key) {
      if (!objects.has(key)) return null;
      const value = objects.get(key);
      const json = JSON.stringify(value);
      return { size: Buffer.byteLength(json), text: async () => json,
        json: async () => structuredClone(value) };
    },
    async put(key, body) {
      if (key !== MANIFEST && failPut && ++generationPuts === 2) throw poison.error;
      objects.set(key, JSON.parse(String(body)));
    },
    async delete(keys) {
      const all = Array.isArray(keys) ? keys : [keys];
      if (all.includes(MANIFEST)) {
        manifestDeletes++;
        // The initial manifest invalidation is allowed. Failure occurs
        // during the attempted recovery delete, after an R2 PUT failure.
        if (failManifestDelete && manifestDeletes > 1) throw poison.error;
      } else {
        generationDeletes += all.length;
        if (failObjectDelete) throw poison.error;
      }
      for (const key of all) objects.delete(key);
    },
    async list({ prefix }) {
      if (failList) throw poison.error;
      return {
        objects: [...objects.keys()].filter((k) => k.startsWith(prefix))
          .map((key) => ({ key })),
        truncated: truncateList,
      };
    },
  };
  return { bucket, objects, poison, count: () =>
    ({ manifestDeletes, generationPuts, generationDeletes }) };
}

async function withThrowingWarn(fn) {
  const previous = console.warn;
  const logged = [];
  console.warn = (line) => {
    logged.push(String(line));
    throw new Error("SEC768_THROWING_DIAGNOSTIC_SINK");
  };
  try { return { result: await fn(), logged }; }
  finally { console.warn = previous; }
}

test("SEC-768: a V2 post-commit cleanup failure cannot delete the new manifest", async () => {
  const h = bucketWithFaults({ previous: "older", failList: true });
  const { result, logged } = await withThrowingWarn(() =>
    publishMemberSuggestionsV2BestEffort({
      bucket: h.bucket, items, generatedAt: 200, generation: "newer",
    }));
  assert.equal(result.published, true);
  assert.equal(h.objects.get(MANIFEST)?.generation, "newer");
  assert.equal(h.count().manifestDeletes, 1, "only initial invalidation; no rollback after commit");
  assert.deepEqual(logged.map((s) => JSON.parse(s).result), [
    "previous_generation_cleanup_failed",
  ]);
  assert.equal(h.poison.nameReads(), 0);
  assert.doesNotMatch(logged.join(" "), /SEC768_SECRET_PROVIDER|SEC768_POISONED_PROVIDER_NAME/);
});

test("SEC-768: truncated old-generation list is diagnostic only, even with broken logger", async () => {
  const h = bucketWithFaults({ previous: "older", truncateList: true });
  const { result, logged } = await withThrowingWarn(() =>
    publishMemberSuggestionsV2BestEffort({
      bucket: h.bucket, items, generatedAt: 200, generation: "newer",
    }));
  assert.equal(result.published, true);
  assert.equal(h.objects.get(MANIFEST)?.generation, "newer");
  assert.equal(JSON.parse(logged[0]).result, "previous_generation_cleanup_truncated");
  assert.equal(h.count().manifestDeletes, 1);
});

test("SEC-768: failed V2 manifest recovery preserves potentially live immutable keys", async () => {
  const h = bucketWithFaults({ failPut: true, failManifestDelete: true });
  const { result, logged } = await withThrowingWarn(() =>
    publishMemberSuggestionsV2BestEffort({
      bucket: h.bucket, items, generatedAt: 200, generation: "failed",
    }));
  assert.equal(result.published, false);
  assert.equal(result.reason, "publish_failed");
  assert.equal(h.count().generationDeletes, 0,
    "an uncertain manifest must not trigger immutable-key deletion");
  assert.ok(h.count().generationPuts >= 2);
  assert.deepEqual(logged.map((s) => JSON.parse(s).result), [
    "manifest_cleanup_failed", "v1_fallback",
  ]);
  assert.equal(h.poison.nameReads(), 0);
  assert.doesNotMatch(JSON.stringify(result) + logged.join(" "),
    /SEC768_SECRET_PROVIDER|SEC768_POISONED_PROVIDER_NAME/);
});

test("SEC-768: failed orphan cleanup remains best effort under a throwing logger", async () => {
  const h = bucketWithFaults({ failPut: true, failObjectDelete: true });
  const { result, logged } = await withThrowingWarn(() =>
    publishMemberSuggestionsV2BestEffort({
      bucket: h.bucket, items, generatedAt: 200, generation: "failed",
    }));
  assert.equal(result.published, false);
  assert.equal(result.reason, "publish_failed");
  assert.deepEqual(logged.map((s) => JSON.parse(s).result), [
    "orphan_cleanup_failed", "v1_fallback",
  ]);
  assert.equal(h.poison.nameReads(), 0);
});

test("SEC-768: actual V1 catch continues after V2 rejection and poisoned logger", async () => {
  const source = readFileSync(new URL("./memberSuggestionsArtifacts.ts", import.meta.url), "utf8");
  const start = source.indexOf("  try {\n    await publishMemberSuggestionsV2BestEffort({");
  const stop = source.indexOf("\n  const liveKeys =", start);
  assert.ok(start >= 0 && stop > start, "extract real V1 caller boundary");
  const slice = source.slice(start, stop);
  assert.doesNotMatch(slice, /error_name|error\.name|error\.message|String\(error\)/);
  const poison = makeError();
  const logs = [];
  const outcome = await runInNewContext(
    "(async () => {" + slice + " return 'v1_can_reconcile'; })()",
    {
      env: { R2: {} }, items: [], generatedAt: 123, generation: "v1",
      signal: undefined,
      publishMemberSuggestionsV2BestEffort: async () => { throw poison.error; },
      console: { warn: (line) => {
        logs.push(String(line)); throw new Error("broken logger");
      } },
    },
  );
  assert.equal(outcome, "v1_can_reconcile");
  assert.equal(JSON.parse(logs[0]).result, "v1_fallback_publish_error");
  assert.equal(poison.nameReads(), 0);
  assert.doesNotMatch(logs.join(" "), /SEC768_SECRET_PROVIDER|SEC768_POISONED_PROVIDER_NAME/);
});
