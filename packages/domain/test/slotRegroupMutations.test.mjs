import assert from "node:assert/strict";
import test from "node:test";
import { buildRegroupMutations as canonical } from "../src/slots/regroupMutations.ts";
import { buildRegroupMutations as legacy } from "../../../src/lib/slots/slotRegroupMutations.ts";

test("MIG-0657 U01: legacy regroup helper is the canonical domain function", () => {
  assert.strictEqual(legacy, canonical);
});

test("MIG-0657 U01: mixed null X ID rows produce at most two ordered UPDATE plans", () => {
  const rows = Object.freeze([
    Object.freeze({ id: "one", x_user_id: "x-id" }),
    Object.freeze({ id: "two", x_user_id: null }),
    Object.freeze({ id: "three", x_user_id: "x-id" }),
    Object.freeze({ id: "four", x_user_id: null }),
  ]);
  const patch = Object.freeze({ reservation_group_id: "new-group" });
  const plans = canonical(rows, patch, { targetXId: "x-id", adoptNullRows: true });
  assert.equal(plans.length, 2);
  assert.deepEqual(plans.map(p => p.rows.map(r => r.id)), [["one", "three"], ["two", "four"]]);
  assert.deepEqual(plans.map(p => p.statusGuard), ["reserved", "reserved"]);
  assert.strictEqual(plans[0].patch, patch);
  assert.deepEqual(plans[1].patch, { reservation_group_id: "new-group", x_user_id: "x-id" });
  assert.notStrictEqual(plans[1].patch, patch);
  assert.equal(rows[1].x_user_id, null);
  assert.deepEqual(patch, { reservation_group_id: "new-group" });
});

test("MIG-0657 U01: all-adopt and all-keep produce one UPDATE, empty rows zero", () => {
  const rows = [{ id: "n1", x_user_id: null }, { id: "n2", x_user_id: null }];
  const patch = { display_name: "new name" };
  const allAdopt = canonical(rows, patch, { targetXId: "linked", adoptNullRows: true });
  assert.equal(allAdopt.length, 1);
  assert.deepEqual(allAdopt[0].rows, rows);
  assert.deepEqual(allAdopt[0].patch, { display_name: "new name", x_user_id: "linked" });
  assert.equal(allAdopt[0].statusGuard, "reserved");
  for (const identity of [
    { targetXId: "linked", adoptNullRows: false },
    { targetXId: null, adoptNullRows: true },
  ]) {
    const plans = canonical(rows, patch, identity);
    assert.equal(plans.length, 1);
    assert.strictEqual(plans[0].patch, patch);
    assert.deepEqual(plans[0].rows, rows);
  }
  assert.deepEqual(canonical([], patch, { targetXId: "linked", adoptNullRows: true }), []);
});

test("MIG-0657 U01: existing X ID is never overwritten by adoption", () => {
  const rows = [{ id: "existing", x_user_id: "other" }, { id: "legacy", x_user_id: null }];
  const plans = canonical(rows, { reservation_group_id: "g" }, { targetXId: "new", adoptNullRows: true });
  assert.deepEqual(plans[0].rows.map(r => r.id), ["existing"]);
  assert.deepEqual(plans[1].rows.map(r => r.id), ["legacy"]);
  assert.equal(plans[0].patch.x_user_id, undefined);
  assert.equal(plans[1].patch.x_user_id, "new");
});
