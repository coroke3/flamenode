import assert from "node:assert/strict";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });

  const { planXIdMergeD1Budget } = await import("./mergeBudget.ts");
  const { buildStaticRebuildQueueBatch } = await import("../staticRebuild/enqueue.ts");

  const statement = {};
  const audit = (index) => ({
    table_name: "x_users",
    target_id: `x-${index}`,
    operation: "UPDATE",
    actor_user_id: "admin-1",
    before: null,
    after: null,
  });

  function plan({ mutations, assertions, audits, callerReads }) {
    return planXIdMergeD1Budget({
      mutationStatements: Array.from({ length: mutations }, () => statement),
      expectedMutationChanges: Array.from(
        { length: mutations },
        (_, index) => (index < assertions ? 1 : null),
      ),
      preMutationAssertions: [statement],
      postMutationAssertions: [statement],
      audits: Array.from({ length: audits }, (_, index) => audit(index)),
      callerQueryCount: callerReads,
    });
  }

  test("MIG-0516追加後の最大対応mergeはFree 50 query超過を事前拒否する", async () => {
    // merge.ts builds 20 base DML + visibility fence + one <=100-target queue
    // DML + a build-request marker. Five strict assertions cover
    // x_users/request/fence/queue/marker; 3 or 4 audits share one chunk.
    const queue = await buildStaticRebuildQueueBatch(
      { run: (query) => query },
      Array.from({ length: 100 }, (_, index) => ({
        targetType: "user",
        targetId: `x-${index}`,
        reason: "x_id_merge",
      })),
    );
    assert.equal(queue.acceptedTargetCount, 100);
    assert.equal(queue.statements.length, 2);
    assert.deepEqual(queue.expectedChanges, [100, 1]);

    for (const auditCount of [3, 4]) {
      const budget = plan({
        mutations: 20 + 1 + queue.statements.length,
        assertions: 2 + 1 + queue.expectedChanges.length,
        audits: auditCount,
        callerReads: 18,
      });
      assert.equal(budget.preparationQueryCount, 2);
      assert.equal(budget.mutationStatementCount, 23);
      assert.equal(budget.mutationAssertionCount, 5);
      assert.equal(budget.integrityAssertionCount, 2);
      assert.equal(budget.auditQueryCount, 2);
      assert.equal(budget.totalQueryCount, 52);
      assert.equal(budget.withinLimit, false);
    }
  });

  test("実production plannerは最大対応revertを余裕付きでFree 50 query以内に収める", () => {
    // revert has 21 base inverse DML + fence + one <=100-target queue. The
    // three request/identity CAS checks plus fence/queue make five changes()
    // assertions; it keeps two summary audits in one chunk.
    const budget = plan({
      mutations: 23,
      assertions: 5,
      audits: 2,
      callerReads: 5,
    });
    assert.equal(budget.preparationQueryCount, 2);
    assert.equal(budget.batchQueryCount, 32);
    assert.equal(budget.totalQueryCount, 39);
    assert.equal(budget.withinLimit, true);
  });

  test("production plannerは1 statementでも上限を超える形を事前拒否できる", () => {
    const budget = plan({
      mutations: 23,
      assertions: 4,
      audits: 4,
      callerReads: 18,
    });
    assert.equal(budget.totalQueryCount, 51);
    assert.equal(budget.withinLimit, false);
  });
}
