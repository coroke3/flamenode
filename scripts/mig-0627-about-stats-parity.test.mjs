// MIG-0627 U02b PREP ONLY: RH-026 CURRENT / existing Hono R2 / Astro build
// snapshot shape parity. This does not add a Worker-accessible artifact source,
// retire R2, approve an artifact publisher or grant production cutover.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeTopStatsSection } from "../src/lib/publicData/staticTopSectionsCore.ts";
import { normalizeAboutStats, publicAboutStatsRoutes } from "../apps/api/src/routes/publicAboutStats.ts";
import {
  ABOUT_STATS_KEY,
  loadAboutStatsSnapshot,
  newSnapshotBuildMetrics,
} from "../apps/site/src/lib/publicDataLoader.ts";

const generation = "mig-0627-u02b-local-fixture";
const limit = 64 * 1024;
const rawStats = (stats) => ({
  schema_version: 1,
  generated_at: 1_760_000_000,
  stats: { public_videos: 120, public_events: 15, creators: 42, active_events: 4, ...stats },
});
const projection = (raw) => {
  const current = normalizeTopStatsSection(raw);
  if (!current) return null;
  return {
    publicVideos: current.stats.public_videos,
    creators: current.stats.creators,
    events: current.stats.public_events,
  };
};
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value));
function envelope(payload, { key = ABOUT_STATS_KEY, version = generation, visibility = "public", hash } = {}) {
  return bytes({
    schemaVersion: 1,
    generation: version,
    key,
    visibility,
    sha256: hash ?? createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    payload,
  });
}
function snapshotAccess(data, { allowed = true, blocked = false, maxBytes = limit } = {}) {
  const reads = [];
  const metrics = newSnapshotBuildMetrics();
  const source = {
    async read(key) {
      reads.push(key);
      return data;
    },
  };
  const options = {
    generation,
    manifest: {
      schemaVersion: 1,
      generation,
      allowedKeys: allowed ? [ABOUT_STATS_KEY] : [],
      blockedKeys: blocked ? [ABOUT_STATS_KEY] : [],
    },
    maxBytes,
    metrics,
  };
  return { source, options, reads, metrics };
}
async function honoRequest(raw, { missing = false, size = 128 } = {}) {
  const reads = [];
  const bucket = {
    async get(key) {
      reads.push(key);
      return missing ? null : { size, json: async () => raw };
    },
  };
  // No DB, real R2, fetch or Cloudflare credentials are supplied.
  const response = await publicAboutStatsRoutes.request(
    "https://flamenode.net/?utm=ignored", { method: "GET" }, { BUCKET: bucket },
  );
  return { response, reads };
}

test("MIG-0627 U02b PREP T01: CURRENT, Hono and verified build snapshot agree on normalized public counts", async () => {
  const cases = [
    rawStats({}),
    rawStats({ public_videos: "120.9", creators: "42.4", public_events: "15.8" }),
    rawStats({ public_videos: "not-a-count", creators: null, public_events: -7 }),
    rawStats({ public_videos: true, creators: "4.9", public_events: "0" }),
  ];
  for (const raw of cases) {
    const current = projection(raw);
    assert.deepEqual(normalizeAboutStats(raw), current, "Hono must match CURRENT normalizer");
    const source = snapshotAccess(envelope(current));
    const build = await loadAboutStatsSnapshot(source.source, source.options);
    assert.deepEqual(build, current, "manifest/hash-verified build projection must match CURRENT");
    assert.deepEqual(source.reads, [ABOUT_STATS_KEY]);
    assert.deepEqual(
      { reads: source.metrics.reads, accepted: source.metrics.accepted, rejected: source.metrics.rejected },
      { reads: 1, accepted: 1, rejected: 0 },
    );
  }
});

test("MIG-0627 U02b PREP T02: existing Hono RH-026 preserves DTO, 200 headers and a single bounded R2 read", async () => {
  const raw = rawStats({ public_videos: "9.8", public_events: "2.6", creators: "3.3" });
  const { response, reads } = await honoRequest(raw);
  assert.deepEqual(reads, ["top/sections/stats.v1.json"]);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { stats: projection(raw) });
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=300, stale-while-revalidate=1800");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("MIG-0627 U02b PREP T03: missing, malformed and oversized legacy stats remain 503/no-store", async () => {
  for (const scenario of [
    { raw: null, missing: true },
    { raw: { schema_version: 2, generated_at: 1_760_000_000, stats: {} } },
    { raw: rawStats({}), size: limit + 1 },
  ]) {
    const { response, reads } = await honoRequest(scenario.raw, scenario);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { stats: null });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Retry-After"), "30");
    assert.deepEqual(reads, ["top/sections/stats.v1.json"]);
  }
});

