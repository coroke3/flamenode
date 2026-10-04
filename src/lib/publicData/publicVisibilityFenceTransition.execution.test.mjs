import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";

const runningWithTsx =
  process.env.FLAMENODE_FENCE_TRANSITION_EXECUTION === "1";

if (!runningWithTsx) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--test",
      fileURLToPath(import.meta.url),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_FENCE_TRANSITION_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return {
          url: "data:text/javascript,export%20{}",
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  const OBJECT_KEY = "visibility/blocked-entities.v1.json";
  const r2 = { object: null, version: 0, beforePut: null };
  const bucket = {
    async get(key) {
      assert.equal(key, OBJECT_KEY);
      if (!r2.object) return null;
      const { body, etag } = r2.object;
      return { etag, size: Buffer.byteLength(body), text: async () => body };
    },
    async put(key, body, options) {
      assert.equal(key, OBJECT_KEY);
      if (r2.beforePut) {
        const hook = r2.beforePut;
        r2.beforePut = null;
        hook();
      }
      const onlyIf = options?.onlyIf;
      if (onlyIf instanceof Headers && onlyIf.get("if-none-match") === "*" && r2.object) {
        return null;
      }
      if (onlyIf?.etagMatches && onlyIf.etagMatches !== r2.object?.etag) {
        return null;
      }
      r2.version += 1;
      r2.object = { body: String(body), etag: `etag-${r2.version}` };
      return { etag: r2.object.etag };
    },
  };
  mock.module("@/lib/cloudflare", {
    namedExports: { getEnv: () => ({ BUCKET: bucket }) },
  });

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  process.on("exit", () => {
    console.warn = originalWarn;
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const {
    compensatePublicVisibilityFenceOnD1Failure,
    planPublicVisibilityFenceTransition,
    preCommitPublicVisibilityFence,
  } = await import("./publicVisibilityFenceTransition.ts");

  const migrationsDir = new URL("../../../migrations/", import.meta.url);
  const schemaSql = readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort()
    .map((name) => readFileSync(new URL(name, migrationsDir), "utf8"))
    .join("\n");

  function createHarness(t) {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(schemaSql);
    t.after(() => sqlite.close());
    r2.object = null;
    r2.version = 0;
    r2.beforePut = null;
    warnings.length = 0;
    const db = drizzle(async (sql, params, method) => {
      const statement = sqlite.prepare(sql);
      if (method === "run") {
        statement.run(...params);
        return { rows: [] };
      }
      const rows = statement.all(...params).map((row) => Object.values(row));
      return { rows: method === "get" ? rows[0] : rows };
    });
    return {
      sqlite,
      db,
      runPlan(plan) {
        for (const statement of plan.mutationStatements) {
          const { sql, params } = statement.toSQL();
          assert.equal(sqlite.prepare(sql).run(...params).changes, 1);
        }
      },
      fence(entityType, entityId) {
        const row = sqlite
          .prepare(
            "SELECT * FROM public_visibility_fences WHERE entity_type = ? AND entity_id = ?",
          )
          .get(entityType, entityId);
        return row ? { ...row } : null;
      },
    };
  }

  function manifestEntities() {
    return r2.object ? JSON.parse(r2.object.body).entities : [];
  }

  function seedManifest(entities) {
    r2.version += 1;
    r2.object = {
      body: JSON.stringify({
        schema_version: 1,
        revision: 1,
        generated_at: 100,
        entities,
      }),
      etag: `etag-${r2.version}`,
    };
  }

  const basePlan = {
    entityType: "x_user",
    entityId: "Alice",
    isPublic: (status) => status === "approved",
    actorUserId: "admin-1",
    reason: "test",
    now: 1_000,
  };

  test("公開可否が変わらなければ fence を作らない", async (t) => {
    const harness = createHarness(t);
    const plan = await planPublicVisibilityFenceTransition({
      ...basePlan,
      db: harness.db,
      previousStatus: "pending",
      nextStatus: "rejected",
    });
    assert.deepEqual(plan.mutationStatements, []);
    assert.equal(plan.fenceToken, null);
  });

  test("非公開化は blocked fence を正規化した ID で作り、再公開は同じ token を再利用する", async (t) => {
    const harness = createHarness(t);
    const blocked = await planPublicVisibilityFenceTransition({
      ...basePlan,
      db: harness.db,
      previousStatus: "approved",
      nextStatus: "rejected",
    });
    assert.deepEqual(blocked.expectedMutationChanges, [1]);
    assert.match(blocked.fenceToken, /^vf/);
    harness.runPlan(blocked);
    const row = harness.fence("x_user", "alice");
    assert.equal(row.fence_token, blocked.fenceToken);
    assert.equal(row.state, "blocked");
    assert.equal(row.blocked_at, 1_000);
    assert.equal(row.release_requested_at, null);
    assert.equal(row.requested_by_auth_user_id, "admin-1");

    const released = await planPublicVisibilityFenceTransition({
      ...basePlan,
      db: harness.db,
      previousStatus: "rejected",
      nextStatus: "approved",
      now: 2_000,
    });
    assert.equal(released.fenceToken, blocked.fenceToken);
    harness.runPlan(released);
    const after = harness.fence("x_user", "alice");
    assert.equal(after.state, "release_pending");
    assert.equal(after.blocked_at, null);
    assert.equal(after.release_requested_at, 2_000);
  });

  test("preCommit は manifest に token を書いて確認し、競合で別 token があれば失敗する", async () => {
    await preCommitPublicVisibilityFence({
      entityType: "x_user",
      entityId: "Alice",
      fenceToken: "vf-1",
      reason: "test",
    });
    assert.deepEqual(
      manifestEntities().map(({ entity_type, entity_id, fence_token }) => ({
        entity_type, entity_id, fence_token,
      })),
      [{ entity_type: "x_user", entity_id: "alice", fence_token: "vf-1" }],
    );

    seedManifest([]);
    r2.beforePut = () =>
      seedManifest([
        { entity_type: "event_group", entity_id: "g1", fence_token: "vf-other", blocked_at: 1 },
      ]);
    await assert.rejects(
      () =>
        preCommitPublicVisibilityFence({
          entityType: "event_group",
          entityId: "g1",
          fenceToken: "vf-mine",
        }),
      /public_visibility_fence_token_mismatch/,
    );
    assert.equal(manifestEntities()[0].fence_token, "vf-other");
  });

  test("compensate は D1 に fence がなければ自分の token だけを manifest から外す", async (t) => {
    const harness = createHarness(t);
    const input = {
      db: harness.db,
      entityType: "event_group",
      entityId: "g1",
      fenceToken: "vf-mine",
      flow: "event_group_visibility",
    };

    seedManifest([
      { entity_type: "event_group", entity_id: "g1", fence_token: "vf-newer", blocked_at: 1 },
    ]);
    await compensatePublicVisibilityFenceOnD1Failure(input);
    assert.equal(manifestEntities()[0].fence_token, "vf-newer");

    seedManifest([
      { entity_type: "event_group", entity_id: "g1", fence_token: "vf-mine", blocked_at: 1 },
    ]);
    await compensatePublicVisibilityFenceOnD1Failure(input);
    assert.deepEqual(manifestEntities(), []);
    assert.deepEqual(warnings, []);
  });

  test("compensate は D1 の fence が自分の token なら manifest を触らない", async (t) => {
    const harness = createHarness(t);
    harness.runPlan(
      await planPublicVisibilityFenceTransition({
        ...basePlan,
        entityType: "event_group",
        entityId: "g1",
        db: harness.db,
        previousStatus: "approved",
        nextStatus: "rejected",
      }),
    );
    const token = harness.fence("event_group", "g1").fence_token;
    seedManifest([
      { entity_type: "event_group", entity_id: "g1", fence_token: token, blocked_at: 1 },
    ]);
    const etagBefore = r2.object.etag;
    await compensatePublicVisibilityFenceOnD1Failure({
      db: harness.db,
      entityType: "event_group",
      entityId: "g1",
      fenceToken: token,
      flow: "event_group_visibility",
    });
    assert.equal(r2.object.etag, etagBefore);
  });
}
