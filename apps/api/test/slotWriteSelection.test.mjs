import assert from "node:assert/strict";
import test from "node:test";
import { selectSlotBatchRows, planBatchReservedRelease } from "../src/routes/manage/slotWriteSelection.ts";

const row = (id, group = null, overrides = {}) => ({
  id, event_id: "event_1", status: "reserved", reservation_group_id: group,
  reserved_by_user_id: "user_1", x_user_id: "x_1", version: 1, ...overrides,
});

test("MIG-0656 U02b-1: exact ID and event selection; labels include submitted, deletes only available", () => {
  assert.equal(selectSlotBatchRows("event_1", ["a"], [row("a")], "release-reserved").ok, true);
  assert.equal(selectSlotBatchRows("event_1", ["a"], [row("a")], "delete-available").ok, false);
  assert.equal(selectSlotBatchRows("event_1", ["a"], [row("a", null, { status: "submitted" })], "update-labels").ok, true);
  assert.equal(selectSlotBatchRows("event_1", ["a"], [row("a", null, { status: "available" })], "delete-available").ok, true);
  for (const [ids, rows] of [
    [["a", "b"], [row("a")]], [["a"], [row("b")]],
    [["a"], [row("a", null, { event_id: "event_2" })]],
    [["a", "a"], [row("a")]], [["a"], [row("a"), row("a")]],
    [["a"], [row("a", null, { version: Number.NaN })]],
    [[], []], [["a", "b", "c", "d"], [row("a"), row("b"), row("c"), row("d")]],
  ]) assert.equal(selectSlotBatchRows("event_1", ids, rows, "release-reserved").ok, false, JSON.stringify(ids));
});

test("MIG-0656 U02b-1: group expansion includes all authoritative members and retains raw group key", () => {
  const a = row("a", "  group ");
  const b = row("b", "  group ");
  const c = row("c", null);
  const selected = [a, c];
  const result = planBatchReservedRelease("event_1", ["a", "c"], selected, [a, b]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows.map((r) => r.id), ["a", "c", "b"]);
  assert.equal(planBatchReservedRelease("event_1", ["a"], [a], [a, b]).ok, true);
  // A trimmed but different group ID must not merge with this one.
  assert.equal(planBatchReservedRelease("event_1", ["a"], [a], [a, row("b", "group")]).ok, false);
  assert.equal(planBatchReservedRelease("event_1", ["c"], [c], []).ok, true);
});

test("MIG-0656 U02b-1: incomplete, stale, foreign, oversized and mixed-user groups fail closed", () => {
  const a = row("a", "g"), b = row("b", "g");
  const reject = [
    [], // group query omitted or missing anchor
    [b], // group query lost anchor
    [row("a", "g", { version: 2 }), b], // changed after selection
    [a, row("b", "g", { event_id: "foreign" })],
    [a, row("b", "elsewhere")],
    [a, row("b", "g", { status: "submitted" })],
    [a, row("b", "g", { reserved_by_user_id: "different" })],
    [a, row("b", "g", { x_user_id: "different" })],
    [a, b, row("c", "g"), row("d", "g")], // SQL LIMIT 4 sentinel
    [a, a], // inconsistent duplicate rows
  ];
  for (const rows of reject) {
    assert.equal(planBatchReservedRelease("event_1", ["a"], [a], rows).ok, false,
      rows.map((r) => r.id).join(","));
  }
  assert.deepEqual(planBatchReservedRelease("event_1", ["a"], [a], [a, b]),
    { ok: true, rows: [a, b] });
});
