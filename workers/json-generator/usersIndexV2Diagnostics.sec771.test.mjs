import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileTrackedArtifacts,
  rebuildUsersIndexV2Artifacts,
  rebuildUsersIndexV2FromLegacyArtifact,
} from "./usersIndexV2Artifacts.ts";
import { USERS_INDEX_V2_MANIFEST_OBJECT_KEY as MANIFEST } from "../../src/lib/publicData/staticUsersIndexV2Core.ts";

function poisonedError(message) {
  const error = new Error(message, { cause: new Error("SEC771_SECRET_NESTED_CAUSE") });
  let reads = 0;
  Object.defineProperty(error, "name", { get() {
    reads++;
    throw new Error("SEC771_SECRET_NAME_GETTER");
  } });
  return { error, nameReads: () => reads };
}

async function brokenLogger(method, callback) {
  const before = console[method];
  const logged = [];
  console[method] = (message) => {
    logged.push(String(message));
    throw new Error("SEC771_THROWING_LOG_SINK");
  };
  try { return { value: await callback(), logged }; }
  finally { console[method] = before; }
}

function fakeDb() {
  let queries = 0;
  const statements = [];
  const DB = {
    prepare(sql) {
      ++queries;
      statements.push(sql);
      return {
        bind(...args) {
          return {
            async first() {
              const keys = typeof args[2] === "string" ? JSON.parse(args[2]) : [];
              return { count: keys.length };
            },
            async all() { return { results: [] }; },
            async run() { return { meta: { changes: 1 } }; },
          };
        },
      };
    },
  };
  return { DB, count: () => queries, statements };
}

test("SEC-771: unreadable manifest stays unknown with a poisoned provider error and broken warn", async () => {
  const poison = poisonedError("SEC771_SECRET_MANIFEST_READ");
  const db = fakeDb();
  let removed = 0;
  const env = { DB: db.DB, R2: {
    async get() { throw poison.error; },
    async delete() { ++removed; },
  } };
  const { value, logged } = await brokenLogger("warn", () =>
    reconcileTrackedArtifacts(env, []));
  assert.deepEqual(value, { deleted: 0, hasMore: true });
  assert.equal(db.count(), 0, "unknown manifest cannot issue a D1 cleanup SELECT");
  assert.equal(removed, 0);
  assert.equal(poison.nameReads(), 0);
  assert.equal(JSON.parse(logged[0]).result, "chunk_cleanup_manifest_read_failed");
  assert.doesNotMatch(logged.join(" "), /SEC771_SECRET/);
});

test("SEC-771: failed orphan delete + broken warn preserves the original page PUT rejection", async () => {
  const primary = new Error("SEC771_PRIMARY_PUT_FAILURE");
  const cleanup = poisonedError("SEC771_SECRET_ORPHAN_DELETE");
  const db = fakeDb();
  const env = { DB: db.DB, R2: {
    async get() { return null; },
    async head() { return null; },
    async put() { throw primary; },
    async delete() { throw cleanup.error; },
  } };
  const messages = [];
  const prev = console.warn;
  console.warn = (message) => { messages.push(String(message)); throw new Error("bad warn"); };
  try {
    await assert.rejects(
      rebuildUsersIndexV2Artifacts(env, [{
        x_id: "user-a", x_name: "User A", icon_url: null, personal_count: 1,
        collab_count: 0, total_works: 1, sort_score: 1,
      }], 1_700_000_000),
      (error) => error === primary,
    );
  } finally { console.warn = prev; }
  assert.equal(db.count(), 0, "failure before R2 commit cannot record tracked artifacts");
  assert.equal(cleanup.nameReads(), 0);
  assert.ok(messages.some(m => JSON.parse(m).result === "chunk_cleanup_failed"));
  assert.doesNotMatch(messages.join(" "), /SEC771_SECRET/);
});

test("SEC-771: legacy fallback success cannot be rejected by a broken warn", async () => {
  const poison = poisonedError("SEC771_SECRET_LEGACY_R2_GET");
  const db = fakeDb();
  const deleted = [];
  const env = { DB: db.DB, R2: {
    async get() { throw poison.error; },
    async delete(keys) { deleted.push(...keys); },
  } };
  const { value, logged } = await brokenLogger("warn", () =>
    rebuildUsersIndexV2FromLegacyArtifact(env));
  assert.deepEqual(value, { liveKeys: [], objectCount: 0, hasMore: false, skipped: false });
  assert.deepEqual(deleted, [MANIFEST], "fallback invalidates only the V2 manifest");
  assert.equal(db.count(), 1);
  assert.equal(poison.nameReads(), 0);
  assert.equal(JSON.parse(logged[0]).result, "legacy_fallback");
  assert.doesNotMatch(logged.join(" "), /SEC771_SECRET/);
});

test("SEC-771: failed V2 invalidation is still fatal with a broken error logger", async () => {
  const primary = new Error("SEC771_PRIMARY_LEGACY_READ");
  const invalidation = poisonedError("SEC771_SECRET_INVALIDATION");
  const db = fakeDb();
  const env = { DB: db.DB, R2: {
    async get() { throw primary; },
    async delete() { throw invalidation.error; },
  } };
  const messages = [];
  const prev = console.error;
  console.error = (message) => { messages.push(String(message)); throw new Error("bad error log"); };
  try {
    await assert.rejects(rebuildUsersIndexV2FromLegacyArtifact(env), e => e === primary);
  } finally { console.error = prev; }
  assert.equal(invalidation.nameReads(), 0);
  assert.equal(db.count(), 0, "failed R2 invalidation cannot mark D1 tracking deleted");
  assert.equal(JSON.parse(messages[0]).result, "manifest_invalidation_failed");
  assert.doesNotMatch(messages.join(" "), /SEC771_SECRET/);
});

test("SEC-771: a throwing same-generation INFO cannot invalidate committed manifest", async () => {
  const objects = new Map();
  const db = fakeDb();
  let puts = 0;
  let deletes = 0;
  const env = { DB: db.DB, R2: {
    async get(key) {
      if (!objects.has(key)) return null;
      const value = objects.get(key);
      const serialized = JSON.stringify(value);
      return { size: Buffer.byteLength(serialized), json: async () => structuredClone(value) };
    },
    async head(key) {
      return objects.has(key) ? { customMetadata: { content_hash: "present" } } : null;
    },
    async put(key, json) { objects.set(key, JSON.parse(String(json))); puts++; return {}; },
    async delete(keys) {
      deletes++;
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
  } };
  const items = [{
    x_id: "user-b", x_name: "User B", icon_url: null, personal_count: 1,
    collab_count: 0, total_works: 1, sort_score: 1,
  }];
  const first = await rebuildUsersIndexV2Artifacts(env, items, 1_700_000_000);
  assert.equal(first.skipped, false);
  const manifest = structuredClone(objects.get(MANIFEST));
  assert.ok(manifest, "first rebuild commits a V2 manifest");
  const previousPuts = puts;
  const { value, logged } = await brokenLogger("info", () =>
    rebuildUsersIndexV2Artifacts(env, items, 1_700_000_000));
  assert.equal(value.skipped, true);
  assert.equal(puts, previousPuts, "same-generation must not re-PUT content");
  assert.equal(deletes, 0, "diagnostic failure cannot invalidate the manifest");
  assert.deepEqual(objects.get(MANIFEST), manifest);
  assert.equal(JSON.parse(logged[0]).result, "generation_same_skip");
});
