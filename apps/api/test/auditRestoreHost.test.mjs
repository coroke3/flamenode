// MIG-0662 U01 — provisional, UNMOUNTED Hono audit restore host.
import assert from "node:assert/strict";
import test from "node:test";
import { createAuditRestoreHost } from "../src/visibility/auditRestoreHost.ts";

function host(env = {}) {
  return createAuditRestoreHost({ env });
}

test("U01 missing manifest binding enforces fail-closed and never writes", async () => {
  const enforced = host({ PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });
  await assert.rejects(enforced.manifest.read(), /public_visibility_manifest_bucket_missing/);
  await assert.rejects(
    enforced.manifest.write({ schema_version: 1, revision: 0, generated_at: 1, entities: [] }),
    /public_visibility_manifest_bucket_missing/,
  );
  const observed = await host({ PUBLIC_VISIBILITY_GUARD_MODE: "observe" }).manifest.read();
  assert.equal(observed.etag, null);
  assert.deepEqual(observed.manifest.entities, []);
});

test("U01 conditional manifest writes preserve ETag and no-store, reads preserve snapshot", async () => {
  const manifest = { schema_version: 1, revision: 7, generated_at: 1700000000, entities: [] };
  const puts = [];
  const bucket = {
    get: async (key) => {
      assert.equal(key, "visibility/blocked-entities.v1.json");
      const text = JSON.stringify(manifest);
      return { etag: "before", size: Buffer.byteLength(text), text: async () => text };
    },
    put: async (key, value, options) => {
      puts.push({ key, value: JSON.parse(value), options });
      return { etag: "after" };
    },
  };
  const current = host({ BUCKET: bucket });
  assert.deepEqual(await current.manifest.read(), { manifest, etag: "before" });
  await current.manifest.write(manifest, { ifMatchEtag: "before" });
  assert.equal(puts.length, 1);
  assert.equal(puts[0].options.onlyIf.etagMatches, "before");
  assert.equal(puts[0].options.httpMetadata.cacheControl, "no-store");
  await current.manifest.write(manifest, { ifMatchEtag: null });
  assert.equal(puts.length, 2);
  assert.equal(puts[1].options.onlyIf.get("If-None-Match"), "*");
});

test("U01 public cache key set and event artifact keys match CURRENT", () => {
  const current = host();
  assert.deepEqual([...current.publicCacheKeys.staticObjectKeys], [
    "videos/random-pool.v1.json",
    "youtube/related-blocklist.v1.json",
    "top/sections/recommended.v1.json",
    "top/sections/latest.v1.json",
    "top/sections/nostalgic.v1.json",
    "top/sections/stats.v1.json",
  ]);
  assert.equal(current.publicCacheKeys.userMaxPages, 5);
  assert.deepEqual(current.publicCacheKeys.eventObjectKeys("example"), [
    "events/example.json",
    "events/example/base.v1.json",
    "events/example/slots.v1.json",
    "events/example/release.v1.json",
  ]);
});

test("U01 event export cache invalidation targets 2 formats x 4 windows", async () => {
  const previous = globalThis.caches;
  const deleted = [];
  globalThis.caches = { default: { delete: async (url) => { deleted.push(url); return true; } } };
  try {
    await host().invalidateEventExportCache("sample");
    assert.equal(deleted.length, 8);
    assert.equal(new Set(deleted).size, 8);
    for (const url of deleted) {
      assert.match(url, /^https:\/\/flamenode\.internal\/public-json\//);
      assert.match(decodeURIComponent(url), /public-event-export:9:sample:(v5|legacy):(15|60|360|1440)$/);
    }
  } finally {
    if (previous === undefined) delete globalThis.caches;
    else globalThis.caches = previous;
  }
});

test("U01 Queue wake host intentionally has no remote producer side effects", async () => {
  const wake = await host().loadQueueWakeHost();
  assert.equal(wake.readEnv(), null);
  assert.equal(wake.readWaitUntil(), null);
  assert.equal(wake.readKv(), null);
});
