import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { app } from "../src/app.ts";
import { normalizeAboutStats } from "../src/routes/publicAboutStats.ts";
import { clearSoftwareSuggestionRateLimitForTests } from "../src/routes/softwareSuggestions.ts";
// CURRENT (Next) implementations, compared on identical input.
import { buildPublicHealthResponse, readPublicHealthCommit } from "../../../src/lib/health/publicHealth.ts";
import { authorizeDeepHealth } from "../../../src/lib/health/deepHealth.ts";
import { normalizeTopStatsSection } from "../../../src/lib/publicData/staticTopSectionsCore.ts";
import {
  checkPublicApiRateLimit,
  clearPublicApiRateLimitForTests,
  parseBoundedPositiveInt,
  publicJsonResponse,
} from "../../../src/lib/api/publicApi.ts";
import {
  MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT,
  toPublicSoftwareSuggestionDto,
} from "../../../src/lib/api/publicDto.ts";

async function snapshot(response) {
  const headers = [...response.headers.entries()].sort(([a], [b]) => a.localeCompare(b));
  const text = response.status === 304 ? "" : await response.text();
  return { status: response.status, headers, body: text };
}

// ---- RH-018 / T01 ----------------------------------------------------------

test("T01 RH-018: GET /api/health matches CURRENT status/body/header", async () => {
  const cases = [
    { BUILD_COMMIT_SHA: "a".repeat(40) },
    { BUILD_COMMIT_SHA: ` ${"AbC123".repeat(6)}abcd ` },
    { BUILD_COMMIT_SHA: "unknown" },
    { BUILD_COMMIT_SHA: "" },
    { BUILD_COMMIT_SHA: 123 },
    {},
  ];
  for (const env of cases) {
    const hono = await app.request("/api/health", { method: "GET" }, env);
    const current = buildPublicHealthResponse(readPublicHealthCommit(env));
    assert.deepEqual(await snapshot(hono), await snapshot(current), JSON.stringify(env));
  }
});

test("T01 RH-018: public health never returns other bindings", async () => {
  const hono = await app.request("/api/health", { method: "GET" }, {
    BUILD_COMMIT_SHA: "b".repeat(40),
    WORKER_ADMIN_TOKEN: "admin-secret-value",
    PUBLIC_VISIBILITY_GUARD_MODE: "enforce",
  });
  const body = await hono.text();
  assert.doesNotMatch(body, /admin-secret-value|enforce|WORKER_ADMIN_TOKEN/);
});

// ---- RH-017 / T02 ----------------------------------------------------------

test("T02 RH-017: deep health token missing/invalid matches CURRENT rejection", async () => {
  const token = "secret-admin-token-12345";
  const cases = [
    { env: {}, headers: {} },
    { env: { WORKER_ADMIN_TOKEN: "   " }, headers: { Authorization: `Bearer ${token}` } },
    { env: { WORKER_ADMIN_TOKEN: token }, headers: {} },
    { env: { WORKER_ADMIN_TOKEN: token }, headers: { Authorization: "Basic dXNlcjpwYXNz" } },
    { env: { WORKER_ADMIN_TOKEN: token }, headers: { Authorization: "Bearer wrong-token" } },
    { env: { WORKER_ADMIN_TOKEN: token }, headers: { Authorization: `Bearer ${token}x` } },
    { env: { WORKER_ADMIN_TOKEN: token }, headers: { Authorization: `Bearer ${token} extra` } },
    { env: { WORKER_ADMIN_TOKEN: token }, headers: { Authorization: `bearer ${token}` } },
  ];
  for (const { env, headers } of cases) {
    const url = "https://flamenode.test/api/health/deep";
    const hono = await app.request(url, { method: "GET", headers }, env);
    const current = authorizeDeepHealth(new Request(url, { headers }), env.WORKER_ADMIN_TOKEN);
    assert.ok(current, "CURRENT must reject this case");
    const honoSnap = await snapshot(hono);
    assert.deepEqual(honoSnap, await snapshot(current), JSON.stringify({ env, headers }));
    assert.doesNotMatch(honoSnap.body, /secret-admin-token/);
  }
});

test("RH-017: authorized deep health fails closed with CURRENT's failure response and reads no binding", async () => {
  const token = "secret-admin-token-12345";
  const touched = [];
  const binding = (name) =>
    new Proxy({}, {
      get(_target, key) {
        touched.push(`${name}.${String(key)}`);
        throw new Error(`${name} must not be read`);
      },
    });
  const res = await app.request(
    "/api/health/deep",
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    {
      WORKER_ADMIN_TOKEN: token,
      BUILD_COMMIT_SHA: "c".repeat(40),
      DB: binding("DB"),
      KV: binding("KV"),
      BUCKET: binding("BUCKET"),
    },
  );
  // Same body/status/header as CURRENT app/api/health/deep/route.ts when
  // runDeepHealthChecks cannot vouch for the deployment (catch -> 503).
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await res.json(), { ok: false, service: "flamenode-web" });
  assert.deepEqual(touched, []);
});

