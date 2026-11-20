// MIG-0627 U02a: TARGET sitemap consumes verified build snapshots while
// CURRENT Next.js keeps its runtime R2 readers until the approved Phase 9 cutover.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sitemapVideosOrEmpty, sitemapRowsForEmittedVideoPages, loadSitemapCanonicalVideoPages } from "../apps/site/src/pages/sitemap.xml.ts";
import { FIXTURE_VIDEO_DETAIL_PAYLOADS } from "../apps/site/src/lib/videoFixtures.ts";
import { buildSitemapEntries } from "../apps/site/src/lib/sitemap.ts";
import {
  SITEMAP_VIDEOS_KEY,
  newSnapshotBuildMetrics,
} from "../apps/site/src/lib/publicDataLoader.ts";

const root = new URL("../", import.meta.url);
const generation = "mig-0627-golden-1";
const publicVideos = {
  generated_at: 1_760_000_000,
  videos: [
    { id: "vid-one", youtube_video_id: "AAAAAAAAAAA", scheduled_time: 1_760_000_000 },
    { id: "vid-two", youtube_video_id: null, scheduled_time: null },
  ],
};

function buildEnvelope(payload, { generationId = generation, visibility = "public", hash = null, key = SITEMAP_VIDEOS_KEY } = {}) {
  return new TextEncoder().encode(JSON.stringify({
    schemaVersion: 1,
    generation: generationId,
    key,
    visibility,
    sha256: hash ?? createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    payload,
  }));
}

function accessWith({ manifestAllowed = true, manifestBlocked = false, bytes = buildEnvelope(publicVideos) } = {}) {
  const reads = [];
  const metrics = newSnapshotBuildMetrics();
  return {
    reads, metrics,
    access: {
      source: {
        async read(key) {
          reads.push(key);
          return bytes;
        },
      },
      options: {
        manifest: {
          schemaVersion: 1,
          generation,
          allowedKeys: manifestAllowed ? [SITEMAP_VIDEOS_KEY] : [],
          blockedKeys: manifestBlocked ? [SITEMAP_VIDEOS_KEY] : [],
        },
        generation,
        metrics,
      },
    },
  };
}

test("MIG-0627 U02a T01: sitemap reads only the approved build snapshot, once", async () => {
  const fixture = accessWith();
  const warnings = [];
  const actual = await sitemapVideosOrEmpty(fixture.access, (message) => warnings.push(message));
  assert.deepEqual(actual, publicVideos);
  assert.deepEqual(fixture.reads, [SITEMAP_VIDEOS_KEY]);
  assert.deepEqual(
    { reads: fixture.metrics.reads, accepted: fixture.metrics.accepted, rejected: fixture.metrics.rejected },
    { reads: 1, accepted: 1, rejected: 0 },
  );
  assert.deepEqual(warnings, []);
});

test("MIG-0627 U02a T02: denied or blocked snapshot key never reaches source", async () => {
  for (const options of [{ manifestAllowed: false }, { manifestBlocked: true }]) {
    const fixture = accessWith(options);
    const warnings = [];
    assert.deepEqual(
      await sitemapVideosOrEmpty(fixture.access, (message) => warnings.push(message)),
      { generated_at: null, videos: [] },
    );
    assert.deepEqual(fixture.reads, [], "deny before any R2/filesystem-backed snapshot read");
    assert.equal(fixture.metrics.reads, 0);
    assert.equal(fixture.metrics.rejected, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /NOT_PUBLIC/);
  }
});

test("MIG-0627 U02a T03: bad generation or hash fails the public build, not a silent omission", async () => {
  const fixtures = [
    { bytes: buildEnvelope(publicVideos, { generationId: "previous-build" }), expectedCode: "GENERATION_MISMATCH" },
    { bytes: buildEnvelope({ ...publicVideos, generated_at: 1 }, { hash: "0".repeat(64) }), expectedCode: "HASH_MISMATCH" },
  ];
  for (const { bytes, expectedCode } of fixtures) {
    const fixture = accessWith({ bytes });
    const warnings = [];
    await assert.rejects(
      sitemapVideosOrEmpty(fixture.access, (message) => warnings.push(message)),
      (error) => error?.code === expectedCode,
    );
    assert.deepEqual(fixture.reads, [SITEMAP_VIDEOS_KEY]);
    assert.deepEqual(warnings, [], "corruption must not fall back to stale or synthetic video URLs");
  }
});

