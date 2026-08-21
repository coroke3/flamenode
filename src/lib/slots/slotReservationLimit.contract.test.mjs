import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const slotAction = fs.readFileSync("src/lib/actions/slot.ts", "utf8");
const limitGuard = fs.readFileSync(
  "src/lib/slots/slotReservationLimitGuard.ts",
  "utf8",
);
const migration = fs.readFileSync(
  "migrations/0059_event_slot_reservation_limits.sql",
  "utf8",
);
const schema = fs.readFileSync("src/lib/db/schema.canonical.ts", "utf8");

test("X ID limit uses slots as source of truth and an atomic post-update guard", () => {
  assert.match(slotAction, /loadLogicalReservationCountForXId/);
  assert.match(slotAction, /buildReservationLimitGuardStatement/);
  assert.match(slotAction, /extraStatements\.push\(reservationLimitGuard\)/);
  assert.match(limitGuard, /\$\{slots\.status\} IN \('reserved', 'submitted'\)/);
  assert.match(limitGuard, /COUNT\(DISTINCT CASE/);
  assert.match(limitGuard, /TRIM\(matched\.reservation_group_id\)/);
  assert.match(limitGuard, /UNION ALL/);
  assert.match(
    limitGuard,
    /\$\{slots\.reserved_x_id_snapshot\} = \$\{xIdSnapshot\}[\s\S]*?\$\{slots\.reserved_x_id_snapshot\} <> \$\{xIdSnapshot\}[\s\S]*?lower\(trim\(ltrim\(trim\(\$\{slots\.reserved_x_id_snapshot\}\), '@'\)\)\) = \$\{xIdSnapshot\}/,
  );
  assert.doesNotMatch(migration, /slot_reservation_subject_counts/);
  assert.doesNotMatch(schema, /slotReservationSubjectCounts/);
});

test("notification queue is not woken by a non-notification guard", () => {
  assert.match(slotAction, /const wakeNotification = args\.notificationWakeSource;/);
  assert.doesNotMatch(slotAction, /extra\.length > 0 \? "web"/);
});

test("migration keeps existing events backward compatible and indexes the hot path", () => {
  assert.match(
    migration,
    /max_slot_reservation_groups_per_xid INTEGER NOT NULL DEFAULT 0/,
  );
  assert.match(migration, /slot_interval_minutes INTEGER/);
  assert.match(migration, /slots_event_x_snapshot_active_group_idx/);
});


test("extend and merge bulk regroup instead of one UPDATE per slot", () => {
  assert.match(slotAction, /function buildRegroupMutations/);
  assert.match(slotAction, /...buildRegroupMutations\(\s*groupRows/);
  assert.match(slotAction, /...buildRegroupMutations\(\s*reservedRows/);
});
