import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { buildSlotReservedReleasePrecondition } from "../src/routes/manage/slotWriteAssertions.ts";

const dialect = new SQLiteSyncDialect();
const row = (id, group = null, fields = {}) => ({
  id, event_id: "event_1", status: "reserved", reservation_group_id: group,
  reserved_by_user_id: "user_1", x_user_id: "x_1",
  reserved_x_id_snapshot: "snap", updated_at: 100, version: 2,
  ...fields,
});

function setup(rows) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE slots (id TEXT PRIMARY KEY, event_id TEXT, status TEXT, reservation_group_id TEXT, reserved_by_user_id TEXT, x_user_id TEXT, reserved_x_id_snapshot TEXT, updated_at INTEGER, version INTEGER)");
  const insert = db.prepare("INSERT INTO slots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const r of rows) insert.run(r.id, r.event_id, r.status, r.reservation_group_id,
    r.reserved_by_user_id, r.x_user_id, r.reserved_x_id_snapshot, r.updated_at, r.version);
  return db;
}

function check(db, expectedRows, eventId = "event_1") {
  const compiled = dialect.sqlToQuery(buildSlotReservedReleasePrecondition(eventId, expectedRows));
  assert.ok(compiled.params.length <= 4, "one JSON snapshot, event ID and count");
  return Object.values(db.prepare(compiled.sql).get(...compiled.params))[0];
}

test("MIG-0656 U02b-2: full raw group and solo pass; foreign event and raw-spaced group are excluded", () => {
  const a = row("a", " grp "), b = row("b", " grp "), solo = row("solo");
  const db = setup([a,b,solo,row("foreign"," grp ",{event_id:"event_2"}),row("different","grp")]);
  try { assert.equal(check(db,[a,b,solo]),1); } finally { db.close(); }
});

test("MIG-0656 U02b-2: phantom group member, deletion and version race abort SQL", () => {
  const a=row("a","g"), b=row("b","g"), c=row("c","g");
  const db=setup([a,b]);
  try {
    assert.equal(check(db,[a,b]),1);
    db.prepare("INSERT INTO slots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      c.id,c.event_id,c.status,c.reservation_group_id,c.reserved_by_user_id,c.x_user_id,c.reserved_x_id_snapshot,c.updated_at,c.version);
    assert.throws(() => check(db,[a,b]),"newly inserted member must fail");
    db.prepare("DELETE FROM slots WHERE id='c'").run();
    db.prepare("UPDATE slots SET version=version+1 WHERE id='b'").run();
    assert.throws(() => check(db,[a,b]),"version changed");
    db.prepare("UPDATE slots SET version=version-1 WHERE id='b'").run();
    db.prepare("DELETE FROM slots WHERE id='b'").run();
    assert.throws(() => check(db,[a,b]),"missing member");
  } finally { db.close(); }
});

test("MIG-0656 U02b-2: owner, X id, snapshot, timestamp, status, group moves abort SQL", () => {
  const a=row("a","g"),b=row("b","g");
  for (const [column,value] of [
    ["reserved_by_user_id","other"],["x_user_id","other"],["reserved_x_id_snapshot","other"],
    ["updated_at",101],["status","submitted"],["reservation_group_id","new_g"],
  ]) {
    const db=setup([a,b]);
    try {
      db.prepare("UPDATE slots SET "+column+"=? WHERE id='b'").run(value);
      assert.throws(() => check(db,[a,b]),column);
    } finally { db.close(); }
  }
});

test("MIG-0656 U02b-2: unsafe snapshots are rejected before a D1 batch", () => {
  const a=row("a","g");
  for (const rows of [
    [],[a,a],[a,row("b","g",{reserved_by_user_id:"other"})],
    [row("x",null,{status:"submitted"})],[row("x",null,{version:NaN})],
    [row("x",null,{updated_at:1.5})],[row("x",null,{event_id:"foreign"})],
    ["a","b","c","d"].map(id=>row(id)),
  ]) assert.throws(()=>buildSlotReservedReleasePrecondition("event_1",rows));
  assert.throws(()=>buildSlotReservedReleasePrecondition(" ",[a]));
});