import assert from "node:assert/strict";
import { test } from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { D1_MAX_BATCH_QUERIES, D1_RESERVED_CALLER_QUERIES } from "../src/audit/mutateBudget.ts";
import {
  assembleAdminVideoMemberAtomicPlan,
} from "../src/video/adminMemberAtomicAssembly.ts";

const dialect = new SQLiteSyncDialect();
const target = {
  id: "video-1",
  collaboration_type: "individual",
  visibility_status: "public",
  creator_x_user_id: "owner",
  updated_at: 42,
};
function capturedDb() {
  const planned = [];
  const db = {
    update(table) {
      return {
        set(values) {
          return {
            where(condition) {
              const statement = {
                kind: "video-metadata",
                table, values, query: dialect.sqlToQuery(condition),
              };
              planned.push(statement);
              return statement;
            },
          };
        },
      };
    },
    run(stmt) {
      const statement = { kind: "queue", query: dialect.sqlToQuery(stmt) };
      planned.push(statement);
      return statement;
    },
  };
  return { db, planned };
}
const memberPlan = (statements = [], expectedChanges = [], audits = []) => ({
  statements, expectedChanges, audits,
});
const input = extra => ({
  target,
  actorUserId: "admin",
  members: [],
  isCollab: false,
  eventIds: [],
  now: 12345,
  membersPlan: memberPlan(),
  ...extra,
});

test("MIG-0650 U03ax: no-op composes no D1 mutation, audit, Queue, or wake work", async () => {
  const { db, planned } = capturedDb();
  const result = await assembleAdminVideoMemberAtomicPlan(db, input());
  assert.equal(result.noOp, true);
  assert.deepEqual(result.plan, {
    statements: [], expectedChanges: [], audits: [],
  });
  assert.deepEqual(result.targets, []);
  assert.equal(result.queue.acceptedTargetCount, 0);
  assert.deepEqual(result.queue.statements, []);
  assert.equal(result.budget, null, "true no-op never enters the D1 mutation budget");
  assert.equal(planned.length, 0);
});

test("MIG-0650 U03ax: collaboration-only save places video UPDATE, strict audit and Queue in one plan", async () => {
  const { db, planned } = capturedDb();
  const result = await assembleAdminVideoMemberAtomicPlan(db, input({
    isCollab: true, eventIds: ["event-a"],
  }));
  assert.equal(result.noOp, false);
  assert.deepEqual(result.plan.expectedChanges, [1, 2]);
  assert.equal(result.plan.statements.length, 2);
  assert.deepEqual(planned.map(x => x.kind), ["video-metadata", "queue"]);
  assert.equal(result.plan.statements[0], planned[0]);
  assert.equal(result.plan.statements[1], planned[1]);
  assert.deepEqual(result.targets.map(x => x.targetType), ["video", "event_release"]);
  assert.equal(result.queue.acceptedTargetCount, 2);
  assert.equal(result.budget?.withinLimit, true);
  assert.equal(result.budget?.callerQueryCount, D1_RESERVED_CALLER_QUERIES);
  assert.equal(result.budget?.mutationStatementCount, 2);
  assert.equal(result.budget?.mutationAssertionCount, 2);
  assert.equal(result.plan.audits.length, 1);
  assert.equal(result.plan.audits[0].table_name, "videos");
  assert.equal(result.plan.audits[0].strict, true);
  assert.deepEqual(planned[0].values, {
    collaboration_type: "collab", updated_at: 12345,
  });
  assert.match(planned[1].query.sql, /INSERT INTO static_rebuild_queue/);
  assert.match(planned[1].query.sql, /ON CONFLICT\(target_type, target_id\)/);
});

