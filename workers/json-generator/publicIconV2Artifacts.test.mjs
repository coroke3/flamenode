import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY,
  PUBLIC_X_ICON_V2_MAX_MANIFEST_BYTES,
  normalizePublicXIconV2Manifest,
  publicXIconV2ShardObjectKey,
} from "../../src/lib/publicData/publicIconProjectionV2.ts";
import {
  PUBLIC_X_ICON_MAP_MAX_OBJECT_BYTES,
  PUBLIC_X_ICON_MAP_OBJECT_KEY,
} from "../../src/lib/publicData/publicIconProjection.ts";
import { rebuildPublicIconV2FromLegacyArtifact } from "./publicIconV2Artifacts.ts";

function jsonObject(value) {
  const body = structuredClone(value);
  const serialized = JSON.stringify(body);
  return {
    size: new TextEncoder().encode(serialized).byteLength,
    async json() {
      return structuredClone(body);
    },
  };
}

function legacyPayload() {
  return {
    schema_version: 1,
    generated_at: 123,
    entries: {
      alpha: { icon_url: null, source: "none" },
      beta: {
        icon_url: "https://example.com/beta.png",
        source: "registered",
      },
    },
  };
}

test("partial V2 publish failure leaves a valid empty manifest that forces V1 fallback", async () => {
  const objects = new Map([[PUBLIC_X_ICON_MAP_OBJECT_KEY, legacyPayload()]]);
  let generationShardPuts = 0;

  const bucket = {
    async get(key) {
      const value = objects.get(key);
      return value === undefined ? null : jsonObject(value);
    },
    async head(key) {
      return objects.has(key) ? {} : null;
    },
    async put(key, body) {
      const parsed = JSON.parse(String(body));
      if (key !== PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY) {
        generationShardPuts += 1;
        if (generationShardPuts === 2) {
          throw new Error("injected_r2_failure");
        }
      }
      objects.set(key, parsed);
      return {};
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
  };

  await assert.rejects(
    rebuildPublicIconV2FromLegacyArtifact({ R2: bucket }),
    /injected_r2_failure/,
  );

  const manifest = normalizePublicXIconV2Manifest(
    objects.get(PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY),
  );
  assert.ok(manifest);
  assert.deepEqual(manifest.shards, []);
  assert.equal(manifest.generated_at, 123);
});

test("ambiguous real-manifest PUT failure never deletes possibly referenced shards", async () => {
  const objects = new Map([[PUBLIC_X_ICON_MAP_OBJECT_KEY, legacyPayload()]]);
  let manifestPuts = 0;
  let shardDeleteAttempted = false;

  const bucket = {
    async get(key) {
      const value = objects.get(key);
      return value === undefined ? null : jsonObject(value);
    },
    async head(key) {
      return objects.has(key) ? {} : null;
    },
    async put(key, body) {
      const parsed = JSON.parse(String(body));
      if (key === PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY) {
        manifestPuts += 1;
        if (manifestPuts === 1) {
          objects.set(key, parsed);
          return {};
        }
        if (manifestPuts === 2) {
          // R2側ではcommit済みだがclientにはtransport errorとして見える境界。
          objects.set(key, parsed);
          throw new Error("ambiguous_manifest_commit");
        }
        // fallback restoreも失敗し、実manifestが残っている可能性を再現する。
        throw new Error("fallback_restore_failed");
      }
      objects.set(key, parsed);
      return {};
    },
    async delete(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      if (list.includes(PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY)) {
        throw new Error("manifest_delete_failed");
      }
      if (list.length > 0) shardDeleteAttempted = true;
      for (const key of list) objects.delete(key);
    },
  };

  await assert.rejects(
    rebuildPublicIconV2FromLegacyArtifact({ R2: bucket }),
    /ambiguous_manifest_commit/,
  );

  const manifest = normalizePublicXIconV2Manifest(
    objects.get(PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY),
  );
  assert.ok(manifest);
  assert.ok(manifest.shards.length > 0);
  assert.equal(shardDeleteAttempted, false);
  for (const shard of manifest.shards) {
    assert.ok(
      objects.has(publicXIconV2ShardObjectKey(manifest.generation, shard)),
      `manifest referenced shard ${shard} must be preserved`,
    );
  }
});

test("oversized canonical V1 icon map is rejected before JSON parse", async () => {
  let parsed = false;
  const bucket = {
    async get(key) {
      if (key !== PUBLIC_X_ICON_MAP_OBJECT_KEY) return null;
      return {
        size: PUBLIC_X_ICON_MAP_MAX_OBJECT_BYTES + 1,
        async json() {
          parsed = true;
          return legacyPayload();
        },
      };
    },
  };

  await assert.rejects(
    rebuildPublicIconV2FromLegacyArtifact({ R2: bucket }),
    /public_icon_v2_v1_too_large/,
  );
  assert.equal(parsed, false);
});

test("oversized current V2 manifest is ignored before JSON parse", async () => {
  let parsed = false;
  const legacy = legacyPayload();
  const bucket = {
    async get(key) {
      if (key === PUBLIC_X_ICON_MAP_OBJECT_KEY) return jsonObject(legacy);
      if (key === PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY) {
        return {
          size: PUBLIC_X_ICON_V2_MAX_MANIFEST_BYTES + 1,
          async json() {
            parsed = true;
            return {};
          },
        };
      }
      return null;
    },
    async head() {
      return null;
    },
    async put() {
      return {};
    },
    async delete() {},
  };

  await rebuildPublicIconV2FromLegacyArtifact({ R2: bucket });
  assert.equal(parsed, false);
});
