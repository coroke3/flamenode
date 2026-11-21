// MIG-0662 U01 — provisional, UNMOUNTED Hono audit restore host.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("U01 observe-mode missing manifest emits CURRENT telemetry and off-mode stays quiet", async () => {
  const originalWarn = console.warn;
  const warnings = [];
  try {
    console.warn = (...args) => { warnings.push(args); };
    const observed = await host({ PUBLIC_VISIBILITY_GUARD_MODE: "observe" }).manifest.read();
    assert.equal(observed.etag, null);
    assert.deepEqual(observed.manifest.entities, []);
    assert.deepEqual(warnings, [[JSON.stringify({
      service: "public-visibility-guard",
      mode: "observe",
      result: "manifest_bucket_missing",
    })]]);
    warnings.length = 0;

    const off = await host({ PUBLIC_VISIBILITY_GUARD_MODE: "off" }).manifest.read();
    assert.equal(off.etag, null);
    assert.equal(warnings.length, 0, "off mode does not log missing manifest binding");

    await assert.rejects(
      host({ PUBLIC_VISIBILITY_GUARD_MODE: "enforce" }).manifest.read(),
      /public_visibility_manifest_bucket_missing/,
    );
    assert.equal(warnings.length, 0, "enforce mode rejects before any telemetry");
  } finally {
    console.warn = originalWarn;
  }
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


