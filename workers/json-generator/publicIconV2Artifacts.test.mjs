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

function persistentBucket() {
  const objects = new Map([[PUBLIC_X_ICON_MAP_OBJECT_KEY, legacyPayload()]]);
  const metadata = new Map();
  let shardPuts = 0;
  const bucket = {
    async get(key) {
      const value = objects.get(key);
      return value === undefined ? null : jsonObject(value);
    },
    async head(key) {
      const value = objects.get(key);
      if (value === undefined) return null;
      const serialized = JSON.stringify(value);
      return {
        size: new TextEncoder().encode(serialized).byteLength,
        customMetadata: metadata.get(key) ?? {},
      };
    },
    async put(key, body, options = {}) {
      const parsed = JSON.parse(String(body));
      objects.set(key, parsed);
      metadata.set(key, structuredClone(options.customMetadata ?? {}));
      if (key !== PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY) shardPuts += 1;
      return {};
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        objects.delete(key);
        metadata.delete(key);
      }
    },
  };
  return {
    bucket,
    objects,
    metadata,
    getShardPuts: () => shardPuts,
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
          objects.set(key, parsed);
          throw new Error("ambiguous_manifest_commit");
        }
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

test("same generation is skipped only when every shard has matching metadata", async () => {
  const state = persistentBucket();
  const first = await rebuildPublicIconV2FromLegacyArtifact({ R2: state.bucket });
  assert.equal(first.skipped, false);
  const putsAfterFirst = state.getShardPuts();
  assert.ok(putsAfterFirst > 0);

  const second = await rebuildPublicIconV2FromLegacyArtifact({ R2: state.bucket });
  assert.equal(second.skipped, true);
  assert.equal(state.getShardPuts(), putsAfterFirst);

  const manifest = normalizePublicXIconV2Manifest(
    state.objects.get(PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY),
  );
  assert.ok(manifest && manifest.shards.length > 0);
  const damagedKey = publicXIconV2ShardObjectKey(
    manifest.generation,
    manifest.shards[0],
  );
  state.metadata.set(damagedKey, {});

  const repaired = await rebuildPublicIconV2FromLegacyArtifact({ R2: state.bucket });
  assert.equal(repaired.skipped, false);
  assert.ok(state.getShardPuts() > putsAfterFirst);
  const repairedMetadata = state.metadata.get(damagedKey);
  assert.equal(repairedMetadata?.flamenode_schema, "public-icon-v2");
  assert.equal(repairedMetadata?.flamenode_generation, manifest.generation);
  assert.equal(
    repairedMetadata?.flamenode_shard,
    String(manifest.shards[0]),
  );
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

async function withBrokenWarnSink(action) {
  const originalWarn = console.warn;
  const attempted = [];
  console.warn = (line) => {
    attempted.push(JSON.parse(line));
    throw new Error("SEC759_DIAGNOSTIC_SINK_SECRET");
  };
  try {
    const value = await action();
    return { value, attempted };
  } finally {
    console.warn = originalWarn;
  }
}

function poisonedR2Failure() {
  const error = new Error("SEC759_R2_PROVIDER_SECRET");
  Object.defineProperty(error, "name", {
    get() { throw new Error("SEC759_THROWING_ERROR_NAME"); },
  });
  return error;
}

test("SEC-759: a broken fallback-restore log sink does not skip manifest withdrawal and shard cleanup", async () => {
  const state = persistentBucket();
  const providerError = poisonedR2Failure();
  const put = state.bucket.put.bind(state.bucket);
  let manifestPuts = 0;
  state.bucket.put = async (key, body, options) => {
    if (key === PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY && ++manifestPuts >= 2) {
      throw providerError;
    }
    return put(key, body, options);
  };

  const { attempted } = await withBrokenWarnSink(async () => {
    await assert.rejects(
      () => rebuildPublicIconV2FromLegacyArtifact({ R2: state.bucket }),
      (error) => error === providerError,
    );
  });

  assert.equal(manifestPuts, 3, "initial fallback and failed commit/restore attempted");
  assert.equal(state.objects.has(PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY), false);
  assert.deepEqual([...state.objects.keys()], [PUBLIC_X_ICON_MAP_OBJECT_KEY],
    "unreferenced shards were cleaned up after manifest withdrawal");
  assert.equal(attempted.length, 1);
  assert.equal(attempted[0].service, "public-icon-v2");
  assert.equal(attempted[0].result, "fallback_manifest_restore_failed");
  assert.equal(typeof attempted[0].generation, "string");
  assert.ok(!JSON.stringify(attempted).includes("SEC759_R2_PROVIDER_SECRET"));
});

test("SEC-759: failed manifest withdrawal retains potentially referenced shards despite broken logger", async () => {
  const state = persistentBucket();
  const providerError = poisonedR2Failure();
  const put = state.bucket.put.bind(state.bucket);
  const remove = state.bucket.delete.bind(state.bucket);
  let manifestPuts = 0;
  let shardDeleteCalls = 0;
  state.bucket.put = async (key, body, options) => {
    if (key === PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY && ++manifestPuts >= 2) {
      throw providerError;
    }
    return put(key, body, options);
  };
  state.bucket.delete = async (keys) => {
    const list = Array.isArray(keys) ? keys : [keys];
    if (list.includes(PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY)) throw providerError;
    shardDeleteCalls += 1;
    return remove(keys);
  };

  const { attempted } = await withBrokenWarnSink(async () => {
    await assert.rejects(
      () => rebuildPublicIconV2FromLegacyArtifact({ R2: state.bucket }),
      (error) => error === providerError,
    );
  });

  assert.equal(manifestPuts, 3);
  assert.equal(shardDeleteCalls, 0, "uncertain manifest state must protect shards");
  assert.ok(state.objects.size > 2, "written shards are preserved");
  assert.deepEqual(attempted.map((event) => event.result), [
    "fallback_manifest_restore_failed", "manifest_cleanup_failed",
  ]);
  assert.ok(!JSON.stringify(attempted).includes("SEC759_R2_PROVIDER_SECRET"));
});

test("SEC-759: old-generation R2 cleanup failure cannot turn a committed new generation into an error", async () => {
  const state = persistentBucket();
  const first = await rebuildPublicIconV2FromLegacyArtifact({ R2: state.bucket });
  const original = state.objects.get(PUBLIC_X_ICON_MAP_OBJECT_KEY);
  const replacement = structuredClone(original);
  replacement.entries.alpha = {
    icon_url: "https://example.com/alpha.png",
    source: "registered",
  };
  state.objects.set(PUBLIC_X_ICON_MAP_OBJECT_KEY, replacement);

  const providerError = poisonedR2Failure();
  const remove = state.bucket.delete.bind(state.bucket);
  let oldDeleteCalls = 0;
  state.bucket.delete = async (keys) => {
    const list = Array.isArray(keys) ? keys : [keys];
    if (list.some((key) => key.includes(first.generation))) {
      oldDeleteCalls += 1;
      throw providerError;
    }
    return remove(keys);
  };
  const { value: result, attempted } = await withBrokenWarnSink(() =>
    rebuildPublicIconV2FromLegacyArtifact({ R2: state.bucket })
  );
  assert.equal(result.skipped, false);
  assert.notEqual(result.generation, first.generation);
  assert.equal(oldDeleteCalls, 1);
  const manifest = normalizePublicXIconV2Manifest(
    state.objects.get(PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY),
  );
  assert.equal(manifest?.generation, result.generation, "new manifest stays committed");
  for (const shard of manifest.shards) {
    assert.ok(state.objects.has(publicXIconV2ShardObjectKey(result.generation, shard)));
  }
  assert.deepEqual(attempted.map((event) => event.result), [
    "generation_cleanup_failed",
  ]);
  assert.ok(!JSON.stringify(attempted).includes("SEC759_R2_PROVIDER_SECRET"));
});
