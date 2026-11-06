import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return {
          url: "data:text/javascript,export%20{}",
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  const {
    PUBLIC_JSON_ISOLATE_CACHE_MAX_ENTRIES,
    PUBLIC_JSON_ISOLATE_CACHE_MAX_ENTRY_BYTES,
    PUBLIC_JSON_ISOLATE_CACHE_MAX_TTL_SEC,
    deletePublicJsonIsolateCache,
    readPublicJsonIsolateCache,
    resetPublicJsonIsolateCacheForTests,
    writePublicJsonIsolateCache,
  } = await import("./publicCacheIsolate.ts");

  test("isolate cache は TTL 内の plain object だけを返し Promise は保存しない", () => {
    resetPublicJsonIsolateCacheForTests();
    const now = 1_000_000;
    const aPayload = { id: "a" };
    const aBytes = new TextEncoder().encode(JSON.stringify(aPayload)).byteLength;
    writePublicJsonIsolateCache("videos/a.json", aPayload, 60, aBytes, now);
    assert.deepEqual(readPublicJsonIsolateCache("videos/a.json", now + 1_000), {
      id: "a",
    });
    assert.deepEqual(
      readPublicJsonIsolateCache(
        "videos/a.json",
        now + PUBLIC_JSON_ISOLATE_CACHE_MAX_TTL_SEC * 1000 - 1,
      ),
      { id: "a" },
    );
    assert.equal(
      readPublicJsonIsolateCache(
        "videos/a.json",
        now + PUBLIC_JSON_ISOLATE_CACHE_MAX_TTL_SEC * 1000,
      ),
      null,
    );
    assert.equal(
      readPublicJsonIsolateCache(
        "videos/a.json",
        now + PUBLIC_JSON_ISOLATE_CACHE_MAX_TTL_SEC * 1000 + 1,
      ),
      null,
    );

    writePublicJsonIsolateCache(
      "videos/b.json",
      Promise.resolve({ id: "b" }),
      30,
      1,
      now,
    );
    assert.equal(readPublicJsonIsolateCache("videos/b.json", now), null);
  });

  test("isolate cache は null・Promise の置換で旧entryを破棄する", () => {
    const now = 1_250_000;
    const payload = { id: "previous" };
    const weight = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    const key = "replacement.json";
    for (const invalid of [null, undefined, Promise.resolve({ id: "next" })]) {
      resetPublicJsonIsolateCacheForTests();
      writePublicJsonIsolateCache(key, payload, 30, weight, now);
      assert.deepEqual(readPublicJsonIsolateCache(key, now), payload);
      writePublicJsonIsolateCache(key, invalid, 30, weight, now);
      assert.equal(readPublicJsonIsolateCache(key, now), null,
        "invalid replacement must not expose a prior snapshot");
    }
    // Replacements of unrelated keys must not invalidate valid entries.
    resetPublicJsonIsolateCacheForTests();
    writePublicJsonIsolateCache("valid.json", payload, 30, weight, now);
    writePublicJsonIsolateCache("invalid.json", null, 30, weight, now);
    assert.deepEqual(readPublicJsonIsolateCache("valid.json", now), payload);
  });

  test("isolate cache は直接渡された無効TTLを保持せず既存entryも破棄する", () => {
    const now = 1_500_000;
    const payload = { id: "valid" };
    const weight = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    for (const ttl of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1]) {
      resetPublicJsonIsolateCacheForTests();
      writePublicJsonIsolateCache("invalid-ttl.json", payload, 30, weight, now);
      assert.deepEqual(readPublicJsonIsolateCache("invalid-ttl.json", now), payload);
      writePublicJsonIsolateCache("invalid-ttl.json", { id: "bad" }, ttl, weight, now);
      assert.equal(readPublicJsonIsolateCache("invalid-ttl.json", now), null, `ttl=${String(ttl)}`);
      assert.equal(readPublicJsonIsolateCache("invalid-ttl.json", now + 100_000), null);
    }
    resetPublicJsonIsolateCacheForTests();
    writePublicJsonIsolateCache("fractional-ttl.json", payload, 0.5, weight, now);
    assert.deepEqual(readPublicJsonIsolateCache("fractional-ttl.json", now), payload);
    assert.equal(readPublicJsonIsolateCache("fractional-ttl.json", now + 1_000), null);
  });

  test("isolate cache は非有限の時計値で期限切れ検証を迂回させない", () => {
    const now = 2_500_000;
    const payload = { id: "valid" };
    const weight = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    for (const invalidClock of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      resetPublicJsonIsolateCacheForTests();
      writePublicJsonIsolateCache("clock.json", payload, 30, weight, now);
      assert.equal(readPublicJsonIsolateCache("clock.json", invalidClock), null);
      // An invalid read must not refresh TTL or LRU.
      assert.equal(readPublicJsonIsolateCache("clock.json", now + 30_000), null);

      resetPublicJsonIsolateCacheForTests();
      writePublicJsonIsolateCache("clock.json", payload, 30, weight, now);
      writePublicJsonIsolateCache("clock.json", { id: "bad" }, 30, weight, invalidClock);
      assert.equal(readPublicJsonIsolateCache("clock.json", now), null);
    }
  });

  test("isolate cache は安全整数範囲外の有効期限を保存しない", () => {
    const payload = { id: "safe" };
    const weight = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    const key = "overflow-clock.json";
    for (const clock of [
      Number.MAX_VALUE,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER - 999,
      1234.5,
    ]) {
      resetPublicJsonIsolateCacheForTests();
      writePublicJsonIsolateCache(key, payload, 30, weight, 1_000_000);
      writePublicJsonIsolateCache(key, { id: "bad" }, 30, weight, clock);
      assert.equal(readPublicJsonIsolateCache(key, 1_000_000), null, `clock=${String(clock)}`);
    }
    resetPublicJsonIsolateCacheForTests();
    writePublicJsonIsolateCache(key, payload, 1, weight, Number.MAX_SAFE_INTEGER - 1000);
    assert.deepEqual(readPublicJsonIsolateCache(key, Number.MAX_SAFE_INTEGER - 1), payload);
    assert.equal(readPublicJsonIsolateCache(key, Number.MAX_SAFE_INTEGER), null);
  });

  test("isolate cache は単一entryのserialized byte上限を超えるpayloadを保持しない", () => {
    resetPublicJsonIsolateCacheForTests();
    const now = 3_000_000;
    const oversized = {
      value: "x".repeat(PUBLIC_JSON_ISOLATE_CACHE_MAX_ENTRY_BYTES),
    };
    const oversizedBytes = new TextEncoder().encode(
      JSON.stringify(oversized),
    ).byteLength;
    writePublicJsonIsolateCache(
      "large.json",
      oversized,
      30,
      oversizedBytes,
      now,
    );
    assert.equal(readPublicJsonIsolateCache("large.json", now), null);
  });

  test("isolate cache はaggregate byte budgetを超えるとLRU evictionする", () => {
    resetPublicJsonIsolateCacheForTests();
    const now = 4_000_000;
    const payload = { value: "x".repeat(64 * 1024) };
    const payloadBytes = new TextEncoder().encode(
      JSON.stringify(payload),
    ).byteLength;
    for (let i = 0; i < 20; i += 1) {
      writePublicJsonIsolateCache(
        `bytes/${i}.json`,
        payload,
        30,
        payloadBytes,
        now,
      );
    }
    assert.equal(readPublicJsonIsolateCache("bytes/0.json", now), null);
    assert.deepEqual(readPublicJsonIsolateCache("bytes/19.json", now), payload);
  });

  test("isolate cache は件数上限で最古を追い出す", () => {
    resetPublicJsonIsolateCacheForTests();
    const now = 2_000_000;
    for (let i = 0; i < PUBLIC_JSON_ISOLATE_CACHE_MAX_ENTRIES + 2; i += 1) {
      const payload = { i };
      const payloadBytes = new TextEncoder().encode(
        JSON.stringify(payload),
      ).byteLength;
      writePublicJsonIsolateCache(
        `k/${i}.json`,
        payload,
        30,
        payloadBytes,
        now,
      );
    }
    assert.equal(readPublicJsonIsolateCache("k/0.json", now), null);
    assert.deepEqual(
      readPublicJsonIsolateCache(
        `k/${PUBLIC_JSON_ISOLATE_CACHE_MAX_ENTRIES + 1}.json`,
        now,
      ),
      { i: PUBLIC_JSON_ISOLATE_CACHE_MAX_ENTRIES + 1 },
    );
    deletePublicJsonIsolateCache(
      `k/${PUBLIC_JSON_ISOLATE_CACHE_MAX_ENTRIES + 1}.json`,
    );
    assert.equal(
      readPublicJsonIsolateCache(
        `k/${PUBLIC_JSON_ISOLATE_CACHE_MAX_ENTRIES + 1}.json`,
        now,
      ),
      null,
    );
  });
}
