// MIG-0662 U01 — provisional, UNMOUNTED Hono audit restore host.
import assert from "node:assert/strict";
import test from "node:test";
import { createAuditRestoreHost } from "../src/visibility/auditRestoreHost.ts";
import { upsertBlockedEntityInManifest } from "@flamenode/server-core/visibility/manifestCore";
import { RANDOM_VIDEO_POOL_OBJECT_KEY } from "@flamenode/server-core/publicData/randomVideoPoolCore";
import { YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY } from "@flamenode/server-core/publicData/staticYoutubeRelatedBlocklistCore";

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
    RANDOM_VIDEO_POOL_OBJECT_KEY,
    YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY,
    "top/sections/recommended.v1.json",
    "top/sections/latest.v1.json",
    "top/sections/nostalgic.v1.json",
    "top/sections/stats.v1.json",
  ]);
  // Producer keys and Hono invalidation remain coupled.
  assert.equal(RANDOM_VIDEO_POOL_OBJECT_KEY, "videos/random-pool.v1.json");
  assert.equal(YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY, "youtube/related-blocklist.v1.json");
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

test("U01 CAS retry preserves another writer's blocked entity while adding our own", async () => {
  const ours = { entity_type: "video", entity_id: "ours", fence_token: "token-ours", blocked_at: 100 };
  const theirs = { entity_type: "event", entity_id: "theirs", fence_token: "token-theirs", blocked_at: 101 };
  const base = { schema_version: 1, revision: 0, generated_at: 100, entities: [] };
  let current = { ...base, revision: 1, entities: [theirs] };
  let etag = "etag-concurrent";
  const puts = [];
  const bucket = {
    get: async () => {
      const body = JSON.stringify(current);
      return { etag, size: Buffer.byteLength(body), text: async () => body };
    },
    put: async (key, value, options) => {
      puts.push({ key, value: JSON.parse(value), options });
      if (puts.length === 1) return null; // first ETag read is stale
      assert.equal(options.onlyIf.etagMatches, "etag-concurrent");
      current = JSON.parse(value);
      etag = "etag-merged";
      return { etag };
    },
  };

  await host({ BUCKET: bucket }).manifest.write(
    upsertBlockedEntityInManifest(base, ours, 100),
    {
      ifMatchEtag: "etag-stale",
      mutateOnConflict: (latest) => upsertBlockedEntityInManifest(latest, ours, 102),
    },
  );

  assert.equal(puts.length, 2);
  assert.equal(puts[0].options.onlyIf.etagMatches, "etag-stale");
  assert.equal(puts[1].options.httpMetadata.cacheControl, "no-store");
  assert.equal(current.entities.length, 2);
  assert.deepEqual(
    current.entities.map((e) => [e.entity_type, e.entity_id, e.fence_token]).sort(),
    [["event", "theirs", "token-theirs"], ["video", "ours", "token-ours"]],
  );
});

test("U01 CAS retry rejects an existing different fence token without replacing it", async () => {
  const ours = { entity_type: "video", entity_id: "same", fence_token: "token-ours", blocked_at: 100 };
  const theirs = { ...ours, fence_token: "token-another" };
  const latest = { schema_version: 1, revision: 5, generated_at: 100, entities: [theirs] };
  let putCalls = 0;
  const bucket = {
    get: async () => {
      const body = JSON.stringify(latest);
      return { etag: "etag-current", size: Buffer.byteLength(body), text: async () => body };
    },
    put: async () => { putCalls += 1; return null; }, // a lost conditional put
  };
  await assert.rejects(
    host({ BUCKET: bucket }).manifest.write(
      { ...latest, revision: 6, entities: [ours] },
      {
        ifMatchEtag: "etag-stale",
        mutateOnConflict: (current) => {
          const existing = current.entities.find((e) =>
            e.entity_type === "video" && e.entity_id === "same");
          if (existing && existing.fence_token !== ours.fence_token) {
            throw new Error("public_visibility_fence_token_mismatch");
          }
          return upsertBlockedEntityInManifest(current, ours, 102);
        },
      },
    ),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(putCalls, 3); // bounded retries; no successful R2 write
  assert.equal(latest.entities[0].fence_token, "token-another");
});

test("U01 first-create race merges new blocks with the existing R2 manifest", async () => {
  const ours = { entity_type: "video", entity_id: "new-video", fence_token: "new-token", blocked_at: 100 };
  const theirs = { entity_type: "event", entity_id: "new-event", fence_token: "foreign-token", blocked_at: 101 };
  const base = { schema_version: 1, revision: 0, generated_at: 100, entities: [] };
  let current = { ...base, revision: 1, entities: [theirs] };
  const puts = [];
  const bucket = {
    get: async () => {
      const body = JSON.stringify(current);
      return { etag: "etag-created-by-other", size: Buffer.byteLength(body), text: async () => body };
    },
    put: async (_key, value, options) => {
      puts.push(options);
      if (puts.length === 1) return null;
      assert.equal(options.onlyIf.etagMatches, "etag-created-by-other");
      current = JSON.parse(value);
      return { etag: "etag-after-merge" };
    },
  };
  await host({ BUCKET: bucket }).manifest.write(
    upsertBlockedEntityInManifest(base, ours, 100),
    { ifMatchEtag: null },
  );
  assert.equal(puts.length, 2);
  assert.equal(puts[0].onlyIf.get("If-None-Match"), "*");
  assert.deepEqual(
    current.entities.map((e) => [e.entity_type, e.entity_id]).sort(),
    [["event", "new-event"], ["video", "new-video"]],
  );
});
