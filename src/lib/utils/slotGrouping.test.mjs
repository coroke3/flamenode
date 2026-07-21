import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sortSlotsChronologically,
  areSlotsInSamePart,
  buildSlotParts,
  collapseReservationGroups,
} from "./slotGroupingCore.ts";

const baseSlot = {
  slot_label: null,
  status: "available",
  display_name: null,
  is_owned_by_viewer: false,
  group_key: null,
};

test("sortSlotsChronologically: 時刻、sort_order、idの順で安定化する", () => {
  const result = sortSlotsChronologically([
    { id: "c", start_time: null, sort_order: 0 },
    { id: "a", start_time: 100, sort_order: 2 },
    { id: "b", start_time: 100, sort_order: 1 },
  ]);
  assert.deepEqual(
    result.map((row) => row.id),
    ["b", "a", "c"],
  );
});

test("buildSlotParts: 開始時刻差とJST日付で部を分割する", () => {
  const may18LateJst = Math.floor(Date.UTC(2026, 4, 18, 14, 55) / 1000);
  const may19StartJst = Math.floor(Date.UTC(2026, 4, 18, 15, 0) / 1000);
  assert.equal(
    buildSlotParts(
      [
        { start_time: 100, sort_order: 1 },
        { start_time: 200, sort_order: 2 },
        { start_time: 5000, sort_order: 3 },
      ],
      30 * 60,
    ).length,
    2,
  );
  assert.equal(
    buildSlotParts(
      [
        { start_time: may18LateJst, sort_order: 1 },
        { start_time: may19StartJst, sort_order: 2 },
      ],
      30 * 60,
    ).length,
    2,
  );
});

test("areSlotsInSamePart: 件数枠は連続sort_orderだけを同じ部とする", () => {
  assert.equal(
    areSlotsInSamePart(
      { start_time: null, sort_order: 2 },
      { start_time: null, sort_order: 3 },
    ),
    true,
  );
  assert.equal(
    areSlotsInSamePart(
      { start_time: null, sort_order: 2 },
      { start_time: null, sort_order: 4 },
    ),
    false,
  );
});

test("buildSlotParts: 時刻なし枠もsort_orderの連続性でまとめる", () => {
  const parts = buildSlotParts([
    { start_time: 100, sort_order: 0 },
    { start_time: null, sort_order: 1 },
    { start_time: null, sort_order: 2 },
  ]);
  assert.equal(parts.length, 2);
  assert.equal(parts[1].is_timeless, true);
  assert.equal(parts[1].rows.length, 2);
});

test("collapseReservationGroups: グループ無し枠は個別行のまま", () => {
  const rows = [
    { ...baseSlot, id: "s1", start_time: 100, sort_order: 0 },
    { ...baseSlot, id: "s2", start_time: 300, sort_order: 1 },
  ];
  const output = collapseReservationGroups(rows);
  assert.equal(output.length, 2);
  assert.equal(output[0].is_group, false);
  assert.equal(output[0].group_size, 1);
  assert.deepEqual(output[0].slot_ids, ["s1"]);
});

test("collapseReservationGroups: reservation_group_id単位で集約する", () => {
  const rows = [
    {
      ...baseSlot,
      id: "s1",
      start_time: 100,
      sort_order: 0,
      group_key: "g1",
      status: "reserved",
      display_name: "Team",
    },
    {
      ...baseSlot,
      id: "s2",
      start_time: 200,
      sort_order: 1,
      group_key: "g1",
      status: "reserved",
      display_name: "Team",
    },
    { ...baseSlot, id: "s3", start_time: 500, sort_order: 2 },
  ];
  const output = collapseReservationGroups(rows);
  assert.equal(output.length, 2);
  const grouped = output.find((row) => row.group_id === "g1");
  assert.ok(grouped);
  assert.equal(grouped.is_group, true);
  assert.equal(grouped.group_size, 2);
  assert.equal(grouped.status, "reserved");
  assert.deepEqual(grouped.slot_ids, ["s1", "s2"]);
});

test("空入力は空配列", () => {
  assert.deepEqual(buildSlotParts([]), []);
  assert.deepEqual(collapseReservationGroups([]), []);
});
