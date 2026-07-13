import assert from "node:assert/strict";
import { test } from "node:test";
import { withDeduplicatingR2 } from "./r2Dedup.ts";

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
