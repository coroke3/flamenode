import assert from "node:assert/strict";
import test from "node:test";
import {
  annotateReservationGroups,
  collapseReservationGroups,
} from "./slotGroupingCore.ts";

const makeRows = (statuses, relations = [], owners = []) =>
  statuses.map((status, index) => ({
    id: `slot-${index + 1}`,
    slot_label: null,
    start_time: 1000 + index * 60,
    sort_order: index,
    status,
    display_name: "Team",
    is_owned_by_viewer: owners[index] ?? true,
    viewer_relation: relations[index] ?? "active",
    group_key: "group-1",
  }));

test("annotated group rejects mixed reserved/submitted and available statuses just like collapsed view", () => {
  for (const statuses of [
    ["reserved", "submitted"],
    ["available", "reserved"],
    ["available", "submitted"],
    ["available", "reserved", "submitted"],
  ]) {
    const rows = makeRows(statuses);
    const annotated = annotateReservationGroups(rows);
    const collapsed = collapseReservationGroups(rows);
    assert.equal(collapsed[0]?.integrity_error, "mixed_status");
    assert.equal(annotated.length, rows.length);
    for (const row of annotated) {
      assert.equal(row.integrity_error, "mixed_status");
      assert.equal(row.is_owned_by_viewer, false);
    }
  }
});

test("annotated group rejects mixed account viewer relations for every slot", () => {
  const rows = makeRows(
    ["reserved", "reserved"],
    ["active", "account_other"],
    [true, false],
  );
  assert.equal(collapseReservationGroups(rows)[0]?.integrity_error, "mixed_viewer_relation");
  for (const row of annotateReservationGroups(rows)) {
    assert.equal(row.integrity_error, "mixed_viewer_relation");
    assert.equal(row.is_owned_by_viewer, false);
  }
});

test("active plus unassigned is still allowed when all slots are owned", () => {
  const rows = makeRows(["reserved", "reserved"], ["active", "unassigned"]);
  assert.equal(collapseReservationGroups(rows)[0]?.integrity_error, null);
  for (const row of annotateReservationGroups(rows)) {
    assert.equal(row.integrity_error, null);
    assert.equal(row.is_owned_by_viewer, true);
  }
});

test("annotated group does not grant actions on a partially owned group", () => {
  const rows = makeRows(["reserved", "reserved"], ["active", "active"], [true, false]);
  assert.equal(collapseReservationGroups(rows)[0]?.is_owned_by_viewer, false);
  for (const row of annotateReservationGroups(rows)) {
    assert.equal(row.integrity_error, null);
    assert.equal(row.is_owned_by_viewer, false);
  }
});

test("individual ungrouped slots retain independent ownership and status", () => {
  const rows = makeRows(["reserved", "submitted"], ["active", "account_other"], [true, false])
    .map((row) => ({ ...row, group_key: null }));
  const annotated = annotateReservationGroups(rows);
  assert.deepEqual(annotated.map((row) => ({
    id: row.id,
    integrity_error: row.integrity_error,
    is_owned_by_viewer: row.is_owned_by_viewer,
    group_id: row.group_id,
  })), [
    { id: "slot-1", integrity_error: null, is_owned_by_viewer: true, group_id: null },
    { id: "slot-2", integrity_error: null, is_owned_by_viewer: false, group_id: null },
  ]);
});
