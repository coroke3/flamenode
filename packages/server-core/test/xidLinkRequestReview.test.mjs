import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, getTableColumns } from "drizzle-orm";
import { buildXIdRequestApprovalAudit, planXIdAccountLinkInsert, planXIdAliasApproval, planXIdApprovalPublicRebuildTargets, planXIdCanonicalApproval, planXIdInitialActiveSelection, planXIdLinkRejection, planXIdSiblingCancellation, prepareXIdReviewNotifications } from "../src/xid/linkRequestReview.ts";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { assertChanges } from "../src/audit/mutate.ts";
import { users, xIdentityRequests, xUserAccountLinks, xUsers } from "@flamenode/db/schema";
import { expectedRowCondition } from "../src/audit/expectedRowCondition.ts";

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

const canonicalPlan = (xUser, actorXUserId = null) => planXIdCanonicalApproval(db, {
  effectiveXUserId: "candidate", xUser, actorUserId: "reviewer", actorXUserId,
});

test("SA-090 canonical approval preserves CURRENT insert/update/no-op and exact audit", () => {
  const created = {
    id: "candidate", x_name: "@candidate", icon_url: null, profile_text: null,
    portfolio_contact: null, youtube_channel_url: null, other_social_links: null,
    creative_start_date: null, approval_status: "approved",
  };
  const create = canonicalPlan(null);
  assert.equal(create.expectedChanges, 1);
  assert.deepEqual(create.statement.toSQL(), db.insert(xUsers).values(created).toSQL());
  assert.deepEqual(create.audit, {
    table_name: "x_users", target_id: "candidate", operation: "CREATE",
    before: null, after: created, actor_user_id: "reviewer", actor_x_user_id: null,
    reason: "新規X名義申請を承認", context: "x-identity-request",
    retention_class: "long_audit",
  });
  for (const status of ["pending", "rejected", "imported", "approved"]) {
    const row = { ...created, x_name: "Existing", profile_text: "keep", approval_status: status };
    const before = { ...row };
    const plan = canonicalPlan(row, "reviewer-x");
    if (status === "approved") {
      assert.equal(plan, null);
    } else {
      assert.equal(plan.expectedChanges, 1);
      assert.deepEqual(plan.statement.toSQL(), db.update(xUsers).set({ approval_status: "approved" })
        .where(expectedRowCondition({ expectedCurrent: row })).toSQL());
      assert.deepEqual(plan.audit, {
        table_name: "x_users", target_id: "candidate", operation: "UPDATE",
        before, after: { ...before, approval_status: "approved" },
        actor_user_id: "reviewer", actor_x_user_id: "reviewer-x",
        reason: "既存X名義の連携申請を承認", context: "x-identity-request",
        retention_class: "long_audit",
      });
      assert.notStrictEqual(plan.audit.before, row);
    }
    assert.deepEqual(row, before);
  }
});

test("SA-090 canonical approval CAS preserves newer rows and rolls back preceding mutation", () => {
  const row = { id: "candidate", x_name: "Original", approval_status: "rejected", profile_text: null };
  const plan = canonicalPlan(row);
  const q = plan.statement.toSQL();
  const check = new SQLiteSyncDialect().sqlToQuery(assertChanges(plan.expectedChanges));
  for (const [label, race, expected] of [
    ["stable", null, 1],
    ["newer name", "UPDATE x_users SET x_name='Newer' WHERE id='candidate'", 0],
    ["newer profile", "UPDATE x_users SET profile_text='Newer' WHERE id='candidate'", 0],
    ["concurrent approval", "UPDATE x_users SET approval_status='approved' WHERE id='candidate'", 0],
    ["deleted", "DELETE FROM x_users WHERE id='candidate'", 0],
  ]) {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`CREATE TABLE x_users (id TEXT PRIMARY KEY, x_name TEXT, approval_status TEXT, profile_text TEXT);
        CREATE TABLE marker (n INTEGER NOT NULL);
        INSERT INTO x_users VALUES ('candidate','Original','rejected',NULL), ('other','Original','rejected',NULL);
        INSERT INTO marker VALUES (0);`);
      if (race) sqlite.exec(race);
      const before = sqlite.prepare("SELECT * FROM x_users ORDER BY id").all();
      sqlite.exec("BEGIN");
      sqlite.exec("UPDATE marker SET n=1");
      assert.equal(Number(sqlite.prepare(q.sql).run(...q.params).changes), expected, label);
      if (expected === 1) {
        assert.doesNotThrow(() => sqlite.prepare(check.sql).get(...check.params), label);
        sqlite.exec("COMMIT");
        assert.equal(sqlite.prepare("SELECT approval_status FROM x_users WHERE id='candidate'").get().approval_status, "approved");
        assert.equal(Number(sqlite.prepare(q.sql).run(...q.params).changes), 0, "stale replay must not update");
      } else {
        assert.throws(() => sqlite.prepare(check.sql).get(...check.params), label);
        sqlite.exec("ROLLBACK");
        assert.deepEqual(sqlite.prepare("SELECT * FROM x_users ORDER BY id").all(), before, label);
        assert.equal(sqlite.prepare("SELECT n FROM marker").get().n, 0, label);
      }
      assert.equal(sqlite.prepare("SELECT approval_status FROM x_users WHERE id='other'").get().approval_status, "rejected");
    } finally { sqlite.close(); }
  }
});

