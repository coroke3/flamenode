import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sortSlotsChronologically,
  areSlotsInSamePart,
  buildSlotParts,
  collapseReservationGroups,
  annotateReservationGroups,
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
  assert.deepEqual(annotateReservationGroups([]), []);
});

const annotateSolo = (id, overrides = {}) => ({
  ...baseSlot,
  id,
  start_time: 100,
  sort_order: 0,
  ...overrides,
});

test("annotateReservationGroups: 単独枠はgroupなし1枠", () => {
  const rows = [annotateSolo("s1")];
  const output = annotateReservationGroups(rows);
  assert.equal(output.length, 1);
  assert.equal(output[0].group_id, null);
  assert.equal(output[0].group_size, 1);
  assert.equal(output[0].group_position, 1);
  assert.deepEqual(output[0].slot_ids, ["s1"]);
  assert.equal(output[0].group_first_slot_id, "s1");
  assert.equal(output[0].group_last_slot_id, "s1");
  assert.equal(output[0].is_group, false);
});

test("annotateReservationGroups: 連続groupの各枠にpositionを付与する", () => {
  const makeGroup = (count, groupKey = "g1") =>
    Array.from({ length: count }, (_, index) => ({
      ...baseSlot,
      id: `s${index + 1}`,
      start_time: 100 + index * 100,
      sort_order: index,
      group_key: groupKey,
      status: "reserved",
    }));

  for (const count of [2, 3, 5, 10, 20]) {
    const rows = makeGroup(count);
    const output = annotateReservationGroups(rows);
    assert.equal(output.length, count, `count=${count}`);
    assert.equal(output[0].group_size, count);
    assert.equal(output[0].group_position, 1);
    assert.equal(output.at(-1).group_position, count);
    assert.equal(output[0].group_first_slot_id, "s1");
    assert.equal(output.at(-1).group_last_slot_id, `s${count}`);
    assert.equal(output[0].is_group, count > 1);
    for (const row of output) {
      assert.deepEqual(
        row.slot_ids,
        rows.map((candidate) => candidate.id),
      );
    }
  }
});

test("annotateReservationGroups: 隣接する別groupは独立に注釈する", () => {
  const rows = [
    {
      ...baseSlot,
      id: "a1",
      start_time: 100,
      sort_order: 0,
      group_key: "g1",
      status: "reserved",
    },
    {
      ...baseSlot,
      id: "a2",
      start_time: 200,
      sort_order: 1,
      group_key: "g1",
      status: "reserved",
    },
    { ...baseSlot, id: "b1", start_time: 300, sort_order: 2 },
    {
      ...baseSlot,
      id: "c1",
      start_time: 400,
      sort_order: 3,
      group_key: "g2",
      status: "reserved",
    },
    {
      ...baseSlot,
      id: "c2",
      start_time: 500,
      sort_order: 4,
      group_key: "g2",
      status: "reserved",
    },
  ];
  const output = annotateReservationGroups(rows);
  assert.equal(output.length, 5);
  assert.deepEqual(
    output.filter((row) => row.group_id === "g1").map((row) => row.id),
    ["a1", "a2"],
  );
  assert.deepEqual(
    output.filter((row) => row.group_id === "g2").map((row) => row.id),
    ["c1", "c2"],
  );
  assert.equal(output.find((row) => row.id === "b1").group_id, null);
});

test("annotateReservationGroups: 同名表示でもgroup_keyが違えば別group", () => {
  const rows = [
    {
      ...baseSlot,
      id: "s1",
      start_time: 100,
      sort_order: 0,
      group_key: "g1",
      display_name: "Team A",
      status: "reserved",
    },
    {
      ...baseSlot,
      id: "s2",
      start_time: 200,
      sort_order: 1,
      group_key: "g2",
      display_name: "Team A",
      status: "reserved",
    },
  ];
  const output = annotateReservationGroups(rows);
  assert.equal(output.length, 2);
  assert.equal(output[0].group_id, "g1");
  assert.equal(output[1].group_id, "g2");
  assert.equal(output[0].is_group, false);
  assert.equal(output[1].is_group, false);
});

test("annotateReservationGroups: submitted groupも全行を返す", () => {
  const rows = [
    {
      ...baseSlot,
      id: "s1",
      start_time: 100,
      sort_order: 0,
      group_key: "g1",
      status: "submitted",
    },
    {
      ...baseSlot,
      id: "s2",
      start_time: 200,
      sort_order: 1,
      group_key: "g1",
      status: "submitted",
    },
  ];
  const output = annotateReservationGroups(rows);
  assert.equal(output.length, 2);
  assert.equal(output[0].status, "submitted");
  assert.equal(output[1].status, "submitted");
  assert.equal(output[0].group_size, 2);
});

test("annotateReservationGroups: 逆順入力でも時系列順に全行返す", () => {
  const rows = [
    {
      ...baseSlot,
      id: "s3",
      start_time: 300,
      sort_order: 2,
      group_key: "g1",
      status: "reserved",
    },
    {
      ...baseSlot,
      id: "s1",
      start_time: 100,
      sort_order: 0,
      group_key: "g1",
      status: "reserved",
    },
    {
      ...baseSlot,
      id: "s2",
      start_time: 200,
      sort_order: 1,
      group_key: "g1",
      status: "reserved",
    },
  ];
  const output = annotateReservationGroups(rows);
  assert.equal(output.length, 3);
  assert.deepEqual(
    output.map((row) => row.id),
    ["s1", "s2", "s3"],
  );
  assert.deepEqual(
    output.map((row) => row.group_position),
    [1, 2, 3],
  );
});

test("annotateReservationGroups: 件数枠(null start_time)も全行返す", () => {
  const rows = [
    {
      ...baseSlot,
      id: "s1",
      start_time: null,
      sort_order: 1,
      group_key: "g1",
      status: "reserved",
    },
    {
      ...baseSlot,
      id: "s2",
      start_time: null,
      sort_order: 2,
      group_key: "g1",
      status: "reserved",
    },
    { ...baseSlot, id: "s3", start_time: null, sort_order: 3 },
  ];
  const output = annotateReservationGroups(rows);
  assert.equal(output.length, 3);
  assert.equal(output[0].group_size, 2);
  assert.equal(output[2].group_id, null);
});