test("MIG-0627 U02b PREP T04: missing and blocked snapshot keys deny before any source read", async () => {
  for (const mode of [{ allowed: false }, { blocked: true }]) {
    const a = snapshotAccess(envelope(projection(rawStats({}))), mode);
    await assert.rejects(
      loadAboutStatsSnapshot(a.source, a.options),
      (error) => error?.code === "NOT_PUBLIC",
    );
    assert.deepEqual(a.reads, []);
    assert.equal(a.metrics.reads, 0);
    assert.equal(a.metrics.rejected, 1);
  }
});

test("MIG-0627 U02b PREP T05: stale generation, nonpublic envelope and hash corruption fail closed", async () => {
  const payload = projection(rawStats({}));
  for (const { data, code } of [
    { data: envelope(payload, { version: "different-generation" }), code: "GENERATION_MISMATCH" },
    { data: envelope(payload, { visibility: "private" }), code: "NOT_PUBLIC" },
    { data: envelope(payload, { hash: "0".repeat(64) }), code: "HASH_MISMATCH" },
  ]) {
    const a = snapshotAccess(data);
    await assert.rejects(loadAboutStatsSnapshot(a.source, a.options), (error) => error?.code === code);
    assert.deepEqual(a.reads, [ABOUT_STATS_KEY]);
    assert.equal(a.metrics.rejected, 1);
    assert.equal(a.metrics.accepted, 0);
  }
});

test("MIG-0627 U02b PREP T06: verified envelopes obey a 64-KiB boundary before JSON parsing", async () => {
  const payload = projection(rawStats({}));
  const emptyPadding = envelope({ ...payload, padding: "" });
  const pad = limit - emptyPadding.byteLength;
  assert.ok(pad > 0, "test fixture has room for byte boundary");
  const exactlyLimit = envelope({ ...payload, padding: "x".repeat(pad) });
  assert.equal(exactlyLimit.byteLength, limit);
  const accepted = snapshotAccess(exactlyLimit);
  assert.deepEqual(await loadAboutStatsSnapshot(accepted.source, accepted.options), payload);
  assert.equal(accepted.metrics.bytes, limit);

  const rejected = snapshotAccess(envelope({ ...payload, padding: "x".repeat(pad + 1) }));
  await assert.rejects(
    loadAboutStatsSnapshot(rejected.source, rejected.options),
    (error) => error?.code === "INVALID_SIZE",
  );
  assert.deepEqual(rejected.reads, [ABOUT_STATS_KEY]);
  assert.equal(rejected.metrics.bytes, 0, "oversized source must not enter parsing");
});

test("MIG-0627 U02b PREP T07: signed but invalid counts cannot be served as build stats", async () => {
  const invalid = [
    { publicVideos: -1, creators: 2, events: 3 },
    { publicVideos: "bad", creators: 2, events: 3 },
    { publicVideos: Number.MAX_SAFE_INTEGER + 1, creators: 2, events: 3 },
  ];
  for (const payload of invalid) {
    const a = snapshotAccess(envelope(payload));
    await assert.rejects(loadAboutStatsSnapshot(a.source, a.options), (error) => error?.code === "INVALID_PAYLOAD");
    assert.equal(a.metrics.accepted, 0);
    assert.equal(a.metrics.rejected, 1);
  }
});

test("MIG-0627 U02b PREP T08: CURRENT and Hono readers remain mounted until approved source handoff", async () => {
  const root = new URL("../", import.meta.url);
  const [current, hono, env, wrapper] = await Promise.all([
    readFile(new URL("app/api/public/about-stats/route.ts", root), "utf8"),
    readFile(new URL("apps/api/src/routes/publicAboutStats.ts", root), "utf8"),
    readFile(new URL("apps/api/src/env.ts", root), "utf8"),
    readFile(new URL("apps/site/scripts/buildPublicSite.ts", root), "utf8"),
  ]);
  assert.match(current, /bucket\.get\(TOP_STATS_OBJECT_KEY\)/);
  assert.match(hono, /bucket\.get\(TOP_STATS_OBJECT_KEY\)/);
  assert.match(wrapper, /mkdtempSync/);
  assert.match(wrapper, /rmSync\(snapshotDir/);
  assert.doesNotMatch(env, /FLAMENODE_SNAPSHOT_(?:DIR|MANIFEST_FILE|GENERATION)/,
    "Astro process-local files are not a Hono Worker binding");
});
