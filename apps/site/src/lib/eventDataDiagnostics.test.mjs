import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEventDataFromPayloads, loadEventBuildData } from "./eventData.ts";

async function withFailingLogger(run) {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => {
    warnings.push(args);
    throw new Error("diagnostic sink unavailable");
  };
  try {
    return await run(warnings);
  } finally {
    console.warn = original;
  }
}

test("nonpublic and invalid event/release snapshots remain skipped when console.warn throws", async () => {
  await withFailingLogger(async (warnings) => {
    const result = buildEventDataFromPayloads({
      source: "snapshot",
      index: null,
      details: { "private-event": null },
      releases: { "missing-release": null },
    });
    assert.equal(result.details.size, 0);
    assert.equal(result.releases.size, 0);
    assert.equal(result.index, null);
    assert.equal(warnings.length, 2);
  });
});

test("missing index/detail/release snapshots do not abort the build when console.warn throws", async () => {
  const missing = [
    "snapshot/event-index/current.json",
    "snapshot/event-detail/missing-event.json",
    "snapshot/event-release/missing-event.json",
  ];
  const reads = [];
  const injected = {
    manifest: { schemaVersion: 1, generation: "test-gen", allowedKeys: missing, blockedKeys: [] },
    generation: "test-gen",
    source: {
      async read(key) {
        reads.push(key);
        return null;
      },
    },
  };
  await withFailingLogger(async (warnings) => {
    const result = await loadEventBuildData({}, injected);
    assert.equal(result.index, null);
    assert.equal(result.details.size, 0);
    assert.equal(result.releases.size, 0);
    assert.deepEqual(reads, missing);
    assert.equal(warnings.length, 3);
  });
});

test("fixture output retains public events and skips private events with broken logger", async () => {
  await withFailingLogger(async (warnings) => {
    const result = await loadEventBuildData({});
    assert.equal(result.source, "fixture");
    assert.equal(result.details.has("autumn-collab-2026"), true);
    assert.equal(result.details.has("draft-secret-event"), false);
    assert.ok(warnings.length > 0);
  });
});

test("non-skippable snapshot provider errors remain fatal, not silently swallowed", async () => {
  const injected = {
    manifest: {
      schemaVersion: 1,
      generation: "test-gen",
      allowedKeys: ["snapshot/event-index/current.json"],
      blockedKeys: [],
    },
    generation: "test-gen",
    source: { async read() { throw new Error("sensitive provider details"); } },
  };
  await withFailingLogger(async () => {
    await assert.rejects(loadEventBuildData({}, injected), (error) => {
      assert.equal(error.code, "SOURCE_UNAVAILABLE");
      assert.doesNotMatch(error.message, /sensitive provider details/);
      return true;
    });
  });
});
