import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fixturePayloadSource, loadUserBuildDataFrom, snapshotPayloadSource } from "./userData.ts";
import { SnapshotBuildError, USERS_INDEX_KEY, userProfileSnapshotKey } from "./publicDataLoader.ts";

const warning = "[user-routes] profile snapshot unavailable";

async function withWarningSink(sink, run) {
  const original = console.warn;
  console.warn = sink;
  try {
    return await run();
  } finally {
    console.warn = original;
  }
}

function trackedFixture() {
  const source = fixturePayloadSource();
  const reads = [];
  return {
    reads,
    source: {
      ...source,
      async index() {
        reads.push(["index"]);
        return source.index();
      },
      async profile(id) {
        reads.push(["profile", id]);
        return source.profile(id);
      },
      async page(id, section, page) {
        reads.push(["page", id, section, page]);
        return source.page(id, section, page);
      },
    },
  };
}

test("SEC-825: throwing warning preserves public user/index/timestamp projection and read counts", async () => {
  const normal = trackedFixture();
  const broken = trackedFixture();
  const normalWarnings = [];
  const failedWarnings = [];
  const expected = await withWarningSink((...args) => normalWarnings.push(args),
    () => loadUserBuildDataFrom(normal.source));
  const actual = await withWarningSink((...args) => {
    failedWarnings.push(args);
    throw new Error("diagnostic sink unavailable");
  }, () => loadUserBuildDataFrom(broken.source));

  assert.deepEqual(actual, expected);
  assert.deepEqual(broken.reads, normal.reads);
  assert.equal(actual.generatedAt, 1760000000);
  assert.deepEqual([...actual.users.keys()].sort(), ["long_list", "miku_producer", "minimal_user"]);
  assert.deepEqual(actual.index.map((entry) => entry.x_id).sort(), [...actual.users.keys()].sort());
  assert.equal(actual.users.has("suspended_user"), false);
  assert.deepEqual(normalWarnings, [[warning]]);
  assert.deepEqual(failedWarnings, normalWarnings, "fixed diagnostic only, no user ID or raw error");
});

test("SEC-825: mismatched profile and missing profile stay omitted under a failing warning sink", async () => {
  const fixture = trackedFixture();
  const source = fixture.source;
  const mismatched = await fixturePayloadSource().profile("miku_producer");
  const warnings = [];
  const actual = await withWarningSink((...args) => {
    warnings.push(args);
    throw new Error("diagnostic sink unavailable");
  }, () => loadUserBuildDataFrom({
    ...source,
    async profile(id) {
      const payload = await source.profile(id);
      return id === "minimal_user" ? mismatched : payload;
    },
  }));

  assert.deepEqual([...actual.users.keys()].sort(), ["long_list", "miku_producer"]);
  assert.deepEqual(actual.index.map((entry) => entry.x_id).sort(), ["long_list", "miku_producer"]);
  assert.equal(actual.generatedAt, 1760000000);
  assert.equal(fixture.reads.some(([kind, id]) => kind === "page" &&
    (id === "minimal_user" || id === "suspended_user")), false);
  assert.deepEqual(warnings, [[warning], [warning]]);
});

function envelope(key, payload, overrides = {}) {
  return new TextEncoder().encode(JSON.stringify({
    schemaVersion: 1, generation: "sec-825", key, visibility: "public",
    sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    payload, ...overrides,
  }));
}

test("SEC-825: actual verified snapshot loader still rejects hash, generation and provider failures", async () => {
  const fixture = fixturePayloadSource();
  const index = await fixture.index();
  // A known missing user is skippable; a subsequent corrupt public profile is not.
  const missingKey = userProfileSnapshotKey("long_list");
  const publicKey = userProfileSnapshotKey("miku_producer");
  const profile = await fixture.profile("miku_producer");
  const manifest = {
    schemaVersion: 1, generation: "sec-825",
    allowedKeys: [USERS_INDEX_KEY, missingKey, publicKey], blockedKeys: [],
  };
  for (const [code, override] of [
    ["HASH_MISMATCH", { sha256: "0".repeat(64) }],
    ["GENERATION_MISMATCH", { generation: "stale" }],
    ["SOURCE_UNAVAILABLE", null],
  ]) {
    const warnings = [];
    const snapshot = snapshotPayloadSource({
      async read(key) {
        if (key === USERS_INDEX_KEY) return envelope(key, index);
        if (key === missingKey) return null;
        assert.equal(key, publicKey);
        if (override === null) throw new Error("provider unavailable");
        return envelope(key, profile, override);
      },
    }, manifest, "sec-825");

    await withWarningSink((...args) => {
      warnings.push(args);
      throw new Error("diagnostic sink unavailable");
    }, () => assert.rejects(loadUserBuildDataFrom(snapshot),
      (error) => error instanceof SnapshotBuildError && error.code === code));
    assert.ok(warnings.length >= 1, "skippable missing profile must exercise the failing logger");
    assert.ok(warnings.every((args) => args.length === 1 && args[0] === warning));
  }
});
