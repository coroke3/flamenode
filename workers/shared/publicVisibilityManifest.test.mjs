import assert from "node:assert/strict";
import test from "node:test";
import {
  writeWorkerVisibilityBlockedEntitiesManifest,
} from "./publicVisibilityManifest.ts";

const manifest = {
  schema_version: 1,
  revision: 1,
  generated_at: 100,
  entities: [],
};

test("conditional manifest PUT treats R2 null as a CAS failure", async () => {
  let calls = 0;
  const bucket = {
    async put() {
      calls += 1;
      return null;
    },
  };

  await assert.rejects(
    () =>
      writeWorkerVisibilityBlockedEntitiesManifest(
        bucket,
        manifest,
        "etag-1",
      ),
    /public_visibility_manifest_precondition_failed/,
  );
  assert.equal(calls, 3);
});

test("manifest PUT succeeds when R2 returns an object result", async () => {
  let calls = 0;
  const bucket = {
    async put() {
      calls += 1;
      return {};
    },
  };

  await writeWorkerVisibilityBlockedEntitiesManifest(bucket, manifest, null);
  assert.equal(calls, 1);
});
