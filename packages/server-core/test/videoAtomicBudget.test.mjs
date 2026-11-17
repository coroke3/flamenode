import assert from "node:assert/strict";
import { test } from "node:test";
import { D1_MAX_BATCH_QUERIES, D1_RESERVED_CALLER_QUERIES, planD1AuditMutationBudget } from "../src/audit/mutateBudget.ts";
import { inspectVideoAtomicWritePlanBudget } from "../src/video/videoAtomicBudget.ts";
const plan = (statements, expectedChanges, audits) => ({ statements, expectedChanges, audits });

test("MIG-0650 U03w retains CURRENT reserved pre-read budget", () => {
  const r = inspectVideoAtomicWritePlanBudget(plan([], [], []));
  assert.equal(r.callerQueryCount, D1_RESERVED_CALLER_QUERIES);
  assert.equal(r.totalQueryCount, D1_RESERVED_CALLER_QUERIES);
});

test("MIG-0650 U03w matches canonical audit/chunk/assertion projection", () => {
  const p = plan([{}, {}, {}], [null, 1, 4], [
    { actor_user_id: "admin", actor_x_user_id: " @Alice " },
    { actor_user_id: "admin", actor_x_user_id: null },
  ]);
  const budget = inspectVideoAtomicWritePlanBudget(p);
  assert.deepEqual(budget, planD1AuditMutationBudget({
    mutationStatementCount: 3, mutationAssertionCount: 2,
    auditEntryCount: 2, distinctActorCount: 1, actorXValidationQueryCount: 1,
  }));
  assert.equal(budget.totalQueryCount, D1_RESERVED_CALLER_QUERIES + 3 + 2 + 2 + 3);
});

test("MIG-0650 U03w Hono can pass measured caller read count", () => {
  const p = plan([{}], [1], [{ actor_user_id: "admin" }]);
  const a = inspectVideoAtomicWritePlanBudget(p);
  const b = inspectVideoAtomicWritePlanBudget(p, { callerQueryCount: 3 });
  assert.equal(a.totalQueryCount - b.totalQueryCount, D1_RESERVED_CALLER_QUERIES - 3);
  assert.equal(b.callerQueryCount, 3);
  assert.deepEqual(inspectVideoAtomicWritePlanBudget(p, { callerQueryCount: 0 }),
    planD1AuditMutationBudget({ mutationStatementCount: 1, mutationAssertionCount: 1,
      auditEntryCount: 1, distinctActorCount: 1, callerQueryCount: 0 }));
});

test("MIG-0650 U03w rejects excessive atomic D1 statement plan", () => {
  const many = Array.from({length:D1_MAX_BATCH_QUERIES}, () => ({}));
  const r = inspectVideoAtomicWritePlanBudget(plan(many, many.map(() => 1), [{ actor_user_id: "admin" }]), { callerQueryCount: 3 });
  assert.equal(r.withinLimit, false);
  assert.equal(r.limit, D1_MAX_BATCH_QUERIES);
});

test("MIG-0650 U03w counts distinct actors and X validation pre-reads", () => {
  const r = inspectVideoAtomicWritePlanBudget(plan([{}], [null], [
    {actor_user_id:"admin"},{actor_user_id:"other",actor_x_user_id:"xuser"},
  ]), {callerQueryCount:3});
  assert.equal(r.preparationQueryCount, 4);
  assert.equal(r.actorXValidationQueryCount, 1);
});
