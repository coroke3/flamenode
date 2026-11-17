import assert from "node:assert/strict";
import { test } from "node:test";
import {
  prepareAdminMemberAtomicExecution,
  executeAdminMemberAtomicCandidate,
} from "../src/video/adminMemberAtomicExecute.ts";
import { inspectVideoAtomicWritePlanBudget } from "../src/video/videoAtomicBudget.ts";
import { D1_MAX_BATCH_QUERIES } from "../src/audit/mutateBudget.ts";

const actorSnapshot = JSON.stringify({
  discord_id: null, discord_name: null, x_user_id: null,
  x_name: null, icon_url: null,
});
const preloaded = {
  settings: { enabled: true },
  actorSnapshotJsonById: { admin: actorSnapshot },
};
const audit = {
  table_name: "video_members_set", target_id: "video-1",
  actor_user_id: "admin", operation: "MERGE", strict: true,
  before: { id: "video-1", rows: [] },
  after: { id: "video-1", rows: [] },
};
const queueRow = { tag: "durable-queue" };
const mutation = { tag: "member-cas" };
function fixture(extra = {}) {
  const plan = {
    statements: [mutation, queueRow],
    expectedChanges: [null, 1],
    audits: [audit],
  };
  return {
    assembly: {
      plan,
      queue: { statements: [queueRow], expectedChanges: [1], acceptedTargetCount: 1 },
      targets: [{ targetType: "video", targetId: "video-1" }],
      noOp: false,
      budget: inspectVideoAtomicWritePlanBudget(plan),
    },
    videoId: "video-1", actorUserId: "admin",
    callerQueryCount: 3, preloaded, ...extra,
  };
}
function noOp() {
  return fixture({
    assembly: {
      plan: { statements: [], expectedChanges: [], audits: [] },
      queue: { statements: [], expectedChanges: [], acceptedTargetCount: 0 },
      targets: [], noOp: true, budget: null,
    },
  });
}

test("MIG-0650 U03bf emits one complete strict audited atomic D1 mutation contract", () => {
  const input = fixture();
  const atomic = prepareAdminMemberAtomicExecution(input);
  assert.deepEqual(atomic.mutationStatements, [mutation, queueRow]);
  assert.deepEqual(atomic.expectedMutationChanges, [null, 1]);
  assert.deepEqual(atomic.audits, [audit]);
  assert.equal(atomic.callerQueryCount, 3);
  assert.equal(atomic.preloaded, preloaded);
  assert.equal(atomic.staticRebuildWakeSource, "admin");
});

test("MIG-0650 U03bf true no-op skips audit/Queue and all D1 execution", async () => {
  const plan = noOp();
  assert.equal(prepareAdminMemberAtomicExecution(plan), null);
  const unexpectedDb = new Proxy({}, { get() { throw Error("must not read/write D1"); } });
  assert.deepEqual(await executeAdminMemberAtomicCandidate(unexpectedDb, plan), {
    committed: false, auditIds: [],
  });
});

test("MIG-0650 U03by no-op rejects missing or forged authenticated actor context without D1 access", async () => {
  const invalid = [
    {},
    { settings: preloaded.settings, actorSnapshotJsonById: {} },
    { settings: preloaded.settings, actorSnapshotJsonById: { admin: "{}" } },
  ];
  let dbAccess = 0;
  const neverDb = new Proxy({}, {
    get() { dbAccess++; throw Error("invalid no-op must not touch D1"); },
  });
  for (const forged of invalid) {
    const input = noOp();
    input.preloaded = forged;
    assert.throws(() => prepareAdminMemberAtomicExecution(input), {
      name: "RangeError", message: "video_admin_member_atomic_execution_invalid",
    });
    await assert.rejects(
      executeAdminMemberAtomicCandidate(neverDb, input),
      { name: "RangeError", message: "video_admin_member_atomic_execution_invalid" },
    );
  }
  assert.equal(dbAccess, 0, "reject before any D1 or Queue operation");
});

test("MIG-0650 U03bz no-op enforces measured D1 50-read cap before reporting success", async () => {
  // Exactly 50 executed SELECTs are within the per-invocation budget for a
  // no-op (no mutation/audit/Queue queries follow).
  assert.equal(prepareAdminMemberAtomicExecution(
    noOpWithCount(D1_MAX_BATCH_QUERIES),
  ), null);
  let dbTouches = 0;
  const neverDb = new Proxy({}, {
    get() { dbTouches++; throw Error("no-op must not touch a D1 handle"); },
  });
  for (const count of [D1_MAX_BATCH_QUERIES + 1, 1000]) {
    const input = noOpWithCount(count);
    assert.throws(() => prepareAdminMemberAtomicExecution(input), {
      name: "RangeError",
      message: "video_admin_member_atomic_execution_budget_exceeded",
    });
    await assert.rejects(
      executeAdminMemberAtomicCandidate(neverDb, input),
      { name: "RangeError",
        message: "video_admin_member_atomic_execution_budget_exceeded" },
    );
  }
  assert.equal(dbTouches, 0, "rejected no-op never reads or writes D1");
});

