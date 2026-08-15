import assert from "node:assert/strict";
import test from "node:test";
import {
  readWorkerVisibilityBlockedEntitiesManifest,
  writeWorkerVisibilityBlockedEntitiesManifest,
} from "./publicVisibilityManifest.ts";

const manifest = {
  schema_version: 1,
  revision: 1,
  generated_at: 100,
  entities: [],
};

test("worker manifest size guard uses UTF-8 bytes", async () => {
  const multibyteId = "é".repeat(525_000);
  const bucket = {
    async get() {
      return {
        text: async () =>
          JSON.stringify({
            schema_version: 1,
            revision: 1,
            generated_at: 100,
            entities: [
              {
                entity_type: "video",
                entity_id: multibyteId,
                fence_token: "token",
                blocked_at: 100,
              },
            ],
          }),
      };
    },
  };

  await assert.rejects(
    () => readWorkerVisibilityBlockedEntitiesManifest(bucket),
    /public_visibility_manifest_too_large/,
  );
});

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

test("concurrent first upserts merge both blocked entities after create CAS loss", async () => {
  let object = null;
  let version = 0;
  let firstCreateLost = true;
  const competitor = {
    entity_type: "video",
    entity_id: "video-b",
    fence_token: "token-b",
    blocked_at: 100,
  };
  const bucket = {
    async get() {
      if (!object) return null;
      return {
        etag: object.etag,
        text: async () => object.body,
      };
    },
    async put(_key, body, options) {
      const onlyIf = options?.onlyIf;
      const isCreate = onlyIf instanceof Headers
        ? onlyIf.get("if-none-match") === "*"
        : false;
      if (isCreate && firstCreateLost) {
        firstCreateLost = false;
        object = {
          etag: "competitor-etag",
          body: JSON.stringify({
            ...manifest,
            revision: 1,
            entities: [competitor],
          }),
        };
        return null;
      }
      if (onlyIf?.etagMatches && onlyIf.etagMatches !== object?.etag) {
        return null;
      }
      version += 1;
      object = { etag: `etag-${version}`, body: String(body) };
      return { etag: object.etag };
    },
  };

  await writeWorkerVisibilityBlockedEntitiesManifest(
    bucket,
    {
      ...manifest,
      entities: [
        {
          entity_type: "video",
          entity_id: "video-a",
          fence_token: "token-a",
          blocked_at: 100,
        },
      ],
    },
    null,
  );

  const saved = JSON.parse(object.body);
  assert.deepEqual(
    saved.entities.map((entry) => entry.entity_id).sort(),
    ["video-a", "video-b"],
  );
});
