import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import { planXIdAliasApproval, planXIdLinkRejection } from "../src/xid/linkRequestReview.ts";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { assertChanges } from "../src/audit/mutate.ts";

// No D1 methods should run during planning; only the generated UPDATE is
// compiled. The SQLite fixture below tests its actual pending-status CAS.
const db = drizzle({
  prepare() { throw new Error("planning must not access D1"); },
  batch() { throw new Error("planning must not batch D1"); },
});
const request = {
  id: "req-1", request_type: "new_link", status: "pending",
  requested_by_auth_user_id: "applicant", requested_x_id: "candidate",
  updated_at: 10, decision_reason: null, decided_by_auth_user_id: null, decided_at: null,
};
const makePlan = (overrides = {}) => planXIdLinkRejection(db, {
  request, actorUserId: "reviewer", actorXUserId: "reviewer-x",
  reason: "", now: 20, notificationStatements: [], ...overrides,
});

test("SA-091 preserves exact CURRENT before/after audit and default reason", () => {
  const plan = makePlan();
  assert.equal(plan.mutationStatements.length, 1);
  assert.deepEqual(plan.expectedMutationChanges, [1]);
  assert.deepEqual(plan.audits, [{
    table_name: "x_identity_requests", target_id: "req-1", operation: "UPDATE",
    before: request, after: {
      ...request, status: "rejected", updated_at: 20,
      decision_reason: "X ID申請を却下", decided_by_auth_user_id: "reviewer", decided_at: 20,
    },
    actor_user_id: "reviewer", actor_x_user_id: "reviewer-x",
    reason: "X ID申請を却下", context: "x-identity-request", retention_class: "long_audit",
  }]);
  assert.equal(request.status, "pending");
  assert.equal(request.decision_reason, null);
  assert.notStrictEqual(plan.audits[0].before, request);
});

test("SA-091 preserves explicit null audit actor and optional notification order/count", () => {
  // The host creates real outbox statements; the planner retains identity and
  // order and allows idempotent outbox inserts to affect zero rows.
  const direct = { fixture: "direct-notification" };
  const channel = { fixture: "channel-notification" };
  for (const notifications of [[], [direct], [channel], [direct, channel]]) {
    const plan = makePlan({ reason: "manual decision", actorXUserId: null, notificationStatements: notifications });
    assert.equal(plan.audits[0].actor_x_user_id, null);
    assert.equal(plan.audits[0].reason, "manual decision");
    assert.equal(plan.audits[0].after.decision_reason, "manual decision");
    assert.deepEqual(plan.expectedMutationChanges, [1, ...notifications.map(() => null)]);
    assert.equal(plan.mutationStatements.length, 1 + notifications.length);
    notifications.forEach((statement, i) => assert.strictEqual(plan.mutationStatements[i + 1], statement));
    assert.equal(plan.notificationWakeSource, undefined, "host owns Queue wake");
  }
});

test("SA-091 refuses non-pending and merge/revert plans before any D1 access", () => {
  for (const bad of [
    { status: "approved" }, { status: "rejected" }, { status: "cancelled" },
    { request_type: "merge" }, { request_type: "revert_merge" },
  ]) {
    assert.throws(() => makePlan({ request: { ...request, ...bad } }), /Invalid link-request rejection plan/);
  }
});

test("SA-091 generated UPDATE executes once for exact pending ID, never overwrites terminal or other rows", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`CREATE TABLE x_identity_requests (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at INTEGER NOT NULL,
      decision_reason TEXT, decided_by_auth_user_id TEXT, decided_at INTEGER
    );
    INSERT INTO x_identity_requests VALUES ('req-1','pending',10,NULL,NULL,NULL);
    INSERT INTO x_identity_requests VALUES ('other','pending',11,NULL,NULL,NULL);`);
    const { sql, params } = makePlan({ reason: "rejected by reviewer" }).mutationStatements[0].toSQL();
    const update = sqlite.prepare(sql);
    assert.equal(Number(update.run(...params).changes), 1);
    assert.deepEqual({ ...sqlite.prepare("SELECT * FROM x_identity_requests WHERE id='req-1'").get() }, {
      id: "req-1", status: "rejected", updated_at: 20, decision_reason: "rejected by reviewer",
      decided_by_auth_user_id: "reviewer", decided_at: 20,
    });
    assert.equal(Number(update.run(...params).changes), 0, "replay must fail expected-one CAS");
    assert.equal(sqlite.prepare("SELECT status FROM x_identity_requests WHERE id='other'").get().status, "pending");
    sqlite.exec("UPDATE x_identity_requests SET status='approved',updated_at=30 WHERE id='req-1'");
    assert.equal(Number(update.run(...params).changes), 0, "concurrent terminal decision must win");
    assert.equal(sqlite.prepare("SELECT updated_at FROM x_identity_requests WHERE id='req-1'").get().updated_at, 30);
  } finally {
    sqlite.close();
  }
});


