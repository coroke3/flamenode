import assert from "node:assert/strict";
import { test } from "node:test";
import {
  staticArtifactContentHash,
  staticArtifactCustomMetadata,
  resolveIdenticalJsonArtifactPut,
  withDeduplicatingR2,
  ArtifactHashCache,
} from "./r2Dedup.ts";

async function hash(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Buffer.from(digest).toString("hex");
}

function createEnv({ storedHash, metadataHash, hasObject = true }) {
  const calls = { head: 0, put: 0, select: 0, putOptions: null };
  const object = {
    key: "top.json",
    etag: "etag",
    version: "v1",
    size: 1,
    ...(metadataHash ? { customMetadata: { content_hash: metadataHash } } : {}),
  };
  const R2 = {
    async head() {
      calls.head += 1;
      return hasObject ? object : null;
    },
    async put(_key, _value, options) {
      calls.put += 1;
      calls.putOptions = options;
      return object;
    },
  };
  const DB = {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              calls.select += 1;
              return storedHash ? { content_hash: storedHash } : null;
            },
          };
        },
      };
    },
  };
  return { env: { DB, R2 }, calls, object };
}

test("R2 content_hashが一致する場合はD1を読まずPUTを省略する", async () => {
  const body = JSON.stringify({ ok: true });
  const contentHash = await staticArtifactContentHash(body);
  const fixture = createEnv({ storedHash: await hash(body), metadataHash: contentHash });
  const wrapped = withDeduplicatingR2(fixture.env);
  const result = await wrapped.R2.put("top.json", body);
  assert.equal(result, fixture.object);
  assert.equal(fixture.calls.head, 1);
  assert.equal(fixture.calls.put, 0);
  assert.equal(fixture.calls.select, 0);
});

test("legacy R2 object uses one D1 fallback and is rewritten with metadata", async () => {
  const body = JSON.stringify({ schema_version: 4, generation: "gen-a", ok: true });
  const fixture = createEnv({ storedHash: await staticArtifactContentHash(body) });
  const wrapped = withDeduplicatingR2(fixture.env);
  await wrapped.R2.put("top.json", body);
  assert.equal(fixture.calls.head, 1);
  assert.equal(fixture.calls.select, 1);
  assert.equal(fixture.calls.put, 1);
  assert.deepEqual(fixture.calls.putOptions.customMetadata, {
    content_hash: await staticArtifactContentHash(body),
    schema_version: "4",
    source_generation: "gen-a",
  });
});

test("DB hashが一致してもR2実体が欠落していればPUTする", async () => {
  const body = JSON.stringify({ ok: true });
  const fixture = createEnv({
    storedHash: await hash(body),
    hasObject: false,
  });
  const wrapped = withDeduplicatingR2(fixture.env);
  await wrapped.R2.put("top.json", body);
  assert.equal(fixture.calls.head, 1);
  assert.equal(fixture.calls.put, 1);
  assert.equal(fixture.calls.select, 0);
});

test("非文字列bodyは比較せず通常PUTする", async () => {
  const fixture = createEnv({ storedHash: null });
  const wrapped = withDeduplicatingR2(fixture.env);
  await wrapped.R2.put("binary.bin", new Uint8Array([1, 2, 3]));
  assert.equal(fixture.calls.head, 0);
  assert.equal(fixture.calls.put, 1);
});

test("generated_atだけが変わったJSONでも同一hash metadataならR2 PUTを省略する", async () => {
  const previous = JSON.stringify({ generated_at: 100, items: [{ id: "v1" }] });
  const next = JSON.stringify({ generated_at: 200, items: [{ id: "v1" }] });
  const contentHash = await staticArtifactContentHash(previous);
  const fixture = createEnv({
    storedHash: contentHash,
    metadataHash: contentHash,
  });
  const wrapped = withDeduplicatingR2(fixture.env);
  await wrapped.R2.put("top.json", next);
  assert.equal(fixture.calls.head, 1);
  assert.equal(fixture.calls.put, 0);
  assert.equal(fixture.calls.select, 0);
});

test("意味内容が変わったJSONはR2 PUTする", async () => {
  const previous = JSON.stringify({ generated_at: 100, items: [{ id: "v1" }] });
  const next = JSON.stringify({ generated_at: 200, items: [{ id: "v2" }] });
  const fixture = createEnv({
    storedHash: await staticArtifactContentHash(previous),
    metadataHash: await staticArtifactContentHash(previous),
  });
  const wrapped = withDeduplicatingR2(fixture.env);
  await wrapped.R2.put("top.json", next);
  assert.equal(fixture.calls.head, 1);
  assert.equal(fixture.calls.put, 1);
});

test("artifactHashCache を preload したlegacy fallbackはhash照会を省きmetadata付きで更新する", async () => {
  const body = JSON.stringify({ ok: true });
  const storedHash = await hash(body);
  let selectCount = 0;
  const cache = new ArtifactHashCache();
  const DB = {
    prepare(query) {
      return {
        bind() {
          return {
            async all() {
              if (query.includes("target_type")) {
                return {
                  results: [{ object_key: "top.json", content_hash: storedHash }],
                };
              }
              return { results: [] };
            },
            async first() {
              selectCount += 1;
              return { content_hash: storedHash };
            },
          };
        },
      };
    },
  };
  const R2 = {
    async head() {
      return { key: "top.json" };
    },
    async put() {
      return { key: "top.json" };
    },
  };
  await cache.preload(DB, "top", "global");
  const wrapped = withDeduplicatingR2({ DB, R2, artifactHashCache: cache });
  await wrapped.R2.put("top.json", body);
  assert.equal(selectCount, 0);
});

test("resolveIdenticalJsonArtifactPut はR2 metadata一致ならhash付きheadを返す", async () => {
  const body = JSON.stringify({ generated_at: 100, items: [{ id: "v1" }] });
  const storedHash = await staticArtifactContentHash(body);
  const fixture = createEnv({ storedHash, metadataHash: storedHash });
  const result = await resolveIdenticalJsonArtifactPut(
    fixture.env,
    "top.json",
    body,
  );
  assert.ok(result);
  assert.equal(result.skipPut, true);
  assert.equal(result.object, fixture.object);
  assert.equal(fixture.calls.head, 1);
  assert.equal(fixture.calls.select, 0);
  assert.equal(fixture.calls.put, 0);
});

test("metadata builder records hash, schema, and a bounded generation", async () => {
  assert.deepEqual(
    staticArtifactCustomMetadata(
      JSON.stringify({ schema_version: 2, generation_key: "g-2" }),
      "abc",
      1,
    ),
    { content_hash: "abc", schema_version: "2", source_generation: "g-2" },
  );
});