test("MIG-0627 U02a T04: CURRENT keeps its R2 sitemap readers until authorized cutover", async () => {
  const current = await readFile(new URL("src/lib/publicData/sitemapSources.ts", root), "utf8");
  const target = await readFile(new URL("apps/site/src/pages/sitemap.xml.ts", root), "utf8");
  const currentKeys = [
    "list/recent.json",
    "events/index.json",
    "users/index.json",
    "search-index-lite.json",
  ];
  for (const key of currentKeys) {
    assert.ok(current.includes(`r2Key: "${key}"`), `CURRENT reader must retain ${key} until cutover`);
  }
  assert.match(current, /loadPublicJson/);
  assert.match(target, /snapshotAccessFromEnv\(/, "Astro must use the build-only snapshot adapter");
  assert.doesNotMatch(target, /loadPublicJson|\.BUCKET\.get\(|\bfetch\(/,
    "Astro sitemap must not regain request-time D1/R2/HTTP sources");
});

test("MIG-0627 U02a T05: stale video-index alias cannot advertise an unbuilt canonical page", () => {
  const index = [
    { id: "vid-one", youtube_video_id: "BBBBBBBBBBB", scheduled_time: 1_760_000_000 },
    { id: "vid-unpublished", youtube_video_id: "CCCCCCCCCCC", scheduled_time: 1_760_000_000 },
  ];
  const emitted = [
    // Astro emits both aliases for one verified public detail, with one canonical slug.
    { videoId: "vid-one", canonicalSlug: "AAAAAAAAAAA", slug: "AAAAAAAAAAA", youtubeId: "AAAAAAAAAAA" },
    { videoId: "vid-one", canonicalSlug: "AAAAAAAAAAA", slug: "vid-one", youtubeId: "AAAAAAAAAAA" },
  ];
  const published = sitemapRowsForEmittedVideoPages(index, emitted);
  assert.deepEqual(published, [
    { id: "vid-one", youtube_video_id: "AAAAAAAAAAA", scheduled_time: 1_760_000_000 },
  ]);
  const urls = buildSitemapEntries({
    origin: "https://example.test",
    videos: published,
    events: [],
    creators: [],
    now: new Date("2026-01-01T00:00:00.000Z"),
  }).map((entry) => entry.url);
  assert.ok(urls.includes("https://example.test/AAAAAAAAAAA"));
  assert.equal(urls.includes("https://example.test/BBBBBBBBBBB"), false,
    "the stale index alias was not emitted as a static page");
  assert.equal(urls.includes("https://example.test/CCCCCCCCCCC"), false,
    "private/missing detail is not in the emitted page set");
});

test("MIG-0627 U02a T06: optional missing index omits video URLs; source failure aborts build", async () => {
  const missing = accessWith({ bytes: null });
  const warnings = [];
  assert.deepEqual(
    await sitemapVideosOrEmpty(missing.access, (message) => warnings.push(message)),
    { generated_at: null, videos: [] },
  );
  assert.deepEqual(missing.reads, [SITEMAP_VIDEOS_KEY]);
  assert.equal(missing.metrics.rejected, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /SNAPSHOT_MISSING/);

  const failure = accessWith();
  failure.access.source.read = async (key) => {
    failure.reads.push(key);
    throw new Error("synthetic filesystem/R2 read failure");
  };
  const errors = [];
  await assert.rejects(
    sitemapVideosOrEmpty(failure.access, (message) => errors.push(message)),
    (error) => error?.code === "SOURCE_UNAVAILABLE",
  );
  assert.deepEqual(failure.reads, [SITEMAP_VIDEOS_KEY]);
  assert.equal(failure.metrics.rejected, 1);
  assert.deepEqual(errors, [], "source failures must not publish stale or fixture aliases");
});

test("MIG-0627 U02a T07: invalid index payload rejects build instead of advertising bad URLs", async () => {
  const invalid = accessWith({
    bytes: buildEnvelope({
      generated_at: 1_760_000_000,
      videos: [{ id: 42, youtube_video_id: "AAAAAAAAAAA", scheduled_time: null }],
    }),
  });
  const warnings = [];
  await assert.rejects(
    sitemapVideosOrEmpty(invalid.access, (message) => warnings.push(message)),
    (error) => error?.code === "INVALID_PAYLOAD",
  );
  assert.deepEqual(invalid.reads, [SITEMAP_VIDEOS_KEY]);
  assert.equal(invalid.metrics.rejected, 1);
  assert.deepEqual(warnings, []);
});

test("MIG-0627 U02a T08: fixture canonical page projection is Node-import safe", async () => {
  const pages = await loadSitemapCanonicalVideoPages(null);
  const byId = new Map(pages.map((page) => [page.videoId, page]));
  assert.equal(byId.get("vid-aaa")?.youtubeId, "dKw1xV41f8s");
  assert.equal(byId.get("vid-aaa")?.canonicalSlug, "dKw1xV41f8s");
  assert.equal(byId.get("vid-bbb")?.youtubeId, null);
  assert.equal(byId.get("vid-bbb")?.canonicalSlug, "vid-bbb");
});

test("MIG-0627 U02a T09: canonical projection reads a verified public detail and rejects key-ID mismatch", async () => {
  const id = "vid-aaa";
  const key = `snapshot/video-detail/${id}.json`;
  const fixture = accessWith();
  fixture.access.options.manifest.allowedKeys.push(key);
  const bytes = buildEnvelope(FIXTURE_VIDEO_DETAIL_PAYLOADS[id], { key });
  fixture.access.source.read = async (requested) => {
    fixture.reads.push(requested);
    return requested === key ? bytes : null;
  };
  const pages = await loadSitemapCanonicalVideoPages(fixture.access, new Set([id]));
  assert.deepEqual(fixture.reads, [key]);
  assert.deepEqual(pages, [{
    videoId: id,
    canonicalSlug: "dKw1xV41f8s",
    slug: "dKw1xV41f8s",
    youtubeId: "dKw1xV41f8s",
  }]);

  const mismatched = accessWith();
  const wrongKey = "snapshot/video-detail/vid-other.json";
  mismatched.access.options.manifest.allowedKeys.push(wrongKey);
  const wrongBytes = buildEnvelope(FIXTURE_VIDEO_DETAIL_PAYLOADS[id], { key: wrongKey });
  mismatched.access.source.read = async (requested) => requested === wrongKey ? wrongBytes : null;
  await assert.rejects(
    loadSitemapCanonicalVideoPages(mismatched.access, new Set(["vid-other"])),
    /not a public, matching video detail/,
  );
});

test("MIG-0627 U02a T10: sitemap reads only detail snapshots named in the index", async () => {
  const fixture = accessWith();
  const relevant = "snapshot/video-detail/vid-aaa.json";
  const unrelated = "snapshot/video-detail/vid-bbb.json";
  fixture.access.options.manifest.allowedKeys.push(relevant, unrelated);
  const relevantBytes = buildEnvelope(FIXTURE_VIDEO_DETAIL_PAYLOADS["vid-aaa"], { key: relevant });
  fixture.access.source.read = async (key) => {
    fixture.reads.push(key);
    if (key !== relevant) throw new Error("unrelated public detail must never be read by sitemap");
    return relevantBytes;
  };
  const pages = await loadSitemapCanonicalVideoPages(fixture.access, new Set(["vid-aaa"]));
  assert.deepEqual(pages.map((page) => page.videoId), ["vid-aaa"]);
  assert.deepEqual(fixture.reads, [relevant]);
  assert.equal(fixture.metrics.reads, 1, "one verified source read even with extra manifest detail");
  assert.equal(fixture.metrics.accepted, 1);
  assert.equal(fixture.metrics.rejected, 0);
});

test("MIG-0627 U02a T11: empty index or missing candidate avoids unrelated detail reads", async () => {
  const fixture = accessWith();
  fixture.access.options.manifest.allowedKeys.push(
    "snapshot/video-detail/vid-aaa.json",
    "snapshot/video-detail/vid-bbb.json",
  );
  fixture.access.source.read = async (key) => {
    fixture.reads.push(key);
    throw new Error("no video-detail reads permitted");
  };
  assert.deepEqual(await loadSitemapCanonicalVideoPages(fixture.access, new Set()), []);
  assert.deepEqual(
    await loadSitemapCanonicalVideoPages(fixture.access, new Set(["vid-not-in-manifest"])),
    [],
  );
  assert.deepEqual(fixture.reads, []);
  assert.equal(fixture.metrics.reads, 0);

  // Fixture fallback is filtered by the same candidates, without changing
  // the canonical projection or adding request-time R2/HTTP access.
  const fixtureSubset = await loadSitemapCanonicalVideoPages(null, new Set(["vid-bbb"]));
  assert.deepEqual(fixtureSubset.map((page) => [page.videoId, page.canonicalSlug]),
    [["vid-bbb", "vid-bbb"]]);
  assert.deepEqual(await loadSitemapCanonicalVideoPages(null, new Set()), []);
});

test("MIG-0627 U02a T12: an indexed but broken public detail still fails closed", async () => {
  const fixture = accessWith();
  const key = "snapshot/video-detail/vid-aaa.json";
  fixture.access.options.manifest.allowedKeys.push(key);
  fixture.access.source.read = async (requested) => {
    fixture.reads.push(requested);
    return null;
  };
  await assert.rejects(
    loadSitemapCanonicalVideoPages(fixture.access, new Set(["vid-aaa"])),
    (error) => error?.code === "SNAPSHOT_MISSING",
  );
  assert.deepEqual(fixture.reads, [key]);
  assert.equal(fixture.metrics.rejected, 1);
});

test("MIG-0627 U02a T13: oversized candidate set fails before any verified detail read", async () => {
  const fixture = accessWith();
  fixture.access.options.manifest.allowedKeys.push("snapshot/video-detail/vid-aaa.json");
  const candidateIds = new Set(Array.from({ length: 501 }, (_, i) => `video-${i}`));
  candidateIds.add("vid-aaa");
  await assert.rejects(
    loadSitemapCanonicalVideoPages(fixture.access, candidateIds),
    /video candidate limit exceeded \(500\)/,
  );
  await assert.rejects(
    loadSitemapCanonicalVideoPages(null, candidateIds),
    /video candidate limit exceeded \(500\)/,
  );
  assert.deepEqual(fixture.reads, [], "no source reads after oversized input");
  assert.equal(fixture.metrics.reads, 0, "no build-snapshot budget consumed");

  // The exact 500-candidate boundary is allowed, with unrelated entries skipped.
  const boundary = new Set(Array.from({ length: 500 }, (_, i) => `video-${i}`));
  assert.deepEqual(await loadSitemapCanonicalVideoPages(fixture.access, boundary), []);
  assert.deepEqual(fixture.reads, []);
});

test("MIG-0627 U02a T14: configured build requires verified candidate set before any read", async () => {
  const fixture = accessWith();
  fixture.access.options.manifest.allowedKeys.push("snapshot/video-detail/vid-aaa.json");
  await assert.rejects(
    loadSitemapCanonicalVideoPages(fixture.access),
    /verified video candidate set is required/,
  );
  assert.deepEqual(fixture.reads, [], "missing candidate set cannot scan all manifest details");
  assert.equal(fixture.metrics.reads, 0);
  // An explicitly verified empty index remains valid and reads nothing.
  assert.deepEqual(await loadSitemapCanonicalVideoPages(fixture.access, new Set()), []);
  assert.equal(fixture.metrics.reads, 0);
});

test("MIG-0627 U02a T15: duplicated allowed detail keys cannot amplify source reads", async () => {
  const fixture = accessWith();
  const key = "snapshot/video-detail/vid-aaa.json";
  fixture.access.options.manifest.allowedKeys.push(key, key, key, key);
  const bytes = buildEnvelope(FIXTURE_VIDEO_DETAIL_PAYLOADS["vid-aaa"], { key });
  fixture.access.source.read = async (requested) => {
    fixture.reads.push(requested);
    return requested === key ? bytes : null;
  };
  const pages = await loadSitemapCanonicalVideoPages(fixture.access, new Set(["vid-aaa"]));
  assert.equal(pages.length, 1, "one canonical video page per verified detail key");
  assert.equal(pages[0].videoId, "vid-aaa");
  assert.deepEqual(fixture.reads, [key]);
  assert.deepEqual(
    { reads: fixture.metrics.reads, accepted: fixture.metrics.accepted, rejected: fixture.metrics.rejected },
    { reads: 1, accepted: 1, rejected: 0 },
  );
});

test("MIG-0627 U02a T16: visibility-blocked detail is never read or advertised", async () => {
  const fixture = accessWith();
  const key = "snapshot/video-detail/vid-aaa.json";
  fixture.access.options.manifest.allowedKeys.push(key);
  fixture.access.options.manifest.blockedKeys.push(key);
  fixture.access.source.read = async (requested) => {
    fixture.reads.push(requested);
    throw new Error("blocked detail must not be read");
  };
  const pages = await loadSitemapCanonicalVideoPages(fixture.access, new Set(["vid-aaa"]));
  assert.deepEqual(pages, []);
  assert.deepEqual(fixture.reads, []);
  assert.equal(fixture.metrics.reads, 0);
  assert.deepEqual(
    sitemapRowsForEmittedVideoPages([{ id: "vid-aaa", youtube_video_id: "dKw1xV41f8s", scheduled_time: null }], pages),
    [],
    "even a stale public index cannot re-advertise a manifest-revoked video",
  );
});

test("MIG-0627 U02a T17: a valid envelope containing private video detail fails closed", async () => {
  const fixture = accessWith();
  const key = "snapshot/video-detail/vid-aaa.json";
  fixture.access.options.manifest.allowedKeys.push(key);
  const publicDetail = FIXTURE_VIDEO_DETAIL_PAYLOADS["vid-aaa"];
  const privateDetail = {
    ...publicDetail,
    video: { ...publicDetail.video, visibility_status: "private" },
  };
  const bytes = buildEnvelope(privateDetail, { key });
  fixture.access.source.read = async (requested) => {
    fixture.reads.push(requested);
    return requested === key ? bytes : null;
  };
  await assert.rejects(
    loadSitemapCanonicalVideoPages(fixture.access, new Set(["vid-aaa"])),
    /not a public, matching video detail/,
  );
  assert.deepEqual(fixture.reads, [key]);
  assert.equal(fixture.metrics.reads, 1);
  assert.equal(fixture.metrics.accepted, 1, "envelope validity alone does not make its detail public");
});

test("MIG-0627 U02a T18: large manifests do not amplify candidate-driven snapshot reads", async () => {
  const fixture = accessWith();
  const keyA = "snapshot/video-detail/vid-aaa.json";
  const keyB = "snapshot/video-detail/vid-bbb.json";
  const blocked = "snapshot/video-detail/vid-blocked.json";
  const unrelated = Array.from({ length: 2500 }, (_, i) => `snapshot/video-detail/unrelated-${i}.json`);
  fixture.access.options.manifest.allowedKeys.push(...unrelated, keyA, keyA, keyB, blocked);
  fixture.access.options.manifest.blockedKeys.push(...unrelated.slice(0, 1250), blocked);
  const payloads = new Map([
    [keyA, buildEnvelope(FIXTURE_VIDEO_DETAIL_PAYLOADS["vid-aaa"], { key: keyA })],
    [keyB, buildEnvelope(FIXTURE_VIDEO_DETAIL_PAYLOADS["vid-bbb"], { key: keyB })],
  ]);
  fixture.access.source.read = async (key) => {
    fixture.reads.push(key);
    assert.ok(payloads.has(key), "unrelated or blocked manifest key must not trigger a read");
    return payloads.get(key);
  };
  const pages = await loadSitemapCanonicalVideoPages(
    fixture.access, new Set(["vid-aaa", "bad/path", "vid-blocked", "vid-bbb", "long".repeat(30)]),
  );
  assert.deepEqual(pages.map((page) => page.videoId), ["vid-aaa", "vid-bbb"]);
  assert.deepEqual(fixture.reads, [keyA, keyB]);
  assert.deepEqual(
    { reads: fixture.metrics.reads, accepted: fixture.metrics.accepted, rejected: fixture.metrics.rejected },
    { reads: 2, accepted: 2, rejected: 0 },
  );
});

test("MIG-0627 U02a T19: invalid manifest is rejected before any indexed source read", async () => {
  for (const damage of [
    (manifest) => { manifest.generation = "wrong-generation"; },
    (manifest) => { manifest.allowedKeys = [42]; },
    (manifest) => { manifest.blockedKeys = null; },
  ]) {
    const fixture = accessWith();
    fixture.access.options.manifest.allowedKeys.push("snapshot/video-detail/vid-aaa.json");
    damage(fixture.access.options.manifest);
    await assert.rejects(
      loadSitemapCanonicalVideoPages(fixture.access, new Set(["vid-aaa"])),
      /configured snapshot manifest is invalid/,
    );
    assert.deepEqual(fixture.reads, [], "a damaged manifest cannot trigger source reads");
    assert.equal(fixture.metrics.reads, 0);
  }
});

test("MIG-0627 U02a T20: sitemap reuses the emitted user-index timestamp without a second snapshot read", async () => {
  const source = fixturePayloadSource();
  let indexReads = 0;
  const build = await loadUserBuildDataFrom({
    ...source,
    index: async () => {
      indexReads += 1;
      return source.index();
    },
  });
  assert.equal(indexReads, 1, "user listing and sitemap must share the same verified index read");
  assert.equal(build.generatedAt, 1_760_000_000);
  assert.ok(build.index.some((entry) => entry.x_id === "miku_producer"));
  assert.equal(build.index.some((entry) => entry.x_id === "suspended_user"), false);
  const withNoIndex = await loadUserBuildDataFrom({
    ...source,
    index: async () => null,
  });
  assert.equal(withNoIndex.generatedAt, null, "unavailable user index must not contribute a timestamp");

  const sitemapSource = await readFile(new URL("apps/site/src/pages/sitemap.xml.ts", root), "utf8");
  assert.match(sitemapSource, /userGeneratedAt\s*=\s*users\.generatedAt/);
  assert.doesNotMatch(sitemapSource, /loadUsersIndexSnapshot\s*\(/,
    "the sitemap must not independently read the same user index");
});
