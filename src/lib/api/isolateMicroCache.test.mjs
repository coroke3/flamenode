import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ISOLATE_MICRO_CACHE_MAX_ENTRIES,
  ISOLATE_MICRO_CACHE_TTL_MS,
  isolateMicroCacheGet,
  isolateMicroCacheSet,
  isolateMicroCacheSizeForTests,
  resetIsolateMicroCacheForTests,
} from "./isolateMicroCache.ts";

import {
  isolateMicroCacheGet as honoGet,
  isolateMicroCacheSet as honoSet,
  resetIsolateMicroCacheForTests as resetHono,
} from "../../../apps/api/src/routes/live/microCache.ts";

test("時計の巻き戻しではCURRENT/Honoとも旧マイクロキャッシュを破棄する", () => {
  for (const [name, get, set, reset] of [
    ["CURRENT", isolateMicroCacheGet, isolateMicroCacheSet, resetIsolateMicroCacheForTests],
    ["Hono", honoGet, honoSet, resetHono],
  ]) {
    reset();
    set("event", "public-payload", 1_000);
    assert.equal(get("event", 1_000), "public-payload", name);
    assert.equal(get("event", 999), null, name + ": clock rollback invalidates");
    assert.equal(get("event", 1_001), null, name + ": old payload remains invalidated");

    set("event", "new-payload", 2_000);
    assert.equal(get("event", 16_999), "new-payload", name);
    assert.equal(get("event", 17_000), null, name + ": standard TTL unchanged");
    reset();
  }
});

test("非有限時刻はCURRENT/Honoとも無期限エントリを作れない", () => {
  for (const [name, get, set, reset] of [
    ["CURRENT", isolateMicroCacheGet, isolateMicroCacheSet, resetIsolateMicroCacheForTests],
    ["Hono", honoGet, honoSet, resetHono],
  ]) {
    reset();
    for (const invalid of [NaN, Infinity, -Infinity]) {
      assert.throws(() => set("poison", "v", invalid), RangeError, name);
      assert.equal(get("poison", 0), null, name + ": invalid set did not store entry");
    }
    set("good", "v", 1_000);
    assert.equal(get("good", NaN), null, name + ": nonfinite read invalidates");
    assert.equal(get("good", 1_000), null, name + ": invalidated cache must not reappear");
    reset();
  }
});

test("TTLは15秒で、期限ちょうどから無効になる", () => {
  resetIsolateMicroCacheForTests();
  assert.equal(ISOLATE_MICRO_CACHE_TTL_MS, 15_000);
  isolateMicroCacheSet("k", "v", 1_000);
  assert.equal(isolateMicroCacheGet("k", 1_000), "v");
  assert.equal(isolateMicroCacheGet("k", 15_999), "v");
  assert.equal(isolateMicroCacheGet("k", 16_000), null);
  assert.equal(isolateMicroCacheSizeForTests(), 0);
});

test("未登録keyはnullを返す", () => {
  resetIsolateMicroCacheForTests();
  assert.equal(isolateMicroCacheGet("missing", 0), null);
});

test("最大64件で最古から追い出す", () => {
  resetIsolateMicroCacheForTests();
  assert.equal(ISOLATE_MICRO_CACHE_MAX_ENTRIES, 64);
  for (let i = 0; i < 64; i += 1) isolateMicroCacheSet(`k${i}`, `v${i}`, 100);
  assert.equal(isolateMicroCacheSizeForTests(), 64);
  isolateMicroCacheSet("k64", "v64", 100);
  assert.equal(isolateMicroCacheSizeForTests(), 64);
  assert.equal(isolateMicroCacheGet("k0", 100), null);
  assert.equal(isolateMicroCacheGet("k1", 100), "v1");
  assert.equal(isolateMicroCacheGet("k64", 100), "v64");
});

test("同一keyの再設定はsizeを増やさず挿入順を更新する", () => {
  resetIsolateMicroCacheForTests();
  for (let i = 0; i < 64; i += 1) isolateMicroCacheSet(`k${i}`, `v${i}`, 100);
  isolateMicroCacheSet("k0", "fresh", 100);
  assert.equal(isolateMicroCacheSizeForTests(), 64);
  isolateMicroCacheSet("k64", "v64", 100);
  assert.equal(isolateMicroCacheGet("k0", 100), "fresh");
  assert.equal(isolateMicroCacheGet("k1", 100), null);
});

test("満杯時は期限切れentryを先に掃除する", () => {
  resetIsolateMicroCacheForTests();
  for (let i = 0; i < 64; i += 1) isolateMicroCacheSet(`k${i}`, `v${i}`, 0);
  isolateMicroCacheSet("new", "v", 20_000);
  assert.equal(isolateMicroCacheSizeForTests(), 1);
  assert.equal(isolateMicroCacheGet("new", 20_000), "v");
});

test("finished stringだけを保持し、Promise等は拒否する", async () => {
  resetIsolateMicroCacheForTests();
  assert.throws(
    () => isolateMicroCacheSet("p", Promise.resolve("x"), 0),
    TypeError,
  );
  assert.throws(() => isolateMicroCacheSet("o", { a: 1 }, 0), TypeError);
  assert.throws(() => isolateMicroCacheSet("r", new Response("x"), 0), TypeError);
  assert.equal(isolateMicroCacheSizeForTests(), 0);

  const source = await readFile(
    new URL("./isolateMicroCache.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /Map<string,\s*Promise/);
  assert.match(source, /type Entry = \{ value: string; expiresAt: number \}/);
});
