// MIG-0656 U02c-6a: SA-059 bounded, unmounted deletion-read regression.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  SLOT_AVAILABLE_DELETE_CHUNK_SNAPSHOT_SQL,
  selectAvailableDeleteChunk,
  ALL_AVAILABLE_DELETE_MAX_ROWS,
} from "../src/routes/manage/slotAvailableDeleteChunkSnapshot.ts";
import { canUpdateEventLabels } from "../src/routes/manage/slotWriteScopedRead.ts";

const columns = [
  "id", "event_id", "reserved_by_user_id", "x_user_id",
  "reserved_x_id_snapshot", "display_name", "slot_label", "start_time",
  "sort_order", "reservation_group_id", "video_id", "status",
  "updated_at", "version",
];
const makeSlot = (id, update = {}) => ({
  id, event_id: "ev", reserved_by_user_id: null, x_user_id: null,
  reserved_x_id_snapshot: null, display_name: null, slot_label: "Keep",
  start_time: null, sort_order: 1, reservation_group_id: null,
  video_id: null, status: "available", updated_at: 100,
  version: 1, ...update,
});
function database(rows) {
  const db = new DatabaseSync(":memory:");
  db.exec([
    "CREATE TABLE events(id TEXT PRIMARY KEY);",
    "CREATE TABLE event_staff(event_id TEXT, x_user_id TEXT, permission_preset TEXT, custom_permission_keys_json TEXT);",
    "CREATE TABLE x_user_account_links(auth_user_id TEXT, x_user_id TEXT);",
    "CREATE TABLE x_users(id TEXT PRIMARY KEY, approval_status TEXT);",
    "CREATE TABLE slots (" + columns.map(k => k === "id" ? "id TEXT PRIMARY KEY" :
      ["start_time","sort_order","updated_at","version"].includes(k)
        ? k + " INTEGER" : k + " TEXT").join(",") + ");",
    "INSERT INTO events VALUES('ev');",
    "INSERT INTO x_users VALUES('x1','approved');",
    "INSERT INTO x_user_account_links VALUES('staff','x1');",
    "INSERT INTO event_staff VALUES('ev','x1','slot_manager',NULL);",
  ].join(" "));
  const insert = db.prepare("INSERT INTO slots VALUES (" + columns.map(() => "?").join(",") + ")");
  for (const row of rows) insert.run(...columns.map(k => row[k]));
  return db;
}
function snapshot(db, { eventId="ev", userId="staff" }={}) {
  return db.prepare(SLOT_AVAILABLE_DELETE_CHUNK_SNAPSHOT_SQL)
    .get(eventId, eventId, userId, eventId);
}
test("SA-059: one bound D1 query scans at most 4 available rows, emits 3 and hasMore", () => {
  const rows = Array.from({ length: 11 }, (_, i) => makeSlot("s" + String(i).padStart(2,"0")));
  const db = database([...rows, makeSlot("reserved", { status: "reserved" }),
    makeSlot("foreign", { event_id: "other" })]);
  try {
    const read = snapshot(db);
    assert.equal(read.exists_id, "ev");
    assert.equal(canUpdateEventLabels("user", read.staff_json), true);
    const selection = selectAvailableDeleteChunk("ev", read);
    assert.equal(selection.ok, true);
    if (!selection.ok) throw Error("expected selected chunk");
    assert.equal(ALL_AVAILABLE_DELETE_MAX_ROWS, 3);
    assert.equal(selection.rows.length, 3);
    assert.deepEqual(selection.rows.map(x => x.id), ["s00", "s01", "s02"]);
    assert.equal(selection.hasMore, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM slots").get().n, 13,
      "read-only snapshot may not delete any slot");
  } finally { db.close(); }
});
test("SA-059: 0, 1 and 3 available rows are complete, not a partial success", () => {
  for (const n of [0,1,3]) {
    const db = database(Array.from({ length:n },(_,i)=>makeSlot("s"+i)));
    try {
      const parsed=selectAvailableDeleteChunk("ev", snapshot(db));
      assert.equal(parsed.ok,true);
      if (!parsed.ok) continue;
      assert.equal(parsed.rows.length,n);
      assert.equal(parsed.hasMore,false);
    } finally { db.close(); }
  }
});
test("SA-059: permission scope and foreign event are separate from snapshot selection", () => {
  const db=database([makeSlot("s0"),makeSlot("foreign",{event_id:"other"})]);
  try{
    const denied=snapshot(db,{userId:"unlinked"});
    assert.equal(canUpdateEventLabels("user",denied.staff_json),false);
    assert.equal(denied.exists_id,"ev");
    const allowed=snapshot(db);
    assert.equal(canUpdateEventLabels("user",allowed.staff_json),true);
    assert.equal(selectAvailableDeleteChunk("ev",allowed).ok,true);
    const missing=snapshot(db,{eventId:"missing"});
    assert.equal(missing.exists_id,null);
    assert.equal(canUpdateEventLabels("user",missing.staff_json),false);
  } finally {db.close();}
});
test("SA-059: malformed rows, duplicate identifiers and oversized JSON fail closed", () => {
  const a=makeSlot("a"),b=makeSlot("b");
  for(const input of [
    "not-json",JSON.stringify({rows:[a]}),
    JSON.stringify([a,a]),JSON.stringify([a, {...b,event_id:"other"}]),
    JSON.stringify([{...a,status:"reserved"}]),
    JSON.stringify([{...a,version:2.5}]),
    JSON.stringify([{...a,updated_at:null}]),
    JSON.stringify([{...a,slot_label:123}]),
    JSON.stringify([{...a,start_time:"oops"}]),
    JSON.stringify([a,b,makeSlot("c"),makeSlot("d"),makeSlot("e")]),
  ]) assert.deepEqual(selectAvailableDeleteChunk("ev",{rows_json:input}).ok,false);
  assert.equal(selectAvailableDeleteChunk(" ev ",{rows_json:"[]"}).ok,false);
});
test("SA-059: no route is mounted, and selection has no mutation side effects", async () => {
  const {readFile}=await import("node:fs/promises");
  const index=await readFile(new URL("../src/routes/manage/index.ts",import.meta.url),"utf8");
  assert.doesNotMatch(index,/slotAvailableDeleteChunkSnapshot/);
  assert.equal((SLOT_AVAILABLE_DELETE_CHUNK_SNAPSHOT_SQL.match(/\?/g)||[]).length,4);
  assert.match(SLOT_AVAILABLE_DELETE_CHUNK_SNAPSHOT_SQL,/ORDER BY s\.id ASC LIMIT 4/);
  assert.doesNotMatch(SLOT_AVAILABLE_DELETE_CHUNK_SNAPSHOT_SQL,/\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
});
