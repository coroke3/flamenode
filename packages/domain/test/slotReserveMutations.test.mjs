import assert from "node:assert/strict";
import test from "node:test";
import { buildSlotReserveMutationPlan as canonical } from "../src/slots/reserveMutations.ts";
import { buildSlotReserveMutationPlan as legacy } from "../../../src/lib/slots/slotReserveMutations.ts";

const makePlan = (rows, identity = { canonicalXUserId: "approved", snapshotXId: "approved" }, groupId = "group") =>
  canonical({ rows, actorUserId: "actor-1", identity, displayName: "Reserved", groupId });

test("MIG-0657 U01d: CURRENT bridge delegates to canonical domain reservation planner", () => {
  assert.strictEqual(legacy, canonical);
});

test("MIG-0657 U01d: multiple available rows use exactly one guarded bulk mutation", () => {
  const rows = Object.freeze(Array.from({ length: 20 }, (_, i) => Object.freeze({ id: "s" + i, status: "available" })));
  const [plan] = makePlan(rows);
  assert.equal(makePlan(rows).length, 1);
  assert.deepEqual(plan.rows.map(row => row.id), rows.map(row => row.id));
  assert.equal(plan.statusGuard, "available");
  assert.deepEqual(plan.patch, {
    reserved_by_user_id: "actor-1",
    x_user_id: "approved",
    reserved_x_id_snapshot: "approved",
    display_name: "Reserved",
    reservation_group_id: "group",
    status: "reserved",
  });
  assert.notStrictEqual(plan.rows, rows);
  assert.equal(rows[0].status, "available", "input row is not changed");
});

test("MIG-0657 U01d: singleton reserve has null group ID", () => {
  const [plan] = makePlan([{ id: "one" }], { canonicalXUserId: "x", snapshotXId: "x" }, null);
  assert.deepEqual(plan.rows, [{ id: "one" }]);
  assert.equal(plan.patch.reservation_group_id, null);
});

test("MIG-0657 U01d: pending identity preserves snapshot without an approved canonical X ID", () => {
  const [plan] = makePlan([{ id: "one" }], { canonicalXUserId: null, snapshotXId: "pending-id" }, null);
  assert.equal(plan.patch.x_user_id, null);
  assert.equal(plan.patch.reserved_x_id_snapshot, "pending-id");
});

test("MIG-0657 U01d: Discord-only reservation leaves both X fields null", () => {
  const [plan] = makePlan([{ id: "one" }], { canonicalXUserId: null, snapshotXId: null }, null);
  assert.equal(plan.patch.x_user_id, null);
  assert.equal(plan.patch.reserved_x_id_snapshot, null);
});

test("MIG-0657 U01d: frozen identity and rows remain unmodified after planning", () => {
  const identity = Object.freeze({ canonicalXUserId: "existing", snapshotXId: "snapshot" });
  const rows = Object.freeze([Object.freeze({ id: "s1", x_user_id: null })]);
  const [plan] = makePlan(rows, identity);
  plan.rows.pop();
  assert.equal(rows.length, 1);
  assert.deepEqual(identity, { canonicalXUserId: "existing", snapshotXId: "snapshot" });
  assert.equal(plan.patch.x_user_id, "existing");
  assert.equal(plan.patch.reserved_x_id_snapshot, "snapshot");
});
