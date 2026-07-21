import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPublicHealthResponse } from "../../../src/lib/health/publicHealth.ts";

test("Workers health endpoint exposes only the validated deployment commit", async () => {
  const response = buildPublicHealthResponse("a".repeat(40));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "flamenode-web",
    commit: "a".repeat(40),
    runtime: "cloudflare-worker",
  });
});

test("Workers health endpoint fails closed without a valid commit", async () => {
  const response = buildPublicHealthResponse("unknown");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    service: "flamenode-web",
    runtime: "cloudflare-worker",
  });
});
