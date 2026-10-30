import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeDeepHealth,
  classifyArtifactSloError,
  REQUIRED_SCHEMA_VERSION,
} from "../src/health/deepHealth.ts";
import { RUNTIME_CRITICAL_TABLES } from "../src/health/schemaContract.ts";
import { normalizeRecommendCore } from "../src/publicData/staticRecommendCore.ts";
import { normalizeYoutubeRelatedBlocklist } from "../src/publicData/staticYoutubeRelatedBlocklistCore.ts";
import { normalizeRandomVideoPool } from "../src/publicData/randomVideoPoolCore.ts";

test("MIG-0660 core deep-health token gate keeps CURRENT 503/401/no-store contract", async () => {
  const makeRequest = (authorization) =>
    new Request("https://flamenode.net/api/health/deep", {
      headers: authorization ? { Authorization: authorization } : {},
    });
  const absent = authorizeDeepHealth(makeRequest(), undefined);
  assert.equal(absent.status, 503);
  assert.equal(absent.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await absent.json(), { ok: false, service: "flamenode-web" });
  for (const auth of [undefined, "Basic abc", "Bearer wrong", "Bearer correct extra"]) {
    const rejected = authorizeDeepHealth(makeRequest(auth), "correct");
    assert.equal(rejected.status, 401);
    assert.equal(rejected.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(authorizeDeepHealth(makeRequest("Bearer correct"), "correct"), null);
});

test("MIG-0660 deep health core preserves schema contract and redacts unknown artifact keys", () => {
  assert.equal(typeof REQUIRED_SCHEMA_VERSION, "string");
  assert.ok(RUNTIME_CRITICAL_TABLES.includes("d1_migrations"));
  assert.ok(RUNTIME_CRITICAL_TABLES.includes("public_page_renders"));
  const failure = classifyArtifactSloError(new Error("static artifact missing: attacker.secret"));
  assert.equal(failure.reason, "artifact_missing");
  assert.equal(failure.key, "unknown");
});

test("MIG-0660 pure public-data normalizers accept the same empty artifact envelopes", () => {
  assert.deepEqual(normalizeRecommendCore({
    schema_version: 1, generated_at: 10, recommended: [], latest: [], underrated: [],
  }), { generatedAt: 10, recommended: [], latest: [], underrated: [] });
  assert.deepEqual(
    normalizeYoutubeRelatedBlocklist({ schema_version: 1, generated_at: 10, blocked: {} })?.blockedIds.size,
    0,
  );
  const pool = normalizeRandomVideoPool({
    schema_version: 1, generated_at: 10, generation_key: "test", items: [],
  });
  assert.equal(pool?.items.length, 0);
});