test("MIG-0650 U03ax: members CAS, metadata, strict audits and full Queue preserve CURRENT order", async () => {
  const { db, planned } = capturedDb();
  const cas = { kind: "public-member-cas" };
  const audit = {
    table_name: "video_members_set",
    target_id: "video-1", operation: "MERGE",
    actor_user_id: "admin", strict: true,
    before: {
      id: "video-1",
      rows: [{
        id: "old", video_id: "video-1", x_user_id: "alice",
        name: "Alice", order_index: 0, can_edit: 0,
        is_public_member: 1,
      }],
    },
    after: { id: "video-1", rows: [] },
  };
  const result = await assembleAdminVideoMemberAtomicPlan(db, input({
    target: { ...target, collaboration_type: "collab" },
    members: [{ x_user_id: "bob" }],
    isCollab: true,
    eventIds: ["event-a", "event-b"],
    membersPlan: memberPlan([cas], [null], [audit]),
  }));
  assert.equal(result.noOp, false);
  assert.deepEqual(result.plan.statements, [cas, ...planned]);
  assert.deepEqual(planned.map(x => x.kind), ["video-metadata", "queue"]);
  assert.deepEqual(result.plan.expectedChanges, [null, 1, 7]);
  assert.deepEqual(result.targets.map(x => `${x.targetType}:${x.targetId}`), [
    "video:video-1",
    "member_suggestions:global",
    "event_release:event-a",
    "event_release:event-b",
    "users_index:global",
    "user:alice",
    "user:bob",
  ]);
  assert.equal(result.queue.acceptedTargetCount, 7);
  assert.deepEqual(result.plan.audits.map(x => x.table_name), [
    "video_members_set", "videos",
  ]);
  assert.equal(result.plan.audits[0], audit, "member audit object is preserved");
  assert.deepEqual(result.plan.audits[1].after, {
    id: "video-1", collaboration_type: "collab", updated_at: 12345,
  });
});

test("MIG-0650 U03ax: private member changes do not enqueue public user projections", async () => {
  const { db } = capturedDb();
  const audit = {
    table_name: "video_members_set",
    target_id: "video-1", operation: "MERGE",
    actor_user_id: "admin", strict: true,
    before: { id: "video-1", rows: [] },
    after: { id: "video-1", rows: [] },
  };
  const result = await assembleAdminVideoMemberAtomicPlan(db, input({
    target: { ...target, visibility_status: "private" },
    members: [{ x_user_id: "alice" }],
    membersPlan: memberPlan([{ kind: "members" }], [null], [audit]),
  }));
  assert.deepEqual(result.targets.map(x => x.targetType), ["video", "member_suggestions"]);
  assert.deepEqual(result.plan.expectedChanges, [null, 1, 2]);
});

test("MIG-0650 U03ax: malformed planner inputs reject before metadata or Queue construction", async () => {
  for (const extra of [
    { target: { ...target, id: "" } },
    { actorUserId: "" },
    { now: -1 },
    { now: Number.NaN },
    { now: Number.POSITIVE_INFINITY },
    { now: 1.5 },
    { membersPlan: memberPlan([{}], [], []) },
  ]) {
    const { db, planned } = capturedDb();
    await assert.rejects(
      () => assembleAdminVideoMemberAtomicPlan(db, input(extra)),
      { name: "RangeError", message: "video_admin_member_atomic_assembly_invalid_input" },
    );
    assert.equal(planned.length, 0, "no SQL should be created from malformed plans");
  }
});

test("MIG-0650 U03ay: malformed oversized event fanout rejects before even metadata SQL planning", async () => {
  const { db, planned } = capturedDb();
  await assert.rejects(
    () => assembleAdminVideoMemberAtomicPlan(db, input({
      isCollab: true,
      eventIds: Array.from({ length: 9 }, (_, i) => "event-" + i),
    })),
    { name: "RangeError", message: "video_admin_member_rebuild_target_limit_exceeded" },
  );
  assert.equal(planned.length, 0);
});

