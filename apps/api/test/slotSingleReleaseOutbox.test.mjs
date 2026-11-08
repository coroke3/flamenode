// MIG-0656 U02c-5c: SA-060 20-row notification candidate parity, UNMOUNTED.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { buildSlotReleaseOutboxStatements } from "../src/routes/manage/slotReleaseOutbox.ts";
import { buildSlotSingleReleaseOutboxStatements } from "../src/routes/manage/slotSingleReleaseOutbox.ts";
import { buildSlotSingleReleaseAtomicPlan } from "../src/routes/manage/slotSingleReleaseMutation.ts";

const dialect = new SQLiteSyncDialect();
const row = (id, extras = {}) => ({
  id, event_id: "ev", status: "reserved", reserved_by_user_id: "u1",
  x_user_id: "x1", reserved_x_id_snapshot: "x1", version: 3,
  updated_at: 100, reservation_group_id: "group  ",
  display_name: "Owner", slot_label: "Keep", start_time: null,
  sort_order: 0, video_id: null, ...extras,
});
const group = count => Array.from({ length: count }, (_, i) => row("slot-" + i));
const options = (rows, makeId = () => "dm-default") => ({
  eventId: "ev", rows, createdAt: 201, siteOrigin: "https://flamenode.example",
  makeId,
});
const columns = ["id", "event_id", "status", "reserved_by_user_id", "x_user_id",
  "reserved_x_id_snapshot", "version", "updated_at", "reservation_group_id",
  "display_name", "slot_label", "start_time", "sort_order", "video_id"];
function setup(rows = []) {
  const db = new DatabaseSync(":memory:");
  db.exec([
    'CREATE TABLE "user"(id TEXT PRIMARY KEY,is_notification_enabled INTEGER);',
    `INSERT INTO "user" VALUES ('u1',1),('u2',0);`,
    "CREATE TABLE notification_outbox(",
    "id TEXT PRIMARY KEY,recipient_user_id TEXT,type TEXT,payload_json TEXT,",
    "delivery_route TEXT,correlation_id TEXT,status TEXT,attempt_count INTEGER,",
    "processing_started_at INTEGER,lease_token TEXT,lease_expires_at INTEGER,",
    "next_attempt_at INTEGER,last_error TEXT,processed_at INTEGER,event_id TEXT,",
    "dedupe_key TEXT,created_at INTEGER);",
    "CREATE UNIQUE INDEX active_dedupe ON notification_outbox(dedupe_key)",
    "WHERE dedupe_key IS NOT NULL AND status IN ('pending','processing','sent');",
    "CREATE TABLE slots(" + columns.map(k => k === "id" ? "id TEXT PRIMARY KEY" :
      ["version", "updated_at", "start_time", "sort_order"].includes(k)
        ? k + " INTEGER" : k + " TEXT").join(",") + ");",
  ].join(" "));
  const insert = db.prepare("INSERT INTO slots VALUES (" + columns.map(() => "?").join(",") + ")");
  for (const item of rows) insert.run(...columns.map(k => item[k]));
  return db;
}
const compile = query => dialect.sqlToQuery(query);
const exec = (db, query) => {
  const q = compile(query);
  assert.ok(q.params.length <= 100, "D1 binding cap");
  return db.prepare(q.sql).run(...q.params).changes;
};
const count = db => db.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n;