// ---- RH-026 / T03 ----------------------------------------------------------

test("T03 RH-026: about-stats normalization matches CURRENT normalizeTopStatsSection", () => {
  const payloads = [
    null,
    "x",
    {},
    { schema_version: 2, generated_at: 1, stats: {} },
    { schema_version: "1", generated_at: "1729000000", stats: { public_videos: "7" } },
    { schema_version: 1, generated_at: 0, stats: { public_videos: 1 } },
    { schema_version: 1, generated_at: 1729000000 },
    { schema_version: 1, generated_at: 1729000000, stats: null },
    {
      schema_version: 1,
      generated_at: 1729000000.9,
      stats: { public_videos: 12.7, creators: -3, public_events: Number.NaN, active_events: 4 },
    },
    {
      schema_version: 1,
      generated_at: 1729000000,
      stats: { public_videos: 120, creators: 42, public_events: 15, private_videos: 9 },
    },
  ];
  for (const payload of payloads) {
    const current = normalizeTopStatsSection(payload);
    const expected = current
      ? {
          publicVideos: current.stats.public_videos,
          creators: current.stats.creators,
          events: current.stats.public_events,
        }
      : null;
    assert.deepEqual(normalizeAboutStats(payload), expected, JSON.stringify(payload));
  }
});

test("T03 RH-026: R2 missing / oversized / malformed / throw degrade to CURRENT's 503", async () => {
  let cancelled = 0;
  const buckets = [
    undefined,
    { get: async () => null },
    { get: async () => ({ size: 64 * 1024 + 1, body: { cancel: async () => { cancelled += 1; } }, json: async () => ({}) }) },
    { get: async () => ({ size: Number.NaN, json: async () => ({}) }) },
    { get: async () => ({ size: 10, json: async () => ({ schema_version: 1, generated_at: 0, stats: {} }) }) },
    { get: async () => ({ size: 10, json: async () => { throw new SyntaxError("bad json"); } }) },
    { get: async () => { throw new Error("r2 down"); } },
  ];
  for (const BUCKET of buckets) {
    const res = await app.request("/api/public/about-stats", { method: "GET" }, { BUCKET });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.equal(res.headers.get("Retry-After"), "30");
    assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(res.headers.get("Content-Type"), "application/json");
    assert.deepEqual(await res.json(), { stats: null });
  }
  assert.equal(cancelled, 1);
});

