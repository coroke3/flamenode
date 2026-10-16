import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRouteMap,
  lookupRoute,
  measureRouteMapMetrics,
  RouteCollisionError,
  DuplicateRouteError,
  InvalidRouteIdError,
  RESERVED_ROOT_SLUGS,
  RESERVED_ASSET_PATHS,
} from "../apps/site/src/lib/routeMap.ts";

test("T01: video slug colliding with reserved root slug fails build", () => {
  assert.throws(
    () => buildRouteMap([{ kind: "video", id: "event" }], "gen-01"),
    (err) => err instanceof RouteCollisionError && err.code === "ROUTE_COLLISION",
  );

  // Check another reserved root slug
  assert.throws(
    () => buildRouteMap([{ kind: "video", id: "about" }], "gen-01"),
    (err) => err instanceof RouteCollisionError,
  );

  // Check alias collision with reserved root path
  assert.throws(
    () =>
      buildRouteMap(
        [{ kind: "video", id: "safe_video_01", aliases: ["rules"] }],
        "gen-01",
      ),
    (err) => err instanceof RouteCollisionError,
  );

  // Check asset collision
  assert.throws(
    () => buildRouteMap([{ kind: "video", id: "favicon.ico" }], "gen-01"),
    (err) => err instanceof RouteCollisionError,
  );
});

test("T02: duplicate slug across entries fails build", () => {
  // Two videos with identical canonical slug
  assert.throws(
    () =>
      buildRouteMap(
        [
          { kind: "video", id: "video_alpha" },
          { kind: "video", id: "video_alpha" },
        ],
        "gen-01",
      ),
    (err) => err instanceof DuplicateRouteError && err.code === "DUPLICATE_ROUTE",
  );

  // Canonical colliding with alias
  assert.throws(
    () =>
      buildRouteMap(
        [
          { kind: "video", id: "video_alpha" },
          { kind: "video", id: "video_beta", aliases: ["video_alpha"] },
        ],
        "gen-01",
      ),
    (err) => err instanceof DuplicateRouteError,
  );
});

test("T03: X ID rename / alias resolves to redirect", () => {
  const manifest = buildRouteMap(
    [
      {
        kind: "user",
        id: "creator_new_handle",
        aliases: ["creator_old_handle"],
      },
      {
        kind: "video",
        id: "vid_canonical_123",
        aliases: ["dQw4w9WgXcQ"], // YouTube ID alias
      },
    ],
    "gen-01",
  );

  // User alias redirect
  const userAliasRes = lookupRoute(manifest, "user/creator_old_handle");
  assert.deepEqual(userAliasRes, {
    type: "redirect",
    targetPath: "/user/creator_new_handle",
    status: 308,
    reason: "alias",
  });

  // User canonical lookup
  const userCanonicalRes = lookupRoute(manifest, "/user/creator_new_handle");
  assert.deepEqual(userCanonicalRes, {
    type: "canonical",
    kind: "user",
    id: "creator_new_handle",
    canonicalPath: "/user/creator_new_handle",
  });

  // Video alias redirect (YouTube ID)
  const videoAliasRes = lookupRoute(manifest, "dQw4w9WgXcQ");
  assert.deepEqual(videoAliasRes, {
    type: "redirect",
    targetPath: "/vid_canonical_123",
    status: 308,
    reason: "alias",
  });

  // Video canonical lookup
  const videoCanonicalRes = lookupRoute(manifest, "/vid_canonical_123");
  assert.deepEqual(videoCanonicalRes, {
    type: "canonical",
    kind: "video",
    id: "vid_canonical_123",
    canonicalPath: "/vid_canonical_123",
  });
});

test("T04: ID containing path traversal or encoding is rejected", () => {
  // Test case explicitly testing `..%2F`
  assert.throws(
    () => buildRouteMap([{ kind: "video", id: "..%2F" }], "gen-01"),
    (err) => err instanceof InvalidRouteIdError && err.code === "INVALID_ROUTE_ID",
  );

  assert.throws(
    () => buildRouteMap([{ kind: "video", id: "../traversal" }], "gen-01"),
    (err) => err instanceof InvalidRouteIdError,
  );

  assert.throws(
    () => buildRouteMap([{ kind: "video", id: "nested/path" }], "gen-01"),
    (err) => err instanceof InvalidRouteIdError,
  );

  // Lookup with traversal fails closed (returns null)
  const manifest = buildRouteMap(
    [{ kind: "video", id: "sample_video" }],
    "gen-01",
  );
  assert.equal(lookupRoute(manifest, "..%2Fetc%2Fpasswd"), null);
  assert.equal(lookupRoute(manifest, "../sample_video"), null);
});

