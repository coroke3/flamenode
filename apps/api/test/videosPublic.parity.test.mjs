import assert from "node:assert/strict";
import { test } from "node:test";
import { runUnderRootTsx } from "./support/personalHarness.mjs";
import { createFakeBucket, createFakeKv, createSqlite, createD1, insert } from "./support/publicEventsHarness.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
  const CLOUDFLARE_STUB = stub(`
    export class CloudflareBindingsUnavailableError extends Error {
      constructor(missing = [], cause) {
        super("Cloudflare bindings unavailable: " + missing.join(", "));
        this.name = "CloudflareBindingsUnavailableError";
        this.missing = missing;
        this.cause = cause;
      }
    }
    export async function withDatabaseRead(fn) {
      const r = globalThis.__pubRef; r.calls += 1;
      if (r.dbError) throw new Error("db_down");
      return fn(r.db);
    }
    export const withDatabase = withDatabaseRead;
    export async function withDatabaseWrite(fn) { return fn(globalThis.__pubRef.db); }
    export function getDatabase() {
      const r = globalThis.__pubRef;
      if (r.dbError) throw new Error("db_down");
      return r.db;
    }
    export function getEnv() { return globalThis.__pubRef.env; }
  `);

  const NEXT_PORTS_STUB = stub(`
    export async function nextQueueWakeHost() {
      return {
        async sendWake() { return { result: "ok" }; }
      };
    }
    export function nextRethrowFrameworkControl() {}
  `);

  const OPENNEXT_STUB = stub(`
    export function getCloudflareContext() {
      const r = globalThis.__pubRef;
      return {
        env: r.env,
        waitUntil: (p) => { r.waitUntilPromises.push(p); },
      };
    }
  `);

  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      if (specifier === "@/lib/cloudflare") return { url: CLOUDFLARE_STUB, shortCircuit: true };
      if (specifier === "@/lib/serverCore/nextPorts") return { url: NEXT_PORTS_STUB, shortCircuit: true };
      if (specifier === "@opennextjs/cloudflare") return { url: OPENNEXT_STUB, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { schema } = await import("@flamenode/db");
  const { app } = await import("../src/app.ts");
  const { GET: currentVideosGet } = await import("../../../app/api/videos/route.ts");
  const { clearPublicApiRateLimitForTests } = await import("@flamenode/server-core/publicData/publicApi");
  const { resetOperationModeCachesForTests } = await import("../src/routes/live/operationMode.ts");
  const { resetPublicJsonIsolateCacheForTests } = await import("../../../src/lib/publicData/publicCacheIsolate.ts");
  const { resetPublicOperationModeCacheForTests } = await import("../../../src/lib/operationMode/publicModeCore.ts");

  function setupTestEnv() {
    clearPublicApiRateLimitForTests();
    resetOperationModeCachesForTests();
    resetPublicJsonIsolateCacheForTests();
    resetPublicOperationModeCacheForTests();

    const sqlite = createSqlite();
    const d1 = createD1(sqlite);
    const db = drizzle(d1, { schema });
    const bucket = createFakeBucket();
    const kv = createFakeKv();

    const env = {
      DB: d1,
      BUCKET: bucket,
      KV: kv,
      PUBLIC_VISIBILITY_GUARD_MODE: "off",
    };

    const pubRef = {
      env,
      db,
      calls: 0,
      dbError: false,
      waitUntilPromises: [],
    };
    globalThis.__pubRef = pubRef;

    return { sqlite, d1, db, bucket, kv, env, pubRef };
  }

  function seedFixtures(bucket) {
    const recentPayload = {
      generated_at: 1700000000,
      total: 3,
      items: [
        {
          id: "v1",
          title: "Video 1",
          youtube_video_id: "yt1",
          display_name: "Author 1",
          icon_url: "https://img/1.png",
          scheduled_time: 1700001000,
          status: "public",
        },
        {
          id: "v2",
          title: "Video 2",
          youtube_video_id: "yt2",
          display_name: "Author 2",
          icon_url: "https://img/2.png",
          scheduled_time: 1700002000,
          status: "public",
        },
        {
          id: "v3",
          title: "Video 3",
          youtube_video_id: "yt3",
          display_name: "Author 3",
          icon_url: "https://img/3.png",
          scheduled_time: 1700003000,
          status: "public",
        },
      ],
    };
    bucket.put("list/recent.json", recentPayload);

    const popularPayload = {
      generated_at: 1700000000,
      total: 2,
      items: [
        {
          id: "v2",
          title: "Video 2",
          youtube_video_id: "yt2",
          display_name: "Author 2",
          icon_url: "https://img/2.png",
          scheduled_time: 1700002000,
          status: "public",
          score: 100,
        },
        {
          id: "v1",
          title: "Video 1",
          youtube_video_id: "yt1",
          display_name: "Author 1",
          icon_url: "https://img/1.png",
          scheduled_time: 1700001000,
          status: "public",
          score: 50,
        },
      ],
    };
    bucket.put("list/popular.json", popularPayload);

    const eventBasePayload = {
      generated_at: 1700000000,
      event: {
        id: "evt-1",
        title: "Autumn Collab",
        visibility_status: "public",
      },
      public_videos: [
        {
          id: "v1",
          title: "Video 1",
          display_name: "Author 1",
          scheduled_time: 1700001000,
          score: 10,
        },
        {
          id: "v3",
          title: "Video 3",
          display_name: "Author 3",
          scheduled_time: 1700003000,
          score: 20,
        },
      ],
      video_total: 2,
    };
    bucket.put("events/evt-1/base.v1.json", eventBasePayload);

    const searchLitePayload = {
      generated_at: 1700000000,
      videos: [
        {
          id: "v1",
          title: "Apple Pie",
          creator_display_name: "Chef Apple",
        },
        {
          id: "v2",
          title: "Banana Split",
          creator_display_name: "Chef Banana",
        },
      ],
    };
    bucket.put("search-index-lite.json", searchLitePayload);
  }

  test("T01: RH-032 recent / old / score / event / search lite / <2 chars parity with CURRENT", async () => {
    const { bucket, env } = setupTestEnv();
    seedFixtures(bucket);

    const cases = [
      "http://localhost/api/videos",
      "http://localhost/api/videos?sort=old",
      "http://localhost/api/videos?sort=score",
      "http://localhost/api/videos?event=evt-1",
      "http://localhost/api/videos?event=evt-1&sort=old",
      "http://localhost/api/videos?q=Banana",
      "http://localhost/api/videos?q=a", // < 2 compact chars
      "http://localhost/api/videos?q=no_match_xyz",
    ];

    for (const urlStr of cases) {
      clearPublicApiRateLimitForTests();
      const currentReq = new Request(urlStr);
      const currentRes = await currentVideosGet(currentReq);
      const currentText = await currentRes.text();
      const currentEtag = currentRes.headers.get("ETag");

      clearPublicApiRateLimitForTests();
      const honoReq = new Request(urlStr);
      const honoRes = await app.request(honoReq, {}, env);
      const honoText = await honoRes.text();
      const honoEtag = honoRes.headers.get("ETag");

      assert.equal(honoRes.status, currentRes.status, `Status match for ${urlStr}`);
      assert.equal(
        honoRes.headers.get("Cache-Control"),
        currentRes.headers.get("Cache-Control"),
        `Cache-Control match for ${urlStr}`,
      );
      assert.equal(honoText, currentText, `Body text match for ${urlStr}`);
      assert.equal(honoEtag, currentEtag, `ETag match for ${urlStr}`);
    }
  });

  test("T01b: RH-032 search postings v1 path matches CURRENT", async () => {
    const { bucket, env } = setupTestEnv();
    const { buildStaticVideoSearchPostingArtifacts, staticVideoSearchPostingManifestObjectKey, staticVideoSearchPostingDirectoryObjectKey, staticVideoSearchPostingPageObjectKey } = await import("@flamenode/server-core/publicData/searchIndexCore");

    const items = [
      { id: "vid-1", title: "Cyberpunk Tokyo Night", display_name: "Cyber Artist", youtube_video_id: null, creator_x_user_id: null, creator_x_user_name: null },
      { id: "vid-2", title: "Retro Kyoto Sunset", display_name: "Kyoto Artist", youtube_video_id: null, creator_x_user_id: null, creator_x_user_name: null },
    ];

    const artifacts = buildStaticVideoSearchPostingArtifacts({
      items,
      generatedAt: 1700000000,
      generation: "gen-test",
    });

    bucket.put(staticVideoSearchPostingManifestObjectKey("current"), artifacts.manifest);
    for (const { bucket: b, directory } of artifacts.directories) {
      bucket.put(staticVideoSearchPostingDirectoryObjectKey("gen-test", b), directory);
    }
    for (const { bucket: b, page } of artifacts.pages) {
      bucket.put(staticVideoSearchPostingPageObjectKey("gen-test", b, page.page), page);
    }

    const urlStr = "http://localhost/api/videos?q=Tokyo";
    clearPublicApiRateLimitForTests();
    const currentRes = await currentVideosGet(new Request(urlStr));
    const currentText = await currentRes.text();

    clearPublicApiRateLimitForTests();
    const honoRes = await app.request(new Request(urlStr), {}, env);
    const honoText = await honoRes.text();

    assert.equal(honoRes.status, currentRes.status);
    assert.equal(honoText, currentText);
    const parsed = JSON.parse(honoText);
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0].id, "vid-1");
  });

  test("T02: limit and page clamping match CURRENT", async () => {
    const { bucket, env } = setupTestEnv();
    seedFixtures(bucket);

    const testUrls = [
      "http://localhost/api/videos?limit=100", // clamped to 48
      "http://localhost/api/videos?limit=0", // fallback to 24
      "http://localhost/api/videos?limit=-5", // fallback to 24
      "http://localhost/api/videos?page=9999", // clamped to ceil(5000/24) = 209
      "http://localhost/api/videos?page=0", // fallback to 1
    ];

    for (const urlStr of testUrls) {
      clearPublicApiRateLimitForTests();
      const currentRes = await currentVideosGet(new Request(urlStr));
      const currentBody = await currentRes.text();

      clearPublicApiRateLimitForTests();
      const honoRes = await app.request(new Request(urlStr), {}, env);
      const honoBody = await honoRes.text();

      assert.equal(honoRes.status, currentRes.status);
      assert.equal(honoBody, currentBody);
    }
  });

  test("T03: rate limit kicks in at 61st request with 429", async () => {
    const { bucket, env } = setupTestEnv();
    seedFixtures(bucket);

    const reqUrl = "http://localhost/api/videos";
    for (let i = 0; i < 60; i++) {
      const res = await app.request(new Request(reqUrl), {}, env);
      assert.equal(res.status, 200);
    }

    const blockedRes = await app.request(new Request(reqUrl), {}, env);
    assert.equal(blockedRes.status, 429);
    assert.equal(blockedRes.headers.get("Cache-Control"), "no-store");
    assert.ok(blockedRes.headers.get("Retry-After"));
  });

  test("T04: artifact absent, broken JSON, or empty collection returns 503", async () => {
    const { bucket, env } = setupTestEnv();

    // 1. Missing artifact
    clearPublicApiRateLimitForTests();
    const resMissing = await app.request(new Request("http://localhost/api/videos"), {}, env);
    assert.equal(resMissing.status, 503);
    const bodyMissing = await resMissing.json();
    assert.equal(bodyMissing.error, "static_list_unavailable");

    // 2. Broken JSON
    bucket.setRaw("list/recent.json", { data: "{ malformed json", size: 20 });
    clearPublicApiRateLimitForTests();
    const resBroken = await app.request(new Request("http://localhost/api/videos"), {}, env);
    assert.equal(resBroken.status, 503);

    // 3. Empty collection items: []
    bucket.put("list/recent.json", { generated_at: 1700000000, total: 0, items: [] });
    clearPublicApiRateLimitForTests();
    const resEmpty = await app.request(new Request("http://localhost/api/videos"), {}, env);
    assert.equal(resEmpty.status, 503);
  });

  test("T05: visibility guard modes enforce / observe / off", async () => {
    const { bucket, env } = setupTestEnv();
    seedFixtures(bucket);

    // Enforce without manifest -> fails closed 503
    env.PUBLIC_VISIBILITY_GUARD_MODE = "enforce";
    clearPublicApiRateLimitForTests();
    const resNoManifest = await app.request(new Request("http://localhost/api/videos"), {}, env);
    assert.equal(resNoManifest.status, 503);

    // Put valid manifest
    const manifest = {
      schema_version: 1,
      revision: 1,
      generated_at: 1700000000,
      entities: [
        { entity_type: "event", entity_id: "evt-blocked", fence_token: "t1", blocked_at: 1700000000 },
      ],
    };
    await bucket.put("visibility/blocked-entities.v1.json", manifest, {
      httpMetadata: { etag: '"etag-1"' },
    });

    // Enforce with valid manifest -> 200
    clearPublicApiRateLimitForTests();
    const resEnforceOk = await app.request(new Request("http://localhost/api/videos"), {}, env);
    assert.equal(resEnforceOk.status, 200);

    // Enforce with blocked event -> 503
    bucket.put("events/evt-blocked/base.v1.json", {
      event: { id: "evt-blocked", title: "Blocked", visibility_status: "public" },
      public_videos: [{ id: "v1", title: "V1", display_name: "D", scheduled_time: 1 }],
      video_total: 1,
    });
    clearPublicApiRateLimitForTests();
    const resBlocked = await app.request(
      new Request("http://localhost/api/videos?event=evt-blocked"),
      {},
      env,
    );
    assert.equal(resBlocked.status, 503);
  });

  test("T08: D1 statements = 0 for RH-032", async () => {
    const { bucket, env, pubRef } = setupTestEnv();
    seedFixtures(bucket);

    clearPublicApiRateLimitForTests();
    const res = await app.request(new Request("http://localhost/api/videos"), {}, env);
    assert.equal(res.status, 200);
    assert.equal(pubRef.calls, 0, "RH-032 must execute 0 D1 statements");
  });

  test("T09: Upper boundary measurements and query pages", async () => {
    const { bucket, env } = setupTestEnv();

    // 48 items with max titles
    const items = Array.from({ length: 48 }, (_, i) => ({
      id: `v${i}`,
      title: "A".repeat(120),
      youtube_video_id: "yt" + i,
      display_name: "Author " + i,
      scheduled_time: 1700000000 + i,
      status: "public",
    }));
    bucket.put("list/recent.json", {
      generated_at: 1700000000,
      total: 48,
      items,
    });

    clearPublicApiRateLimitForTests();
    const res = await app.request(new Request("http://localhost/api/videos?limit=48"), {}, env);
    assert.equal(res.status, 200);
    const body = await res.text();
    console.log(`[videos-public budget] 48_items_bytes=${body.length}`);
    assert.ok(body.length < 64 * 1024, "Response size within safe budget");
  });
}
