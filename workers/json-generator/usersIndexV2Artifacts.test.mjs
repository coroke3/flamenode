import assert from "node:assert/strict";
import test from "node:test";
import {
  rebuildUsersIndexV2Artifacts,
  rebuildUsersIndexV2FromLegacyArtifact,
} from "./usersIndexV2Artifacts.ts";

function source(index) {
  return {
    x_id: `creator-${index}`,
    x_name: `Creator ${index}`,
    icon_url: null,
    personal_count: 1,
    collab_count: 0,
    total_works: 1,
    sort_score: 3,
  };
}

function createEnv({
  failPutKey,
  failPutAt,
  failRunAt,
  legacyPayload,
} = {}) {
  const calls = { first: 0, run: 0, all: 0 };
  const queries = [];
  const bindings = [];
  const putKeys = [];
  const deleteKeys = [];
  const R2 = {
    async head() {
      return null;
    },
    async put(key) {
      putKeys.push(key);
      if (key === failPutKey || (failPutAt && putKeys.length === failPutAt)) {
        throw new Error(`r2_put_failed:${key}`);
      }
      return {};
    },
    async delete(key) {
      if (Array.isArray(key)) deleteKeys.push(...key);
      else deleteKeys.push(key);
    },
    async get(key) {
      if (key === "users/index.json" && legacyPayload) {
        return { json: async () => legacyPayload };
      }
      return null;
    },
  };
  const DB = {
    prepare(sql) {
      queries.push(sql);
      return {
        bind(...values) {
          bindings.push({ sql, values });
          return {
            async first() {
              calls.first += 1;
              return null;
            },
            async run() {
              calls.run += 1;
              if (calls.run === failRunAt) {
                throw new Error(`d1_run_failed:${calls.run}`);
              }
              return { meta: { changes: 1 } };
            },
            async all() {
              calls.all += 1;
              return { results: [] };
            },
          };
        },
      };
    },
  };
  return { DB, R2, calls, queries, bindings, putKeys, deleteKeys };
}

test("users index v2 tracks all generation objects within a bounded D1 statement count", async () => {
  const env = createEnv();
  const result = await rebuildUsersIndexV2Artifacts(
    env,
    Array.from({ length: 500 }, (_, index) => source(index)),
    1_700_000_000,
  );

  // 500 creators produce 11 pages for each of 3 sorts plus search and the
  // manifest.  Generation-specific keys skip per-page D1 hash probes, and all
  // rows are upserted in bounded multi-value statements below D1's 100-bind
  // limit.
  assert.equal(result.objectCount, 35);
  assert.equal(env.calls.first, 1);
  // page/search rows are recorded in 12/12/10 chunks before the manifest;
  // the manifest itself is recorded immediately after its R2 PUT.
  assert.equal(env.calls.run, 4);
  assert.equal(env.calls.all, 1);
  assert.equal(env.calls.first + env.calls.run + env.calls.all, 6);
  const trackingSqls = env.queries.filter((sql) =>
    sql.includes("INSERT INTO static_artifacts"),
  );
  assert.equal(trackingSqls.length, 4);
  assert.equal(
    trackingSqls.reduce(
      (total, sql) =>
        total +
        (sql.match(/\(\?, \?, \?, \?, \?, \?, NULL, \?, NULL\)/g) ?? [])
          .length,
      0,
    ),
    35,
  );
  assert.ok(
    trackingSqls.every(
      (sql) =>
        (sql.match(/\(\?, \?, \?, \?, \?, \?, NULL, \?, NULL\)/g) ?? [])
          .length <= 12,
    ),
  );
});

test("manifest R2 failure leaves every successful page/search PUT tracked", async () => {
  const env = createEnv({ failPutKey: "users/index.v2/manifest.json" });

  await assert.rejects(
    rebuildUsersIndexV2Artifacts(
      env,
      Array.from({ length: 500 }, (_, index) => source(index)),
      1_700_000_000,
    ),
    /r2_put_failed:users\/index\.v2\/manifest\.json/,
  );

  const trackedKeys = new Set(
    env.bindings
      .filter(({ sql }) => sql.includes("INSERT INTO static_artifacts"))
      .flatMap(({ values }) =>
        Array.from(
          { length: Math.floor(values.length / 7) },
          (_, row) => values[row * 7 + 3],
        ),
      ),
  );
  assert.equal(env.calls.run, 3);
  assert.equal(env.putKeys.length, 35);
  assert.equal(trackedKeys.size, 34);
  assert.deepEqual(new Set(env.putKeys.slice(0, -1)), trackedKeys);
  assert.equal(trackedKeys.has("users/index.v2/manifest.json"), false);
});

test("page R2 failure after a completed chunk keeps the completed chunk tracked", async () => {
  const env = createEnv({ failPutAt: 13 });

  await assert.rejects(
    rebuildUsersIndexV2Artifacts(
      env,
      Array.from({ length: 500 }, (_, index) => source(index)),
      1_700_000_000,
    ),
    /r2_put_failed:/,
  );

  const trackedKeys = new Set(
    env.bindings
      .filter(({ sql }) => sql.includes("INSERT INTO static_artifacts"))
      .flatMap(({ values }) =>
        Array.from(
          { length: Math.floor(values.length / 7) },
          (_, row) => values[row * 7 + 3],
        ),
      ),
  );
  assert.equal(env.calls.run, 1);
  assert.equal(trackedKeys.size, 12);
  assert.deepEqual(new Set(env.putKeys.slice(0, -1)), trackedKeys);
});

test("D1 chunk failure removes the just-written untracked R2 chunk", async () => {
  const env = createEnv({ failRunAt: 1 });

  await assert.rejects(
    rebuildUsersIndexV2Artifacts(
      env,
      Array.from({ length: 500 }, (_, index) => source(index)),
      1_700_000_000,
    ),
    /d1_run_failed:1/,
  );

  assert.equal(env.calls.run, 1);
  assert.equal(env.putKeys.length, 12);
  assert.deepEqual(new Set(env.deleteKeys), new Set(env.putKeys));
});

test("manifest tracking failure is invalidated so no committed R2 object remains untracked", async () => {
  const env = createEnv({
    failRunAt: 4,
    legacyPayload: {
      generated_at: 1_700_000_000,
      items: Array.from({ length: 500 }, (_, index) => source(index)),
    },
  });

  const result = await rebuildUsersIndexV2FromLegacyArtifact(env);

  assert.deepEqual(result, { liveKeys: [], objectCount: 0 });
  assert.equal(env.calls.run, 5);
  assert.ok(env.deleteKeys.includes("users/index.v2/manifest.json"));

  const trackedKeys = new Set(
    env.bindings
      .filter(({ sql }) => sql.includes("INSERT INTO static_artifacts"))
      .flatMap(({ values }) =>
        Array.from(
          { length: Math.floor(values.length / 7) },
          (_, row) => values[row * 7 + 3],
        ),
      ),
  );
  assert.deepEqual(
    new Set(env.putKeys),
    new Set([...trackedKeys, "users/index.v2/manifest.json"]),
  );
});
