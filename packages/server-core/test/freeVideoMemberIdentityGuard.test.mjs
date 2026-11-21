import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { createSqlite, insert } from "../../../apps/api/test/support/personalHarness.mjs";
import { buildFreeVideoMemberIdentityGuardSql } from "../src/video/freeVideoMemberIdentityGuard.ts";
import { D1_MAX_BIND_PARAMETERS } from "../src/audit/mutateBudget.ts";

const dialect = new SQLiteSyncDialect();
function assertGuard(sqlite, entries, allowed) {
  const statement = dialect.sqlToQuery(buildFreeVideoMemberIdentityGuardSql(entries));
  assert.ok(statement.params.length <= D1_MAX_BIND_PARAMETERS);
  if (allowed) {
    const result = sqlite.prepare(statement.sql).get(...statement.params);
    assert.equal(Object.values(result)[0], 1);
  } else {
    assert.throws(() => sqlite.prepare(statement.sql).get(...statement.params), /malformed JSON/);
  }
}
function identity(candidate, canonical = candidate) {
  return [{ candidate, canonical }];
}

test("MIG-0651 identity CAS: invalid/duplicate inputs are rejected without D1", () => {
  for (const rows of [[], identity("", ""), identity("a", "not a handle"),
    [identity("raw")[0], identity("raw")[0]],
    Array.from({length:101},(_,i) => ({candidate:"member"+i,canonical:"member"+i})),
  ]) {
    assert.throws(() => buildFreeVideoMemberIdentityGuardSql(rows),
      /free_video_member_identity_guard_arguments_invalid/);
  }
});

test("MIG-0651 identity CAS: not-found placeholder remains valid, same-canonical arrival valid, rejection aborts", () => {
  const db = createSqlite();
  try {
    assertGuard(db, identity("newone"), true);
    insert(db, "x_users", {id:"newone",x_name:"New",approval_status:"approved"});
    assertGuard(db, identity("newone"), true);
    db.prepare("UPDATE x_users SET approval_status='rejected' WHERE id='newone'").run();
    assertGuard(db, identity("newone"), false);
  } finally { db.close(); }
});

test("MIG-0651 identity CAS: stable alias, rejected direct shadow and valid target allowed", () => {
  const db = createSqlite();
  try {
    insert(db, "x_users", {id:"canonical",x_name:"Canonical",approval_status:"approved"});
    insert(db, "x_user_aliases", {alias_x_id:"oldalias",x_user_id:"canonical"});
    assertGuard(db, identity("oldalias", "canonical"), true);
    insert(db, "x_users", {id:"oldalias",x_name:"Old",approval_status:"rejected"});
    assertGuard(db, identity("oldalias", "canonical"), true);
    db.prepare("UPDATE x_users SET approval_status='approved' WHERE id='oldalias'").run();
    assertGuard(db, identity("oldalias", "canonical"), false);
  } finally { db.close(); }
});

test("MIG-0651 identity CAS: alias deletion, retarget, reject and ambiguity fail closed", () => {
  const db = createSqlite();
  try {
    insert(db, "x_users", {id:"canon",x_name:"Canonical",approval_status:"approved"});
    insert(db, "x_users", {id:"other",x_name:"Other",approval_status:"approved"});
    insert(db, "x_user_aliases", {alias_x_id:"former",x_user_id:"canon"});
    const rows = identity("former", "canon");
    assertGuard(db, rows, true);
    db.prepare("UPDATE x_user_aliases SET x_user_id='other' WHERE alias_x_id='former'").run();
    assertGuard(db, rows, false);
    db.prepare("UPDATE x_user_aliases SET x_user_id='canon' WHERE alias_x_id='former'").run();
    db.prepare("UPDATE x_users SET approval_status='rejected' WHERE id='canon'").run();
    assertGuard(db, rows, false);
    db.prepare("UPDATE x_users SET approval_status='approved' WHERE id='canon'").run();
    insert(db, "x_user_aliases", {alias_x_id:"former",x_user_id:"other"});
    assertGuard(db, rows, false);
    db.prepare("DELETE FROM x_user_aliases WHERE alias_x_id='former'").run();
    assertGuard(db, rows, false);
  } finally { db.close(); }
});

test("MIG-0651 identity CAS: canonical direct collision and normalized duplicate both abort", () => {
  const db = createSqlite();
  try {
    insert(db, "x_users", {id:"target",x_name:"Target",approval_status:"approved"});
    insert(db, "x_user_aliases", {alias_x_id:"freeid",x_user_id:"target"});
    assertGuard(db, identity("freeid"), false,
      "an alias to target must not change the placeholder's own identity");
    db.prepare("DELETE FROM x_user_aliases").run();
    insert(db, "x_users", {id:"freeid",x_name:"Direct",approval_status:"pending"});
    assertGuard(db, identity("freeid"), true);
    insert(db, "x_users", {id:"FREEID",x_name:"Duplicate",approval_status:"approved"});
    assertGuard(db, identity("freeid"), false);
  } finally { db.close(); }
});

test("MIG-0651 identity CAS: 100 handles occupy one D1 bind and detect one stale mapping", () => {
  const db = createSqlite();
  try {
    const entries = Array.from({length:100},(_,i) => ({
      candidate:"new"+i,canonical:"new"+i,
    }));
    assertGuard(db, entries, true);
    insert(db, "x_users", {id:"new79",x_name:"New 79",approval_status:"rejected"});
    assertGuard(db, entries, false);
  } finally { db.close(); }
});
