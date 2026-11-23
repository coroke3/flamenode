import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDeepHealthFailureResponse,
  classifyArtifactSloError,
  runDeepHealthChecks,
  REQUIRED_SCHEMA_VERSION,
} from "../src/health/deepHealth.ts";
import { REQUIRED_RUNTIME_TABLE_COUNT } from "../src/health/schemaContract.ts";
import { PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY as MANIFEST_KEY } from "../src/visibility/manifestCore.ts";

const poisonMessage = (marker) => {
  const error = new Error("initial");
  Object.defineProperty(error, "message", {
    configurable: true,
    get() { throw new Error(marker); },
  });
  return error;
};

test("SEC-818: a throwing console.error cannot replace fixed deep-health 503 or leak providers", async () => {
  const previous = console.error;
  console.error = () => { throw new Error("logger_unavailable"); };
  try {
    for (const failure of [
      new Error("SECRET_D1_CONNECTION"),
      classifyArtifactSloError(new Error("static artifact missing: top.json")),
      classifyArtifactSloError(poisonMessage("SECRET_POISONED_GETTER")),
    ]) {
      const response = buildDeepHealthFailureResponse(failure);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const payload = await response.json();
      assert.equal(payload.ok, false);
      assert.equal(payload.service, "flamenode-web");
      assert.doesNotMatch(JSON.stringify(payload), /SECRET_D1_CONNECTION|SECRET_POISONED_GETTER/);
    }
  } finally {
    console.error = previous;
  }
});

test("SEC-818: untrusted Error.message accessors cannot throw during artifact classification", () => {
  const hostile = poisonMessage("SECRET_MESSAGE_GETTER");
  const failure = classifyArtifactSloError(hostile);
  assert.equal(failure.reason, "artifact_invalid");
  assert.equal(failure.key, "unknown");
  assert.equal(failure.message, "deep health failed: artifact_invalid");
  assert.equal(failure.cause, hostile, "original cause remains available only to internal callers");
  const fixed = classifyArtifactSloError(new Error("static artifact missing: top.json"));
  assert.equal(fixed.reason, "artifact_missing");
  assert.equal(fixed.key, "top.json");
  assert.equal(fixed.message, "deep health failed: artifact_missing");
  const foreign = classifyArtifactSloError(new Error("static artifact missing: PRIVATE_CREDENTIAL"));
  assert.equal(foreign.key, "unknown");
  assert.doesNotMatch(foreign.message, /PRIVATE_CREDENTIAL/);
});

const sec = () => Math.floor(Date.now() / 1000);
const artifact = (key, now) => {
  const base = { generated_at: now };
  if (key === "top.json") return { ...base, latest: [], nostalgic_pool: [], nostalgic: [], nostalgic_shuffled_at: now, stats: {} };
  if (key === "list/recent.json" || key === "list/popular.json") return { ...base, total: 0, items: [] };
  if (key === "search-index-lite.json") return { ...base, videos: [], users: [] };
  if (key === "events/index.json") return { ...base, items: [], group_sections: [] };
  if (key === "users/index.json") return { ...base, items: [] };
  if (key === "recommend.json") return { ...base, recommended: [], latest: [], underrated: [], creators: [] };
  if (key === "rules/current.json") return { ...base, version_label: "v", body_markdown: "test" };
  if (key.includes("related") || key.includes("blocklist")) return { ...base, schema_version: 1, blocked: {} };
  if (key.includes("random") || key.includes("pool")) return { ...base, schema_version: 1, generation_key: "fixture", items: [] };
  throw new Error("unexpected required artifact: " + key);
};

function makeHealthyEnv(visibility) {
  const now = sec();
  let dbReads = 0;
  const env = {
    BUILD_COMMIT_SHA: "a".repeat(40),
    FLAMENODE_LOCAL_PREVIEW: "1",
    PUBLIC_VISIBILITY_GUARD_MODE: visibility.mode,
    DB: {
      prepare() {
        dbReads += 1;
        return {
          async first() {
            return {
              version: REQUIRED_SCHEMA_VERSION,
              required_table_count: REQUIRED_RUNTIME_TABLE_COUNT,
              public_video_detail_count: 0,
              tracked_video_detail_count: 0,
              public_event_detail_count: 0,
              tracked_event_detail_count: 0,
            };
          },
        };
      },
    },
    KV: { async get() { return null; } },
    BUCKET: {
      async head() { return null; },
      async get(key) {
        if (key === MANIFEST_KEY) {
          if (visibility.error) throw visibility.error;
          if (visibility.missing) return null;
          return { async text() { return visibility.text ?? "{malformed-json"; } };
        }
        // The recommend-core artifact is bootstrap-optional; the rest must be
        // validated normally so this really exercises runDeepHealthChecks.
        if (key.includes("recommend-core")) return null;
        return { async text() { return JSON.stringify(artifact(key, now)); } };
      },
    },
  };
  return { env, stats: () => ({ dbReads }) };
}

test("SEC-818: log sink failure preserves observe/enforce public-visibility health semantics", async () => {
  const original = console.warn;
  console.warn = () => { throw new Error("POISON_LOGGER"); };
  try {
    for (const mode of ["observe", "enforce"]) {
      for (const visibility of [
        { missing: true },
        { error: poisonMessage("SECRET_PROVIDER_ERROR_GETTER") },
        { text: "{broken" },
      ]) {
        const { env, stats } = makeHealthyEnv({ ...visibility, mode });
        const result = await runDeepHealthChecks(env);
        assert.equal(result.checks.public_visibility, "degraded");
        assert.equal(result.public_visibility_guard_mode, mode);
        assert.equal(result.ok, mode === "observe", mode);
        assert.equal(result.status, mode === "observe" ? "ok" : "degraded");
        assert.equal(stats().dbReads, 1, "one bounded D1 health query; no fallback D1 I/O");
      }
    }
  } finally {
    console.warn = original;
  }
});

test("SEC-818: malformed R2 body logs fixed diagnostic codes, never provider exception contents", async () => {
  const original = console.warn;
  const output = [];
  console.warn = (...args) => { output.push(...args); };
  try {
    const { env } = makeHealthyEnv({ mode: "enforce", text: "{malformed-json" });
    const result = await runDeepHealthChecks(env);
    assert.equal(result.checks.public_visibility, "degraded");
    assert.equal(result.ok, false);
    assert.equal(output.length, 1);
    const logged = JSON.parse(output[0]);
    assert.deepEqual(
      Object.keys(logged).sort(),
      ["service", "check", "mode", "status", "reason"].sort(),
    );
    assert.deepEqual(logged, {
      service: "deep-health", check: "public_visibility", mode: "enforce",
      status: "degraded", reason: "manifest_malformed",
    });
  } finally {
    console.warn = original;
  }
});
