// MIG-0656 U02c-5b: SA-060 single-release atomic plan SQL regressions.
// Offline node:sqlite only. The parent Hono route is intentionally UNMOUNTED.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { buildSlotSingleReleaseAtomicPlan } from "../src/routes/manage/slotSingleReleaseMutation.ts";

const dialect = new SQLiteSyncDialect();
const columns = [
  "id", "event_id", "status", "reserved_by_user_id", "x_user_id",
  "reserved_x_id_snapshot", "display_name", "slot_label", "start_time",
  "sort_order", "reservation_group_id", "video_id", "updated_at", "version",
];
const makeRow = (id, override = {}) => ({
  id, event_id: "ev", status: "reserved",
  reserved_by_user_id: "recipient", x_user_id: "x",
  reserved_x_id_snapshot: "x", display_name: "Name",
  slot_label: "Keep", start_time: 123, sort_order: 1,
  reservation_group_id: "group", video_id: null,
  updated_at: 100, version: 1, ...override,
});
const makeGroup = (n, override = {}) =>
  Array.from({ length: n }, (_, i) => makeRow("slot-" + i, override));
function setup(rows) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE slots (" +
    columns.map(key => key === "id" ? key + " TEXT PRIMARY KEY" :
      ["start_time","sort_order","updated_at","version"].includes(key)
        ? key + " INTEGER" : key + " TEXT").join(", ") + ")");
  const insert = db.prepare("INSERT INTO slots VALUES (" + columns.map(() => "?").join(",") + ")");
  for (const row of rows) insert.run(...columns.map(key => row[key]));
  return db;
}
const compile = value => dialect.sqlToQuery(value);
function assertValid(db, plan) {
  for (const statement of plan.preMutationAssertions) {
    const query = compile(statement);
    assert.equal(db.prepare(query.sql).get(...query.params)[Object.keys(
      db.prepare(query.sql).get(...query.params))[0]], 1);
  }
}
function runMutation(db, plan) {
  const query = compile(plan.mutationStatement);
  return db.prepare(query.sql).run(...query.params).changes;
}
const read = (db, id) => db.prepare("SELECT * FROM slots WHERE id=?").get(id);
function atomicTransaction(db, plan) {
  db.exec("BEGIN");
  try {
    assertValid(db, plan);
    const changes = runMutation(db, plan);
    if (changes !== plan.expectedMutationChanges) throw Error("changed_row_count_mismatch");
    db.exec("COMMIT");
    return changes;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("SA-060: exactly 20 group members release via one CAS DML", () => {
  const rows = makeGroup(20);
  const db = setup([...rows, makeRow("outside", { event_id: "other" })]);
  try {
    const plan = buildSlotSingleReleaseAtomicPlan({ eventId: "ev", rows, updatedAt: 200 });
    assert.equal(plan.expectedMutationChanges, 20);
    assert.equal(plan.preMutationAssertions.length, 1);
    assert.equal(atomicTransaction(db, plan), 20);
    for (const row of rows) {
      const actual = read(db, row.id);
      assert.equal(actual.status, "available");
      assert.equal(actual.version, 2);
      assert.equal(actual.updated_at, 200);
      assert.equal(actual.slot_label, "Keep");
      for (const key of ["reserved_by_user_id", "x_user_id",
        "reserved_x_id_snapshot", "display_name", "reservation_group_id", "video_id"]) {
        assert.equal(actual[key], null, row.id + ":" + key);
      }
    }
    assert.equal(read(db, "outside").status, "reserved");
  } finally { db.close(); }
});

test("SA-060: new 21st group member is caught INSIDE the same transaction", () => {
  const selected = makeGroup(20);
  const db = setup([...selected, makeRow("phantom")]);
  try {
    const plan = buildSlotSingleReleaseAtomicPlan({ eventId: "ev", rows: selected, updatedAt: 200 });
    assert.throws(() => atomicTransaction(db, plan), /malformed JSON/i);
    for (const row of selected) assert.equal(read(db, row.id).status, "reserved");
    assert.equal(read(db, "phantom").status, "reserved");
  } finally { db.close(); }
});

test("SA-060: stale version, updated_at, status, owner and raw group reject all writes", () => {
  for (const changes of [
    { version: 2 }, { updated_at: 101 }, { status: "submitted" },
    { reserved_by_user_id: "else" }, { x_user_id: "other" },
    { reserved_x_id_snapshot: "changed" }, { reservation_group_id: "different" },
  ]) {
    const rows = makeGroup(2);
    const db = setup(rows);
    try {
      db.prepare("UPDATE slots SET " + Object.keys(changes)[0] + "=? WHERE id='slot-1'")
        .run(Object.values(changes)[0]);
      const plan = buildSlotSingleReleaseAtomicPlan({ eventId: "ev", rows, updatedAt: 200 });
      assert.throws(() => atomicTransaction(db, plan), /malformed JSON/i, JSON.stringify(changes));
      assert.equal(read(db, "slot-0").status, "reserved");
    } finally { db.close(); }
  }
});

test("SA-060: raw group ids differ; Unicode-blank IDs are solo", () => {
  const grouped = [makeRow("a", { reservation_group_id: "g  " }),
    makeRow("b", { reservation_group_id: "g  " })];
  const blank = makeRow("blank", { reservation_group_id: "\u3000" });
  const db = setup([...grouped, makeRow("other", { reservation_group_id: "g" }),
    blank, makeRow("blank2", { reservation_group_id: "\u3000" })]);
  try {
    assert.equal(atomicTransaction(db, buildSlotSingleReleaseAtomicPlan({
      eventId: "ev", rows: grouped, updatedAt: 200,
    })), 2);
    assert.equal(read(db, "other").status, "reserved");
    assert.equal(atomicTransaction(db, buildSlotSingleReleaseAtomicPlan({
      eventId: "ev", rows: [blank], updatedAt: 201,
    })), 1);
    assert.equal(read(db, "blank2").status, "reserved");
  } finally { db.close(); }
});

test("SA-060: mixed reservation inputs, duplicates and >20 snapshots fail before SQL", () => {
  const a = makeRow("a");
  for (const rows of [
    [], makeGroup(21), [a,a], [a,makeRow("b", { reserved_by_user_id: "other" })],
    [a,makeRow("b", { x_user_id: "other" })],
    [a,makeRow("b", { reservation_group_id: "another" })],
    [a,makeRow("b", { status: "submitted" })],
    [makeRow("a", { version: NaN })], [makeRow("a", { updated_at: 2.1 })],
    [makeRow("a", { event_id: "foreign" })],
    [makeRow("solo", { reservation_group_id: null }), makeRow("second", { reservation_group_id: null })],
  ]) assert.throws(() => buildSlotSingleReleaseAtomicPlan({
    eventId: "ev", rows, updatedAt: 200,
  }));
  assert.throws(() => buildSlotSingleReleaseAtomicPlan({
    eventId: "ev", rows: [a], updatedAt: NaN,
  }));
});

test("SA-060: no blind partial updates after CAS change even without group", () => {
  const rows = [makeRow("solo", { reservation_group_id: null })];
  const db = setup(rows);
  try {
    const plan = buildSlotSingleReleaseAtomicPlan({ eventId: "ev", rows, updatedAt: 200 });
    db.prepare("UPDATE slots SET version=version+1 WHERE id='solo'").run();
    assert.throws(() => atomicTransaction(db, plan), /malformed JSON/i);
    assert.equal(read(db, "solo").status, "reserved");
  } finally { db.close(); }
});

test("SA-060: query plans remain bounded and do not mount a write route", async () => {
  const plan = buildSlotSingleReleaseAtomicPlan({
    eventId: "ev", rows: makeGroup(20), updatedAt: 200,
  });
  const pre = compile(plan.preMutationAssertions[0]);
  const dml = compile(plan.mutationStatement);
  assert.ok(pre.params.length <= 6);
  assert.ok(dml.params.length <= 4);
  assert.match(pre.sql.trim(), /^WITH expected AS/);
  assert.match(dml.sql.trim(), /^UPDATE slots SET/);
  const { readFile } = await import("node:fs/promises");
  const index = await readFile(new URL("../src/routes/manage/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(index, /slotSingleReleaseMutation/);
});
