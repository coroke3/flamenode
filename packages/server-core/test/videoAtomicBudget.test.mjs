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

test("MIG-0650 U03x rejects invalid explicit caller reads instead of undercounting D1", () => {
  // A malformed or guessed caller count must never be silently clamped
  // from -1 to zero or rounded down before authorizing an atomic write.
  const p = plan([{}], [null], []);
  for (const invalid of [-1, -0.5, 0.5, Number.NaN, Infinity, -Infinity,
    Number.MAX_SAFE_INTEGER + 1, null, "3", true]) {
    assert.throws(
      () => inspectVideoAtomicWritePlanBudget(p, { callerQueryCount: invalid }),
      { name: "RangeError", message: "video_atomic_invalid_caller_query_count" },
      String(invalid),
    );
  }
  assert.equal(
    inspectVideoAtomicWritePlanBudget(p, { callerQueryCount: 0 }).callerQueryCount,
    0,
    "an explicitly measured zero is allowed, but not fabricated from invalid input",
  );
  assert.equal(
    inspectVideoAtomicWritePlanBudget(p).callerQueryCount,
    D1_RESERVED_CALLER_QUERIES,
    "the omitted CURRENT caller count keeps its existing conservative fallback",
  );
});

test("MIG-0650 U03z refuses mismatched mutation assertions before D1 budget approval", () => {
  // Missing assertions must not reduce the projected D1 query total.
  // Excess assertions are likewise invalid: one assertion slot per statement.
  for (const expectedChanges of [[1], [1, 1, 1]]) {
    assert.throws(
      () => inspectVideoAtomicWritePlanBudget(
        plan([{}, {}], expectedChanges, [{ actor_user_id: "admin" }]),
        { callerQueryCount: 3 },
      ),
      { name: "RangeError", message: "video_atomic_expected_changes_mismatch" },
    );
  }
  const valid = inspectVideoAtomicWritePlanBudget(
    plan([{}, {}], [null, 1], [{ actor_user_id: "admin" }]),
    { callerQueryCount: 3 },
  );
  assert.equal(valid.mutationStatementCount, 2);
  assert.equal(valid.mutationAssertionCount, 1);
});

test("MIG-0650 U03ac refuses invalid or sparse expected-changes values before budget approval", () => {
  const malformed = [
    undefined, -1, -0.5, 0.5, Number.NaN, Infinity, -Infinity,
    Number.MAX_SAFE_INTEGER + 1, "1", false, {}, [], 1n,
  ];
  for (const value of malformed) {
    assert.throws(
      () => inspectVideoAtomicWritePlanBudget(plan([{}], [value], []),
        { callerQueryCount: 3 }),
      { name: "RangeError", message: "video_atomic_invalid_expected_changes" },
      String(value),
    );
  }
  const hole = new Array(1);
  assert.throws(
    () => inspectVideoAtomicWritePlanBudget(plan([{}], hole, []),
      { callerQueryCount: 3 }),
    { name: "RangeError", message: "video_atomic_invalid_expected_changes" },
    "a sparse slot must not omit a changes() assertion from the D1 projection",
  );

  const valid = inspectVideoAtomicWritePlanBudget(
    plan([{}, {}, {}], [null, 0, 3], [{ actor_user_id: "admin" }]),
    { callerQueryCount: 3 },
  );
  assert.equal(valid.mutationStatementCount, 3);
  assert.equal(valid.mutationAssertionCount, 2);
});
