import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { buildSlotBatchCasMutation, buildSlotBatchAtomicPlan } from "../src/routes/manage/slotWriteMutations.ts";
import { buildSlotReservedReleasePrecondition } from "../src/routes/manage/slotWriteAssertions.ts";

const dialect = new SQLiteSyncDialect();
const makeRow = (id, props = {}) => ({
  id, event_id: "event_1", status: "available", slot_label: "old",
  reserved_by_user_id: null, x_user_id: null,
  reserved_x_id_snapshot: null, display_name: null,
  reservation_group_id: null, video_id: null, updated_at: 100, version: 2,
  ...props,
});
const columns = [
  "id","event_id","status","slot_label","reserved_by_user_id","x_user_id",
  "reserved_x_id_snapshot","display_name","reservation_group_id","video_id",
  "updated_at","version",
];
function setup(rows) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE slots (id TEXT PRIMARY KEY, event_id TEXT, status TEXT, slot_label TEXT, reserved_by_user_id TEXT, x_user_id TEXT, reserved_x_id_snapshot TEXT, display_name TEXT, reservation_group_id TEXT, video_id TEXT, updated_at INTEGER, version INTEGER)");
  const insert = db.prepare("INSERT INTO slots VALUES ("+columns.map(()=>"?").join(",")+")");
  for (const row of rows) insert.run(...columns.map(k => row[k]));
  return db;
}
function run(db,input) {
  const query = dialect.sqlToQuery(buildSlotBatchCasMutation(input));
  assert.ok(query.params.length <= 4, "bounded binds for <=3 rows");
  return db.prepare(query.sql).run(...query.params).changes;
}
function read(db,id) { return db.prepare("SELECT * FROM slots WHERE id=?").get(id); }

test("MIG-0656 U02b-3: available-delete only deletes matching event, status and CAS", () => {
  const a=makeRow("a"), b=makeRow("b",{status:"reserved"}), c=makeRow("c",{event_id:"foreign"});
  const db=setup([a,b,c]);
  try {
    assert.equal(run(db,{kind:"delete-available",eventId:"event_1",rows:[a,b]}),1);
    assert.equal(read(db,"a"),undefined);
    assert.equal(read(db,"b").status,"reserved");
    assert.ok(read(db,"c"));
    assert.equal(run(db,{kind:"delete-available",eventId:"event_1",rows:[a]}),0);
  } finally { db.close(); }
});

test("MIG-0656 U02b-3: label edit preserves CURRENT any-status behavior, trim and CAS", () => {
  const rows=[makeRow("a"),makeRow("b",{status:"reserved"}),
    makeRow("c",{status:"submitted"})];
  const db=setup(rows);
  try {
    assert.equal(run(db,{kind:"update-labels",eventId:"event_1",rows,updatedAt:200,label:"  新しい名前  "}),3);
    for (const row of rows) {
      const actual=read(db,row.id);
      assert.equal(actual.slot_label,"新しい名前");
      assert.equal(actual.status,row.status);
      assert.equal(actual.version,3);
      assert.equal(actual.updated_at,200);
    }
    assert.equal(run(db,{kind:"update-labels",eventId:"event_1",rows,updatedAt:201,label:"stale"}),0);
  } finally { db.close(); }
});

test("MIG-0656 U02b-3: reserved release clears reservations but retains slot labels", () => {
  const row=makeRow("a",{status:"reserved",slot_label:"ラベル",
    reserved_by_user_id:"user",x_user_id:"x",reserved_x_id_snapshot:"snap",
    display_name:"name",reservation_group_id:"g",video_id:"video"});
  const db=setup([row]);
  try {
    assert.equal(run(db,{kind:"release-reserved",eventId:"event_1",rows:[row],updatedAt:201}),1);
    const after=read(db,"a");
    for(const column of ["reserved_by_user_id","x_user_id","reserved_x_id_snapshot",
      "display_name","reservation_group_id","video_id"]) assert.equal(after[column],null,column);
    assert.equal(after.status,"available");
    assert.equal(after.slot_label,"ラベル");
    assert.equal(after.version,3);
    assert.equal(after.updated_at,201);
    assert.equal(run(db,{kind:"release-reserved",eventId:"event_1",rows:[row],updatedAt:202}),0);
  } finally { db.close(); }
});

test("MIG-0656 U02b-3: SQL CAS detects changed snapshots and rejects out-of-event rows", () => {
  const a=makeRow("a",{reserved_x_id_snapshot:"original"}), other=makeRow("foreign",{event_id:"event_2"});
  const db=setup([a,other]);
  try {
    db.prepare("UPDATE slots SET reserved_x_id_snapshot='changed' WHERE id='a'").run();
    assert.equal(run(db,{kind:"update-labels",eventId:"event_1",rows:[a],updatedAt:111,label:"ok"}),0);
    assert.throws(() => run(db,{kind:"delete-available",eventId:"event_1",rows:[other]}),
      /slot_batch_mutation_invalid_snapshot/, "foreign event identity is rejected before SQL generation");
  } finally { db.close(); }
});

