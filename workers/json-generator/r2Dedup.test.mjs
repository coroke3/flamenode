import assert from "node:assert/strict";
import { test } from "node:test";
import {
  staticArtifactContentHash,
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

function createEnv({ storedHash, hasObject = true }) {
  const calls = { head: 0, put: 0 };
  const object = { key: "top.json", etag: "etag", version: "v1", size: 1 };
  const R2 = {
    async head() {
      calls.head += 1;
      return hasObject ? object : null;
    },
    async put() {
      calls.put += 1;
      return object;
    },
  };
  const DB = {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return storedHash ? { content_hash: storedHash } : null;
            },
          };
        },
      };
    },
  };
  return { env: { DB, R2 }, calls, object };
}

test("DB hashとR2実体が一致する場合はPUTを省略する", async () => {
  const body = JSON.stringify({ ok: true });
  const fixture = createEnv({ storedHash: await hash(body) });
  const wrapped = withDeduplicatingR2(fixture.env);
  const result = await wrapped.R2.put("top.json", body);
  assert.equal(result, fixture.object);
  assert.equal(fixture.calls.head, 1);
  assert.equal(fixture.calls.put, 0);
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
});

test("非文字列bodyは比較せず通常PUTする", async () => {
  const fixture = createEnv({ storedHash: null });
  const wrapped = withDeduplicatingR2(fixture.env);
  await wrapped.R2.put("binary.bin", new Uint8Array([1, 2, 3]));
  assert.equal(fixture.calls.head, 0);
  assert.equal(fixture.calls.put, 1);
});

test("generated_atだけが変わったJSONはR2 PUTを省略する", async () => {
  const previous = JSON.stringify({ generated_at: 100, items: [{ id: "v1" }] });
  const next = JSON.stringify({ generated_at: 200, items: [{ id: "v1" }] });
  const fixture = createEnv({
    storedHash: await staticArtifactContentHash(previous),
  });
  const wrapped = withDeduplicatingR2(fixture.env);
  await wrapped.R2.put("top.json", next);
  assert.equal(fixture.calls.head, 1);
  assert.equal(fixture.calls.put, 0);
});

test("意味内容が変わったJSONはR2 PUTする", async () => {
  const previous = JSON.stringify({ generated_at: 100, items: [{ id: "v1" }] });
  const next = JSON.stringify({ generated_at: 200, items: [{ id: "v2" }] });
  const fixture = createEnv({
    storedHash: await staticArtifactContentHash(previous),
  });
  const wrapped = withDeduplicatingR2(fixture.env);
  await wrapped.R2.put("top.json", next);
  assert.equal(fixture.calls.head, 0);
  assert.equal(fixture.calls.put, 1);
});

test("artifactHashCache を preload すると PUT 前の個別 SELECT を省略する", async () => {
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
      throw new Error("unexpected put");
    },
  };
  await cache.preload(DB, "top", "global");
  const wrapped = withDeduplicatingR2({ DB, R2, artifactHashCache: cache });
  await wrapped.R2.put("top.json", body);
  assert.equal(selectCount, 0);
});
