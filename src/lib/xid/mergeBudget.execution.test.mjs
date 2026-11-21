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

  test("実production plannerは最小・通常・最大対応mergeをFree 50 query以内に収める", async () => {
    // Issue #492: the real merge plan now has 18 base DML after
    // consolidating two alias deletes and the staff promotion/remap.
    // No CAS, audit, fence or queue assertions are removed.
    // At 100 targets, the existing queue path uses one DML; MIG-0516 adds
    // one build-marker DML and one strict changes() assertion.
    const queue = await buildStaticRebuildQueueBatch(
      { run: (query) => query },
      Array.from({ length: 100 }, (_, index) => ({
        targetType: "user",
        targetId: `x-${index}`,
        reason: "x_id_merge",
      })),
    );
    assert.equal(queue.acceptedTargetCount, 100);
    assert.equal(queue.statements.length, 1);
    assert.equal(queue.expectedChanges.length, 1);

    for (const auditCount of [3, 4]) {
      const budget = plan({
        mutations: 18 + 1 + queue.statements.length,
        assertions: 2 + 1 + queue.expectedChanges.length,
        audits: auditCount,
        callerReads: 18,
      });
      assert.equal(budget.preparationQueryCount, 2);
      assert.equal(budget.mutationStatementCount, 20);
      assert.equal(budget.mutationAssertionCount, 4);
      assert.equal(budget.integrityAssertionCount, 2);
      assert.equal(budget.auditQueryCount, 2);
      assert.equal(budget.totalQueryCount, 48);
      assert.equal(budget.withinLimit, true);

      // The independently owned #436 enqueue builder appends exactly one
      // build-marker UPDATE and a mandatory changes() assertion.
      // Count these *real planned operations* rather than raising the limit.
      const withBuildMarker = plan({
        mutations: 18 + 1 + queue.statements.length + 1,
        assertions: 2 + 1 + queue.expectedChanges.length + 1,
        audits: auditCount,
        callerReads: 18,
      });
      assert.equal(withBuildMarker.totalQueryCount, 50);
      assert.equal(withBuildMarker.withinLimit, true);
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