test("MIG-0650 U03ay: audit, target, actor and row-count integrity reject before SQL or Queue", async () => {
  const validAudit = {
    table_name: "video_members_set",
    target_id: "video-1",
    operation: "MERGE",
    actor_user_id: "admin",
    strict: true,
    before: { id: "video-1", rows: [] },
    after: { id: "video-1", rows: [] },
  };
  const memberMutation = { kind: "member-CAS" };
  const invalid = [
    { membersPlan: memberPlan([memberMutation], [null], []) },
    { membersPlan: memberPlan([], [], [validAudit]) },
    { membersPlan: memberPlan([memberMutation], [null], [
      { ...validAudit, strict: false },
    ]) },
    { membersPlan: memberPlan([memberMutation], [null], [
      { ...validAudit, strict: undefined },
    ]) },
    { membersPlan: memberPlan([memberMutation], [null], [
      { ...validAudit, actor_user_id: "other-admin" },
    ]) },
    { membersPlan: memberPlan([memberMutation], [null], [
      { ...validAudit, target_id: "unrelated-video" },
    ]) },
    { membersPlan: memberPlan([memberMutation], [-1], [validAudit]) },
    { membersPlan: memberPlan([memberMutation], [1.5], [validAudit]) },
    { membersPlan: memberPlan([memberMutation], [Number.NaN], [validAudit]) },
    { membersPlan: memberPlan([memberMutation], [undefined], [validAudit]) },
  ];
  for (const extra of invalid) {
    const { db, planned } = capturedDb();
    await assert.rejects(
      () => assembleAdminVideoMemberAtomicPlan(db, input({ ...extra, isCollab: true })),
      { name: "RangeError", message: "video_admin_member_atomic_assembly_invalid_input" },
    );
    assert.equal(planned.length, 0, "a malformed member plan cannot allocate metadata/Queue SQL");
  }

  const { db } = capturedDb();
  const memberPlanInput = memberPlan([memberMutation], [null], [validAudit]);
  const result = await assembleAdminVideoMemberAtomicPlan(db, input({
    membersPlan: memberPlanInput, isCollab: true,
  }));
  assert.equal(result.noOp, false);
  assert.equal(result.plan.statements[0], memberMutation);
  assert.equal(result.plan.audits[0], validAudit);
  assert.deepEqual(memberPlanInput.expectedChanges, [null],
    "assembly does not mutate original member CAS change assertions");
});

test("MIG-0650 U03az: unknown/duplicate audit types and foreign snapshots fail before SQL", async () => {
  const canonical = {
    table_name: "video_members_set",
    target_id: "video-1", operation: "MERGE",
    actor_user_id: "admin", strict: true,
    before: { id: "video-1", rows: [] },
    after: { id: "video-1", rows: [] },
  };
  const validX = {
    table_name: "x_users_member_batch",
    target_id: "video-1", operation: "MERGE",
    actor_user_id: "admin", strict: true,
    before: null,
    after: { id: "video-1", rows: [{ id: "new-x-user" }] },
  };
  const validHidden = {
    ...canonical, table_name: "video_member_hidden_carry_cleanup",
    operation: "DELETE",
    before: { id: "video-1", rows: [{ video_id: "video-1" }] },
    after: { id: "video-1", rows: [] },
  };
  const invalid = [
    [{ ...canonical, table_name: "videos" }],
    [{ ...canonical, table_name: "video_members" }],
    [{ ...canonical, operation: "DELETE" }],
    [{ ...canonical, before: { id: "another-video", rows: [] } }],
    [{ ...canonical, after: { id: "another-video", rows: [] } }],
    [{ ...canonical, before: null }],
    [{ ...canonical, after: null }],
    [{ ...canonical, before: { id: "video-1", rows: [{ video_id: "foreign-video" }] } }],
    [{ ...canonical, after: { id: "video-1", rows: [{ video_id: "foreign-video" }] } }],
    [{ ...canonical, before: { id: "video-1", rows: "not-an-array" } }],
    [{ ...canonical, after: { id: "video-1", rows: [null] } }],
    [{
      ...canonical, table_name: "video_member_hidden_carry_cleanup",
      operation: "DELETE",
      before: { id: "video-1", rows: [{ video_id: "foreign-video" }] },
    }],
    [canonical, canonical],
    [{ ...validX, before: { id: "video-1", rows: [] } }],
    [{ ...validX, after: { id: "another-video", rows: [] } }],
    [{ ...validX, after: { id: "video-1", rows: [] } }],
    [{ ...validX, after: { id: "video-1", rows: "not-a-list" } }],
    [{ ...validX, after: { id: "video-1", rows: [{}] } }],
    [{ ...validHidden, before: { id: "video-1", rows: [] } }],
    [{ ...validHidden, after: { id: "video-1", rows: [{ video_id: "video-1" }] } }],
    [{ ...validHidden, after: { id: "video-1", rows: "bad" } }],
  ];
  for (const audits of invalid) {
    const { db, planned } = capturedDb();
    await assert.rejects(
      () => assembleAdminVideoMemberAtomicPlan(db, input({
        isCollab: true,
        membersPlan: memberPlan([{ kind: "member-CAS" }], [null], audits),
      })),
      { name: "RangeError", message: "video_admin_member_atomic_assembly_invalid_audit" },
    );
    assert.equal(planned.length, 0, "malformed audit cannot allocate metadata or Queue SQL");
  }
  for (const audit of [
    canonical,
    validX,
    {
      ...canonical,
      before: { id: "video-1", rows: [{ video_id: "video-1" }] },
      after: { id: "video-1", rows: [{ video_id: "video-1" }] },
    },
    {
      ...canonical,
      table_name: "video_chapters_member_set",
    },
    validHidden,
  ]) {
    const { db } = capturedDb();
    const result = await assembleAdminVideoMemberAtomicPlan(db, input({
      membersPlan: memberPlan([{ kind: "member-CAS" }], [null], [audit]),
      isCollab: true,
    }));
    assert.equal(result.plan.audits[0], audit);
    assert.equal(result.noOp, false);
  }
  const { db } = capturedDb();
  const paired = await assembleAdminVideoMemberAtomicPlan(db, input({
    isCollab: true,
    membersPlan: memberPlan([{ kind: "member-CAS" }], [null], [validX, canonical]),
  }));
  assert.deepEqual(paired.plan.audits.slice(0, 2), [validX, canonical],
    "distinct CURRENT audit categories keep their canonical order and identity");
});

