import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { groupDisplaySlots, partLabels } from "../.test-dist/apps/ops/src/routes/manage/slotParts.js";
import { SlotList, slotStatusLabel, slotTimeLabel } from "../.test-dist/apps/ops/src/routes/manage/SlotList.js";
import { EventSlots, EventSlotsView } from "../.test-dist/apps/ops/src/routes/manage/EventSlots.js";

const slot = (id, opts = {}) => ({
  id, event_id: "ev id", slot_label: null, start_time: null, sort_order: 0,
  status: "available", display_name: null, x_user_id: null,
  reserved_x_id_snapshot: null, reserved_by_user_id: null,
  discord_display_name: null, discord_id: null,
  reservation_group_id: null, video_id: null, updated_at: 1700000000, version: 1,
  ...opts,
});
const data = (opts = {}) => ({
  event: { id: "ev id", title: "Example <Event>", accent_color: null,
    slot_part_gap_minutes: 15, parts: ["午前", "午後"] },
  isAdmin: false, statusFilter: "all", offset: 0, pageSize: 100,
  pendingCount: 4, total: 3,
  counts: { available: 1, reserved: 1, submitted: 1 },
  slots: [
    slot("s1", { status: "available", start_time: 1700000000, sort_order: 1 }),
    slot("s2", { status: "reserved", start_time: 1700000060, sort_order: 2,
      display_name: "User <name>", reserved_x_id_snapshot: "x_name",
      discord_display_name: "Discord Name", discord_id: "1234" }),
    slot("s3", { status: "submitted", start_time: null, sort_order: 3,
      slot_label: "No.3", video_id: "vid/a?&" }),
  ],
  atLimit: false, ...opts,
});
const render = node => renderToStaticMarkup(React.createElement(MemoryRouter, null, node));

test("MIG-0722 U02a: CURRENT JST part boundaries and gap grouping are preserved", () => {
  const d = seconds => Math.floor(new Date(seconds).getTime() / 1000);
  const dayOne = d("2026-10-30T14:59:00Z"); // 23:59 JST
  const nextDay = d("2026-10-30T15:00:00Z"); // 00:00 JST next day
  const rows = [
    slot("one", { start_time: dayOne, sort_order: 1 }),
    slot("two", { start_time: nextDay, sort_order: 2 }),
    slot("three", { start_time: nextDay + 300, sort_order: 3 }),
    slot("four", { start_time: null, sort_order: 5 }),
    slot("five", { start_time: null, sort_order: 6 }),
    slot("six", { start_time: null, sort_order: 8 }),
  ];
  const parts = groupDisplaySlots(rows, 15);
  assert.deepEqual(parts.map(p => p.rows.map(r => r.id)),
    [["one"], ["two", "three"], ["four", "five"], ["six"]]);
  assert.deepEqual([...partLabels(rows, 15, ["第1回", "第2回"]).entries()],
    [["one", "第1回"], ["two", "第2回"], ["three", "第2回"],
      ["four", "件数枠"], ["five", "件数枠"], ["six", "件数枠"]]);
  assert.deepEqual(groupDisplaySlots(rows, -1).map(p => p.rows.length),
    [1, 2, 2, 1], "invalid gap defaults to CURRENT 15min");
});

test("MIG-0722 U02a: safe read-only slot table renders CURRENT holder fields, status and video link", () => {
  const current = data();
  const html = render(React.createElement(SlotList, {
    eventId: "ev id", slots: current.slots,
    partGapMinutes: 15, parts: current.event.parts,
  }));
  assert.match(html, /User &lt;name&gt;/);
  assert.match(html, /X ID/);
  assert.match(html, /@x_name/);
  assert.match(html, /Discord Name/);
  assert.match(html, /1234/);
  assert.match(html, /空き/);
  assert.match(html, /確保済/);
  assert.match(html, /提出済/);
  assert.match(html, /件数枠/);
  assert.match(html, /\/manage\/events\/ev%20id\/videos\/vid%2Fa%3F%26/);
  assert.match(html, /横スクロール可能/);
  assert.doesNotMatch(html, /<button|<input|全削除する|強制解放する/);
  assert.match(html, /編集・削除機能は移行中/);
  const empty = render(React.createElement(SlotList, {
    eventId: "ev id", slots: [], partGapMinutes: null, parts: [],
  }));
  assert.match(empty, /枠はまだありません/);
  for (const status of ["constructor", "__proto__", "unknown"]) assert.equal(slotStatusLabel(status), "不明");
  assert.equal(slotStatusLabel("reserved"), "確保済");
  assert.equal(slotTimeLabel(slot("a", { slot_label: "No. 1" })), "No. 1");
});

test("MIG-0722 U02a: filter nav, counts, encoded URLs, 500 cap and XSS-safe title", () => {
  const current = data({ atLimit: true });
  const html = render(React.createElement(EventSlotsView, {
    eventId: "ev id", status: "reserved", data: current,
  }));
  assert.match(html, /Example &lt;Event&gt;/);
  assert.match(html, /全3件中、最大500件/);
  assert.match(html, /最大500件まで表示/);
  assert.match(html, /\/manage\/events\/ev%20id\/slots\?status=reserved/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /空き/);
  assert.match(html, /確保済/);
  assert.match(html, /提出済/);
  assert.match(html, /枠一覧 \(3\)/);
  const filterCount = (html.match(/manage-slot-stat-value/g) ?? []).length;
  assert.equal(filterCount, 4);
  const noSlots = render(React.createElement(EventSlotsView, {
    eventId: "ev id", status: "bad", data: data({ total: 0, slots: [], atLimit: false,
      counts: {} }),
  }));
  assert.match(noSlots, /枠はまだありません/);
  assert.doesNotMatch(noSlots, /最大500件まで表示しています/);
});

test("MIG-0722 U02a: mounted page starts with a loading guard and no cached private rows in SSR", () => {
  const html = render(React.createElement(EventSlots, { eventId: "ev id" }));
  assert.match(html, /枠を読み込み中/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /Example|User|管理者/);
});
