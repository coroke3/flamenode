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

test("MIG-0657 U01e: adjacent extend uses the same available-CAS patch and original group snapshot", () => {
  const candidate = Object.freeze({ id: "candidate", status: "available" });
  const plans = canonical({
    rows: [candidate],
    actorUserId: "actor",
    identity: { canonicalXUserId: "linked-x", snapshotXId: "old-x-snapshot" },
    displayName: "same-owner",
    groupId: "existing-group",
  });
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].rows, [candidate]);
  assert.equal(plans[0].statusGuard, "available");
  assert.equal(plans[0].patch.reserved_x_id_snapshot, "old-x-snapshot");
  assert.equal(plans[0].patch.x_user_id, "linked-x");
  assert.equal(plans[0].patch.reservation_group_id, "existing-group");
  assert.equal(candidate.status, "available");
});

test("MIG-0657 U01e: merge gap inherits old reservation snapshot and updates only the gap", () => {
  const gap = Object.freeze({ id: "gap", status: "available" });
  const plans = canonical({
    rows: [gap],
    actorUserId: "merging-actor",
    identity: { canonicalXUserId: null, snapshotXId: "pending-original" },
    displayName: "merged-name",
    groupId: "new-group",
  });
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].rows.map(row => row.id), ["gap"]);
  assert.deepEqual(plans[0].patch, {
    reserved_by_user_id: "merging-actor",
    x_user_id: null,
    reserved_x_id_snapshot: "pending-original",
    display_name: "merged-name",
    reservation_group_id: "new-group",
    status: "reserved",
  });
  assert.equal(plans[0].statusGuard, "available");
});

test("MIG-0657 U01e: nullable original display name is preserved during extension", () => {
  const candidate = Object.freeze({ id: "candidate-null-name", status: "available" });
  const plan = canonical({
    rows: [candidate],
    actorUserId: "existing-actor",
    identity: { canonicalXUserId: null, snapshotXId: null },
    displayName: null,
    groupId: "old-group",
  })[0];
  assert.equal(plan.patch.display_name, null);
  assert.equal(plan.patch.reservation_group_id, "old-group");
  assert.equal(plan.statusGuard, "available");
});
