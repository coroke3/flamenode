import assert from "node:assert/strict";
import test from "node:test";
import { buildSlotAtomicAuditPlan as canonical } from "../src/slots/atomicAuditPlan.ts";
import { buildSlotAtomicAuditPlan as legacy } from "../../../src/lib/slots/slotAtomicAuditPlan.ts";

const row = (id, overrides = {}) => ({
  id, event_id: "e1", status: "available", version: 3,
  updated_at: 100, reserved_x_id_snapshot: null, display_name: null,
  ...overrides,
});

test("MIG-0657 U01g: CURRENT adapter uses the canonical planner", () => {
  assert.strictEqual(legacy, canonical);
});

test("MIG-0657 U01g: one available CAS maps one statement and one exact audit delta", () => {
  const before = row("s1");
  const patch = { status: "reserved", display_name: "name", x_user_id: null };
  const p = canonical([{ rows: [before], patch, statusGuard: "available" }], 123);
  assert.equal(p.updates.length, 1);
  assert.strictEqual(p.updates[0].rows[0], before);
  assert.strictEqual(p.updates[0].patch, patch);
  assert.equal(p.updates[0].statusGuard, "available");
  assert.equal(p.updates[0].expectedChanges, 1);
  assert.deepEqual(p.auditDeltas, [{
    targetId: "s1",
    before: { ...before },
    after: { ...before, ...patch, updated_at: 123, version: 4 },
  }]);
  assert.equal(before.version, 3);
  assert.equal(before.display_name, null);
});

test("MIG-0657 U01g: 20-row single bulk update retains one CAS and 20 audits", () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(String(i)));
  const p = canonical([{ rows, patch: { status: "reserved" }, statusGuard: "available" }], 200);
  assert.deepEqual(p.updates.map(x => x.expectedChanges), [20]);
  assert.equal(p.auditDeltas.length, 20);
  assert.deepEqual(p.auditDeltas.map(x => x.targetId), rows.map(x => x.id));
});

test("MIG-0657 U01g: multi-statement regroup keeps statement ordering and audit order", () => {
  const rows = [row("keep"), row("adopt", { status: "reserved" }), row("gap")];
  const p = canonical([
    { rows: [rows[0]], patch: { reservation_group_id: "g" }, statusGuard: "reserved" },
    { rows: [rows[1]], patch: { reservation_group_id: "g", x_user_id: "approved" }, statusGuard: "reserved" },
    { rows: [rows[2]], patch: { status: "reserved" }, statusGuard: "available" },
  ], 203);
  assert.deepEqual(p.updates.map(x => x.statusGuard), ["reserved", "reserved", "available"]);
  assert.deepEqual(p.updates.map(x => x.expectedChanges), [1, 1, 1]);
  assert.deepEqual(p.auditDeltas.map(x => x.targetId), ["keep", "adopt", "gap"]);
});

test("MIG-0657 U01g: empty mutation arrays are skipped, not billed", () => {
  const p = canonical([
    { rows: [], patch: { status: "reserved" }, statusGuard: "available" },
    { rows: [row("s1")], patch: { status: "reserved" }, statusGuard: "available" },
  ], 400);
  assert.equal(p.updates.length, 1);
  assert.equal(p.auditDeltas.length, 1);
});

test("MIG-0657 U01g: no mutation plan fails closed with CURRENT message", () => {
  assert.throws(() => canonical([], 3), /更新対象の枠がありません。/);
  assert.throws(() => canonical([{ rows: [], patch: {} }], 3), /更新対象の枠がありません。/);
});

test("MIG-0657 U01g: duplicate ID within the same statement fails closed", () => {
  assert.throws(() => canonical([{ rows: [row("one"), row("one")], patch: {} }], 2),
    /同一枠を複数の更新に含めることはできません。/);
});

test("MIG-0657 U01g: duplicate ID across separate status CAS groups fails closed", () => {
  assert.throws(() => canonical([
    { rows: [row("one")], patch: { status: "reserved" }, statusGuard: "available" },
    { rows: [row("one")], patch: { status: "available" }, statusGuard: "reserved" },
  ], 2), /同一枠を複数の更新に含めることはできません。/);
});

test("MIG-0657 U01g: frozen row, array, patch and mutation survive planning unchanged", () => {
  const before = Object.freeze(row("s1", { display_name: null, reserved_x_id_snapshot: null }));
  const rows = Object.freeze([before]);
  const patch = Object.freeze({ display_name: "new", reserved_x_id_snapshot: "pending" });
  const mutation = Object.freeze({ rows, patch, statusGuard: "reserved" });
  const p = canonical(Object.freeze([mutation]), 800);
  assert.equal(before.display_name, null);
  assert.equal(before.version, 3);
  assert.equal(patch.reserved_x_id_snapshot, "pending");
  assert.equal(p.auditDeltas[0].before.reserved_x_id_snapshot, null);
  assert.equal(p.auditDeltas[0].after.reserved_x_id_snapshot, "pending");
  assert.notStrictEqual(p.auditDeltas[0].before, before);
});

test("MIG-0657 U01g: null overwrite and version increment preserve correct after snapshot", () => {
  const before = row("s1", { status: "reserved", version: 8, display_name: "old", reserved_x_id_snapshot: "x" });
  const p = canonical([{ rows: [before], patch: {
    status: "available", display_name: null, reserved_x_id_snapshot: null
  }, statusGuard: "reserved" }], 999);
  assert.equal(p.auditDeltas[0].after.display_name, null);
  assert.equal(p.auditDeltas[0].after.reserved_x_id_snapshot, null);
  assert.equal(p.auditDeltas[0].after.updated_at, 999);
  assert.equal(p.auditDeltas[0].after.version, 9);
  assert.equal(before.version, 8);
});

test("MIG-0657 U01g: statement and audit counts stay equal for every nonempty group", () => {
  const p = canonical([
    { rows: [row("a"), row("b")], patch: { status: "reserved" }, statusGuard: "available" },
    { rows: [], patch: { status: "reserved" }, statusGuard: "available" },
    { rows: [row("c")], patch: { status: "reserved" }, statusGuard: "available" },
  ], 2);
  assert.deepEqual(p.updates.map(x => x.expectedChanges), [2, 1]);
  assert.equal(p.auditDeltas.length, p.updates.reduce((n,x)=>n+x.expectedChanges,0));
});