test("MIG-0656 U02b-3: same-transaction membership assertion prevents partial group release", () => {
  const a=makeRow("a",{status:"reserved",reservation_group_id:"g",reserved_by_user_id:"u"});
  const b=makeRow("b",{status:"reserved",reservation_group_id:"g",reserved_by_user_id:"u"});
  const c=makeRow("c",{status:"reserved",reservation_group_id:"g",reserved_by_user_id:"u"});
  const db=setup([a,b,c]);
  const selected=[a,b];
  try {
    const assertion=dialect.sqlToQuery(buildSlotReservedReleasePrecondition("event_1",selected));
    db.exec("BEGIN");
    assert.throws(()=>db.prepare(assertion.sql).get(...assertion.params),"phantom detected before mutation");
    db.exec("ROLLBACK");
    assert.equal(read(db,"a").status,"reserved");
    assert.equal(read(db,"b").status,"reserved");
    assert.equal(read(db,"c").status,"reserved");
  } finally { db.close(); }
});


test("MIG-0656 U02b-3a: atomic plan always attaches group check + exact affected-row count", () => {
  const a = makeRow("a", { status: "reserved", reservation_group_id: "g" });
  const b = makeRow("b", { status: "reserved", reservation_group_id: "g" });
  const release = buildSlotBatchAtomicPlan({
    kind: "release-reserved", eventId: "event_1", rows: [a, b], updatedAt: 200,
  });
  assert.equal(release.expectedMutationChanges, 2);
  assert.equal(release.preMutationAssertions.length, 1);
  assert.ok(dialect.sqlToQuery(release.preMutationAssertions[0]).sql.includes("json_each"));
  assert.ok(dialect.sqlToQuery(release.mutationStatement).sql.includes("status = 'reserved'"));

  for (const kind of ["delete-available", "update-labels"]) {
    const plan = buildSlotBatchAtomicPlan({
      kind, eventId: "event_1", rows: [a],
      updatedAt: 200, ...(kind === "update-labels" ? { label: "name" } : {}),
    });
    assert.equal(plan.preMutationAssertions.length, 0);
    assert.equal(plan.expectedMutationChanges, 1);
  }
});

test("MIG-0656 U02b-3a: SQLite manual transaction rolls back partial CAS changes", () => {
  const a = makeRow("a");
  const b = makeRow("b", { status: "reserved" });
  const db = setup([a, b]);
  try {
    const plan = buildSlotBatchAtomicPlan({
      kind: "delete-available", eventId: "event_1", rows: [a, b],
    });
    const compiled = dialect.sqlToQuery(plan.mutationStatement);
    db.exec("BEGIN");
    assert.equal(db.prepare(compiled.sql).run(...compiled.params).changes, 1);
    assert.throws(() => db.prepare(
      "SELECT CASE WHEN changes() = ? THEN 1 ELSE json_extract('not-valid-json', '$') END"
    ).get(plan.expectedMutationChanges), "simulated exact change-count assertion");
    db.exec("ROLLBACK");
    assert.equal(read(db, "a").status, "available", "partial delete is not committed");
    assert.equal(read(db, "b").status, "reserved");
  } finally { db.close(); }
});

test("MIG-0656 U02b-3a: same-transaction group check prevents any release on a new group member", () => {
  const a = makeRow("a", { status: "reserved", reservation_group_id: "g" });
  const b = makeRow("b", { status: "reserved", reservation_group_id: "g" });
  const c = makeRow("c", { status: "reserved", reservation_group_id: "g" });
  const db = setup([a, b, c]);
  try {
    const plan = buildSlotBatchAtomicPlan({
      kind: "release-reserved", eventId: "event_1", rows: [a, b], updatedAt: 200,
    });
    db.exec("BEGIN");
    assert.throws(() => {
      for (const assertion of plan.preMutationAssertions) {
        const compiled = dialect.sqlToQuery(assertion);
        db.prepare(compiled.sql).get(...compiled.params);
      }
      const compiled = dialect.sqlToQuery(plan.mutationStatement);
      db.prepare(compiled.sql).run(...compiled.params);
    }, "phantom stops mutation before any change");
    db.exec("ROLLBACK");
    for (const id of ["a", "b", "c"]) assert.equal(read(db, id).status, "reserved");
  } finally { db.close(); }
});

test("MIG-0656 U02b-3: invalid inputs are rejected before any SQL is built", () => {
  const a=makeRow("a");
  for(const input of [
    {kind:"delete-available",eventId:"event_1",rows:[]},
    {kind:"delete-available",eventId:"event_1",rows:[a,a]},
    {kind:"delete-available",eventId:"event_1",rows:[makeRow("wrong",{event_id:"foreign"})]},
    {kind:"delete-available",eventId:"event_1",rows:["a","b","c","d"].map(id=>makeRow(id))},
    {kind:"update-labels",eventId:"event_1",rows:[a],updatedAt:1,label:" "},
    {kind:"update-labels",eventId:"event_1",rows:[a],updatedAt:1,label:"x".repeat(201)},
    {kind:"update-labels",eventId:"event_1",rows:[a],updatedAt:1.5,label:"ok"},
    {kind:"release-reserved",eventId:"event_1",rows:[makeRow("a",{version:NaN})],updatedAt:10},
    {kind:"release-reserved",eventId:"event_1",rows:[a]},
  ]) assert.throws(()=>buildSlotBatchCasMutation(input));
});