import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { and, eq, or, sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { slots } from "@flamenode/db/schema";
import { versionedSlotWhere as canonical } from "../src/slots/versionedPredicate.ts";

// Preserved baseline logic from CURRENT, deliberately independent of the
// new canonical implementation to catch SQL/bind ordering drift.
function currentBaseline(eventId, rows, status) {
  if (rows.length === 0) throw new Error("versioned_slot_where_empty");
  return and(
    eq(slots.event_id, eventId),
    status ? eq(slots.status, status) : undefined,
    or(...rows.map((row) => and(
      eq(slots.id, row.id),
      eq(slots.version, row.version),
      eq(slots.updated_at, row.updated_at),
      sql`${slots.reserved_x_id_snapshot} IS ${row.reserved_x_id_snapshot ?? null}`,
    ))),
  );
}
const dialect = new SQLiteSyncDialect();
const compile = x => dialect.sqlToQuery(x);
const row = (id, extra = {}) => ({
  id, version: 5, updated_at: 1700000,
  reserved_x_id_snapshot: null, ...extra,
});

test("MIG-0657 U01h: empty target fails closed with CURRENT error", () => {
  assert.throws(() => canonical("event", [], "available"), /versioned_slot_where_empty/);
});

test("MIG-0657 U01h: one-row available CAS has byte-identical SQL and params", () => {
  const records = [row("s1")];
  assert.deepEqual(compile(canonical("event", records, "available")),
    compile(currentBaseline("event", records, "available")));
});

test("MIG-0657 U01h: explicit X snapshot and reserved status preserve all bindings", () => {
  const records = [row("s1", {reserved_x_id_snapshot: "approved-X"})];
  const compiled = compile(canonical("event", records, "reserved"));
  assert.deepEqual(compiled, compile(currentBaseline("event", records, "reserved")));
  assert.ok(compiled.params.includes("approved-X"));
  assert.ok(compiled.params.includes(1700000));
});

test("MIG-0657 U01h: null and absent X snapshots compile equally (IS NULL bind)", () => {
  const a = compile(canonical("event", [row("s1")], "reserved"));
  const b = compile(canonical("event", [{id:"s1",version:5,updated_at:1700000}], "reserved"));
  assert.deepEqual(a,b);
  assert.ok(a.params.includes(null));
});

test("MIG-0657 U01h: 20-row batch keeps identical SQL and <=100 WHERE binds", () => {
  const rows = Array.from({length:20}, (_,i)=>row("slot-"+i));
  const sql1 = compile(canonical("event", rows, "available"));
  assert.deepEqual(sql1, compile(currentBaseline("event", rows, "available")));
  assert.equal(sql1.params.length, 2+4*20);
  assert.ok(sql1.params.length <= 100);
});

test("MIG-0657 U01h: no-status CAS stays compatible", () => {
  const rows = [row("s1"),row("s2")];
  assert.deepEqual(compile(canonical("event",rows)),compile(currentBaseline("event",rows)));
});

test("MIG-0657 U01h: SQLite refuses cross-event and cross-status matches", () => {
  const db=new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE slots (id TEXT PRIMARY KEY, event_id TEXT, status TEXT, version INTEGER, updated_at INTEGER, reserved_x_id_snapshot TEXT)");
    db.prepare("INSERT INTO slots VALUES (?, ?, ?, ?, ?, ?)").run("s1","e1","available",5,1700000,null);
    function match(eventId, input, status) {
      const q=compile(canonical(eventId,[input],status));
      return db.prepare("SELECT id FROM slots WHERE "+q.sql).all(...q.params).map(r=>r.id);
    }
    assert.deepEqual(match("e1",row("s1"),"available"),["s1"]);
    assert.deepEqual(match("e2",row("s1"),"available"),[]);
    assert.deepEqual(match("e1",row("s1"),"reserved"),[]);
    assert.deepEqual(match("e1",row("s1",{version:4}),"available"),[]);
    assert.deepEqual(match("e1",row("s1",{updated_at:1699999}),"available"),[]);
    assert.deepEqual(match("e1",row("s1",{reserved_x_id_snapshot:"other"}),"available"),[]);
  } finally { db.close(); }
});

test("MIG-0657 U01h: SQLite CAS verifies non-null snapshot equality and rejects null", () => {
  const db=new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE slots (id TEXT PRIMARY KEY, event_id TEXT, status TEXT, version INTEGER, updated_at INTEGER, reserved_x_id_snapshot TEXT)");
    db.prepare("INSERT INTO slots VALUES (?, ?, ?, ?, ?, ?)").run("s1","e1","reserved",6,1700000,"original");
    const hit=input=>{
      const q=compile(canonical("e1",[input],"reserved"));
      return db.prepare("SELECT id FROM slots WHERE "+q.sql).all(...q.params).length;
    };
    assert.equal(hit(row("s1",{version:6,reserved_x_id_snapshot:"original"})),1);
    assert.equal(hit(row("s1",{version:6,reserved_x_id_snapshot:null})),0);
    assert.equal(hit(row("s1",{version:6,reserved_x_id_snapshot:"other"})),0);
  } finally { db.close(); }
});
