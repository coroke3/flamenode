// MIG-0627 U02d PREP ONLY: exercise the actual mounted Hono search API with
// generated postings plus fake R2/D1. The runtime R2 readers remain intact.
// This does not approve a replacement artifact producer or production cutover.
import assert from "node:assert/strict";
import test from "node:test";
import { runUnderRootTsx } from "../apps/api/test/support/personalHarness.mjs";
import { createFakeBucket, createFakeKv, createSqlite, createD1 } from "../apps/api/test/support/publicEventsHarness.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const { app } = await import("../apps/api/src/app.ts");
  const { resetOperationModeCachesForTests } = await import("../apps/api/src/routes/live/operationMode.ts");
  const { clearPublicApiRateLimitForTests } = await import("@flamenode/server-core/publicData/publicApi");
  const {
    buildStaticVideoSearchPostingArtifacts,
    staticVideoSearchPostingManifestObjectKey,
    staticVideoSearchPostingDirectoryObjectKey,
    staticVideoSearchPostingPageObjectKey,
  } = await import("@flamenode/server-core/publicData/searchIndexCore");

  const source = [
    { id: "posted-tokyo", title: "Cyberpunk Tokyo Night", display_name: "Cyber Artist", youtube_video_id: null, creator_x_user_id: null, creator_x_user_name: null },
    { id: "posted-kyoto", title: "Retro Kyoto Sunset", display_name: "Kyoto Artist", youtube_video_id: null, creator_x_user_id: null, creator_x_user_name: null },
  ];
  const generation = "mig-0627-u02d";
  const manifestKey = staticVideoSearchPostingManifestObjectKey("current");
  const liteKey = "search-index-lite.json";

  function harness(t, mode = "off") {
    clearPublicApiRateLimitForTests();
    resetOperationModeCachesForTests();
    const sqlite = createSqlite();
    t.after(() => sqlite.close());
    const d1 = createD1(sqlite);
    const storage = createFakeBucket();
    const reads = [];
    const bucket = {
      async get(key) {
        reads.push(key);
        return storage.get(key);
      },
      async head(key) {
        const obj = await storage.get(key);
        return obj ? { size: obj.size, etag: obj.etag } : null;
      },
    };
    const env = { DB: d1, KV: createFakeKv(), BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: mode };
    return {
      storage, reads, d1,
      async query(value = "Tokyo") {
        const url = new URL("http://localhost/api/videos");
        url.searchParams.set("q", value);
        const response = await app.request(new Request(url), {}, env);
        return { response, payload: await response.json() };
      },
    };
  }

  async function seedPostings(storage, { directory = (value) => value, page = (value) => value, omitPages = false } = {}) {
    const artifacts = buildStaticVideoSearchPostingArtifacts({
      items: source, generatedAt: 1700000000, generation,
    });
    await storage.put(manifestKey, artifacts.manifest);
    for (const entry of artifacts.directories) {
      await storage.put(staticVideoSearchPostingDirectoryObjectKey(generation, entry.bucket), directory(entry.directory));
    }
    if (!omitPages) {
      for (const entry of artifacts.pages) {
        await storage.put(staticVideoSearchPostingPageObjectKey(generation, entry.bucket, entry.page.page), page(entry.page));
      }
    }
    return artifacts;
  }

  async function seedLite(storage) {
    await storage.put(liteKey, {
      generated_at: 1700000000,
      videos: [{ id: "lite-only-tokyo", title: "Tokyo fallback", creator_display_name: "Fallback Artist" }],
    });
  }

  test("MIG-0627 U02d PREP T01: current-generation posting search is bounded and skips legacy lite", async (t) => {
    const h = harness(t);
    await seedPostings(h.storage);
    await seedLite(h.storage);
    const { response, payload } = await h.query();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.items.map((item) => item.id), ["posted-tokyo"]);
    assert.ok(h.reads.includes(manifestKey));
    assert.equal(h.reads.includes(liteKey), false, "verified posting path must not re-read legacy lite");
    assert.ok(h.reads.length > 1 && h.reads.length <= 35, "manifest + bounded directory/page reads");
    assert.deepEqual({ statements: h.d1.stats.statements, writes: h.d1.stats.writes }, { statements: 0, writes: 0 });
  });

  test("MIG-0627 U02d PREP T02: missing indexed posting page uses only existing legacy lite fallback", async (t) => {
    const h = harness(t);
    await seedPostings(h.storage, { omitPages: true });
    await seedLite(h.storage);
    const { response, payload } = await h.query();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.items.map((item) => item.id), ["lite-only-tokyo"]);
    assert.ok(h.reads.includes(manifestKey));
    assert.ok(h.reads.includes(liteKey));
    assert.equal(h.d1.stats.statements, 0);
    assert.equal(h.d1.stats.writes, 0);
  });

  test("MIG-0627 U02d PREP T03: mismatched directory generation never advertises stale postings", async (t) => {
    const h = harness(t);
    await seedPostings(h.storage, { directory: (entry) => ({ ...entry, generation: "videos-stale" }) });
    await seedLite(h.storage);
    const { response, payload } = await h.query();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.items.map((item) => item.id), ["lite-only-tokyo"]);
    assert.ok(h.reads.includes(liteKey));
    assert.equal(h.d1.stats.statements, 0);
    assert.equal(h.d1.stats.writes, 0);
  });

  test("MIG-0627 U02d PREP T04: malformed posting page without fallback fails unavailable, not stale public data", async (t) => {
    const h = harness(t);
    await seedPostings(h.storage, { page: (entry) => ({ ...entry, generation: "videos-stale" }) });
    const { response, payload } = await h.query();
    assert.equal(response.status, 503);
    assert.deepEqual(payload, { error: "static_list_unavailable" });
    assert.ok(h.reads.includes(liteKey));
    assert.equal(h.d1.stats.statements, 0);
    assert.equal(h.d1.stats.writes, 0);
  });
}
