import assert from "node:assert/strict";
import test from "node:test";
import {
  rebuildUsersIndexV2Artifacts,
  rebuildUsersIndexV2FromLegacyArtifact,
} from "./usersIndexV2Artifacts.ts";
import { rebuildEnvironment } from "../shared/rebuildEnvironment.ts";

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
  abortController,
  abortPutAt,
} = {}) {
  const calls = { first: 0, run: 0, all: 0 };
  const queries = [];
  const bindings = [];
  const putKeys = [];
  const writtenKeys = [];
  const deleteKeys = [];
  const R2 = {
    async head() {
      return null;
    },
    async put(key) {
      putKeys.push(key);
      if (abortController && abortPutAt && putKeys.length === abortPutAt) {
        abortController.abort("test_abort_after_r2_put");
      }
      if (key === failPutKey || (failPutAt && putKeys.length === failPutAt)) {
        throw new Error(`r2_put_failed:${key}`);
      }
      writtenKeys.push(key);
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
  return {
    DB,
    R2,
    calls,
    queries,
    bindings,
    putKeys,
    writtenKeys,
    deleteKeys,
  };
}

function trackedKeysFromBindings(env) {
  return new Set(
    env.bindings
      .filter(({ sql }) => sql.includes("INSERT INTO static_artifacts"))
      .flatMap(({ values }) => {
        const rows = JSON.parse(values[0]);
        return rows.map(({ objectKey }) => objectKey);
      }),
  );
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
  // rows are upserted through bounded JSON1 statements.
  assert.equal(result.objectCount, 35);
  assert.equal(env.calls.first, 1);
  // All page/search rows fit in one JSON1 upsert for this fixture; the
  // manifest is recorded immediately after its R2 PUT.
  assert.equal(env.calls.run, 2);
  assert.equal(env.calls.all, 1);
  assert.equal(env.calls.first + env.calls.run + env.calls.all, 4);
  const trackingSqls = env.queries.filter((sql) =>
    sql.includes("INSERT INTO static_artifacts"),
  );
  assert.equal(trackingSqls.length, 2);
  assert.equal(trackedKeysFromBindings(env).size, 35);
  assert.ok(trackingSqls.every((sql) => sql.includes("json_each(?1)")));
});

test("large users index keeps tracking below the Worker D1 statement budget", async () => {
  const env = createEnv();
  const result = await rebuildUsersIndexV2Artifacts(
    env,
    Array.from({ length: 8_000 }, (_, index) => source(index)),
    1_700_000_000,
  );

  // 8,000 creators produce 501 pages, one search artifact, and one manifest.
  // JSON1 tracking stays at two page/search UPSERTs plus one manifest UPSERT,
  // rather than one statement per generated object.
  assert.equal(result.objectCount, 503);
  assert.equal(env.calls.first, 1);
  assert.equal(env.calls.run, 3);
  assert.equal(env.calls.all, 1);
  assert.equal(env.calls.first + env.calls.run + env.calls.all, 5);
  assert.equal(trackedKeysFromBindings(env).size, 503);
});

test("rebuild環境はimmutable page/searchのdeduplicate falseを二重probeしない", async () => {
  const env = createEnv();
  const rebuildEnv = rebuildEnvironment({ ...env, KV: {} });

  await rebuildUsersIndexV2Artifacts(
    rebuildEnv,
    [source(0)],
    1_700_000_000,
  );

  // Only the manifest is content-deduplicated. Generation-specific pages and
  // search use immutable keys and must not trigger implicit D1 hash probes.
  assert.equal(env.calls.first, 1);
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

  const trackedKeys = trackedKeysFromBindings(env);
  assert.equal(env.calls.run, 1);
  assert.equal(env.putKeys.length, 35);
  assert.equal(trackedKeys.size, 34);
  assert.deepEqual(new Set(env.putKeys.slice(0, -1)), trackedKeys);
  assert.equal(trackedKeys.has("users/index.v2/manifest.json"), false);
});

test("page R2 failure cleans the successful but untracked chunk", async () => {
  const env = createEnv({ failPutAt: 13 });

  await assert.rejects(
    rebuildUsersIndexV2Artifacts(
      env,
      Array.from({ length: 500 }, (_, index) => source(index)),
      1_700_000_000,
    ),
    /r2_put_failed:/,
  );

  const trackedKeys = trackedKeysFromBindings(env);
  assert.equal(env.calls.run, 0);
  assert.equal(trackedKeys.size, 0);
  assert.deepEqual(
    new Set(env.deleteKeys),
    new Set([...env.writtenKeys, env.putKeys.at(-1)]),
  );
});

test("abort after an R2 PUT cleans the current untracked object", async () => {
  const controller = new AbortController();
  const env = createEnv({ abortController: controller, abortPutAt: 1 });

  await assert.rejects(
    rebuildUsersIndexV2Artifacts(
      env,
      Array.from({ length: 500 }, (_, index) => source(index)),
      1_700_000_000,
      controller.signal,
    ),
    /test_abort_after_r2_put/,
  );

  assert.equal(env.calls.run, 0);
  assert.deepEqual(new Set(env.deleteKeys), new Set(env.writtenKeys));
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
  assert.equal(env.putKeys.length, 34);
  assert.deepEqual(new Set(env.deleteKeys), new Set(env.putKeys));
});

test("manifest tracking failure is invalidated so no committed R2 object remains untracked", async () => {
  const env = createEnv({
    failRunAt: 2,
    legacyPayload: {
      generated_at: 1_700_000_000,
      items: Array.from({ length: 500 }, (_, index) => source(index)),
    },
  });

  const result = await rebuildUsersIndexV2FromLegacyArtifact(env);

  assert.deepEqual(result, { liveKeys: [], objectCount: 0 });
  assert.equal(env.calls.run, 3);
  assert.ok(env.deleteKeys.includes("users/index.v2/manifest.json"));

  const trackedKeys = trackedKeysFromBindings(env);
  trackedKeys.delete("users/index.v2/manifest.json");
  assert.deepEqual(
    new Set(env.putKeys.filter((key) => key !== "users/index.v2/manifest.json")),
    trackedKeys,
  );
});
