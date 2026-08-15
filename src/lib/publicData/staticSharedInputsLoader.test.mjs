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
          url: "data:text/javascript,export%20function%20getCloudflareContext()%7Breturn%20%7B%7D%7D",
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  let r2Objects = new Map();
  const cacheStore = new Map();
  const cacheWrites = [];

  mock.module("@/lib/cloudflare", {
    namedExports: {
      getEnv() {
        return {
          BUCKET: {
            async get(key) {
              const value = r2Objects.get(key);
              if (value == null) return null;
              return {
                async json() {
                  return value;
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

  function slotStatsPayload(generatedAt) {
    return {
      schema_version: 1,
      generated_at: generatedAt,
      items: [{ event_id: "e1", available: 1, total: 2 }],
    };
  }

  function resetHarness() {
    r2Objects = new Map();
    cacheStore.clear();
    cacheWrites.length = 0;
  }

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