const makeAliasPlan = (overrides = {}) => planXIdAliasApproval(db, {
  targetXUserId: "target", submittedXUserId: "candidate",
  actorUserId: "reviewer", actorXUserId: null, ...overrides,
});
const compileAlias = (plan) => new SQLiteSyncDialect().sqlToQuery(plan.statement.getSQL());

test("SA-090 alias planner preserves exact audit attribution and bound collision predicate", () => {
  for (const actorXUserId of [null, "reviewer-x"]) {
    const plan = makeAliasPlan({ actorXUserId });
    assert.equal(plan.expectedChanges, 1);
    assert.deepEqual(plan.audit, {
      table_name: "x_user_aliases", target_id: "target:candidate",
      operation: "CREATE", before: null,
      after: { x_user_id: "target", alias_x_id: "candidate" },
      actor_user_id: "reviewer", actor_x_user_id: actorXUserId,
      reason: "X名義の別名申請を承認", context: "x-identity-request",
      retention_class: "long_audit",
    });
    const query = compileAlias(plan);
    assert.deepEqual(query.params, ["target", "candidate", "target", "candidate", "candidate"]);
    assert.doesNotMatch(query.sql, /candidate|reviewer/);
  }
});

test("SA-090 alias conditional INSERT loses races and rolls back preceding mutation", () => {
  const cases = [
    ["approved", "", 1],
    ["missing target", "DELETE FROM x_users WHERE id='target'", 0],
    ["rejected target", "UPDATE x_users SET approval_status='rejected' WHERE id='target'", 0],
    ["pending target", "UPDATE x_users SET approval_status='pending' WHERE id='target'", 0],
    ["canonical collision", "INSERT INTO x_users VALUES (' @CaNdIdAtE ', 'rejected')", 0],
    ["alias collision", "INSERT INTO x_user_aliases VALUES ('other', ' @CaNdIdAtE ')", 0],
    ["exact alias replay", "INSERT INTO x_user_aliases VALUES ('target', 'candidate')", 0],
  ];
  const plan = makeAliasPlan();
  const q = compileAlias(plan);
  const check = new SQLiteSyncDialect().sqlToQuery(assertChanges(plan.expectedChanges));
  for (const [label, race, expected] of cases) {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`CREATE TABLE x_users (id TEXT PRIMARY KEY, approval_status TEXT NOT NULL);
        CREATE TABLE x_user_aliases (x_user_id TEXT NOT NULL, alias_x_id TEXT PRIMARY KEY);
        CREATE TABLE marker (n INTEGER NOT NULL);
        INSERT INTO x_users VALUES ('target','approved'), ('other','approved');
        INSERT INTO x_user_aliases VALUES ('other','unrelated');
        INSERT INTO marker VALUES (0);`);
      if (race) sqlite.exec(race);
      const before = sqlite.prepare("SELECT * FROM x_user_aliases ORDER BY alias_x_id").all();
      sqlite.exec("BEGIN");
      sqlite.exec("UPDATE marker SET n=1");
      assert.equal(Number(sqlite.prepare(q.sql).run(...q.params).changes), expected, label);
      if (expected === 1) {
        assert.doesNotThrow(() => sqlite.prepare(check.sql).get(...check.params), label);
        sqlite.exec("COMMIT");
        assert.equal(sqlite.prepare("SELECT n FROM marker").get().n, 1);
        assert.equal(sqlite.prepare("SELECT x_user_id FROM x_user_aliases WHERE alias_x_id='candidate'").get().x_user_id, "target");
        assert.equal(Number(sqlite.prepare(q.sql).run(...q.params).changes), 0, "replay cannot insert twice");
      } else {
        assert.throws(() => sqlite.prepare(check.sql).get(...check.params), label);
        sqlite.exec("ROLLBACK");
        assert.equal(sqlite.prepare("SELECT n FROM marker").get().n, 0, label);
        assert.deepEqual(sqlite.prepare("SELECT * FROM x_user_aliases ORDER BY alias_x_id").all(), before, label);
      }
      assert.equal(sqlite.prepare("SELECT x_user_id FROM x_user_aliases WHERE alias_x_id='unrelated'").get().x_user_id, "other");
    } finally { sqlite.close(); }
  }
});