const initialSelection = (authUser, overrides = {}) => planXIdInitialActiveSelection(db, {
  authUser, effectiveXUserId: "candidate", requestedAuthUserId: "applicant",
  xName: null, actorUserId: "reviewer", actorXUserId: null, ...overrides,
});

test("SA-090 initial Active X preserves exact CURRENT full-row audit and notification overlay", () => {
  const row = { id: "applicant", active_x_user_id: null, name: "Original",
    emailVerified: new Date(1700000000123), is_banned: 0 };
  const before = { ...row };
  assert.equal(initialSelection(null), null);
  assert.equal(initialSelection({ ...row, active_x_user_id: "existing" }), null);
  for (const selected of [null, ""]) {
    const current = { ...row, active_x_user_id: selected };
    for (const [xName, actorXUserId] of [[null, null], ["", "reviewer-x"], ["Display", null]]) {
      const plan = initialSelection(current, { xName, actorXUserId });
      assert.equal(plan.expectedChanges, 1);
      assert.deepEqual(plan.statement.toSQL(), db.update(users).set({ active_x_user_id: "candidate" })
        .where(expectedRowCondition({ expectedCurrent: current })).toSQL());
      assert.deepEqual(plan.audit, {
        table_name: "user", target_id: "applicant", operation: "UPDATE",
        before: current, after: { ...current, active_x_user_id: "candidate" },
        actor_user_id: "reviewer", actor_x_user_id: actorXUserId,
        reason: "初回連携X名義をアクティブに設定", context: "x-identity-request",
        retention_class: "normal",
      });
      assert.deepEqual(plan.notificationActiveX, { activeXId: "candidate", activeXName: xName ?? "@candidate" });
      assert.notStrictEqual(plan.audit.before, current);
      assert.equal(current.active_x_user_id, selected);
    }
  }
  assert.deepEqual(row, before);
});

