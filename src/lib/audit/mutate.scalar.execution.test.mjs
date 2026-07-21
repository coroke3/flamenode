import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

if (process.env.FLAMENODE_SCALAR_EXECUTION !== "1") {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", fileURLToPath(import.meta.url)],
    {
      stdio: "inherit",
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, FLAMENODE_SCALAR_EXECUTION: "1" },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  const { mutateWithAudit } = await import("./mutate.ts");
  const audit = (index) => ({
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
  const dbFor = (failure) => {
    const state = { batches: [], committed: false };
    const selectChain = {
      leftJoin: () => selectChain,
      where: () => ({ get: async () => undefined }),
    };
    const db = {
      select: () => ({ from: () => selectChain }),
      run: (query) => {
        const sequel =
          typeof query === "string"
            ? { sql: query, params: [] }
            : typeof query?.getSQL === "function"
              ? (() => {
                  const sqlQuery = query.getSQL();
                  return {
                    sql: String(sqlQuery),
                    params: sqlQuery.shouldInlineParams
                      ? []
                      : Array.isArray(sqlQuery.params)
                        ? [...sqlQuery.params]
                        : [],
                  };
                })()
              : { sql: String(query), params: [] };
        return {
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
        if (failure) throw new Error("mutation changes assertion failure");
        state.committed = true;
        return [];
      },
    };
    return { db, state };
  };

  test("scalar + 5 audits は本体assertion後に全chunkを成功させる", async () => {
    const { db, state } = dbFor(false);
    const ids = await mutateWithAudit(db, {
      mutationStatements: [makeMutation()],
      expectedMutationChanges: 1,
      audits: Array.from({ length: 5 }, (_, index) => audit(index)),
    });
    assert.equal(ids.length, 5);
    assert.equal(state.batches[0].length, 6);
    assert.equal(state.committed, true);
  });

  test("scalar の mutation changes 不一致は最初のassertionでrollbackする", async () => {
    const { db, state } = dbFor(true);
    await assert.rejects(
      mutateWithAudit(db, {
        mutationStatements: [makeMutation()],
        expectedMutationChanges: 1,
        audits: Array.from({ length: 5 }, (_, index) => audit(index)),
      }),
      /mutation changes assertion failure/,
    );
    assert.equal(state.batches.length, 1);
    assert.equal(state.batches[0].length, 6);
    assert.equal(state.committed, false);
  });

  test("scalar は複数mutation statementをfail-closedで拒否する", async () => {
    const { db, state } = dbFor(false);
    await assert.rejects(
      mutateWithAudit(db, {
        mutationStatements: [makeMutation(), makeMutation()],
        expectedMutationChanges: 1,
        audits: [audit(0)],
      }),
      /scalar.*1件/,
    );
    assert.equal(state.batches.length, 0);
  });
}
