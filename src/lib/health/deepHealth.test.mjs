import assert from "node:assert/strict";
import { test } from "node:test";
import { getTableName, isTable } from "drizzle-orm";
import * as dbSchema from "../db/schema.ts";
import {
  authorizeDeepHealth,
  runDeepHealthChecks,
} from "./deepHealth.ts";
import {
  ARTIFACT_SLO_MAX_AGE_SEC,
  ARTIFACT_SLO_PROBES,
  assertArtifactSloFresh,
  assertTrackedDetailArtifactSloFresh,
} from "./artifactSlo.ts";
import {
  REQUIRED_RUNTIME_TABLE_COUNT,
  RUNTIME_CRITICAL_TABLES,
} from "./schemaContract.ts";

const commit = "b".repeat(40);

function artifactPayload(key, now) {
  const generatedAt = now - 60;
  if (key === "top.json") {
    return {
      generated_at: generatedAt,
      latest: [],
      nostalgic_pool: [],
      nostalgic: [],
      nostalgic_shuffled_at: generatedAt,
      stats: { public_videos: 0 },
    };
  }
  if (key === "list/recent.json" || key === "list/popular.json") {
    return { generated_at: generatedAt, total: 0, items: [] };
  }
  if (key === "search-index-lite.json") {
    return { generated_at: generatedAt, videos: [], users: [] };
  }
  if (key === "events/index.json") {
    return { generated_at: generatedAt, items: [], group_sections: [] };
  }
  if (key === "users/index.json") {
    return { generated_at: generatedAt, items: [] };
  }
  if (key === "recommend.json") {
    return {
      generated_at: generatedAt,
      recommended: [],
      latest: [],
      underrated: [],
      creators: [],
    };
  }
  if (key === "recommend/core.v1.json") {
    return {
      schema_version: 1,
      generated_at: generatedAt,
      recommended: [],
      latest: [],
      underrated: [],
    };
  }
  if (key === "rules/current.json") {
    return {
      generated_at: generatedAt,
      version_label: "v1",
      body_markdown: "rules",
    };
  }
  if (key === "youtube/related-blocklist.v1.json") {
    return {
      schema_version: 1,
      generated_at: generatedAt,
      blocked: {},
    };
  }
  if (key === "videos/random-pool.v1.json") {
    return {
      schema_version: 1,
      generated_at: generatedAt,
      generation_key: "fixture-generation",
      items: [],
    };
  }
  if (key === "visibility/blocked-entities.v1.json") {
    return {
      schema_version: 1,
      revision: 0,
      generated_at: generatedAt,
      entities: [],
    };
  }
  throw new Error(`unexpected artifact key ${key}`);
}

function createBucket(now) {
  return {
    head: async () => null,
    get: async (key) => ({
      text: async () => JSON.stringify(artifactPayload(key, now)),
    }),
  };
}

function createBaseEnv(now, overrides = {}) {
  return {
    BUILD_COMMIT_SHA: commit,
    QUEUE_DISPATCH_ENABLED: "1",
    QUEUE_CONTINUATION_ENABLED: "1",
    QUEUE_YOUTUBE_SYNC_ENABLED: "1",
    NOTIFICATION_WAKE_QUEUE: { send: () => {} },
    STATIC_REBUILD_WAKE_QUEUE: { send: () => {} },
    YOUTUBE_SYNC_WAKE_QUEUE: { send: () => {} },
    DB: {
      prepare: () => ({
        first: async () => ({
          version: "2026-08-24-observability-1",
          required_table_count: REQUIRED_RUNTIME_TABLE_COUNT,
          public_video_detail_count: 0,
          tracked_video_detail_count: 0,
          oldest_video_detail_generated_at: null,
          public_event_detail_count: 0,
          tracked_event_detail_count: 0,
          oldest_event_detail_generated_at: null,
        }),
      }),
    },
    KV: { get: async () => null },
    BUCKET: createBucket(now),
    ...overrides,
  };
}

test("runtime table contract covers every table exported by the canonical schema", () => {
  const exportedTables = Object.values(dbSchema)
    .filter(isTable)
    .map(getTableName)
    .sort();
  const contractedTables = RUNTIME_CRITICAL_TABLES.filter(
    (table) => table !== "d1_migrations",
  ).sort();
  assert.deepEqual(contractedTables, exportedTables);
});

test("deep health rejects missing and invalid bearer tokens", async () => {
  const request = new Request("https://example.com/api/health/deep");
  assert.equal(authorizeDeepHealth(request, undefined)?.status, 503);
  assert.equal(authorizeDeepHealth(request, "secret-token")?.status, 401);
});

