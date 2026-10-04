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