test("T05: unknown URL returns null (404 in caller)", () => {
  const manifest = buildRouteMap(
    [
      { kind: "video", id: "known_video_01" },
      { kind: "user", id: "known_user_01" },
      { kind: "event", id: "known_event_01" },
    ],
    "gen-01",
  );

  assert.equal(lookupRoute(manifest, "non_existent_video"), null);
  assert.equal(lookupRoute(manifest, "user/non_existent_user"), null);
  assert.equal(lookupRoute(manifest, ""), null);
  assert.equal(lookupRoute(manifest, "/"), null);
});

test("legacy redirects and determinism", () => {
  const fixture = [
    {
      kind: "redirect",
      fromPath: "/groups/slug-group-a",
      toPath: "/event#event-group-slug-group-a",
      status: 307,
    },
    {
      kind: "video",
      id: "video_z",
      aliases: ["alias_z"],
    },
    {
      kind: "video",
      id: "video_a",
      aliases: ["alias_a"],
    },
    {
      kind: "event",
      id: "event_spring_2026",
    },
  ];

  const m1 = buildRouteMap(fixture, "generation-deterministic-01");
  const m2 = buildRouteMap(fixture, "generation-deterministic-01");

  // Output must be bit-for-bit identical
  assert.equal(m1.sha256, m2.sha256);
  assert.equal(JSON.stringify(m1), JSON.stringify(m2));

  // Keys must be strictly sorted
  const keys = Object.keys(m1.routes);
  const sorted = [...keys].sort();
  assert.deepEqual(keys, sorted);

  // Legacy redirect resolves correctly
  const legacyRes = lookupRoute(m1, "/groups/slug-group-a");
  assert.deepEqual(legacyRes, {
    type: "redirect",
    targetPath: "/event#event-group-slug-group-a",
    status: 307,
    reason: "legacy",
  });
});

test("U03 metrics: manifest bytes, entry count, and p99 lookup CPU", () => {
  const fixture = [
    {
      kind: "video",
      id: "vid_01",
      aliases: ["yt_01"],
    },
    {
      kind: "video",
      id: "vid_02",
      aliases: ["yt_02"],
    },
    {
      kind: "user",
      id: "user_alice",
      aliases: ["user_alice_old"],
    },
    {
      kind: "event",
      id: "event_summer_2026",
    },
    {
      kind: "redirect",
      fromPath: "/groups/demo",
      toPath: "/event#event-group-demo",
      status: 307,
    },
  ];

  const manifest = buildRouteMap(fixture, "generation-metrics-01");
  const sampleKeys = ["vid_01", "yt_01", "user/user_alice_old", "groups/demo", "non_existent"];

  const metrics = measureRouteMapMetrics(manifest, sampleKeys, 10000);

  // Verify metric fields
  assert.equal(metrics.totalEntries, manifest.totalEntries);
  assert.ok(metrics.manifestBytes > 0, "manifestBytes must be positive");
  assert.ok(
    metrics.lookupP99CpuMs < 0.1,
    `lookup p99 CPU must be well under 0.1ms, got ${metrics.lookupP99CpuMs}ms`,
  );
  assert.ok(
    metrics.lookupMaxCpuMs < 5.0,
    `lookup max CPU must be well under 5.0ms (Zero 1102 budget), got ${metrics.lookupMaxCpuMs}ms`,
  );

  console.log(
    `[MIG-0404 metrics] totalEntries=${metrics.totalEntries} manifestBytes=${metrics.manifestBytes} lookupP99CpuMs=${metrics.lookupP99CpuMs.toFixed(5)}ms lookupMaxCpuMs=${metrics.lookupMaxCpuMs.toFixed(5)}ms`,
  );
});