// The target host cannot import CURRENT's Next.js-only module at runtime.
// Read the producers' actual public key constants so this regression fails
// if CURRENT changes a cache identity without updating the Hono invalidator.
test("U01 audit restore invalidation cache keys follow CURRENT producer definitions", () => {
  const topSource = readFileSync(
    new URL("../../../src/lib/publicData/staticTopSectionsCore.ts", import.meta.url),
    "utf8",
  );
  const userSource = readFileSync(
    new URL("../../../src/lib/publicData/staticUserProfileCore.ts", import.meta.url),
    "utf8",
  );
  const topKeys = [
    "TOP_RECOMMENDED_OBJECT_KEY",
    "TOP_LATEST_OBJECT_KEY",
    "TOP_NOSTALGIC_OBJECT_KEY",
    "TOP_STATS_OBJECT_KEY",
  ].map((name) => {
    const assignment = topSource.split("export const " + name + " = ")[1];
    const match = assignment?.match(/^["']([^"']+)["']/);
    assert.ok(match, "CURRENT producer constant must remain discoverable: " + name);
    return match[1];
  });
  const userPagesMatch = userSource.match(
    /export\s+const\s+STATIC_USER_MAX_PAGES\s*=\s*(\d+)/,
  );
  assert.ok(userPagesMatch, "CURRENT public user page limit must remain discoverable");
  const current = host().publicCacheKeys;
  assert.deepEqual([...current.staticObjectKeys].slice(2), topKeys);
  assert.equal(current.userMaxPages, Number(userPagesMatch[1]));
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

test("U01 missing vs explicitly undefined conditional matches CURRENT R2 write semantics", async () => {
  const puts = [];
  const bucket = {
    put: async (_key, _value, opts) => {
      puts.push(opts);
      return { etag: "new" };
    },
  };
  const m = { schema_version: 1, revision: 0, generated_at: 1, entities: [] };
  const current = host({ BUCKET: bucket });
  await current.manifest.write(m);
  await current.manifest.write(m, { ifMatchEtag: undefined });
  assert.equal(puts.length, 2);
  assert.equal(puts[0].onlyIf, undefined, "omitted option remains unconditional");
  assert.equal(puts[1].onlyIf.get("If-None-Match"), "*", "explicit undefined is create-if-absent");
});

test("U01 absent Cache API and delete failure are fail-soft without leaking keys to logs", async () => {
  const originalCache = globalThis.caches;
  const originalWarn = console.warn;
  const warnings = [];
  try {
    console.warn = (...parts) => { warnings.push(parts.join(" ")); };
    // A local Node environment may not provide Cloudflare's Cache API.
    if (originalCache === undefined) delete globalThis.caches;
    else globalThis.caches = undefined;
    await host().invalidateEventExportCache("private-sensitive-event");
    assert.equal(warnings.length, 8);
    assert.ok(warnings.every((message) => message === "[public-cache] cache_api_delete_failed"));

    const deletes = [];
    globalThis.caches = { default: { delete: async (url) => {
      deletes.push(url);
      throw new Error("provider_internal_private_key");
    } } };
    await host().deletePublicJsonCaches(["videos/sensitive.json", "events/sensitive.json"]);
    assert.equal(deletes.length, 2, "all deletes are attempted after an edge-cache failure");
    assert.equal(warnings.length, 10);
    assert.ok(warnings.every((message) => message === "[public-cache] cache_api_delete_failed"));
    assert.ok(warnings.every((message) => !/sensitive|provider_internal_private_key/.test(message)));
  } finally {
    console.warn = originalWarn;
    if (originalCache === undefined) delete globalThis.caches;
    else globalThis.caches = originalCache;
  }
});


// #717: Hono-specific defense in depth, not a replacement for shared-core
// logger remediation. No raw provider exception, stack, URL or token can reach
// the restore core through the candidate host's R2 port.
test("U01 #717 manifest R2 provider failures expose only fixed safe error codes", async () => {
  const secret = "provider_cookie=SESSION_SECRET_987_sensitive";
  const current = host({ BUCKET: {
    get: async () => { throw new Error(secret); },
    put: async () => { throw new Error(secret); },
  } });
  for (const [action, expected] of [
    [() => current.manifest.read(), "public_visibility_manifest_read_failed"],
    [() => current.manifest.write({
      schema_version: 1, revision: 0, generated_at: 1, entities: [],
    }, { ifMatchEtag: "old" }), "public_visibility_manifest_put_failed"],
  ]) {
    await assert.rejects(action, (error) => {
      assert.equal(error.message, expected);
      assert.equal(error.cause, undefined);
      assert.equal(Object.hasOwn(error, "cause"), false);
      assert.equal(JSON.stringify(error).includes(secret), false);
      assert.equal(String(error.stack).includes(secret), false);
      return true;
    });
  }

  const malformed = host({ BUCKET: {
    get: async () => {
      const text = '{"token":"RAW_SECRET_VALUE","entities":';
      return { size: Buffer.byteLength(text), etag: "etag-1", text: async () => text };
    },
  } });
  await assert.rejects(malformed.manifest.read(), (error) => {
    assert.equal(error.message, "public_visibility_manifest_read_failed");
    assert.doesNotMatch(String(error.stack), /RAW_SECRET_VALUE/);
    return true;
  });
});

test("U01 #717 known manifest domain failures retain stable codes without raw stacks", async () => {
  const blocked = { schema_version: 1, revision: 0, generated_at: 1, entities: [] };
  const current = host({ BUCKET: {
    get: async () => {
      throw new Error("public_visibility_manifest_too_large");
    },
    put: async () => { throw new Error("public_visibility_manifest_precondition_failed"); },
  } });
  await assert.rejects(current.manifest.read(), (error) => {
    assert.equal(error.message, "public_visibility_manifest_too_large");
    assert.equal(error.cause, undefined);
    return true;
  });
  await assert.rejects(current.manifest.write(blocked, { ifMatchEtag: "old" }), (error) => {
    assert.equal(error.message, "public_visibility_manifest_precondition_failed");
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("U01 #717 R2 binding and guard-mode getter exceptions are sanitized before shared restore", async () => {
  const secret = "R2_PRIVATE_BINDING_GETTER_CREDENTIAL_0662";
  const manifest = { schema_version: 1, revision: 0, generated_at: 1, entities: [] };
  let bucketGets = 0;
  const bucketEnv = {};
  Object.defineProperty(bucketEnv, "BUCKET", {
    get() {
      bucketGets++;
      throw new Error("provider R2 binding access: " + secret, {
        cause: new Error("nested credential: " + secret),
      });
    },
  });
  const poisonedBucket = host(bucketEnv);
  for (const [action, expected] of [
    [() => poisonedBucket.manifest.read(), "public_visibility_manifest_read_failed"],
    [() => poisonedBucket.manifest.write(manifest, { ifMatchEtag: null }),
      "public_visibility_manifest_put_failed"],
  ]) {
    await assert.rejects(action, (error) => {
      assert.equal(error.message, expected);
      assert.equal(Object.hasOwn(error, "cause"), false);
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(String(error.stack), /R2_PRIVATE_BINDING_GETTER_CREDENTIAL_0662/);
      assert.equal(JSON.stringify(error).includes(secret), false);
      return true;
    });
  }
  assert.equal(bucketGets, 2, "both reads and writes independently reject a throwing env binding");

  let modeGets = 0;
  const guardEnv = {};
  Object.defineProperty(guardEnv, "PUBLIC_VISIBILITY_GUARD_MODE", {
    get() {
      modeGets++;
      throw new Error("guard-mode binding access: " + secret);
    },
  });
  await assert.rejects(host(guardEnv).manifest.read(), (error) => {
    assert.equal(error.message, "public_visibility_manifest_read_failed");
    assert.equal(Object.hasOwn(error, "cause"), false);
    assert.doesNotMatch(String(error.stack), /R2_PRIVATE_BINDING_GETTER_CREDENTIAL_0662/);
    return true;
  });
  assert.equal(modeGets, 1, "missing bucket guard-mode resolution must not leak provider errors");
});

test("U01 #717 Error.message throwing accessor cannot bypass manifest provider redaction", async () => {
  // A provider may expose an Error subclass or Proxy with an accessor that
  // throws an unrelated credential-bearing exception while being inspected.
  // This is distinct from ordinary provider rejects and throwing env bindings.
  const secret = "SQL_PARAMS_PRIVATE_CANARY_0662";
  const hostile = new Error("opaque_provider_failure");
  let getterReads = 0;
  Object.defineProperty(hostile, "message", {
    get() {
      getterReads++;
      throw new Error("failed query params: " + secret, {
        cause: new Error("Authorization: bearer " + secret),
      });
    },
  });
  const poisoned = host({ BUCKET: {
    get: async () => { throw hostile; },
    put: async () => { throw hostile; },
  } });
  const empty = { schema_version: 1, revision: 0, generated_at: 1, entities: [] };
  for (const [action, code] of [
    [() => poisoned.manifest.read(), "public_visibility_manifest_read_failed"],
    [() => poisoned.manifest.write(empty, { ifMatchEtag: "prior-etag" }),
      "public_visibility_manifest_put_failed"],
  ]) {
    await assert.rejects(action, (error) => {
      assert.equal(error.message, code);
      assert.equal(error.cause, undefined);
      assert.equal(Object.hasOwn(error, "cause"), false);
      assert.doesNotMatch(String(error.stack), /SQL_PARAMS_PRIVATE_CANARY_0662|Authorization|params:/);
      assert.equal(JSON.stringify(error).includes(secret), false);
      return true;
    });
  }
  assert.equal(getterReads, 2, "both paths must deliberately inspect but never leak a hostile message");
});
