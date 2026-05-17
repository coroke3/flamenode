/**
 * slotGrouping の sortSlotsChronologically / buildSlotParts / collapseReservationGroups の単体テスト。
 *
 * 注: formatSlotPartLabel は formatUnix (path alias 経由) に依存するため
 * このテストでは対象外。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sortSlotsChronologically,
  buildSlotParts,
  collapseReservationGroups,
} from "./slotGroupingCore.ts";

const baseSlot = {
  event_id: "ev1",
  slot_kind: "time",
  slot_label: null,
  status: "available",
  display_name: null,
  x_user_id: null,
  discord_user_id: null,
  video_id: null,
  updated_at: 0,
  priority_reclaim_video_id: null,
  priority_reclaim_until: null,
};

test("sortSlotsChronologically: time あり優先で昇順", () => {
  const r = sortSlotsChronologically([
    { id: "c", start_time: null, end_time: null, sort_order: 0 },
    { id: "a", start_time: 100, end_time: 200, sort_order: 0 },
    { id: "b", start_time: 50, end_time: 80, sort_order: 0 },
  ]);
  assert.deepEqual(r.map((x) => x.id), ["b", "a", "c"]);
});

test("sortSlotsChronologically: 同時刻は sort_order で安定化", () => {
  const r = sortSlotsChronologically([
    { id: "a", start_time: 100, end_time: 200, sort_order: 2 },
    { id: "b", start_time: 100, end_time: 200, sort_order: 1 },
  ]);
  assert.deepEqual(r.map((x) => x.id), ["b", "a"]);
});

test("buildSlotParts: 連続する枠は1パート、ギャップで分割", () => {
  const slots = [
    { start_time: 100, end_time: 200 },
    { start_time: 200, end_time: 300 },
    // 30分以上ギャップ
    { start_time: 5000, end_time: 5100 },
  ];
  const parts = buildSlotParts(slots, 30 * 60);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].rows.length, 2);
  assert.equal(parts[1].rows.length, 1);
});

test("buildSlotParts: gapSec 内ならまとめる", () => {
  const slots = [
    { start_time: 100, end_time: 200 },
    { start_time: 1000, end_time: 1100 }, // 800 秒間隔
  ];
  // gapSec=1000 ならまとまる、gapSec=500 なら分かれる
  assert.equal(buildSlotParts(slots, 1000).length, 1);
  assert.equal(buildSlotParts(slots, 500).length, 2);
});

test("buildSlotParts: 時間なし枠は最後に独立部として追加", () => {
  const slots = [
    { start_time: 100, end_time: 200 },
    { start_time: null, end_time: null },
    { start_time: null, end_time: null },
  ];
  const parts = buildSlotParts(slots);
  assert.equal(parts.length, 2);
  assert.equal(parts[1].is_timeless, true);
  assert.equal(parts[1].rows.length, 2);
});

test("buildSlotParts: 空入力は空配列", () => {
  assert.deepEqual(buildSlotParts([]), []);
});

test("collapseReservationGroups: グループ無し枠はそのまま", () => {
  const rows = [
    { ...baseSlot, id: "s1", start_time: 100, end_time: 200, sort_order: 0, reservation_group_id: null },
    { ...baseSlot, id: "s2", start_time: 300, end_time: 400, sort_order: 0, reservation_group_id: null },
  ];
  const out = collapseReservationGroups(rows);
  assert.equal(out.length, 2);
  assert.equal(out[0].is_group, false);
  assert.equal(out[0].group_size, 1);
});

test("collapseReservationGroups: 同 group_id の枠は 1 行に集約", () => {
  const rows = [
    { ...baseSlot, id: "s1", start_time: 100, end_time: 200, sort_order: 0, reservation_group_id: "g1" },
    { ...baseSlot, id: "s2", start_time: 200, end_time: 300, sort_order: 0, reservation_group_id: "g1" },
    { ...baseSlot, id: "s3", start_time: 300, end_time: 400, sort_order: 0, reservation_group_id: "g1" },
    { ...baseSlot, id: "s4", start_time: 500, end_time: 600, sort_order: 0, reservation_group_id: null },
  ];
  const out = collapseReservationGroups(rows);
  assert.equal(out.length, 2);
  const grouped = out.find((r) => r.group_id === "g1");
  assert.ok(grouped);
  assert.equal(grouped.is_group, true);
  assert.equal(grouped.group_size, 3);
  assert.deepEqual(grouped.slot_ids.sort(), ["s1", "s2", "s3"]);
});

test("collapseReservationGroups: 空入力は空配列", () => {
  assert.deepEqual(collapseReservationGroups([]), []);
});
