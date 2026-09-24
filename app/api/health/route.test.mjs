import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPublicHealthResponse,
  readPublicHealthCommit,
} from "../../../src/lib/health/publicHealth.ts";

test("health commit lookup reads only BUILD_COMMIT_SHA", () => {
  const accessed = [];
  const env = new Proxy(
    {},
    {
      get(_target, key) {
        accessed.push(key);
        return key === "BUILD_COMMIT_SHA" ? "a".repeat(40) : undefined;
      },
      ownKeys() {
        throw new Error("health lookup must not enumerate bindings");
      },
    },
  );

  assert.equal(readPublicHealthCommit(env), "a".repeat(40));
  assert.deepEqual(accessed, ["BUILD_COMMIT_SHA"]);
});

test("health commit lookup safely rejects unavailable or malformed bindings", () => {
  assert.equal(readPublicHealthCommit(undefined), undefined);
  assert.equal(readPublicHealthCommit(null), undefined);
  assert.equal(readPublicHealthCommit({ BUILD_COMMIT_SHA: 123 }), undefined);
});

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