test("MIG-0650 U03bc: composed member and Queue plan fails closed above conservative D1 limit", async () => {
  // A future Hono adapter must never present a large strict-audit member
  // mutation plan as executable simply because each SQL chunk is bounded.
  const fakeMutations = Array.from({ length: D1_MAX_BATCH_QUERIES }, (_, i) => ({ kind: "member-cas-" + i }));
  const audit = {
    table_name: "video_members_set",
    target_id: "video-1", operation: "MERGE",
    actor_user_id: "admin", strict: true,
    before: { id: "video-1", rows: [] },
    after: { id: "video-1", rows: [] },
  };
  const { db, planned } = capturedDb();
  await assert.rejects(
    () => assembleAdminVideoMemberAtomicPlan(db, input({
      membersPlan: memberPlan(fakeMutations, fakeMutations.map(() => null), [audit]),
    })),
    { name: "RangeError", message: "video_admin_member_atomic_budget_exceeded" },
  );
  // The pure composition may construct SQL, but no statement can execute.
  assert.ok(planned.every(statement => statement.kind === "video-metadata" || statement.kind === "queue"));
});

test("MIG-0650 U03bc: accepted strict member plan reports complete D1 projection", async () => {
  const audit = {
    table_name: "video_members_set",
    target_id: "video-1", operation: "MERGE",
    actor_user_id: "admin", strict: true,
    before: { id: "video-1", rows: [] },
    after: { id: "video-1", rows: [] },
  };
  const { db } = capturedDb();
  const result = await assembleAdminVideoMemberAtomicPlan(db, input({
    membersPlan: memberPlan([{ kind: "member-cas" }], [null], [audit]),
  }));
  assert.equal(result.noOp, false);
  assert.ok(result.budget);
  assert.equal(result.budget.callerQueryCount, D1_RESERVED_CALLER_QUERIES);
  assert.equal(result.budget.mutationStatementCount, result.plan.statements.length);
  assert.equal(
    result.budget.mutationAssertionCount,
    result.plan.expectedChanges.filter(value => value !== null).length,
  );
  assert.equal(result.budget.withinLimit, true);
  assert.ok(result.budget.totalQueryCount <= D1_MAX_BATCH_QUERIES);
});
