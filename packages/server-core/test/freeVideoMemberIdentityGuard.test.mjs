import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { createSqlite, insert } from "../../../apps/api/test/support/personalHarness.mjs";
import { buildFreeVideoMemberIdentityGuardSql } from "../src/video/freeVideoMemberIdentityGuard.ts";
import { D1_MAX_BIND_PARAMETERS } from "../src/audit/mutateBudget.ts";

const dialect = new SQLiteSyncDialect();
function assertGuard(sqlite, entries, allowed, message) {
  const statement = dialect.sqlToQuery(buildFreeVideoMemberIdentityGuardSql(entries));
  assert.ok(statement.params.length <= D1_MAX_BIND_PARAMETERS);
  if (allowed) {
    const result = sqlite.prepare(statement.sql).get(...statement.params);
    assert.equal(Object.values(result)[0], 1, message);
  } else {
    assert.throws(() => sqlite.prepare(statement.sql).get(...statement.params), /malformed JSON/, message);
  }
}
function identity(candidate, canonical = candidate, allowAbsent = false) {
  return [{ candidate, canonical, allowAbsent }];
}

test("MIG-0651 identity CAS: invalid/duplicate inputs are rejected without D1", () => {
  for (const rows of [[], identity("", ""), identity("a", "not a handle"),
    [identity("raw")[0], identity("raw")[0]],
    [{candidate:"abc",canonical:"abc",allowAbsent:null}],
    Array.from({length:101},(_,i) => ({candidate:"member"+i,canonical:"member"+i})),
  ]) {
    assert.throws(() => buildFreeVideoMemberIdentityGuardSql(rows),
      /free_video_member_identity_guard_arguments_invalid/);
  }
});

test("MIG-0651 identity CAS: not-found placeholder stays valid only while absent", () => {
  const db = createSqlite();
  try {
    assertGuard(db, identity("newone", "newone", true), true);
    insert(db, "x_users", {id:"newone",x_name:"New",approval_status:"approved"});
    assertGuard(db, identity("newone", "newone", true), false,
      "exact-PK race must not substitute an approved profile for the audited pending INSERT");
    db.prepare("UPDATE x_users SET approval_status='rejected' WHERE id='newone'").run();
    assertGuard(db, identity("newone", "newone", true), false);
  } finally { db.close(); }
});

test("MIG-0651 identity CAS: normalization-only collision cannot create a second canonical X", () => {
  const db = createSqlite();
  try {
    const rows = identity("existing", "existing", true);
    assertGuard(db, rows, true, "genuine no-row placeholder is permitted");
    for (const id of ["EXISTING", "@existing"]) {
      insert(db, "x_users", {id, x_name:"Previously created", approval_status:"approved"});
      assertGuard(db, rows, false,
        "preflight-not-found must reject a case/@-variant direct PK");
      db.prepare("DELETE FROM x_users WHERE id=?").run(id);
    }
    insert(db, "x_users", {id:"existing", x_name:"Exact canonical", approval_status:"approved"});
    assertGuard(db, rows, false, "even exact PK races invalidate the strict pending CREATE audit");
  } finally { db.close(); }
});

test("MIG-0651 identity CAS: alias appearance after placeholder pre-read must fail even for same target", () => {
  const db = createSqlite();
  try {
    const newRow = identity("fresh", "fresh", true);
    assertGuard(db, newRow, true);
    insert(db, "x_users", {id:"fresh",x_name:"New",approval_status:"pending"});
    insert(db, "x_user_aliases", {alias_x_id:"fresh",x_user_id:"fresh"});
    assertGuard(db, newRow, false,
      "a brand-new alias is a change to the not-found snapshot and cannot pass the batch CAS");
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

test("MIG-0651 identity CAS: a previously resolved direct X must not disappear before commit", () => {
  const db = createSqlite();
  try {
    insert(db, "x_users", {id:"present",x_name:"Present",approval_status:"approved"});
    assertGuard(db, identity("present"), true);
    db.prepare("DELETE FROM x_users WHERE id='present'").run();
    assertGuard(db, identity("present"), false);
    // A genuinely not-found preflight is permitted to remain absent.
    assertGuard(db, identity("present", "present", true), true);
  } finally { db.close(); }
});

test("MIG-0651 identity CAS: 100 handles occupy one D1 bind and detect one stale mapping", () => {
  const db = createSqlite();
  try {
    const entries = Array.from({length:100},(_,i) => ({
      candidate:"new"+i,canonical:"new"+i,allowAbsent:true,
    }));
    assertGuard(db, entries, true);
    insert(db, "x_users", {id:"new79",x_name:"New 79",approval_status:"rejected"});
    assertGuard(db, entries, false);
  } finally { db.close(); }
});

test("MIG-0651 identity CAS: 100 mixed handles use normalized expression indexes instead of scans", () => {
  const db = createSqlite();
  try {
    // createSqlite() applies migrations in version order, including 0067.
    for (let i = 0; i < 400; i++) {
      insert(db, "x_users", {
        id: "user" + i, x_name: "User " + i, approval_status: "approved",
      });
    }
    for (let i = 0; i < 40; i++) {
      insert(db, "x_user_aliases", {
        x_user_id: "user" + i, alias_x_id: "old" + i,
      });
    }
    const entries = [
      ...Array.from({length: 40}, (_, i) => ({
        candidate: "user" + i, canonical: "user" + i, allowAbsent: false,
      })),
      ...Array.from({length: 40}, (_, i) => ({
        candidate: "old" + i, canonical: "user" + i, allowAbsent: false,
      })),
      ...Array.from({length: 20}, (_, i) => ({
        candidate: "new" + i, canonical: "new" + i, allowAbsent: true,
      })),
    ];
    const compiled = dialect.sqlToQuery(buildFreeVideoMemberIdentityGuardSql(entries));
    assert.equal(compiled.params.length, 1, "100 inputs stay inside one D1 JSON bind");
    const details = db.prepare("EXPLAIN QUERY PLAN " + compiled.sql)
      .all(...compiled.params).map(row => row.detail);
    assert.ok(details.some(row => row.includes("SEARCH d USING INDEX x_users_canonical_norm_id_idx")),
      "direct X lookup must use canonical normalization expression index");
    assert.ok(details.some(row => row.includes("SEARCH a USING INDEX x_user_aliases_canonical_norm_alias_idx")),
      "alias lookup must use normalized alias expression index");
    assert.ok(details.some(row => row.includes("SEARCH target USING INDEX x_users_canonical_norm_id_idx")),
      "alias target resolution must also use canonical X index");
    assert.ok(!details.some(row => row.startsWith("SCAN d") ||
      row.startsWith("SCAN a") || row.startsWith("SCAN target")),
      "identity lookup cannot scan each persistent table once per input");
    assertGuard(db, entries, true);
    db.prepare("UPDATE x_user_aliases SET x_user_id='user41' WHERE alias_x_id='old18'").run();
    assertGuard(db, entries, false, "retarget after preflight still aborts");
  } finally { db.close(); }
});

