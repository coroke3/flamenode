import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicXIconV2Artifacts,
  normalizePublicXIconV2Manifest,
  normalizePublicXIconV2Shard,
  PUBLIC_X_ICON_V2_SHARD_COUNT,
  publicXIconV2GenerationMaterial,
  publicXIconV2ShardForXId,
  publicXIconV2ShardObjectKey,
} from "./publicIconProjectionV2.ts";

test("public icon v2 shard is deterministic and bounded to 16", () => {
  const first = publicXIconV2ShardForXId("@Mochi_Test");
  const second = publicXIconV2ShardForXId("mochi_test");
  assert.equal(first, second);
  assert.ok(first >= 0 && first < PUBLIC_X_ICON_V2_SHARD_COUNT);
  assert.equal(PUBLIC_X_ICON_V2_SHARD_COUNT, 16);
});

test("public icon v2 shard key rejects non-integer and non-finite values", () => {
  assert.throws(() => publicXIconV2ShardObjectKey("gen-1", Number.NaN));
  assert.throws(() => publicXIconV2ShardObjectKey("gen-1", Number.POSITIVE_INFINITY));
  assert.throws(() => publicXIconV2ShardObjectKey("gen-1", 1.5));
  assert.throws(() => publicXIconV2ShardObjectKey("gen-1", -1));
  assert.throws(() => publicXIconV2ShardObjectKey("gen-1", PUBLIC_X_ICON_V2_SHARD_COUNT));
});

test("public icon v2 generation material is independent of entry insertion order", () => {
  const a = {
    schema_version: 1,
    generated_at: 100,
    entries: {
      beta: { icon_url: "https://example.com/b.png", source: "registered" },
      alpha: { icon_url: null, source: "none" },
    },
  };
  const b = {
    schema_version: 1,
    generated_at: 200,
    entries: {
      alpha: { icon_url: null, source: "none" },
      beta: { icon_url: "https://example.com/b.png", source: "registered" },
    },
  };
  assert.equal(publicXIconV2GenerationMaterial(a), publicXIconV2GenerationMaterial(b));
});

test("public icon v2 artifacts keep source semantics and manifest commit metadata", () => {
  const payload = {
    schema_version: 1,
    generated_at: 123,
    entries: {
      alpha: { icon_url: null, source: "none" },
      beta: { icon_url: "https://example.com/b.png", source: "registered" },
      orphan: { icon_url: "https://example.com/o.png", source: "video" },
    },
  };
  const artifacts = buildPublicXIconV2Artifacts({
    payload,
    generation: "gen-1",
  });
  assert.equal(artifacts.manifest.schema_version, 2);
  assert.equal(artifacts.manifest.shard_count, 16);
  assert.equal(artifacts.manifest.generated_at, 123);
  assert.deepEqual(
    [...artifacts.manifest.shards].sort((a, b) => a - b),
    artifacts.manifest.shards,
  );

  const merged = Object.assign({}, ...artifacts.shards.map((shard) => shard.entries));
  assert.deepEqual(merged.alpha, payload.entries.alpha);
  assert.deepEqual(merged.beta, payload.entries.beta);
  assert.deepEqual(merged.orphan, payload.entries.orphan);
});

test("public icon v2 normalizers fail closed on generation/shard mismatch", () => {
  const manifest = normalizePublicXIconV2Manifest({
    schema_version: 2,
    generation: "gen-1",
    generated_at: 123,
    shard_count: 16,
    shards: [0, 2, 2],
  });
  assert.ok(manifest);
  assert.deepEqual(manifest.shards, [0, 2]);

  assert.equal(
    normalizePublicXIconV2Manifest({
      schema_version: 2,
      generation: "gen-1",
      generated_at: 123,
      shard_count: "16",
      shards: [0],
    }),
    null,
  );
  assert.equal(
    normalizePublicXIconV2Manifest({
      schema_version: 2,
      generation: "gen-1",
      generated_at: "123",
      shard_count: 16,
      shards: [0],
    }),
    null,
  );
  assert.equal(
    normalizePublicXIconV2Manifest({
      schema_version: 2,
      generation: "gen-1",
      generated_at: 123,
      shard_count: 16,
      shards: ["0"],
    }),
    null,
  );

  const xid = "alpha";
  const shard = publicXIconV2ShardForXId(xid);
  const key = publicXIconV2ShardObjectKey("gen-1", shard);
  assert.match(key, /users\/public-icons\/v2\/g\/gen-1\/[0-9a-f]{2}\.json$/);

  const valid = normalizePublicXIconV2Shard(
    {
      schema_version: 2,
      generation: "gen-1",
      generated_at: 123,
      shard,
      entries: {
        [xid]: { icon_url: null, source: "none" },
      },
    },
    { generation: "gen-1", shard },
  );
  assert.ok(valid);
  assert.equal(
    normalizePublicXIconV2Shard(valid, { generation: "other", shard }),
    null,
  );
  assert.equal(
    normalizePublicXIconV2Shard(valid, {
      generation: "gen-1",
      shard: (shard + 1) % 16,
    }),
    null,
  );
  assert.equal(
    normalizePublicXIconV2Shard({ ...valid, shard: String(shard) }, { generation: "gen-1", shard }),
    null,
  );
  assert.equal(
    normalizePublicXIconV2Shard({ ...valid, generated_at: "123" }, { generation: "gen-1", shard }),
    null,
  );
  assert.equal(
    normalizePublicXIconV2Shard(
      {
        ...valid,
        entries: {
          [`@${xid}`]: { icon_url: null, source: "none" },
        },
      },
      { generation: "gen-1", shard },
    ),
    null,
  );
});
