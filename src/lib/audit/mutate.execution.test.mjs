import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runningWithTsx = process.env.FLAMENODE_MUTATE_EXECUTION === "1";

if (!runningWithTsx) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", fileURLToPath(import.meta.url)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_MUTATE_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  const { sql } = await import("drizzle-orm");
  const { drizzle } = await import("drizzle-orm/d1");
  const { SQLiteSyncDialect } = await import("drizzle-orm/sqlite-core");
  const dialect = new SQLiteSyncDialect();
  const {
    AUDIT_INSERT_CHUNK_SIZE,
    D1_MAX_BATCH_QUERIES,
    asBatchRunnable,
    mutateWithAudit,
  } = await import("./mutate.ts");

  const makeAudit = (index) => ({
    table_name: "videos",
    target_id: `video-${index}`,
    operation: "UPDATE",
    actor_user_id: "actor-1",
    before: { title: "before" },
    after: { title: `after-${index}` },
  });

  const makeMutation = () => ({
    kind: "mutation",
    _prepare: () => ({
      getQuery: () => ({ sql: "mutation", params: [] }),
      stmt: { bind: () => ({}) },
    }),
  });

  const makeDb = ({ failOnAuditAssertion = false, failOnMutationAssertion = false, failGetAt = 0 } = {}) => {
    const state = { committed: false, batches: [], gets: 0 };
    const get = async () => {
      state.gets += 1;
      if (state.gets === failGetAt) throw new Error("simulated preparation query failure");
      return undefined;
    };
    const selectChain = {
      leftJoin: () => selectChain,
      where: () => ({ get }),
    };
    const db = {
      select: () => ({ from: () => selectChain }),
      run: (query) => {
        const sequel =
          typeof query === "string"
            ? { sql: query, params: [] }
            : typeof query?.getSQL === "function"
              ? dialect.sqlToQuery(query.getSQL())
              : { sql: String(query), params: [] };
        return {
          kind: "query",
          query,
          config: { action: "run" },
          getSQL: () => query,
          getQuery: () => sequel,
          _prepare: () => ({
            getQuery: () => sequel,
            stmt: { bind: () => ({}) },
          }),
        };
      },
      batch: async (items) => {
        state.batches.push(items);
        if (failOnMutationAssertion && items[1]) {
          throw new Error("simulated mutation changes assertion failure");
        }
        if (failOnAuditAssertion && items[2]) {
          throw new Error("simulated audit assertion failure");
        }
        state.committed = true;
        return [];
      },
    };
    return { db, state };
  };

  test("4件以下は1 chunk、5件目で2 chunkになり返却IDを維持する", async () => {
    assert.equal(AUDIT_INSERT_CHUNK_SIZE, 4);
    const { db, state } = makeDb();
    const ids = await mutateWithAudit(db, {
      mutationStatements: [makeMutation()],
      expectedMutationChanges: 1,
      audits: Array.from({ length: 5 }, (_, index) => makeAudit(index)),
    });
    assert.equal(ids.length, 5);
    assert.equal(state.batches[0].length, 6);
    assert.equal(state.gets, 2);
    assert.equal(state.committed, true);
  });

  test("監査INSERTとassertionも値をinlineせずbindのままbatchへ渡す", async () => {
    const { db, state } = makeDb();
    await mutateWithAudit(db, {
      mutationStatements: [makeMutation()],
      expectedMutationChanges: 1,
      audits: [makeAudit(0)],
    });
    const [, mutationAssertion, auditInsert, auditAssertion] = state.batches[0];
    assert.notEqual(mutationAssertion.query.shouldInlineParams, true);
    assert.notEqual(auditInsert.query.shouldInlineParams, true);
    assert.notEqual(auditAssertion.query.shouldInlineParams, true);
    assert.equal(mutationAssertion.getQuery().params.length, 1);
    assert.equal(auditInsert.getQuery().params.length, 21);
    assert.equal(auditAssertion.getQuery().params.length, 2);
  });

  test("100KB級の監査snapshotをSQL本文へ展開せずbindとして保持する", async () => {
    const { db, state } = makeDb();
    const longBefore = "あ".repeat(18_000);
    const longAfter = "い".repeat(18_000);
    const combinedBytes = new TextEncoder().encode(
      JSON.stringify({ note: longBefore }) + JSON.stringify({ note: longAfter }),
    ).byteLength;
    assert.ok(combinedBytes > 100_000);
    assert.ok(combinedBytes < 120_000);

    await mutateWithAudit(db, {
      mutationStatements: [makeMutation()],
      expectedMutationChanges: 1,
      audits: [
        {
          ...makeAudit(0),
          before: { note: longBefore },
          after: { note: longAfter },
        },
      ],
    });

    const auditInsert = state.batches[0][2];
    assert.notEqual(auditInsert.query.shouldInlineParams, true);
    assert.ok(new TextEncoder().encode(auditInsert.getQuery().sql).byteLength < 100_000);
    const stringParams = auditInsert.getQuery().params.filter(
      (value) => typeof value === "string",
    );
    assert.ok(stringParams.some((value) => value.includes(longBefore.slice(0, 100))));
    assert.ok(stringParams.some((value) => value.includes(longAfter.slice(0, 100))));
  });

  test("builder は db.run せずそのまま batch へ渡す", async () => {
    const { db, state } = makeDb();
    let prepareCalled = false;
    const builder = {
      config: { table: "videos" },
      getSQL: () => sql`UPDATE videos SET title = 'after-0' WHERE id = 'video-0'`.inlineParams(),
      _prepare: () => {
        prepareCalled = true;
        return {
          getQuery: () => ({ sql: "builder", params: [] }),
          stmt: { bind: () => ({}) },
        };
      },
    };
    await mutateWithAudit(db, {
      mutationStatements: [builder],
      expectedMutationChanges: 1,
      audits: [makeAudit(0)],
    });
    assert.equal(prepareCalled, false);
    assert.equal(state.batches[0][0], builder);
  });

  test("bind パラメータ付き db.run はinlineせずbatchまで保持する", async () => {
    const { db, state } = makeDb();
    const parametric = db.run(sql`SELECT ${"bound-value"} AS value`);
    await mutateWithAudit(db, {
      mutationStatements: [parametric],
      expectedMutationChanges: [null],
      audits: [makeAudit(0)],
    });
    assert.equal(state.batches[0][0], parametric);
    assert.deepEqual(state.batches[0][0]?.getQuery().params, ["bound-value"]);
  });

  test("getSQL だけ持つ statement は db.run で batch 可能な RunnableQuery に正規化する", async () => {
    const { db, state } = makeDb();
    const sqlOnly = {
      getSQL: () => sql`UPDATE videos SET title = 'after-0' WHERE id = 'video-0'`.inlineParams(),
    };
    await mutateWithAudit(db, {
      mutationStatements: [sqlOnly],
      expectedMutationChanges: 1,
      audits: [makeAudit(0)],
    });
    assert.equal(state.batches.length, 1);
    assert.equal(state.batches[0][0]?.kind, "query");
  });

  test("Drizzle D1のraw batchはbind parameterをD1PreparedStatement.bindへ渡す", async () => {
    const prepared = [];
    const client = {
      prepare: (query) => ({
        bind: (...params) => {
          const statement = { query, params };
          prepared.push(statement);
          return statement;
        },
      }),
      batch: async (statements) =>
        statements.map(() => ({ success: true, results: [], meta: {} })),
    };
    const db = drizzle(client);

    await db.batch([
      asBatchRunnable(db, db.run(sql`SELECT ${"bound-value"} AS value`)),
    ]);

    assert.equal(prepared.length, 1);
    assert.deepEqual(prepared[0].params, ["bound-value"]);
    assert.doesNotMatch(prepared[0].query, /bound-value/);
  });

  test("100KB超のJSON payloadもSQL本文へ展開せず2MB未満の1 bindとして保持する", async () => {
    const prepared = [];
    const client = {
      prepare: (query) => ({
        bind: (...params) => {
          const statement = { query, params };
          prepared.push(statement);
          return statement;
        },
      }),
      batch: async (statements) =>
        statements.map(() => ({ success: true, results: [], meta: {} })),
    };
    const db = drizzle(client);
    const payload = JSON.stringify(
      Array.from({ length: 300 }, (_, index) => ({
        id: index,
        note: "あ".repeat(400),
      })),
    );
    const payloadBytes = new TextEncoder().encode(payload).byteLength;
    assert.ok(payloadBytes > 100_000);
    assert.ok(payloadBytes < 2_000_000);

    await db.batch([
      asBatchRunnable(db, db.run(sql`SELECT json_array_length(${payload})`)),
    ]);

    assert.equal(prepared.length, 1);
    assert.equal(prepared[0].params.length, 1);
    assert.equal(prepared[0].params[0], payload);
    assert.ok(new TextEncoder().encode(prepared[0].query).byteLength < 100_000);
  });

  test("複数actorでは設定1回とunique actorごとのqueryになる", async () => {
    const { db, state } = makeDb();
    const audits = [0, 1, 2].map((index) => ({
      ...makeAudit(index),
      actor_user_id: `actor-${index}`,
    }));
    await mutateWithAudit(db, {
      mutationStatements: [makeMutation()],
      expectedMutationChanges: 1,
      audits,
    });
    assert.equal(state.gets, 4);
  });

  test("複数actorの前処理queryも上限計算に含めて拒否する", async () => {
    const { db, state } = makeDb();
    const audits = Array.from({ length: 40 }, (_, index) => ({
      ...makeAudit(index),
      actor_user_id: `actor-${index}`,
    }));
    await assert.rejects(
      mutateWithAudit(db, {
        mutationStatements: [makeMutation()],
        expectedMutationChanges: 1,
        audits,
      }),
      /前処理41.*batch22.*予約18\/50/,
    );
    assert.equal(state.gets, 0);
    assert.equal(state.batches.length, 0);
  });

  test("100件境界は50 queryを越えるためbatch前にfail-closedする", async () => {
    const { db, state } = makeDb();
    await assert.rejects(
      mutateWithAudit(db, {
        mutationStatements: [makeMutation()],
        expectedMutationChanges: 1,
        audits: Array.from({ length: 100 }, (_, index) => makeAudit(index)),
      }),
      /batch52.*予約18\/50/,
    );
    assert.equal(state.batches.length, 0);
  });

  test("上限超過入力もdb.batchを呼ばずに拒否する", async () => {
    const { db, state } = makeDb();
    await assert.rejects(
      mutateWithAudit(db, {
        mutationStatements: [makeMutation()],
        expectedMutationChanges: 1,
        audits: Array.from({ length: D1_MAX_BATCH_QUERIES * 4 }, (_, index) => makeAudit(index)),
      }),
      /query 数が上限を超える/,
    );
    assert.equal(state.batches.length, 0);
  });

  test("mutation changes assertion失敗時はmutationをcommitしない", async () => {
    const { db, state } = makeDb({ failOnMutationAssertion: true });
    await assert.rejects(
      mutateWithAudit(db, {
        mutationStatements: [makeMutation()],
        expectedMutationChanges: 1,
        audits: [makeAudit(0)],
      }),
      /simulated mutation changes assertion failure/,
    );
    assert.equal(state.batches.length, 1);
    assert.equal(state.committed, false);
  });

  test("監査chunk assertion失敗時はmutationをcommitしない", async () => {
    const { db, state } = makeDb({ failOnAuditAssertion: true });
    await assert.rejects(
      mutateWithAudit(db, {
        mutationStatements: [makeMutation()],
        expectedMutationChanges: 1,
        audits: Array.from({ length: 5 }, (_, index) => makeAudit(index)),
      }),
      /simulated audit assertion failure/,
    );
    assert.equal(state.batches.length, 1);
    assert.equal(state.committed, false);
  });

  test("strict時の設定/actor query失敗は監査を実行しない", async () => {
    for (const failGetAt of [1, 2]) {
      const { db, state } = makeDb({ failGetAt });
      await assert.rejects(
        mutateWithAudit(db, {
          mutationStatements: [makeMutation()],
          expectedMutationChanges: 1,
          audits: [makeAudit(0)],
        }),
        /simulated preparation query failure/,
      );
      assert.equal(state.batches.length, 0);
    }
  });
}
