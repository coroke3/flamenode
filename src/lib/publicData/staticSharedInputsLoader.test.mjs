import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";

if (process.env.FLAMENODE_STATIC_SHARED_INPUTS_EXECUTION !== "1") {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--test",
      fileURLToPath(import.meta.url),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_STATIC_SHARED_INPUTS_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return {
          url: "data:text/javascript,export%20{}",
          shortCircuit: true,
        };
      }
      if (specifier === "react") {
        return {
          url: "data:text/javascript,export%20function%20cache(fn)%7Breturn%20fn%7D",
          shortCircuit: true,
        };
      }
      if (specifier === "@opennextjs/cloudflare") {
        return {
          url: "data:text/javascript," + encodeURIComponent(
            "export function getCloudflareContext(){return {env:{PUBLIC_VISIBILITY_GUARD_MODE:globalThis.__trendingWorkerVisibilityModeForTests}}}"
          ),
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  let r2Objects = new Map();
  let manifestReads = 0;
  let afterManifestGet = null;
  globalThis.__trendingWorkerVisibilityModeForTests = undefined;
  const cacheStore = new Map();
  const cacheWrites = [];

  mock.module("@/lib/cloudflare", {
    namedExports: {
      getEnv() {
        return {
          BUCKET: {
            async get(key) {
              const value = r2Objects.get(key);
              // Snapshot the old value, then allow a concurrent visibility
              // mutation before the next R2 GET (the returned ETag must track
              // the bytes, never a constant from the mock).
              if (key === "visibility/blocked-entities.v1.json") {
                manifestReads += 1;
                afterManifestGet?.(manifestReads);
              }
              if (value == null) return null;
              return {
                // Real R2 exposes json() to static snapshots and text()/etag
                // to the separate visibility-manifest reader.
                etag: key === "visibility/blocked-entities.v1.json"
                  ? "manifest-test-etag-" + value.revision : undefined,
                size: Buffer.byteLength(JSON.stringify(value)),
                async json() {
                  return value;
                },
                async text() {
                  return JSON.stringify(value);
                },
              };
            },
          },
        };
      },
    },
  });

  mock.module("@/lib/observability/publicRequestMetrics", {
    namedExports: {
      notePublicArtifactMode() {},
      recordPublicR2Get() {},
    },
  });

  mock.module("./publicCache.ts", {
    namedExports: {
      coercePublicJsonCacheEnvelope(value, fallbackStoredAt, options) {
        if (value == null) return null;
        if (
          typeof value === "object" &&
          "payload" in value &&
          typeof value.stored_at === "number"
        ) {
          return value;
        }
        if (options?.requireStoredAt) return null;
        return { payload: value, stored_at: fallbackStoredAt };
      },
      async readPublicJsonCache(key) {
        return cacheStore.get(key) ?? null;
      },
      unwrapPublicJsonCachePayload(value) {
        if (value == null) return null;
        if (
          typeof value === "object" &&
          "payload" in value &&
          typeof value.stored_at === "number"
        ) {
          return value.payload;
        }
        return value;
      },
      writePublicJsonCacheBestEffort(key, payload, ttl) {
        cacheWrites.push({ key, payload, ttl });
        cacheStore.set(key, payload);
      },
    },
  });

  const { loadStaticJsonFreshStaleUnavailable } = await import(
    "./staticSharedInputsLoader.ts"
  );
  const {
    TOP_SLOT_STATS_OBJECT_KEY,
    normalizeStaticTopSlotStats,
  } = await import("./staticTopSlotStatsCore.ts");
  const { resetPublicJsonIsolateCacheForTests } = await import(
    "./publicCacheIsolate.ts"
  );
  const {
    TRENDING_OBJECT_KEY,
    TRENDING_STALE_MAX_AGE_SEC,
    normalizeStaticTrending,
  } = await import("./staticTrendingCore.ts");

  function slotStatsPayload(generatedAt) {
    return {
      schema_version: 1,
      generated_at: generatedAt,
      items: [{ event_id: "e1", available: 1, total: 2 }],
    };
  }

  function resetHarness() {
    globalThis.__trendingWorkerVisibilityModeForTests = undefined;
    r2Objects = new Map();
    manifestReads = 0;
    afterManifestGet = null;
    cacheStore.clear();
    cacheWrites.length = 0;
    resetPublicJsonIsolateCacheForTests();
  }

  test("Issue #653 exposure baseline: cached revoked trending survives a repaired R2 PUT and R2 outage", async () => {
    // Characterizes the CURRENT privacy STOP, not a passing revocation
    // acceptance test. A repaired writer object does not invalidate old
    // Cache API bytes, and an R2 outage permits 3-hour stale replay.
    resetHarness();
    const nowSec = 1_700_000_000;
    const revoked = {
      id: "now-private", title: "Formerly public secret title",
      youtube_video_id: "yt-revoked", display_name: "creator",
      icon_url: null, primary_event_id: null, primary_event_title: null,
      scheduled_time: nowSec - 3600, status: "public", rank: 1,
      video_id: "now-private", views_2d: 1, views_5d: 2,
      views_7d: 3, views_30d: 4,
    };
    const old = { schema_version: 1, generated_at: nowSec - 120, items: [revoked] };
    const repaired = { schema_version: 1, generated_at: nowSec - 120, items: [] };
    const readAt = (clock) => loadStaticJsonFreshStaleUnavailable({
      key: TRENDING_OBJECT_KEY,
      normalize: (value) => normalizeStaticTrending(value, clock),
      cacheMode: "cache_first",
      maxStaleAgeSec: TRENDING_STALE_MAX_AGE_SEC,
      cacheTtlSeconds: 300,
      nowSec: clock,
    });

    // R2 was repaired after the cache was populated, but cache_first does
    // not read R2 on a valid fresh hit (even at the same generated_at).
    cacheStore.set(TRENDING_OBJECT_KEY, { payload: old, stored_at: nowSec - 60 });
    r2Objects.set(TRENDING_OBJECT_KEY, repaired);
    const freshLeak = await readAt(nowSec);
    assert.equal(freshLeak.status, "fresh");
    assert.deepEqual(freshLeak.value?.items.map((row) => row.id), ["now-private"]);
    assert.equal(cacheWrites.length, 0, "fresh cache hit never checked repaired R2");

    // After the 300-second fresh interval, an R2 GET failure still returns
    // the old item as stale until the separately configured 3-hour window.
    cacheStore.set(TRENDING_OBJECT_KEY, { payload: old, stored_at: nowSec - 301 });
    r2Objects.clear();
    const staleLeak = await readAt(nowSec);
    assert.equal(staleLeak.status, "stale");
    assert.deepEqual(staleLeak.value?.items.map((row) => row.id), ["now-private"]);

    cacheStore.set(TRENDING_OBJECT_KEY, {
      payload: old, stored_at: nowSec - TRENDING_STALE_MAX_AGE_SEC - 1,
    });
    const expired = await readAt(nowSec);
    assert.equal(expired.status, "unavailable");
    assert.equal(expired.value, null);

    // Only a successful new read after expiry can consume the repaired
    // artifact; existing Next ISR/CDN or Astro HTML are outside this test.
    cacheStore.set(TRENDING_OBJECT_KEY, { payload: old, stored_at: nowSec - 301 });
    r2Objects.set(TRENDING_OBJECT_KEY, repaired);
    const updated = await readAt(nowSec);
    assert.equal(updated.status, "fresh");
    assert.deepEqual(updated.value?.items, []);
    assert.equal(cacheWrites.length, 1);
  });

  test("Issue #653: enforced trending reader filters fresh Cache API entries against a current R2 visibility fence", async () => {
    resetHarness();
    const previousMode = process.env.PUBLIC_VISIBILITY_GUARD_MODE;
    process.env.PUBLIC_VISIBILITY_GUARD_MODE = "enforce";
    const now = 1_700_000_000;
    const row = (id, eventId = null) => ({
      id, title: id === "v-private" ? "revoked private title" : "Visible",
      youtube_video_id: "yt-" + id, display_name: "Creator",
      icon_url: null, primary_event_id: eventId,
      primary_event_title: eventId ? "event secret" : null,
      scheduled_time: now - 100, status: "public",
      views_2d: 1, views_5d: 2, views_7d: 3, views_30d: 4,
    });
    const old = {
      schema_version: 1, generated_at: now - 120,
      items: [row("v-private"), row("v-withdrawn-event", "e-private"), row("v-ok")],
    };
    const manifestKey = "visibility/blocked-entities.v1.json";
    const manifest = {
      schema_version: 1, revision: 2, generated_at: now,
      entities: [
        { entity_type: "video", entity_id: "v-private", fence_token: "f-1", blocked_at: now },
        { entity_type: "event", entity_id: "e-private", fence_token: "f-2", blocked_at: now },
      ],
    };
    cacheStore.set(TRENDING_OBJECT_KEY, { payload: old, stored_at: now - 60 });
    r2Objects.set(manifestKey, manifest);
    const { loadStaticTrending } = await import("./trendingLoader.ts");
    try {
      const filtered = await loadStaticTrending(now);
      assert.equal(filtered.state, "ready");
      assert.deepEqual(filtered.data?.items.map((item) => item.id), ["v-ok"]);
      assert.equal(filtered.data?.generatedAt, now - 120);
      assert.equal(cacheWrites.length, 0, "no extra R2 writer/cached overwrite on read");
      assert.deepEqual(cacheStore.get(TRENDING_OBJECT_KEY).payload, old,
        "cached original remains untouched");

      // With a full cache hit but no trustworthy manifest, enforce cannot
      // treat embedded "public" status as proof of CURRENT visibility.
      r2Objects.delete(manifestKey);
      const unavailable = await loadStaticTrending(now);
      assert.equal(unavailable.state, "unavailable");
      assert.equal(unavailable.data, null);

      r2Objects.set(manifestKey, { ...manifest, schema_version: 999 });
      const malformed = await loadStaticTrending(now);
      assert.equal(malformed.state, "unavailable");
      assert.equal(malformed.data, null);
    } finally {
      if (previousMode === undefined) delete process.env.PUBLIC_VISIBILITY_GUARD_MODE;
      else process.env.PUBLIC_VISIBILITY_GUARD_MODE = previousMode;
    }
  });

  test("Issue #653: in-flight R2 fence revision change rejects previously cached ranking", async () => {
    resetHarness();
    const previousMode = process.env.PUBLIC_VISIBILITY_GUARD_MODE;
    process.env.PUBLIC_VISIBILITY_GUARD_MODE = "observe";
    globalThis.__trendingWorkerVisibilityModeForTests = "enforce";
    const now = 1_700_000_000;
    const old = {
      schema_version: 1, generated_at: now - 120,
      items: [{
        id: "v-now-private", title: "previously public private title",
        youtube_video_id: "yt-now-private", display_name: "creator",
        icon_url: null, primary_event_id: null, primary_event_title: null,
        scheduled_time: now - 100, status: "public",
        views_2d: 1, views_5d: 2, views_7d: 3, views_30d: 4,
      }],
    };
    const key = "visibility/blocked-entities.v1.json";
    const before = { schema_version: 1, revision: 1, generated_at: now, entities: [] };
    const revoked = {
      schema_version: 1, revision: 2, generated_at: now,
      entities: [{
        entity_type: "video", entity_id: "v-now-private",
        fence_token: "revocation", blocked_at: now,
      }],
    };
    cacheStore.set(TRENDING_OBJECT_KEY, { payload: old, stored_at: now - 60 });
    r2Objects.set(key, before);
    const { loadStaticTrending } = await import("./trendingLoader.ts");
    try {
      afterManifestGet = (count) => {
        if (count === 1) r2Objects.set(key, revoked);
      };
      const raced = await loadStaticTrending(now);
      assert.equal(manifestReads, 2,
        "must check the manifest ETag both before and after filtering");
      assert.equal(raced.state, "unavailable");
      assert.equal(raced.data, null,
        "the first manifest's public verdict must not escape after revocation");
      assert.deepEqual(cacheStore.get(TRENDING_OBJECT_KEY).payload, old,
        "reader must never mutate cached bytes");

      afterManifestGet = null;
      const stableRevoked = await loadStaticTrending(now);
      assert.equal(manifestReads, 4);
      assert.equal(stableRevoked.state, "empty");
      assert.deepEqual(stableRevoked.data?.items, [],
        "stable revoked manifest still returns the safe filtered result");

      r2Objects.set(key, before);
      afterManifestGet = (count) => {
        if (count === 5) r2Objects.delete(key);
      };
      const vanished = await loadStaticTrending(now);
      assert.equal(manifestReads, 6);
      assert.equal(vanished.state, "unavailable",
        "manifest disappearing between reads cannot authorize stale ranking");
      assert.equal(vanished.data, null);

      afterManifestGet = null;
      r2Objects.set(key, before);
      const stablePublic = await loadStaticTrending(now);
      assert.equal(manifestReads, 8);
      assert.deepEqual(stablePublic.data?.items.map((row) => row.id), ["v-now-private"],
        "unchanged committed generation still passes the existing public contract");
    } finally {
      afterManifestGet = null;
      globalThis.__trendingWorkerVisibilityModeForTests = undefined;
      if (previousMode === undefined) delete process.env.PUBLIC_VISIBILITY_GUARD_MODE;
      else process.env.PUBLIC_VISIBILITY_GUARD_MODE = previousMode;
    }
  });

  test("Issue #653: Worker guard binding overrides divergent process.env in cached ranking", async () => {
    resetHarness();
    const previous = process.env.PUBLIC_VISIBILITY_GUARD_MODE;
    const now = 1_700_000_000;
    const revoked = {
      id: "v-revoked", title: "previously-public-title",
      youtube_video_id: "yt-revoked", display_name: "creator",
      icon_url: null, primary_event_id: null, primary_event_title: null,
      scheduled_time: now - 100, status: "public",
      views_2d: 1, views_5d: 2, views_7d: 3, views_30d: 4,
    };
    const old = { schema_version: 1, generated_at: now - 120, items: [revoked] };
    const manifestKey = "visibility/blocked-entities.v1.json";
    const manifest = {
      schema_version: 1, revision: 1, generated_at: now,
      entities: [{
        entity_type: "video", entity_id: "v-revoked",
        fence_token: "f-1", blocked_at: now,
      }],
    };
    cacheStore.set(TRENDING_OBJECT_KEY, { payload: old, stored_at: now - 60 });
    r2Objects.set(manifestKey, manifest);
    const { loadStaticTrending } = await import("./trendingLoader.ts");
    try {
      process.env.PUBLIC_VISIBILITY_GUARD_MODE = "observe";
      globalThis.__trendingWorkerVisibilityModeForTests = "enforce";
      const enforced = await loadStaticTrending(now);
      assert.equal(enforced.state, "empty",
        "Worker enforce must not silently fall back to process.env observe");
      assert.deepEqual(enforced.data?.items, []);

      globalThis.__trendingWorkerVisibilityModeForTests = "off";
      process.env.PUBLIC_VISIBILITY_GUARD_MODE = "enforce";
      const explicitlyOff = await loadStaticTrending(now);
      assert.deepEqual(explicitlyOff.data?.items.map((x) => x.id), ["v-revoked"],
        "explicit Worker off overrides mismatched process.env, preserving opt-out");

      globalThis.__trendingWorkerVisibilityModeForTests = undefined;
      const localFallback = await loadStaticTrending(now);
      assert.deepEqual(localFallback.data?.items, [],
        "without a Worker var, retain existing process.env fallback");

      globalThis.__trendingWorkerVisibilityModeForTests = "enforce";
      process.env.PUBLIC_VISIBILITY_GUARD_MODE = "observe";
      r2Objects.delete(manifestKey);
      const missing = await loadStaticTrending(now);
      assert.equal(missing.state, "unavailable",
        "enforced Worker must fail closed when R2 manifest is unavailable");
      assert.equal(missing.data, null);
    } finally {
      globalThis.__trendingWorkerVisibilityModeForTests = undefined;
      if (previous === undefined) delete process.env.PUBLIC_VISIBILITY_GUARD_MODE;
      else process.env.PUBLIC_VISIBILITY_GUARD_MODE = previous;
    }
  });

  test("loadStaticJsonFreshStaleUnavailable prefers newer R2 over fresh cache", async () => {
    resetHarness();
    const now = 1_700_000_000;
    cacheStore.set(TOP_SLOT_STATS_OBJECT_KEY, {
      payload: slotStatsPayload(100),
      stored_at: now - 60,
    });
    r2Objects.set(TOP_SLOT_STATS_OBJECT_KEY, slotStatsPayload(200));

    const result = await loadStaticJsonFreshStaleUnavailable({
      key: TOP_SLOT_STATS_OBJECT_KEY,
      normalize: normalizeStaticTopSlotStats,
      maxStaleAgeSec: 1200,
      cacheTtlSeconds: 600,
      nowSec: now,
      getGeneratedAt: (value) => value.generatedAt,
    });

    assert.equal(result.status, "fresh");
    assert.equal(result.value?.generatedAt, 200);
    assert.equal(cacheWrites.length, 1);
    assert.equal(cacheWrites[0]?.payload?.payload?.generated_at, 200);
  });

  test("loadStaticJsonFreshStaleUnavailable keeps fresh cache when R2 is older", async () => {
    resetHarness();
    const now = 1_700_000_000;
    cacheStore.set(TOP_SLOT_STATS_OBJECT_KEY, {
      payload: slotStatsPayload(200),
      stored_at: now - 60,
    });
    r2Objects.set(TOP_SLOT_STATS_OBJECT_KEY, slotStatsPayload(100));

    const result = await loadStaticJsonFreshStaleUnavailable({
      key: TOP_SLOT_STATS_OBJECT_KEY,
      normalize: normalizeStaticTopSlotStats,
      maxStaleAgeSec: 1200,
      cacheTtlSeconds: 600,
      nowSec: now,
      getGeneratedAt: (value) => value.generatedAt,
    });

    assert.equal(result.status, "fresh");
    assert.equal(result.value?.generatedAt, 200);
    assert.equal(cacheWrites.length, 0);
  });

  test("loadStaticJsonFreshStaleUnavailable bypass skips cache read/write", async () => {
    resetHarness();
    const now = 1_700_000_000;
    cacheStore.set(TOP_SLOT_STATS_OBJECT_KEY, {
      payload: slotStatsPayload(300),
      stored_at: now - 60,
    });
    r2Objects.set(TOP_SLOT_STATS_OBJECT_KEY, slotStatsPayload(100));

    const result = await loadStaticJsonFreshStaleUnavailable({
      key: TOP_SLOT_STATS_OBJECT_KEY,
      normalize: normalizeStaticTopSlotStats,
      maxStaleAgeSec: 1200,
      cacheTtlSeconds: 600,
      cacheMode: "bypass",
      nowSec: now,
      getGeneratedAt: (value) => value.generatedAt,
    });

    assert.equal(result.status, "fresh");
    assert.equal(result.value?.generatedAt, 100);
    assert.equal(cacheWrites.length, 0);
  });

  test("loadStaticJsonFreshStaleUnavailable r2_first uses bounded stale cache only after R2 miss", async () => {
    resetHarness();
    const now = 1_700_000_000;
    cacheStore.set(TOP_SLOT_STATS_OBJECT_KEY, {
      payload: slotStatsPayload(300),
      stored_at: now - 600,
    });

    const stale = await loadStaticJsonFreshStaleUnavailable({
      key: TOP_SLOT_STATS_OBJECT_KEY,
      normalize: normalizeStaticTopSlotStats,
      maxStaleAgeSec: 1200,
      cacheTtlSeconds: 600,
      cacheMode: "r2_first",
      nowSec: now,
      getGeneratedAt: (value) => value.generatedAt,
    });
    assert.equal(stale.status, "stale");
    assert.equal(stale.value?.generatedAt, 300);

    cacheStore.set(TOP_SLOT_STATS_OBJECT_KEY, {
      payload: slotStatsPayload(300),
      stored_at: now - 1201,
    });
    const unavailable = await loadStaticJsonFreshStaleUnavailable({
      key: TOP_SLOT_STATS_OBJECT_KEY,
      normalize: normalizeStaticTopSlotStats,
      maxStaleAgeSec: 1200,
      cacheTtlSeconds: 600,
      cacheMode: "r2_first",
      nowSec: now,
      getGeneratedAt: (value) => value.generatedAt,
    });
    assert.equal(unavailable.status, "unavailable");
    assert.equal(unavailable.value, null);

    cacheStore.set(TOP_SLOT_STATS_OBJECT_KEY, slotStatsPayload(300));
    const legacyUnavailable = await loadStaticJsonFreshStaleUnavailable({
      key: TOP_SLOT_STATS_OBJECT_KEY,
      normalize: normalizeStaticTopSlotStats,
      maxStaleAgeSec: 1200,
      cacheTtlSeconds: 600,
      cacheMode: "r2_first",
      nowSec: now,
      getGeneratedAt: (value) => value.generatedAt,
    });
    assert.equal(legacyUnavailable.status, "unavailable");
  });
}