test("RH-026: success response only carries the 3 public counters", async () => {
  const res = await app.request("/api/public/about-stats?bust=1", { method: "GET" }, {
    BUCKET: {
      get: async (key) => {
        assert.equal(key, "top/sections/stats.v1.json");
        return {
          size: 100,
          json: async () => ({
            schema_version: 1,
            generated_at: 1729000000,
            stats: { public_videos: 1, creators: 2, public_events: 3, active_events: 4, hidden: "x" },
          }),
        };
      },
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=300, stale-while-revalidate=1800");
  assert.equal(res.headers.get("Content-Type"), "application/json");
  assert.deepEqual(await res.json(), { stats: { publicVideos: 1, creators: 2, events: 3 } });
});

// ---- RH-029 / T04 ----------------------------------------------------------

function createRecordingD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE software_catalog (id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL,
      category TEXT, is_verified INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
      submitted_by_user_id TEXT);
    CREATE TABLE software_aliases (id TEXT PRIMARY KEY, software_id TEXT NOT NULL, alias TEXT NOT NULL,
      normalized_alias TEXT NOT NULL);
    CREATE TABLE video_softwares (id TEXT PRIMARY KEY, video_id TEXT NOT NULL, software_id TEXT NOT NULL);
    INSERT INTO software_catalog VALUES
      ('s1','Blender','blender','3D',1,1,'u1'),
      ('s2','Maya','maya','3D',1,1,'u2'),
      ('s3','After Effects','after effects',NULL,0,1,NULL),
      ('s4','Hidden','hidden','x',1,0,'u3');
    INSERT INTO software_aliases VALUES ('a1','s3','AE','ae'), ('a2','s4','HD','hd');
    INSERT INTO video_softwares VALUES ('v1','x','s1'),('v2','y','s1'),('v3','x','s2'),('v4','x','s4');
  `);
  const calls = [];
  return {
    calls,
    sqlite,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            all: async () => {
              calls.push({ sql, params });
              return { results: sqlite.prepare(sql).all(...params) };
            },
          };
        },
      };
    },
  };
}

test("T04 RH-029: limit query is normalized exactly like CURRENT parseBoundedPositiveInt", async () => {
  clearSoftwareSuggestionRateLimitForTests();
  for (const raw of [null, "", "0", "-1", "-999", "1", "1.9", "20", "49", "50", "51", "999", "abc", "3abc", "Infinity", "1e3"]) {
    const db = createRecordingD1();
    const qs = raw === null ? "" : `?limit=${encodeURIComponent(raw)}`;
    const res = await app.request(`/api/software/suggestions${qs}`, { method: "GET" }, { DB: db });
    assert.equal(res.status, 200, String(raw));
    const bound = db.calls.at(-1).params.at(-1);
    assert.equal(bound, parseBoundedPositiveInt(raw, 20, MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT), String(raw));
  }
});

test("T04 RH-029: DTO allowlist matches CURRENT toPublicSoftwareSuggestionDto, inactive never leaks", async () => {
  clearSoftwareSuggestionRateLimitForTests();
  for (const q of ["", "ae", "hd", "hidden", "blend", "a", "%", "_"]) {
    const db = createRecordingD1();
    const res = await app.request(`/api/software/suggestions?q=${encodeURIComponent(q)}`, { method: "GET" }, { DB: db });
    assert.equal(res.status, 200);
    const data = await res.json();
    const rows = db.sqlite.prepare(db.calls.at(-1).sql).all(...db.calls.at(-1).params);
    const expected = rows.map(toPublicSoftwareSuggestionDto).filter((row) => row !== null);
    assert.deepEqual(data, JSON.parse(JSON.stringify(expected)), q);
    for (const row of data) {
      assert.notEqual(row.id, "s4", `inactive software leaked for q=${q}`);
      assert.deepEqual(Object.keys(row), ["id", "name", "category", "usage_count", "is_verified"]);
    }
    assert.ok(db.calls.length <= 2, "at most 2 D1 reads");
  }
});

test("T04 RH-029: 200/304 headers and ETag match CURRENT publicJsonResponse", async () => {
  clearSoftwareSuggestionRateLimitForTests();
  const db = createRecordingD1();
  const res = await app.request("/api/software/suggestions?limit=5", { method: "GET" }, { DB: db });
  const body = await res.clone().text();
  const cacheControl = "public, max-age=60, s-maxage=120, stale-while-revalidate=300";
  const current = await publicJsonResponse(new Request("https://x.test/"), JSON.parse(body), cacheControl);
  assert.deepEqual(await snapshot(res), await snapshot(current));

  const etag = res.headers.get("ETag");
  for (const inm of [etag, `W/${etag}`, `"zzz", ${etag}`, "*", '"nope"']) {
    const honoRes = await app.request("/api/software/suggestions?limit=5", {
      method: "GET",
      headers: { "If-None-Match": inm },
    }, { DB: createRecordingD1() });
    const currentRes = await publicJsonResponse(
      new Request("https://x.test/", { headers: { "If-None-Match": inm } }),
      JSON.parse(body),
      cacheControl,
    );
    assert.deepEqual(await snapshot(honoRes), await snapshot(currentRes), inm);
  }
});

test("T04 RH-029: DB missing / query failure match CURRENT 503", async () => {
  clearSoftwareSuggestionRateLimitForTests();
  const failing = { prepare() { throw new Error("D1_ERROR: no such table"); } };
  for (const env of [{}, { DB: failing }]) {
    const res = await app.request("/api/software/suggestions?q=x", { method: "GET" }, env);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.equal(res.headers.get("Retry-After"), "30");
    assert.deepEqual(await res.json(), { error: "database_unavailable" });
  }
});

test("T04 RH-029: rate limit sequence matches CURRENT checkPublicApiRateLimit", async () => {
  clearSoftwareSuggestionRateLimitForTests();
  clearPublicApiRateLimitForTests();
  const headers = { "CF-Connecting-IP": " 203.0.113.9 ", "X-Forwarded-For": "198.51.100.1, 10.0.0.1" };
  const db = createRecordingD1();
  const now = Math.floor(Date.now() / 1000);
  for (let index = 1; index <= 61; index += 1) {
    const hono = await app.request("/api/software/suggestions", { method: "GET", headers }, { DB: db });
    const current = checkPublicApiRateLimit(
      new Request("https://x.test/api/software/suggestions", { headers }),
      "/api/software/suggestions",
      now,
    );
    if (index <= 60) {
      assert.equal(hono.status, 200);
      assert.equal(current, null);
    } else {
      assert.equal(hono.status, 429);
      assert.ok(current);
      assert.equal(hono.headers.get("Cache-Control"), current.headers.get("Cache-Control"));
      assert.equal(hono.headers.get("Content-Type"), current.headers.get("Content-Type"));
      assert.deepEqual(await hono.json(), await current.json());
      assert.ok(Number(hono.headers.get("Retry-After")) >= 1);
    }
  }
  // A different client is not affected.
  const other = await app.request("/api/software/suggestions", {
    method: "GET",
    headers: { "CF-Connecting-IP": "203.0.113.10" },
  }, { DB: db });
  assert.equal(other.status, 200);
});
