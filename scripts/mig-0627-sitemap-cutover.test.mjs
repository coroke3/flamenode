// MIG-0627 U02a: TARGET sitemap consumes verified build snapshots while
// CURRENT Next.js keeps its runtime R2 readers until the approved Phase 9 cutover.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sitemapVideosOrEmpty } from "../apps/site/src/pages/sitemap.xml.ts";
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

function buildEnvelope(payload, { generationId = generation, visibility = "public", hash = null } = {}) {
  return new TextEncoder().encode(JSON.stringify({
    schemaVersion: 1,
    generation: generationId,
    key: SITEMAP_VIDEOS_KEY,
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
