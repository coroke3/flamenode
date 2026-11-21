import assert from "node:assert/strict";
import test from "node:test";
import { buildSlotReleaseMutationPlan as canonical } from "../src/slots/releaseMutations.ts";
import { buildSlotReleaseMutationPlan as legacy } from "../../../src/lib/slots/slotReleaseMutations.ts";

const group = (size) => Object.freeze(
  Array.from({ length: size }, (_, n) =>
    Object.freeze({ id: `s${n + 1}`, reservation_group_id: "original", status: "reserved" })),
);
const ids = (plan) => plan.rows.map((row) => row.id);

test("MIG-0657 U01c: CURRENT bridge is identical to domain planner", () => {
  assert.strictEqual(legacy, canonical);
});

test("MIG-0657 U01c: center release splits old group and new group atomically", () => {
  const rows = group(5);
  const plan = canonical(rows, "s3", "right");
  assert.deepEqual(plan.map(ids), [["s3"], ["s4", "s5"]]);
  assert.deepEqual(plan.map(p => p.statusGuard), ["reserved", "reserved"]);
  assert.deepEqual(plan[0].patch, {
    reserved_by_user_id: null, x_user_id: null, reserved_x_id_snapshot: null,
    display_name: null, reservation_group_id: null, status: "available",
  });
  assert.deepEqual(plan[1].patch, { reservation_group_id: "right" });
  assert.equal(rows[2].status, "reserved");
  assert.equal(rows[3].reservation_group_id, "original");
});

test("MIG-0657 U01c: split with a single left row clears left group id", () => {
  const plan = canonical(group(5), "s2", "right");
  assert.deepEqual(plan.map(ids), [["s2"], ["s1"], ["s3", "s4", "s5"]]);
  assert.deepEqual(plan.slice(1).map(p => p.patch), [
    { reservation_group_id: null }, { reservation_group_id: "right" },
  ]);
});

test("MIG-0657 U01c: edge and singleton release preserve exact CURRENT grouping", () => {
  assert.deepEqual(canonical(group(3), "s1", "unused").map(ids), [["s1"]]);
  assert.deepEqual(canonical(group(3), "s3", "unused").map(ids), [["s3"]]);
  const two = canonical(group(2), "s1", "unused");
  assert.deepEqual(two.map(ids), [["s1"], ["s2"]]);
  assert.deepEqual(two[1].patch, { reservation_group_id: null });
  const solo = canonical(
    [{ id: "solo", reservation_group_id: null }],
    "solo", "unused",
  );
  assert.deepEqual(solo.map(ids), [["solo"]]);
});

test("MIG-0657 U01c: malformed inputs remain rejected by canonical release decisions", () => {
  assert.throws(() => canonical([], "none", "new"), /invalid_release_group_size/);
  assert.throws(() => canonical(group(2), "none", "new"), /release_target_not_found/);
  assert.throws(() => canonical(
    [{ id: "dup", reservation_group_id: "g" }, { id: "dup", reservation_group_id: "g" }],
    "dup", "new",
  ), /invalid_release_group_size/);
  assert.throws(() => canonical(group(21), "s10", "new"), /invalid_release_group_size/);
  assert.throws(() => canonical(group(5), "s3", ""), /missing_new_group_id/);
});
