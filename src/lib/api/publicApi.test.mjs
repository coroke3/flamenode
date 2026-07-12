import assert from "node:assert/strict";
import test from "node:test";
import {
  checkPublicApiRateLimit,
  clearPublicApiRateLimitForTests,
  publicJsonResponse,
} from "./publicApi.ts";

const endpoint = "/api/test";

function request(ip, headers = {}) {
  return new Request("https://example.test/api", {
    headers: { "CF-Connecting-IP": ip, ...headers },
  });
}

test("public JSON response emits stable quoted ETag and returns bodyless 304 for weak/multiple matches", async () => {
  const payload = { items: [{ id: "v1" }], page: 1 };
  const first = await publicJsonResponse(request("etag-client"), payload, "public, max-age=30");
  const etag = first.headers.get("ETag");
  assert.match(etag ?? "", /^"[0-9a-f]{64}"$/);

  const second = await publicJsonResponse(
    request("etag-client", { "If-None-Match": `"different", W/${etag}` }),
    payload,
    "public, max-age=30",
  );
  assert.equal(second.status, 304);
  assert.equal(second.body, null);
  assert.equal(second.headers.get("ETag"), etag);
  assert.equal(second.headers.get("Cache-Control"), "public, max-age=30");
});

test("public JSON error response keeps status, ETag, and cache policy without returning 304", async () => {
  const payload = { error: "not_found" };
  const first = await publicJsonResponse(
    request("error-client"),
    payload,
    "public, max-age=60",
    404,
  );
  const etag = first.headers.get("ETag");
  assert.equal(first.status, 404);
  assert.match(etag ?? "", /^"[0-9a-f]{64}"$/);

  const second = await publicJsonResponse(
    request("error-client", { "If-None-Match": etag }),
    payload,
    "public, max-age=60",
    404,
  );
  assert.equal(second.status, 404);
  assert.deepEqual(await second.json(), payload);
});

test("rate limiter uses connecting IP before forwarded IP and returns Retry-After", () => {
  clearPublicApiRateLimitForTests();
  const now = 1000;
  const headers = { "CF-Connecting-IP": "preferred", "X-Forwarded-For": "fallback" };
  for (let i = 0; i < 60; i++) assert.equal(checkPublicApiRateLimit(new Request("https://example.test", { headers }), endpoint, now), null);
  const limited = checkPublicApiRateLimit(new Request("https://example.test", { headers }), endpoint, now);
  assert.equal(limited?.status, 429);
  assert.equal(limited?.headers.get("Retry-After"), "60");
  assert.equal(checkPublicApiRateLimit(request("fallback"), endpoint, now), null);
});

test("rate limiter cleans expired buckets and bounds key cardinality", () => {
  clearPublicApiRateLimitForTests();
  for (let i = 0; i < 2048; i++) {
    assert.equal(checkPublicApiRateLimit(request(`client-${i}`), endpoint, 2000), null);
  }
  assert.equal(checkPublicApiRateLimit(request("overflow"), endpoint, 2000)?.status, 429);
  assert.equal(checkPublicApiRateLimit(request("expired"), endpoint, 2060), null);
});