test("deep health performs read-only D1, KV and R2 probes", async () => {
  const calls = [];
  const now = Math.floor(Date.now() / 1000);
  const env = createBaseEnv(now, {
    DB: {
      prepare(query) {
        calls.push(["d1", query]);
        return {
          first: async () => ({
            version: "2026-08-24-observability-1",
            required_table_count: REQUIRED_RUNTIME_TABLE_COUNT,
            public_video_detail_count: 0,
            tracked_video_detail_count: 0,
            oldest_video_detail_generated_at: null,
            public_event_detail_count: 0,
            tracked_event_detail_count: 0,
            oldest_event_detail_generated_at: null,
          }),
        };
      },
    },
    KV: { get: async (key) => calls.push(["kv", key]) },
    BUCKET: {
      head: async (key) => calls.push(["r2", key]),
      get: async (key) => {
        calls.push(["r2-get", key]);
        return {
          text: async () => JSON.stringify(artifactPayload(key, now)),
        };
      },
    },
  });
  assert.deepEqual(await runDeepHealthChecks(env), {
    ok: true,
    status: "ok",
    service: "flamenode-web",
    commit,
    checks: {
      d1: "ok",
      kv: "ok",
      r2: "ok",
      schema: "ok",
      queues: "ok",
      static_artifacts: "ok",
      public_visibility: "ok",
    },
    public_visibility_guard_mode: "observe",
  });
  assert.ok(calls.some(([kind]) => kind === "d1"));
  assert.ok(calls.some(([kind]) => kind === "kv"));
  assert.ok(calls.some(([kind]) => kind === "r2"));
  assert.ok(calls.filter(([kind]) => kind === "r2-get").length >= 9);
});

test("deep health allows all queue flags disabled in local preview", async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = createBaseEnv(now, {
    FLAMENODE_LOCAL_PREVIEW: "1",
    QUEUE_DISPATCH_ENABLED: "0",
    QUEUE_CONTINUATION_ENABLED: "0",
    QUEUE_YOUTUBE_SYNC_ENABLED: "0",
  });
  const result = await runDeepHealthChecks(env);
  assert.equal(result.checks.queues, "ok");
  assert.equal(result.status, "ok");
});

test("deep health rejects all queue flags disabled in production", async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = createBaseEnv(now, {
    QUEUE_DISPATCH_ENABLED: "0",
    QUEUE_CONTINUATION_ENABLED: "0",
    QUEUE_YOUTUBE_SYNC_ENABLED: "0",
  });
  await assert.rejects(
    () => runDeepHealthChecks(env),
    /queues disabled in production/,
  );
});

test("deep health reports degraded when queue emergency stop is configured", async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = createBaseEnv(now, {
    QUEUE_DISPATCH_ENABLED: "0",
    QUEUE_CONTINUATION_ENABLED: "0",
    QUEUE_YOUTUBE_SYNC_ENABLED: "0",
    QUEUE_EMERGENCY_DISABLED: "1",
    QUEUE_EMERGENCY_REASON: "incident mitigation",
    QUEUE_EMERGENCY_EXPIRES_AT: String(now + 3600),
  });
  const result = await runDeepHealthChecks(env);
  assert.equal(result.status, "degraded");
  assert.equal(result.ok, false);
  assert.equal(result.checks.queues, "degraded");
});

test("deep health rejects queue emergency mode while any queue flag remains enabled", async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = createBaseEnv(now, {
    QUEUE_EMERGENCY_DISABLED: "1",
    QUEUE_EMERGENCY_REASON: "incident mitigation",
    QUEUE_EMERGENCY_EXPIRES_AT: String(now + 3600),
  });
  await assert.rejects(
    () => runDeepHealthChecks(env),
    /queue emergency requires all queue flags disabled/,
  );
});

test("deep health rejects top.json without nostalgic shelf contract", async () => {
  const now = Math.floor(Date.now() / 1000);
  const bucket = {
    async get(key) {
      if (key === "top.json") {
        return {
          text: async () =>
            JSON.stringify({
              generated_at: now,
              latest: [],
              stats: { public_videos: 0 },
            }),
        };
      }
      return {
        text: async () => JSON.stringify(artifactPayload(key, now)),
      };
    },
  };

  await assert.rejects(
    () => assertArtifactSloFresh(bucket, now),
    /missing required field nostalgic_pool/,
  );
});

test("deep health fails closed when queue flags are partially enabled", async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = createBaseEnv(now, {
    QUEUE_DISPATCH_ENABLED: "1",
    QUEUE_CONTINUATION_ENABLED: "0",
    QUEUE_YOUTUBE_SYNC_ENABLED: "1",
  });
  await assert.rejects(() => runDeepHealthChecks(env), /queue continuation disabled/);
});

test("deep health fails closed on schema mismatch", async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = createBaseEnv(now, {
    DB: { prepare: () => ({ first: async () => ({ version: "old" }) }) },
  });
  await assert.rejects(() => runDeepHealthChecks(env), /schema version mismatch/);
});

test("deep health fails closed when any runtime table is missing", async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = createBaseEnv(now, {
    DB: {
      prepare: () => ({
        first: async () => ({
            version: "2026-08-24-observability-1",
          required_table_count: REQUIRED_RUNTIME_TABLE_COUNT - 1,
        }),
      }),
    },
  });
  await assert.rejects(
    () => runDeepHealthChecks(env),
    /required runtime table mismatch/,
  );
});

test("deep health defaults public visibility guard mode to observe", async () => {
  const now = Math.floor(Date.now() / 1000);
  const result = await runDeepHealthChecks(createBaseEnv(now));
  assert.equal(result.public_visibility_guard_mode, "observe");
});