test("SA-090 initial Active X CAS cannot overwrite a changed user or commit a preceding mutation", () => {
  const row = { id: "applicant", name: "Original", active_x_user_id: null,
    emailVerified: new Date(1700000000123), is_banned: 0 };
  const plan = initialSelection(row);
  const q = plan.statement.toSQL();
  const check = new SQLiteSyncDialect().sqlToQuery(assertChanges(plan.expectedChanges));
  for (const [label, race, expected] of [
    ["stable", null, 1],
    ["selected elsewhere", "UPDATE user SET active_x_user_id='other-x' WHERE id='applicant'", 0],
    ["changed name", "UPDATE user SET name='Newer' WHERE id='applicant'", 0],
    ["changed verification", "UPDATE user SET emailVerified=1700000000456 WHERE id='applicant'", 0],
    ["changed BAN", "UPDATE user SET is_banned=1 WHERE id='applicant'", 0],
    ["deleted", "DELETE FROM user WHERE id='applicant'", 0],
  ]) {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, active_x_user_id TEXT,
          emailVerified INTEGER, is_banned INTEGER);
        CREATE TABLE marker (n INTEGER NOT NULL);
        INSERT INTO user VALUES ('applicant','Original',NULL,1700000000123,0),
          ('other','Original',NULL,1700000000123,0);
        INSERT INTO marker VALUES (0);`);
      if (race) sqlite.exec(race);
      const before = sqlite.prepare("SELECT * FROM user ORDER BY id").all();
      sqlite.exec("BEGIN");
      sqlite.exec("UPDATE marker SET n=1");
      assert.equal(Number(sqlite.prepare(q.sql).run(...q.params).changes), expected, label);
      if (expected) {
        assert.doesNotThrow(() => sqlite.prepare(check.sql).get(...check.params), label);
        sqlite.exec("COMMIT");
        assert.equal(sqlite.prepare("SELECT active_x_user_id FROM user WHERE id='applicant'").get().active_x_user_id, "candidate");
        assert.equal(sqlite.prepare("SELECT n FROM marker").get().n, 1);
        assert.equal(Number(sqlite.prepare(q.sql).run(...q.params).changes), 0, "stale replay must not update");
      } else {
        assert.throws(() => sqlite.prepare(check.sql).get(...check.params), label);
        sqlite.exec("ROLLBACK");
        assert.deepEqual(sqlite.prepare("SELECT * FROM user ORDER BY id").all(), before, label);
        assert.equal(sqlite.prepare("SELECT n FROM marker").get().n, 0, label);
      }
      assert.equal(sqlite.prepare("SELECT active_x_user_id FROM user WHERE id='other'").get().active_x_user_id, null);
    } finally { sqlite.close(); }
  }
});

test("SA-090 initial Active X CAS checks every user schema column and fails closed for unsupported snapshots", () => {
  // Full current schema shape, not a hand-picked projection of the SELECT row.
  const row = {
    id: "applicant", name: "Original", email: "original@example.invalid",
    emailVerified: new Date(1700000000123), image: null, discord_id: "123456",
    role: "user", can_create_events: 0, is_tos_accepted: 1,
    accepted_terms_version_id: "v1", terms_reaccept_required: 0,
    is_banned: 0, is_notification_enabled: 1, active_x_user_id: null,
    onboarding_completed_at: 1700000000, last_guild_check: null, created_at: 1690000000,
  };
  assert.deepEqual(Object.keys(row).sort(), Object.keys(getTableColumns(users)).sort());
  const stored = Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, value instanceof Date ? value.getTime() : value]));
  const columns = Object.keys(stored);
  const integers = new Set(["emailVerified", "can_create_events", "is_tos_accepted",
    "terms_reaccept_required", "is_banned", "is_notification_enabled",
    "onboarding_completed_at", "last_guild_check", "created_at"]);
  const plan = initialSelection(row);
  const q = plan.statement.toSQL();
  const check = new SQLiteSyncDialect().sqlToQuery(assertChanges(plan.expectedChanges));
  const races = Object.entries(stored).map(([key, value]) => ({
    label: `changed ${key}`, key,
    value: value === null ? (integers.has(key) ? 1700000001 : "changed")
      : typeof value === "number" ? value + 1 : key === "role" ? "admin" : `${value}-changed`,
  }));
  const scenarios = [
    { label: "stable" }, ...races, { label: "deleted" },
    { label: "unsupported value", snapshot: { ...row, unsupported: {} } },
    { label: "empty snapshot", snapshot: {} },
    { label: "invalid Date", snapshot: { ...row, emailVerified: new Date(NaN) } },
  ];
  for (const scenario of scenarios) {
    const { label, key, value, snapshot } = scenario;
    const sqlite = new DatabaseSync(":memory:");
    try {
      const definitions = columns.map((column) =>
        `"${column}" ${integers.has(column) ? "INTEGER" : "TEXT"}${column === "id" ? " PRIMARY KEY" : ""}`);
      sqlite.exec(`CREATE TABLE user (${definitions.join(", ")});
        CREATE TABLE marker (n INTEGER NOT NULL);
        INSERT INTO marker VALUES (0);`);
      const insert = sqlite.prepare(`INSERT INTO user VALUES (${columns.map(() => "?").join(", ")})`);
      insert.run(...Object.values(stored));
      insert.run(...Object.values({ ...stored, id: "other" }));
      if (key) sqlite.prepare(`UPDATE user SET "${key}"=? WHERE id='applicant'`).run(value);
      if (label === "deleted") sqlite.exec("DELETE FROM user WHERE id='applicant'");
      const before = sqlite.prepare("SELECT * FROM user ORDER BY id").all();
      const query = snapshot ? initialSelection(snapshot).statement.toSQL() : q;
      sqlite.exec("BEGIN; UPDATE marker SET n=1;");
      const changes = Number(sqlite.prepare(query.sql).run(...query.params).changes);
      if (label === "stable") {
        assert.equal(changes, 1);
        assert.doesNotThrow(() => sqlite.prepare(check.sql).get(...check.params));
        sqlite.exec("COMMIT");
        assert.deepEqual(sqlite.prepare("SELECT * FROM user WHERE id='applicant'").get(),
          Object.assign(Object.create(null), stored, { active_x_user_id: "candidate" }));
        assert.equal(sqlite.prepare("SELECT n FROM marker").get().n, 1);
        assert.equal(Number(sqlite.prepare(q.sql).run(...q.params).changes), 0, "stale replay");
      } else {
        assert.equal(changes, 0, label);
        assert.throws(() => sqlite.prepare(check.sql).get(...check.params), label);
        sqlite.exec("ROLLBACK");
        assert.deepEqual(sqlite.prepare("SELECT * FROM user ORDER BY id").all(), before, label);
        assert.equal(sqlite.prepare("SELECT n FROM marker").get().n, 0, label);
      }
      assert.equal(sqlite.prepare("SELECT active_x_user_id FROM user WHERE id='other'").get().active_x_user_id, null);
    } finally { sqlite.close(); }
  }
});

const ownerLinkRow = {
  x_user_id: "candidate", auth_user_id: "applicant", link_role: "owner",
  created_by_request_id: "req-1", created_at: 20, updated_at: 20,
};
const accountLinkPlan = (link = ownerLinkRow, actorXUserId = null) =>
  planXIdAccountLinkInsert(db, { link, actorUserId: "reviewer", actorXUserId });

test("SA-090 account link preserves exact CURRENT composite key, owner provenance and audit", () => {
  assert.deepEqual(Object.keys(ownerLinkRow).sort(), Object.keys(getTableColumns(xUserAccountLinks)).sort());
  for (const link of [
    { ...ownerLinkRow },
    { ...ownerLinkRow, x_user_id: "case_sensitive", auth_user_id: "other", created_by_request_id: "req-2", created_at: 21, updated_at: 21 },
  ]) {
    const before = { ...link };
    for (const actorXUserId of [null, "reviewer-x"]) {
      const plan = accountLinkPlan(link, actorXUserId);
      assert.equal(plan.expectedChanges, 1);
      assert.deepEqual(plan.statement.toSQL(), db.insert(xUserAccountLinks).values(link).toSQL());
      assert.deepEqual(plan.audit, {
        table_name: "x_user_account_links", target_id: `${link.x_user_id}:${link.auth_user_id}`,
        operation: "CREATE", before: null, after: before,
        actor_user_id: "reviewer", actor_x_user_id: actorXUserId,
        reason: "X名義と認証ユーザーを連携", context: "x-identity-request",
        retention_class: "long_audit",
      });
      assert.deepEqual(link, before);
    }
  }
});

test("SA-090 account link inserts a distinct pair and rolls back on duplicate or missing FK", () => {
  const scenarios = [
    { label: "new owner", succeeds: true },
    { label: "same X another owner", succeeds: true, seed: ["candidate", "other", "owner", "req-2", 10, 10] },
    { label: "same auth another X", succeeds: true, seed: ["other-x", "applicant", "manager", "req-2", 10, 10] },
    { label: "concurrent owner", seed: ["candidate", "applicant", "owner", "req-2", 10, 10] },
    { label: "concurrent manager", seed: ["candidate", "applicant", "manager", "req-2", 10, 10] },
    { label: "missing X", remove: "DELETE FROM x_users WHERE id='candidate'" },
    { label: "missing auth user", remove: "DELETE FROM user WHERE id='applicant'" },
    { label: "missing request", remove: "DELETE FROM x_identity_requests WHERE id='req-1'" },
  ];
  const plan = accountLinkPlan();
  const q = plan.statement.toSQL();
  const check = new SQLiteSyncDialect().sqlToQuery(assertChanges(plan.expectedChanges));
  for (const { label, seed, remove, succeeds } of scenarios) {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`PRAGMA foreign_keys=ON;
        CREATE TABLE x_users (id TEXT PRIMARY KEY);
        CREATE TABLE user (id TEXT PRIMARY KEY);
        CREATE TABLE x_identity_requests (id TEXT PRIMARY KEY);
        CREATE TABLE x_user_account_links (
          x_user_id TEXT NOT NULL REFERENCES x_users(id) ON DELETE CASCADE,
          auth_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
          link_role TEXT NOT NULL DEFAULT 'owner',
          created_by_request_id TEXT REFERENCES x_identity_requests(id) ON DELETE SET NULL,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          PRIMARY KEY (x_user_id, auth_user_id)
        );
        CREATE TABLE marker (n INTEGER NOT NULL);
        INSERT INTO marker VALUES (0);
        INSERT INTO x_users VALUES ('candidate'), ('other-x');
        INSERT INTO user VALUES ('applicant'), ('other');
        INSERT INTO x_identity_requests VALUES ('req-1'), ('req-2');`);
      if (seed) sqlite.prepare("INSERT INTO x_user_account_links VALUES (?, ?, ?, ?, ?, ?)").run(...seed);
      if (remove) sqlite.exec(remove);
      const read = () => sqlite.prepare("SELECT * FROM x_user_account_links ORDER BY x_user_id, auth_user_id").all();
      const before = read();
      sqlite.exec("BEGIN; UPDATE marker SET n=1;");
      if (succeeds) {
        assert.equal(Number(sqlite.prepare(q.sql).run(...q.params).changes), 1, label);
        assert.doesNotThrow(() => sqlite.prepare(check.sql).get(...check.params), label);
        sqlite.exec("COMMIT");
        const inserted = sqlite.prepare("SELECT * FROM x_user_account_links WHERE x_user_id='candidate' AND auth_user_id='applicant'").get();
        assert.deepEqual({ ...inserted }, ownerLinkRow, label);
        assert.equal(read().length, before.length + 1, label);
        assert.deepEqual(read().filter(r => r.x_user_id !== "candidate" || r.auth_user_id !== "applicant"), before, label);
        assert.equal(sqlite.prepare("SELECT n FROM marker").get().n, 1, label);
        const committed = read();
        sqlite.exec("BEGIN; UPDATE marker SET n=2;");
        assert.throws(() => sqlite.prepare(q.sql).run(...q.params), undefined, "replay must not overwrite");
        sqlite.exec("ROLLBACK");
        assert.deepEqual(read(), committed, label);
        assert.equal(sqlite.prepare("SELECT n FROM marker").get().n, 1, label);
      } else {
        assert.throws(() => sqlite.prepare(q.sql).run(...q.params), undefined, label);
        sqlite.exec("ROLLBACK");
        assert.deepEqual(read(), before, label);
        assert.equal(sqlite.prepare("SELECT n FROM marker").get().n, 0, label);
      }
    } finally { sqlite.close(); }
  }
});

const siblingReason = "同一X IDの重複pending申請を取り消す";
const siblingCancellation = (sibling, actorXUserId) =>
  planXIdSiblingCancellation({
    sibling, actorUserId: "reviewer", actorXUserId, reason: siblingReason, now: 20,
  });

test("SA-090 sibling cancellation preserves CURRENT decision fields and exact audit snapshot", () => {
  for (const request_type of ["new_link", "existing_link"]) {
    for (const actorXUserId of [null, "reviewer-x"]) {
      const sibling = { ...request, id: "sibling", request_type, slot_bind_status: "complete",
        slot_bind_updated_at: null, decision_reason: "legacy reason" };
      const before = { ...sibling };
      const plan = siblingCancellation(sibling, actorXUserId);
      const update = {
        status: "cancelled", updated_at: 20, decision_reason: siblingReason,
        decided_by_auth_user_id: "reviewer", decided_at: 20,
      };
      assert.deepEqual(plan.update, update);
      assert.deepEqual(plan.audit, {
        table_name: "x_identity_requests", target_id: sibling.id, operation: "UPDATE",
        before, after: { ...before, ...update }, actor_user_id: "reviewer",
        actor_x_user_id: actorXUserId, reason: siblingReason,
        context: "x-identity-request", retention_class: "long_audit",
      });
      assert.deepEqual(sibling, before);
      assert.notStrictEqual(plan.audit.before, sibling);
    }
  }
});

test("SA-090 sibling cancellation keeps the host pending CAS and rolls back on a late sibling conflict", () => {
  const siblings = ["sibling-a", "sibling-b"].map(id => ({ ...request, id }));
  // The host retains the literal ID/pending predicate and expected-one
  // assertion. Compile its exact update shape using the shared decision fields.
  const queries = siblings.map(sibling => db.update(xIdentityRequests)
    .set(siblingCancellation(sibling, null).update)
    .where(and(eq(xIdentityRequests.id, sibling.id), eq(xIdentityRequests.status, "pending")))
    .toSQL());
  const check = new SQLiteSyncDialect().sqlToQuery(assertChanges(1));
  for (const [label, race] of [
    ["both pending", null],
    ["second approved", "UPDATE x_identity_requests SET status='approved' WHERE id='sibling-b'"],
    ["second rejected", "UPDATE x_identity_requests SET status='rejected' WHERE id='sibling-b'"],
    ["second cancelled", "UPDATE x_identity_requests SET status='cancelled' WHERE id='sibling-b'"],
    ["second deleted", "DELETE FROM x_identity_requests WHERE id='sibling-b'"],
  ]) {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`CREATE TABLE x_identity_requests (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at INTEGER NOT NULL,
        decision_reason TEXT, decided_by_auth_user_id TEXT, decided_at INTEGER
      );
      INSERT INTO x_identity_requests VALUES
        ('sibling-a','pending',10,NULL,NULL,NULL),
        ('sibling-b','pending',10,NULL,NULL,NULL),
        ('request','pending',11,NULL,NULL,NULL);
      CREATE TABLE marker (n INTEGER NOT NULL);
      INSERT INTO marker VALUES (0);`);
      if (race) sqlite.exec(race);
      const read = () => sqlite.prepare("SELECT * FROM x_identity_requests ORDER BY id").all();
      const before = read();
      sqlite.exec("BEGIN; UPDATE marker SET n=1;");
      const changes = queries.map((q, i) => {
        const count = Number(sqlite.prepare(q.sql).run(...q.params).changes);
        if (i === 0) assert.doesNotThrow(() => sqlite.prepare(check.sql).get(...check.params));
        return count;
      });
      assert.deepEqual(changes, [1, race ? 0 : 1], label);
      if (race) {
        assert.throws(() => sqlite.prepare(check.sql).get(...check.params), label);
        sqlite.exec("ROLLBACK");
        assert.deepEqual(read(), before, label);
        assert.equal(sqlite.prepare("SELECT n FROM marker").get().n, 0, label);
      } else {
        assert.doesNotThrow(() => sqlite.prepare(check.sql).get(...check.params), label);
        sqlite.exec("COMMIT");
        assert.equal(sqlite.prepare("SELECT count(*) AS n FROM x_identity_requests WHERE status='cancelled'").get().n, 2);
        assert.equal(sqlite.prepare("SELECT n FROM marker").get().n, 1);
        for (const q of queries) {
          assert.equal(Number(sqlite.prepare(q.sql).run(...q.params).changes), 0, "replay must not change a terminal row");
        }
      }
      assert.equal(sqlite.prepare("SELECT status FROM x_identity_requests WHERE id='request'").get().status, "pending");
    } finally { sqlite.close(); }
  }
});

test("SA-090 sibling cancellation rolls back when the final request pending CAS fails", () => {
  const siblings = ["sibling-a", "sibling-b"].map(id => ({ ...request, id }));
  const siblingQueries = siblings.map(sibling => db.update(xIdentityRequests)
    .set(siblingCancellation(sibling, null).update)
    .where(and(eq(xIdentityRequests.id, sibling.id), eq(xIdentityRequests.status, "pending")))
    .toSQL());
  // Compile the still host-owned final request CAS exactly as CURRENT.
  const finalQuery = db.update(xIdentityRequests).set({
    status: "approved",
    slot_bind_status: "pending",
    slot_bind_updated_at: 20,
    updated_at: 20,
    decision_reason: "X ID申請を承認",
    decided_by_auth_user_id: "reviewer",
    decided_at: 20,
  }).where(and(eq(xIdentityRequests.id, request.id), eq(xIdentityRequests.status, "pending"))).toSQL();
  const check = new SQLiteSyncDialect().sqlToQuery(assertChanges(1));
  for (const race of [null, "approved", "rejected", "cancelled", "done", "deleted"]) {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`CREATE TABLE x_identity_requests (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at INTEGER NOT NULL,
        decision_reason TEXT, decided_by_auth_user_id TEXT, decided_at INTEGER,
        slot_bind_status TEXT NOT NULL DEFAULT 'complete',
        slot_bind_updated_at INTEGER, slot_bind_attempt_count INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO x_identity_requests(id,status,updated_at,slot_bind_attempt_count) VALUES
        ('sibling-a','pending',10,2), ('sibling-b','pending',10,3),
        ('req-1','pending',11,1), ('unrelated','pending',12,0);
      CREATE TABLE marker (n INTEGER NOT NULL);
      INSERT INTO marker VALUES (0);`);
      if (race === "deleted") {
        sqlite.prepare("DELETE FROM x_identity_requests WHERE id=?").run(request.id);
      } else if (race !== null) {
        sqlite.prepare("UPDATE x_identity_requests SET status=? WHERE id=?").run(race, request.id);
      }
      const read = () => sqlite.prepare("SELECT * FROM x_identity_requests ORDER BY id").all();
      const before = read();
      const run = q => Number(sqlite.prepare(q.sql).run(...q.params).changes);
      const assertOne = () => sqlite.prepare(check.sql).get(...check.params);
      sqlite.exec("BEGIN; UPDATE marker SET n=1;");
      for (const q of siblingQueries) {
        assert.equal(run(q), 1);
        assert.doesNotThrow(assertOne);
      }
      assert.equal(run(finalQuery), race === null ? 1 : 0, String(race));
      if (race !== null) {
        assert.throws(assertOne);
        sqlite.exec("ROLLBACK");
        assert.deepEqual(read(), before, String(race));
        assert.equal(sqlite.prepare("SELECT n FROM marker").get().n, 0);
      } else {
        assert.doesNotThrow(assertOne);
        sqlite.exec("COMMIT");
        const after = read();
        for (const prior of before) {
          const row = after.find(r => r.id === prior.id);
          if (prior.id === request.id) {
            assert.deepEqual({ ...row }, { ...prior, status: "approved", updated_at: 20,
              decision_reason: "X ID申請を承認", decided_by_auth_user_id: "reviewer",
              decided_at: 20, slot_bind_status: "pending", slot_bind_updated_at: 20 });
          } else if (prior.id.startsWith("sibling-")) {
            assert.deepEqual({ ...row }, { ...prior, ...siblingCancellation(prior, null).update });
          } else {
            assert.deepEqual(row, prior);
          }
        }
        assert.equal(sqlite.prepare("SELECT n FROM marker").get().n, 1);
      }
    } finally { sqlite.close(); }
  }
});

test("SA-090 final approval audit preserves the full CURRENT row and committed slot-bind decision", () => {
  const reason = "X ID申請を承認";
  const update = {
    status: "approved", slot_bind_status: "pending", slot_bind_updated_at: 20,
    updated_at: 20, decision_reason: reason, decided_by_auth_user_id: "reviewer",
    decided_at: 20,
  };
  const check = new SQLiteSyncDialect().sqlToQuery(assertChanges(1));
  for (const request_type of ["new_link", "existing_link", "alias"]) {
    for (const actorXUserId of [null, "reviewer-x"]) {
      for (const attempts of [0, 3]) {
        const row = Object.freeze({
          ...request, request_type,
          source_x_user_id: null,
          target_x_user_id: request_type === "alias" ? "target" : null,
          parent_request_id: null, restore_snapshot_json: null, revert_deadline_at: null,
          requested_at: 1,
          decision_reason: attempts ? "legacy" : null,
          decided_by_auth_user_id: attempts ? "previous" : null,
          decided_at: attempts ? 8 : null,
          slot_bind_status: attempts ? "pending" : "complete",
          slot_bind_attempt_count: attempts, slot_bind_updated_at: attempts ? 9 : null,
        });
        assert.deepEqual(Object.keys(row).sort(), Object.keys(getTableColumns(xIdentityRequests)).sort());
        const audit = buildXIdRequestApprovalAudit({
          request: row, update, actorUserId: "reviewer", actorXUserId,
        });
        assert.deepEqual(audit, {
          table_name: "x_identity_requests", target_id: row.id, operation: "UPDATE",
          before: { ...row }, after: { ...row, ...update },
          actor_user_id: "reviewer", actor_x_user_id: actorXUserId,
          reason, context: "x-identity-request", retention_class: "long_audit",
        });
        assert.notStrictEqual(audit.before, row);
        assert.notStrictEqual(audit.after, row);
        const query = db.update(xIdentityRequests).set(update)
          .where(and(eq(xIdentityRequests.id, row.id), eq(xIdentityRequests.status, "pending")))
          .toSQL();
        const sqlite = new DatabaseSync(":memory:");
        try {
          sqlite.exec(`CREATE TABLE x_identity_requests (
            id TEXT PRIMARY KEY, request_type TEXT NOT NULL, requested_by_auth_user_id TEXT NOT NULL,
            requested_x_id TEXT, source_x_user_id TEXT, target_x_user_id TEXT,
            parent_request_id TEXT, restore_snapshot_json TEXT, revert_deadline_at INTEGER,
            status TEXT NOT NULL, decision_reason TEXT, decided_by_auth_user_id TEXT, decided_at INTEGER,
            slot_bind_status TEXT NOT NULL, slot_bind_attempt_count INTEGER NOT NULL, slot_bind_updated_at INTEGER,
            requested_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
          );`);
          const keys = Object.keys(row);
          const insert = sqlite.prepare(`INSERT INTO x_identity_requests (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`);
          insert.run(...Object.values(row));
          insert.run(...Object.values({ ...row, id: "unrelated" }));
          sqlite.exec("BEGIN");
          assert.equal(Number(sqlite.prepare(query.sql).run(...query.params).changes), 1);
          assert.doesNotThrow(() => sqlite.prepare(check.sql).get(...check.params));
          sqlite.exec("COMMIT");
          assert.deepEqual({ ...sqlite.prepare("SELECT * FROM x_identity_requests WHERE id=?").get(row.id) }, audit.after);
          assert.deepEqual({ ...sqlite.prepare("SELECT * FROM x_identity_requests WHERE id=?").get("unrelated") }, { ...row, id: "unrelated" });
          sqlite.exec("BEGIN");
          assert.equal(Number(sqlite.prepare(query.sql).run(...query.params).changes), 0);
          assert.throws(() => sqlite.prepare(check.sql).get(...check.params));
          sqlite.exec("ROLLBACK");
          assert.deepEqual({ ...sqlite.prepare("SELECT * FROM x_identity_requests WHERE id=?").get(row.id) }, audit.after);
        } finally { sqlite.close(); }
      }
    }
  }
});

test("SA-090/091 notification preparation preserves CURRENT order and deferred statement envelopes", async () => {
  const actor = { userId: "requester", discordId: null, discordName: null,
    activeXId: null, activeXName: null };
  const operator = { ...actor, userId: "operator", activeXId: "operator-x" };
  for (const overlay of [false, true]) {
    for (const hasDm of [false, true]) {
      for (const hasChannel of [false, true]) {
        const calls = [];
        const neverAwait = { then() { assert.fail("raw statement awaited"); } };
        const dm = hasDm ? { statement: neverAwait } : null;
        const channel = hasChannel ? { statement: neverAwait } : null;
        const projected = { ...actor, activeXId: "candidate" };
        const result = await prepareXIdReviewNotifications({
          requesterUserId: "requester", operatorUserId: "operator",
          buildDm: async () => { calls.push("dm"); return dm; },
          loadChannel: async () => {
            calls.push("load");
            return {
              resolveActor: async id => {
                calls.push(id);
                return id === "requester" ? actor : operator;
              },
              ...(overlay ? { overlayRequester: value => {
                calls.push("overlay");
                assert.strictEqual(value, actor);
                return projected;
              } } : {}),
              build: async (requester, reviewer) => {
                calls.push("channel");
                assert.strictEqual(requester, overlay ? projected : actor);
                assert.strictEqual(reviewer, operator);
                return channel;
              },
            };
          },
        });
        assert.deepEqual(calls, ["dm", "load", "requester",
          ...(overlay ? ["overlay"] : []), "operator", "channel"]);
        assert.strictEqual(result.notification, dm);
        assert.strictEqual(result.channelNotification, channel);
      }
    }
  }
});

test("SA-090/091 notification preparation stops at the original failed boundary", async () => {
  const phases = ["dm", "load", "requester", "overlay", "operator", "channel"];
  for (const phase of phases) {
    const calls = [];
    const error = new Error(phase);
    const hit = name => {
      calls.push(name);
      if (name === phase) throw error;
    };
    await assert.rejects(prepareXIdReviewNotifications({
      requesterUserId: "requester", operatorUserId: "operator",
      buildDm: async () => { hit("dm"); return null; },
      loadChannel: async () => {
        hit("load");
        return {
          resolveActor: async id => { hit(id); return null; },
          overlayRequester: actor => { hit("overlay"); return actor; },
          build: async () => { hit("channel"); return null; },
        };
      },
    }), value => value === error);
    assert.deepEqual(calls, phases.slice(0, phases.indexOf(phase) + 1));
  }
});


test("SA-090 public rebuild planning preserves CURRENT ordered targets and explicit operator", () => {
  for (const publicVisibilityChanged of [false, true]) {
    for (const notificationXUserId of [null, "", "approved-x", "0"]) {
      for (const operatorAuthUserId of ["operator-a", "operator-b"]) {
        const input = { publicVisibilityChanged, notificationXUserId, operatorAuthUserId };
        const expected = publicVisibilityChanged && notificationXUserId ? [
          { targetType: "user", targetId: notificationXUserId, reason: "x_id_approved", requestedByUserId: operatorAuthUserId, priority: "normal" },
          { targetType: "users_index", targetId: "global", reason: "x_id_approved", requestedByUserId: operatorAuthUserId, priority: "low" },
        ] : [];
        const planned = planXIdApprovalPublicRebuildTargets(Object.freeze(input));
        assert.deepEqual(planned, expected);
        assert.notEqual(planned, planXIdApprovalPublicRebuildTargets(input));
        if (planned.length > 0) {
          planned[0].targetId = "mutated";
          assert.deepEqual(planXIdApprovalPublicRebuildTargets(input), expected);
        }
      }
    }
  }
});