test("SA-060 U02c-5c: 20 rows send exactly one DM with CURRENT dedupe + count", () => {
  const db = setup();
  try {
    const outbox = buildSlotSingleReleaseOutboxStatements(options(group(20), () => "dm1"));
    assert.equal(outbox.statements.length, 1);
    assert.deepEqual(outbox.dedupeKeys, ["slot_force_released:ev:slot-0:group:3"]);
    assert.equal(exec(db, outbox.statements[0]), 1);
    const saved = db.prepare("SELECT * FROM notification_outbox").get();
    assert.equal(saved.type, "slot_force_released");
    assert.equal(saved.delivery_route, "dm");
    const payload = JSON.parse(saved.payload_json);
    assert.equal(payload.event_id, "ev");
    assert.match(payload.content, /予約枠 20 件/);
    assert.match(payload.content, /対象枠数: 20/);
    assert.match(payload.content, /予約グループ: group/);
    assert.equal(payload.url, "https://flamenode.example/event/ev");
  } finally { db.close(); }
});
test("SA-060 U02c-5c: default SA-063 helper still rejects >3 rows", () => {
  assert.throws(() => buildSlotReleaseOutboxStatements(options(group(4), () => "dm1")),
    /slot_release_notification_invalid_input/);
  assert.equal(buildSlotReleaseOutboxStatements(
    options(group(3), () => "dm1")).statements.length, 1);
});
test("SA-060 U02c-5c: 21 rows, mixed owner/raw group and duplicate slots rejected", () => {
  for (const rows of [
    group(21),
    [row("a"), row("b", { reserved_by_user_id: "u2" })],
    [row("a"), row("b", { x_user_id: "x2" })],
    [row("a", { reservation_group_id: "g" }), row("b", { reservation_group_id: "g  " })],
    [row("a"), row("a")],
    [row("a"), row("b", { status: "submitted" })],
    [row("a", { reservation_group_id: null }), row("b", { reservation_group_id: null })],
  ]) assert.throws(() => buildSlotSingleReleaseOutboxStatements(
    options(rows, () => "dm1")), /slot_single_release_notification_/);
});
test("SA-060 U02c-5c: JS-blank Unicode raw group means solo notification", () => {
  const db = setup();
  try {
    const outbox = buildSlotSingleReleaseOutboxStatements(
      options([row("single", { reservation_group_id: "\u3000" })], () => "dm1"));
    assert.deepEqual(outbox.dedupeKeys, ["slot_force_released:ev:single:solo:3"]);
    assert.equal(exec(db, outbox.statements[0]), 1);
    assert.doesNotMatch(JSON.parse(db.prepare(
      "SELECT payload_json FROM notification_outbox").get().payload_json).content, /予約グループ:/);
  } finally { db.close(); }
});
test("SA-060 U02c-5c: opt-out, missing owner and active dedupe/retry", () => {
  const db = setup();
  try {
    assert.equal(exec(db, buildSlotSingleReleaseOutboxStatements(
      options([row("opted", { reserved_by_user_id: "u2" })], () => "dm1")).statements[0]), 0);
    assert.equal(exec(db, buildSlotSingleReleaseOutboxStatements(
      options([row("missing", { reserved_by_user_id: "missing" })], () => "dm2")).statements[0]), 0);
    assert.equal(buildSlotSingleReleaseOutboxStatements(options([
      row("no-owner", { reserved_by_user_id: null }),
    ])).statements.length, 0);
    assert.equal(count(db), 0);
    const first = buildSlotSingleReleaseOutboxStatements(options([row("a")], () => "first"));
    const second = buildSlotSingleReleaseOutboxStatements(options([row("a")], () => "second"));
    assert.equal(exec(db, first.statements[0]), 1);
    assert.equal(exec(db, second.statements[0]), 0);
    db.prepare("UPDATE notification_outbox SET status='failed'").run();
    assert.equal(exec(db, second.statements[0]), 1);
    assert.equal(count(db), 2);
  } finally { db.close(); }
});
test("SA-060 U02c-5c: invalid notification origin fails closed", () => {
  for (const origin of ["javascript:alert(1)", "https://flamenode.example/path"]) {
    assert.throws(() => buildSlotSingleReleaseOutboxStatements({
      ...options([row("a")], () => "dm1"), siteOrigin: origin,
    }), /slot_release_notification_origin_invalid/);
  }
});
test("SA-060 U02c-5c: strict audit failure rolls back 20-slot CAS and DM", () => {
  const rows = group(20), db = setup(rows);
  try {
    const atomic = buildSlotSingleReleaseAtomicPlan({ eventId: "ev", rows, updatedAt: 202 });
    const outbox = buildSlotSingleReleaseOutboxStatements(options(rows, () => "dm1"));
    let reachedAudit = false;
    let thrown = null;
    db.exec("BEGIN");
    try {
      for (const statement of atomic.preMutationAssertions) {
        const q = compile(statement);
        db.prepare(q.sql).get(...q.params);
      }
      assert.equal(exec(db, atomic.mutationStatement), 20);
      assert.equal(exec(db, outbox.statements[0]), 1);
      reachedAudit = true;
      db.prepare("INSERT INTO missing_strict_audit VALUES (1)").run();
      db.exec("COMMIT");
    } catch (err) { thrown = err; db.exec("ROLLBACK"); }
    assert.equal(reachedAudit, true, "audit failure must occur AFTER CAS and outbox effect");
    assert.match(String(thrown), /no such table: missing_strict_audit/);
    assert.equal(count(db), 0);
    for (const item of rows) assert.equal(db.prepare(
      "SELECT status FROM slots WHERE id=?").get(item.id).status, "reserved");
  } finally { db.close(); }
});
