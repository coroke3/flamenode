import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  buildRouteMap,
  lookupRoute,
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

  // Object.prototype keys must not resolve, before or after a JSON round trip.
  const parsed = JSON.parse(JSON.stringify(manifest));
  for (const key of ["constructor", "/toString", "hasOwnProperty", "__proto__", "user/constructor"]) {
    assert.equal(lookupRoute(manifest, key), null, key);
    assert.equal(lookupRoute(parsed, key), null, key);
  }

  // An entity named like a prototype key is an ordinary route.
  const named = buildRouteMap([{ kind: "video", id: "constructor" }], "gen-01");
  assert.equal(lookupRoute(JSON.parse(JSON.stringify(named)), "constructor").canonicalPath, "/constructor");
});

test("legacy redirects cannot shadow fixed routes or leave the site", () => {
  const build = (fromPath, toPath) =>
    buildRouteMap([{ kind: "redirect", fromPath, toPath }], "gen-01");

  assert.throws(() => build("/about", "/event"), RouteCollisionError);
  assert.throws(() => build("/favicon.ico", "/event"), RouteCollisionError);
  assert.throws(() => build("/groups/../admin", "/event"), InvalidRouteIdError);
  assert.throws(() => build("/groups/a%2Fb", "/event"), InvalidRouteIdError);
  assert.throws(() => build("/", "/event"), InvalidRouteIdError);
  assert.throws(() => build("/groups/a", "//evil.example"), InvalidRouteIdError);
  assert.throws(() => build("/groups/a", "https://evil.example"), InvalidRouteIdError);
  assert.throws(() => build("/groups/a", "/..%2Fadmin"), InvalidRouteIdError);
  assert.equal(build("/groups/a", "/event#event-group-a").routes["groups/a"].targetPath, "/event#event-group-a");

  // Browsers strip tab/CR/LF while parsing, so these would become `//evil.example`.
  for (const toPath of ["/\t/evil.example/x", "/\n/evil.example", "/\r/evil.example", "/ /evil.example", "/\u0000x"]) {
    assert.throws(() => build("/groups/a", toPath), InvalidRouteIdError, JSON.stringify(toPath));
  }
});

test("CURRENT id formats are accepted: X handles with `_`, YouTube ids with `-` / `_`", () => {
  const manifest = buildRouteMap(
    [
      { kind: "user", id: "_flame", aliases: ["__init__", "_"] },
      { kind: "video", id: "1234", aliases: ["-dQw4w9WgXc", "_dQw4w9WgXc"] },
      { kind: "user", id: "__proto__" },
    ],
    "gen-01",
  );
  const parsed = JSON.parse(JSON.stringify(manifest));
  assert.equal(lookupRoute(parsed, "/user/_flame").type, "canonical");
  assert.equal(lookupRoute(parsed, "/user/__init__").targetPath, "/user/_flame");
  assert.equal(lookupRoute(parsed, "-dQw4w9WgXc").targetPath, "/1234");
  assert.equal(lookupRoute(parsed, "user/__proto__").id, "__proto__");
  assert.equal(lookupRoute(parsed, "__proto__"), null);
  assert.throws(() => buildRouteMap([{ kind: "video", id: "_next" }], "gen-01"), RouteCollisionError);
});

test("reserved lists cover every CURRENT top-level route segment and public/ entry", () => {
  const root = new URL("../", import.meta.url);
  const segments = new Set();
  const collect = (dir) => {
    for (const entry of readdirSync(new URL(dir, root), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (/^\(.+\)$/.test(entry.name)) collect(`${dir}${entry.name}/`); // route group
      else if (!entry.name.startsWith("[") && !entry.name.startsWith("_")) segments.add(entry.name);
    }
  };
  collect("app/");
  for (const segment of segments) {
    assert.ok(RESERVED_ROOT_SLUGS.has(segment), `app/ segment '${segment}' missing from RESERVED_ROOT_SLUGS`);
  }
  for (const name of readdirSync(new URL("public/", root))) {
    assert.ok(RESERVED_ASSET_PATHS.has(name), `public/${name} missing from RESERVED_ASSET_PATHS`);
  }
  // Metadata routes generated from app/robots.ts and app/sitemap.ts.
  for (const name of ["robots.txt", "sitemap.xml", "favicon.ico"]) assert.ok(RESERVED_ASSET_PATHS.has(name), name);
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

// U03: measure at production-like scale. The fixture sizes are an assumption
// (the real counts are read from D1 in MIG-0409); each entity has one alias.
const METRIC_SCALE = { video: 20000, user: 5000, event: 1000 };

function syntheticEntries() {
  const entries = [];
  for (const [kind, count] of Object.entries(METRIC_SCALE)) {
    for (let i = 0; i < count; i++) {
      entries.push({ kind, id: `${kind}${i}`, aliases: [`${kind}${i}-old`] });
    }
  }
  return entries;
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

test("U03 metrics: manifest bytes, entry count, parse and lookup CPU", () => {
  const manifest = buildRouteMap(syntheticEntries(), "generation-metrics-01");
  const json = JSON.stringify(manifest);
  const manifestBytes = Buffer.byteLength(json, "utf8");

  // Loading the manifest (once per isolate) is the dominant cost, not the lookup.
  const parseTimes = [];
  let parsed;
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    parsed = JSON.parse(json);
    parseTimes.push(performance.now() - start);
  }
  parseTimes.sort((a, b) => a - b);

  const keys = ["video19999", "video5-old", "user/user42", "event/event7-old", "missing", "constructor"];
  const lookupTimes = [];
  for (let i = 0; i < 10000; i++) {
    const start = performance.now();
    lookupRoute(parsed, keys[i % keys.length]);
    lookupTimes.push(performance.now() - start);
  }
  lookupTimes.sort((a, b) => a - b);

  assert.equal(manifest.totalEntries, 2 * (METRIC_SCALE.video + METRIC_SCALE.user + METRIC_SCALE.event));
  assert.ok(percentile(lookupTimes, 0.99) < 0.1, "lookup p99 must stay far below 1ms");

  console.log(
    `[MIG-0404 metrics] totalEntries=${manifest.totalEntries} manifestBytes=${manifestBytes} ` +
      `parseP50Ms=${percentile(parseTimes, 0.5).toFixed(2)} parseMaxMs=${parseTimes.at(-1).toFixed(2)} ` +
      `lookupP99Ms=${percentile(lookupTimes, 0.99).toFixed(5)}`,
  );
});

test("MIG-0507: a video entry keeps the internal id as resolution.id while keys come from the slug", () => {
  const manifest = buildRouteMap(
    [{ kind: "video", id: "internal-v1", slug: "AAAAAAAAA01", aliases: ["internal-v1"] }],
    "gen-01",
  );
  assert.deepEqual(Object.keys(manifest.routes), ["AAAAAAAAA01", "internal-v1"]);
  assert.deepEqual(manifest.routes.AAAAAAAAA01, { type: "canonical", kind: "video", id: "internal-v1", canonicalPath: "/AAAAAAAAA01" });
  assert.deepEqual(manifest.routes["internal-v1"], { type: "redirect", targetPath: "/AAAAAAAAA01", status: 308, reason: "alias" });
  assert.throws(() => buildRouteMap([{ kind: "video", id: "v1", slug: "about" }], "gen-01"), (e) => e.code === "ROUTE_COLLISION");
  assert.throws(() => buildRouteMap([{ kind: "video", id: "v1", slug: "a/b" }], "gen-01"), (e) => e.code === "INVALID_ROUTE_ID");
});