test("deep health observes a missing visibility manifest without failing the service", async () => {
  const now = Math.floor(Date.now() / 1000);
  const baseBucket = createBucket(now);
  const env = createBaseEnv(now, {
    BUCKET: {
      head: baseBucket.head,
      get: async (key) =>
        key === "visibility/blocked-entities.v1.json"
          ? null
          : baseBucket.get(key),
    },
  });
  const result = await runDeepHealthChecks(env);
  assert.equal(result.status, "ok");
  assert.equal(result.ok, true);
  assert.equal(result.checks.public_visibility, "degraded");
});

test("deep health makes a missing visibility manifest blocking in enforce mode", async () => {
  const now = Math.floor(Date.now() / 1000);
  const baseBucket = createBucket(now);
  const env = createBaseEnv(now, {
    PUBLIC_VISIBILITY_GUARD_MODE: "enforce",
    BUCKET: {
      head: baseBucket.head,
      get: async (key) =>
        key === "visibility/blocked-entities.v1.json"
          ? null
          : baseBucket.get(key),
    },
  });
  const result = await runDeepHealthChecks(env);
  assert.equal(result.status, "degraded");
  assert.equal(result.ok, false);
  assert.equal(result.checks.public_visibility, "degraded");
});

test("deep health reports malformed or unavailable visibility manifests as degraded", async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const getManifest of [
    async () => ({ text: async () => "{not-json" }),
    async () => {
      throw new Error("r2 temporarily unavailable");
    },
  ]) {
    const baseBucket = createBucket(now);
    const env = createBaseEnv(now, {
      PUBLIC_VISIBILITY_GUARD_MODE: "enforce",
      BUCKET: {
        head: baseBucket.head,
        get: async (key) =>
          key === "visibility/blocked-entities.v1.json"
            ? getManifest()
            : baseBucket.get(key),
      },
    });
    const result = await runDeepHealthChecks(env);
    assert.equal(result.status, "degraded");
    assert.equal(result.ok, false);
    assert.equal(result.checks.public_visibility, "degraded");
  }
});

test("deep health skips the visibility manifest read when guard mode is off", async () => {
  const now = Math.floor(Date.now() / 1000);
  const visibilityReads = [];
  const baseBucket = createBucket(now);
  const env = createBaseEnv(now, {
    PUBLIC_VISIBILITY_GUARD_MODE: "off",
    BUCKET: {
      head: baseBucket.head,
      get: async (key) => {
        visibilityReads.push(key);
        return baseBucket.get(key);
      },
    },
  });
  const result = await runDeepHealthChecks(env);
  assert.equal(result.status, "ok");
  assert.equal(result.checks.public_visibility, "ok");
  assert.equal(
    visibilityReads.includes("visibility/blocked-entities.v1.json"),
    false,
  );
});

test("artifact SLO allows missing visibility blocked-entities manifest (bootstrap-ok)", async () => {
  const now = Math.floor(Date.now() / 1000);
  const bucket = {
    async get(key) {
      if (key === "visibility/blocked-entities.v1.json") return null;
      return {
        text: async () => JSON.stringify(artifactPayload(key, now)),
      };
    },
  };
  await assertArtifactSloFresh(bucket, now);
});

test("artifact SLO enforces every configured global freshness boundary", async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const staleProbe of ARTIFACT_SLO_PROBES.filter(
    (probe) => !probe.allowMissing,
  )) {
    const bucket = {
      async get(key) {
        const probe = ARTIFACT_SLO_PROBES.find((entry) => entry.key === key);
        const generatedAt =
          key === staleProbe.key
            ? now - (staleProbe.maxAgeSec ?? ARTIFACT_SLO_MAX_AGE_SEC.top) - 1
            : now;
        return {
          text: async () =>
            JSON.stringify(artifactPayload(probe?.key ?? key, generatedAt)),
        };
      },
    };
    await assert.rejects(
      () => assertArtifactSloFresh(bucket, now),
      new RegExp(`${staleProbe.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: generated_at is stale`),
      staleProbe.key,
    );
  }
});

test("detail artifact SLO rejects incomplete and stale tracked inventories", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.throws(
    () =>
      assertTrackedDetailArtifactSloFresh(
        {
          public_video_detail_count: 2,
          tracked_video_detail_count: 1,
          oldest_video_detail_generated_at: now,
          public_event_detail_count: 0,
          tracked_event_detail_count: 0,
          oldest_event_detail_generated_at: null,
        },
        now,
      ),
    /video detail artifact inventory is incomplete/,
  );
  assert.throws(
    () =>
      assertTrackedDetailArtifactSloFresh(
        {
          public_video_detail_count: 1,
          tracked_video_detail_count: 1,
          oldest_video_detail_generated_at:
            now - ARTIFACT_SLO_MAX_AGE_SEC.video_detail - 1,
          public_event_detail_count: 1,
          tracked_event_detail_count: 1,
          oldest_event_detail_generated_at: now,
        },
        now,
      ),
    /video detail artifact is stale/,
  );
});
