import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupIncrementalCache,
  INCREMENTAL_CACHE_RETENTION_MS as RETENTION,
  INCREMENTAL_CACHE_SCAN_LIMIT as LIMIT,
  INCREMENTAL_CACHE_SCAN_INTERVAL_MS as INTERVAL,
  INCREMENTAL_CACHE_SCAN_STATE_KEY as STATE_KEY,
} from "./incrementalCache.ts";

const NOW = Date.UTC(2026, 8, 30);
const key = (build, suffix = "cache") => `incremental-cache/${build}/${"a".repeat(64)}.${suffix}`;
const object = (key, age = RETENTION + 1) => ({ key, uploaded: new Date(NOW - age), size: 1234 });

function fixture(page, state = null) {
  const calls = { lists: [], deletes: [], writes: [] };
  const env = {
    get DB() { throw new Error("cache cleanup must not read D1"); },
    R2: {
      async list(options) { calls.lists.push(options); return page; },
      async delete(keys) { calls.deletes.push(keys); },
    },
    KV: {
      async get(key, type) { assert.equal(key, STATE_KEY); assert.equal(type, "json"); return state; },
      async put(key, value) { calls.writes.push({ key, value: JSON.parse(value) }); },
    },
  };
  return { env, calls };
}

test("only expired known OpenNext cache objects are bulk deleted; media, artifacts and recent cache survive", async () => {
  const { env, calls } = fixture({ truncated: false, objects: [
    object(key("old-build")), object(key("old-build", "fetch")),
    object(key("current-build"), 0), object(key("boundary"), RETENTION),
    object("media/original.png"), object("users/index.json"),
    object("incremental-cache/unknown/primary-data.json"),
    object(`incremental-cache/../../${"a".repeat(64)}.cache`),
    { ...object(key("invalid-date")), uploaded: new Date(NaN) },
  ] });
  const result = await cleanupIncrementalCache(env, undefined, NOW);
  assert.deepEqual(calls.lists, [{ prefix: "incremental-cache/", limit: LIMIT }]);
  assert.deepEqual(calls.deletes, [[key("old-build"), key("old-build", "fetch")]]);
  assert.equal(result.deleted, 2);
  assert.equal(result.bytesDeleted, 2468);
  assert.equal(result.scanned, 9);
  assert.deepEqual(calls.writes[0].value, { nextScanAt: NOW + INTERVAL });
});

test("short truncated pages resume via the R2 cursor and completed scans wait a day", async () => {
  const { env, calls } = fixture({ truncated: true, cursor: "next-page", objects: [] }, { cursor: "previous-page" });
  const result = await cleanupIncrementalCache(env, undefined, NOW);
  assert.equal(result.hasMore, true);
  assert.equal(calls.lists[0].cursor, "previous-page");
  assert.deepEqual(calls.writes[0].value, { cursor: "next-page" });
  assert.deepEqual(calls.deletes, []);
  const waiting = fixture(null, { nextScanAt: NOW + INTERVAL });
  assert.equal((await cleanupIncrementalCache(waiting.env, undefined, NOW)).skipped, true);
  assert.deepEqual(waiting.calls.lists, []);
});

test("delete failure and missing pagination cursor do not advance cleanup state", async () => {
  const failed = fixture({ truncated: false, objects: [object(key("old"))] });
  failed.env.R2.delete = async () => { throw new Error("R2 unavailable"); };
  await assert.rejects(cleanupIncrementalCache(failed.env, undefined, NOW), /R2 unavailable/);
  assert.deepEqual(failed.calls.writes, []);
  const malformed = fixture({ truncated: true, objects: [object(key("old"))] });
  await assert.rejects(cleanupIncrementalCache(malformed.env, undefined, NOW), /missing_cursor/);
  assert.deepEqual(malformed.calls.deletes, []);
  assert.deepEqual(malformed.calls.writes, []);
});

test("abort after listing prevents deletion and checkpoint; poisoned future state cannot disable scans forever", async () => {
  const controller = new AbortController();
  const aborted = fixture(null);
  aborted.env.R2.list = async () => {
    controller.abort(new Error("cancelled"));
    return { truncated: false, objects: [object(key("old"))] };
  };
  await assert.rejects(cleanupIncrementalCache(aborted.env, controller.signal, NOW), /cancelled/);
  assert.deepEqual(aborted.calls.deletes, []);
  assert.deepEqual(aborted.calls.writes, []);
  const poisoned = fixture({ truncated: false, objects: [] }, { nextScanAt: NOW + INTERVAL * 100 });
  assert.equal((await cleanupIncrementalCache(poisoned.env, undefined, NOW)).skipped, false);
});
