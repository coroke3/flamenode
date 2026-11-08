// MIG-0656 U02c-5a: SA-060 offline SQLite snapshot parity (UNMOUNTED).
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  SLOT_SINGLE_RELEASE_SNAPSHOT_SQL,
  selectSingleReservedReleaseSnapshot,
} from "../src/routes/manage/slotSingleReleaseSnapshot.ts";

const columns = [
  "id", "event_id", "reserved_by_user_id", "x_user_id",
  "reserved_x_id_snapshot", "display_name", "slot_label", "start_time",
  "sort_order", "reservation_group_id", "video_id", "status",
  "updated_at", "version",
];
function slot(id, changes = {}) {
  return {
    id, event_id: "ev", reserved_by_user_id: "recipient",
    x_user_id: "x1", reserved_x_id_snapshot: "x1",
    display_name: "Reserved", slot_label: "Keep", start_time: null,
    sort_order: 0, reservation_group_id: "group",
    video_id: null, status: "reserved", updated_at: 100, version: 1,
    ...changes,
  };
}
function setup(rows) {
  const db = new DatabaseSync(":memory:");
  db.exec([
    "CREATE TABLE events (id TEXT PRIMARY KEY);",
    "CREATE TABLE event_staff (event_id TEXT,x_user_id TEXT,permission_preset TEXT,custom_permission_keys_json TEXT);",
    "CREATE TABLE x_user_account_links (auth_user_id TEXT,x_user_id TEXT);",
    "CREATE TABLE x_users (id TEXT,approval_status TEXT);",
    "CREATE TABLE system_settings (id TEXT PRIMARY KEY,operation_mode TEXT,disabled_features_json TEXT,",
    "cost_guard_exception_until INTEGER,cost_guard_exception_features_json TEXT);",
    "INSERT INTO system_settings (id,operation_mode) VALUES ('default','normal');",
    "CREATE TABLE slots (" + columns.map(name =>
      name + (name === "id" ? " TEXT PRIMARY KEY" :
        ["sort_order", "start_time", "updated_at", "version"].includes(name)
          ? " INTEGER" : " TEXT")).join(",") + ");",
    "INSERT INTO events VALUES ('ev');",
  ].join("\n"));
  const insert = db.prepare("INSERT INTO slots VALUES (" + columns.map(() => "?").join(",") + ")");
  for (const row of rows) insert.run(...columns.map(name => row[name]));
  const read = (slotId = "s0", eventId = "ev") =>
    db.prepare(SLOT_SINGLE_RELEASE_SNAPSHOT_SQL)
      .get(eventId, eventId, "user", eventId, slotId, eventId, eventId, slotId);
  return { db, read, close: () => db.close() };
}
function choose(db, slotId = "s0", eventId = "ev") {
  return selectSingleReservedReleaseSnapshot(eventId, slotId, db.read(slotId, eventId));
}
test("SA-060: one bound read permits complete 20-slot reservation groups", () => {
  const db = setup(Array.from({length: 20}, (_, i) => slot("s" + i)));
  try {
    const selection = choose(db);
    assert.equal(selection.ok, true);
    assert.equal(selection.rows.length, 20);
    assert.ok(selection.rows.some(row => row.id === "s19"));
    assert.equal(db.read().exists_id, "ev");
    assert.equal(JSON.parse(db.read().cost_guard_json).operation_mode, "normal");
  } finally { db.close(); }
});
test("SA-060: 21-member group is rejected rather than silently truncated", () => {
  const db = setup(Array.from({length: 21}, (_, i) => slot("s" + i)));
  try {
    const selection = choose(db);
    assert.deepEqual(selection, {
      ok: false, message: "一度に解放できる枠は 20 件までです。",
    });
  } finally { db.close(); }
});
test("SA-060: raw whitespace group keys stay separate; JS-blank groups are solo", () => {
  const db = setup([
    slot("s0", { reservation_group_id: "g  " }),
    slot("s1", { reservation_group_id: "g  " }),
    slot("other", { reservation_group_id: "g" }),
    slot("unicode", { reservation_group_id: "\u3000" }),
    slot("blank2", { reservation_group_id: "\u3000" }),
    slot("nullgroup", { reservation_group_id: null }),
  ]);
  try {
    const grouped = choose(db);
    assert.equal(grouped.ok, true);
    assert.deepEqual(grouped.rows.map(row => row.id).sort(), ["s0", "s1"]);
    const solo = choose(db, "unicode");
    assert.equal(solo.ok, true);
    assert.deepEqual(solo.rows.map(row => row.id), ["unicode"]);
    const nullGroup = choose(db, "nullgroup");
    assert.equal(nullGroup.ok, true);
    assert.deepEqual(nullGroup.rows.map(row => row.id), ["nullgroup"]);
  } finally { db.close(); }
});
test("SA-060: mixed owners and statuses deny entire group", () => {
  for (const bad of [
    { reserved_by_user_id: "other" },
    { x_user_id: "different" },
    { status: "submitted" },
  ]) {
    const db = setup([slot("s0"), slot("s1", bad)]);
    try {
      assert.equal(choose(db).ok, false, JSON.stringify(bad));
    } finally { db.close(); }
  }
});
test("SA-060: missing anchor, other event and non-reserved anchor fail closed", () => {
  const db = setup([slot("s0", { status: "available" })]);
  try {
    assert.deepEqual(choose(db), {
      ok: false, message: "予約中の枠だけ解放できます。",
    });
    assert.deepEqual(choose(db, "missing"), {
      ok: false, message: "枠が見つかりません。",
    });
    assert.equal(choose(db, "s0", "foreign").ok, false);
  } finally { db.close(); }
});
test("SA-060: anchor group changes and a missing anchor in group are rejected", () => {
  const db = setup([slot("s0"), slot("s1")]);
  try {
    const read = db.read();
    const anchor = JSON.parse(read.anchor_json);
    assert.equal(selectSingleReservedReleaseSnapshot("ev", "s0", {
      ...read, anchor_json: JSON.stringify({ ...anchor, version: anchor.version + 1 }),
    }).ok, false);
    assert.equal(selectSingleReservedReleaseSnapshot("ev", "s0", {
      ...read, group_json: JSON.stringify([slot("s1")]),
    }).ok, false);
    assert.equal(selectSingleReservedReleaseSnapshot("ev", "s0", {
      ...read, group_json: JSON.stringify([slot("s0"), slot("s0")]),
    }).ok, false);
  } finally { db.close(); }
});
test("SA-060: SQL is read-only with eight bound inputs; no route activation", () => {
  assert.match(SLOT_SINGLE_RELEASE_SNAPSHOT_SQL, /^SELECT\b/);
  assert.equal((SLOT_SINGLE_RELEASE_SNAPSHOT_SQL.match(/\?/g) ?? []).length, 8);
  assert.doesNotMatch(SLOT_SINGLE_RELEASE_SNAPSHOT_SQL, /\b(INSERT|UPDATE|DELETE)\b/i);
  const index = new URL("../src/routes/manage/index.ts", import.meta.url);
  // The module is intentionally not imported into the live manage router.
  return import("node:fs/promises").then(({ readFile }) =>
    readFile(index, "utf8").then(source =>
      assert.doesNotMatch(source, /slotSingleReleaseSnapshot/)));
});