function noOpWithCount(callerQueryCount) {
  return { ...noOp(), callerQueryCount };
}

test("MIG-0650 U03bf no-queue member write never requests a Queue wake", () => {
  const plan = fixture();
  const result = {
    statements: [mutation], expectedChanges: [null], audits: [audit],
  };
  plan.assembly = {
    plan: result,
    queue: { statements: [], expectedChanges: [], acceptedTargetCount: 0 },
    targets: [], noOp: false,
    budget: inspectVideoAtomicWritePlanBudget(result),
  };
  const atomic = prepareAdminMemberAtomicExecution(plan);
  assert.equal(atomic.staticRebuildWakeSource, undefined);
});

test("MIG-0650 U03bf rejects missing guard context, invalid counts and forged audit ownership", () => {
  const broken = [
    { actorUserId: "" },
    { videoId: "" },
    { videoId: "other-video" },
    { actorUserId: "other-admin" },
    { callerQueryCount: -1 },
    { callerQueryCount: NaN },
    { callerQueryCount: 1.5 },
    { callerQueryCount: null },
    { callerQueryCount: Number.MAX_SAFE_INTEGER + 1 },
    { preloaded: {} },
    { preloaded: { settings: preloaded.settings, actorSnapshotJsonById: { admin: "{}" } } },
    { preloaded: { settings: preloaded.settings, actorSnapshotJsonById: {} } },
    { assembly: { ...fixture().assembly, budget: null } },
    { assembly: { ...fixture().assembly, budget: { withinLimit: false } } },
  ];
  for (const extra of broken) {
    assert.throws(() => prepareAdminMemberAtomicExecution(fixture(extra)), {
      name: "RangeError", message: "video_admin_member_atomic_execution_invalid",
    }, String(extra.callerQueryCount));
  }
});

test("MIG-0650 U03bf rejects spliced or unaccounted-for Queue mutations", () => {
  const baseline = fixture();
  const invalid = [
    { ...baseline.assembly, queue: { ...baseline.assembly.queue, statements: [{}] } },
    { ...baseline.assembly, queue: { ...baseline.assembly.queue, expectedChanges: [0] } },
    { ...baseline.assembly, queue: { ...baseline.assembly.queue, acceptedTargetCount: 0 } },
    { ...baseline.assembly, targets: [] },
    { ...baseline.assembly, targets: [
      { targetType: "video", targetId: "video-1" },
      { targetType: "user", targetId: "missing-queue-entry" },
    ] },
    { ...baseline.assembly, plan: {
      ...baseline.assembly.plan, expectedChanges: [null],
    } },
  ];
  for (const assembly of invalid) {
    assert.throws(() => prepareAdminMemberAtomicExecution(fixture({ assembly })), {
      name: "RangeError", message: "video_admin_member_atomic_execution_invalid",
    });
  }
});

test("MIG-0650 U03bf requires complete no-op and rejects fake no-op with Queue", () => {
  const baseline = noOp();
  const invalid = [
    { ...baseline.assembly, budget: inspectVideoAtomicWritePlanBudget({ statements: [], expectedChanges: [], audits: [] }) },
    { ...baseline.assembly, targets: [{ targetType: "video", targetId: "video-1" }] },
    { ...baseline.assembly, plan: { statements: [mutation], expectedChanges: [null], audits: [audit] } },
  ];
  for (const assembly of invalid) {
    assert.throws(() => prepareAdminMemberAtomicExecution(fixture({ assembly })), {
      name: "RangeError", message: "video_admin_member_atomic_execution_invalid",
    });
  }
});

test("MIG-0650 U03bf actual measured 3+ read count enforces D1 50-query ceiling", () => {
  const known = fixture();
  assert.ok(prepareAdminMemberAtomicExecution(known));
  assert.throws(() => prepareAdminMemberAtomicExecution(fixture({
    callerQueryCount: D1_MAX_BATCH_QUERIES,
  })), {
    name: "RangeError", message: "video_admin_member_atomic_execution_budget_exceeded",
  });
});
