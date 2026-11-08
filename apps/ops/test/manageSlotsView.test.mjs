import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { groupDisplaySlots, partLabels } from "../.test-dist/apps/ops/src/routes/manage/slotParts.js";
import { SlotList, slotStatusLabel, slotTimeLabel, validateSlotListOperation } from "../.test-dist/apps/ops/src/routes/manage/SlotList.js";
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
  for (const seconds of [1e20, -1e20, Infinity, -Infinity, NaN]) {
    // Malformed API date values must not throw RangeError during render.
    assert.equal(slotTimeLabel(slot("bad", {
      start_time: seconds, slot_label: "不明な日時",
    })), "不明な日時");
    const fallback = render(React.createElement(SlotList, {
      eventId: "ev id", slots: [slot("bad", { start_time: seconds })],
      partGapMinutes: 15, parts: [],
    }));
    assert.match(fallback, /—/);
    assert.doesNotMatch(fallback, /Invalid time value/);
  }
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

test("MIG-0722 U02a: malformed video ID cannot crash the slot list or hide other valid links", () => {
  const html = render(React.createElement(SlotList, {
    eventId: "ev id",
    slots: [
      slot("broken-high", { video_id: "\uD800" }),
      slot("broken-low", { video_id: "\uDC00" }),
      slot("good", { video_id: "video/a?&" }),
    ],
    partGapMinutes: 15,
    parts: [],
  }));
  assert.equal((html.match(/作品を見る/g) ?? []).length, 1);
  assert.match(html, /\/manage\/events\/ev%20id\/videos\/video%2Fa%3F%26/);
  assert.match(html, /枠の状態と取得者を表示しています/);
});

test("MIG-0722 U02b-2: command planner validates event, visible slot status, permissions and atomic cap", () => {
  const rows = [
    slot("available", { event_id: "ev1", status: "available" }),
    slot("reserved", { event_id: "ev1", status: "reserved" }),
    slot("submitted", { event_id: "ev1", status: "submitted" }),
    slot("foreign", { event_id: "ev2", status: "available" }),
    slot("unknown", { event_id: "ev1", status: "unknown" }),
  ];
  const check = (operation, submitted = false) =>
    validateSlotListOperation(rows, "ev1", operation, submitted);
  assert.equal(check({ kind: "delete", slotId: "available" }), true);
  assert.equal(check({ kind: "release", slotId: "reserved" }), true);
  assert.equal(check({ kind: "release", slotId: "available" }), false);
  assert.equal(check({ kind: "delete", slotId: "reserved" }), false);
  assert.equal(check({ kind: "delete", slotId: "foreign" }), false);
  assert.equal(check({ kind: "delete", slotId: "not-found" }), false);
  assert.equal(check({ kind: "delete", slotId: "unknown" }), false);
  assert.equal(check({ kind: "unknown-action", slotId: "submitted" }, true), false);
  assert.equal(check({ kind: "unknown-action", slotIds: ["available"] }), false);
  for (const kind of ["force-release-submitted", "release-submitted-video"]) {
    assert.equal(check({ kind, slotId: "submitted" }), false);
    assert.equal(check({ kind, slotId: "submitted" }, true), true);
    assert.equal(check({ kind, slotId: "reserved" }, true), false);
  }
  assert.equal(check({ kind: "batch-delete", slotIds: ["available"] }), true);
  assert.equal(check({ kind: "batch-release", slotIds: ["reserved"] }), true);
  assert.equal(check({ kind: "batch-delete", slotIds: ["reserved"] }), false);
  assert.equal(check({ kind: "batch-release", slotIds: ["available"] }), false);
  assert.equal(check({ kind: "batch-delete", slotIds: [] }), false);
  assert.equal(check({ kind: "batch-delete", slotIds: ["available", "available"] }), false);
  assert.equal(check({ kind: "batch-delete", slotIds: ["available", "foreign"] }), false);
  assert.equal(check({ kind: "batch-label", slotIds: ["available", "reserved", "submitted"], label: "New" }), true);
  assert.equal(check({ kind: "batch-label", slotIds: ["available", "reserved", "submitted", "foreign"], label: "New" }), false);
  assert.equal(check({ kind: "batch-label", slotIds: ["available"], label: " " }), false);
  assert.equal(check({ kind: "batch-label", slotIds: ["available"], label: "x".repeat(200) }), true);
  assert.equal(check({ kind: "batch-label", slotIds: ["available"], label: "x".repeat(201) }), false);
});

test("MIG-0722 U02b-2: injected handler alone enables selection and confirmations; SSR makes no writes", () => {
  let writes = 0;
  const onAction = async () => { writes++; return { ok: true }; };
  const sample = data();
  const safe = render(React.createElement(SlotList, {
    eventId: "ev id", slots: sample.slots,
    partGapMinutes: 15, parts: sample.event.parts,
    onAction,
  }));
  assert.match(safe, /すべて選択/);
  assert.match(safe, /枠一覧（横スクロール可能）/);
  assert.match(safe, /操作/);
  assert.match(safe, /解放/);
  assert.match(safe, /削除/);
  assert.doesNotMatch(safe, /強制解放|作品のみ解放|枠操作の確認/);
  assert.equal(writes, 0);
  const admin = render(React.createElement(SlotList, {
    eventId: "ev id", slots: sample.slots,
    partGapMinutes: 15, parts: sample.event.parts,
    onAction, canManageSubmittedSlots: true,
  }));
  assert.match(admin, /強制解放/);
  assert.match(admin, /作品のみ解放/);
  assert.equal(writes, 0);
  const foreign = render(React.createElement(SlotList, {
    eventId: "ev id", slots: [
      slot("foreign", { event_id: "other", status: "available" }),
      slot("unknown", { status: "mystery" }),
    ],
    partGapMinutes: 15, parts: [], onAction,
  }));
  assert.doesNotMatch(foreign, /強制解放|作品のみ解放/);
  assert.equal(writes, 0);
});

async function withSlotDom(callback) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://flamenode.test/manage/events/ev%20id/slots",
  });
  const keys = ["window", "document", "Element", "HTMLElement", "Node", "navigator"];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const priorAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  for (const key of keys) Object.defineProperty(globalThis, key, {
    configurable: true, writable: true, value: dom.window[key],
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  try { await callback(dom, root); }
  finally {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = priorAct;
    dom.window.close();
  }
}

test("MIG-0722 U02b-2: actual UI confirms before callback, cancels and blocks >3 selection", async () => {
  await withSlotDom(async (dom, root) => {
    const calls = [];
    const rows = [0, 1, 2, 3].map(index =>
      slot("a" + index, { status: "available", event_id: "ev id" }));
    const onAction = async operation => {
      calls.push(operation);
      return { ok: true, message: "変更完了" };
    };
    const view = React.createElement(MemoryRouter, null, React.createElement(SlotList, {
      eventId: "ev id", slots: rows, partGapMinutes: 15, parts: [], onAction,
    }));
    await React.act(async () => root.render(view));
    const findButton = text => [...dom.window.document.querySelectorAll("button")]
      .find(button => button.textContent.trim() === text);
    await React.act(async () => findButton("削除").click());
    assert.equal(calls.length, 0, "clicking a destructive row operation must only open confirmation");
    assert.ok(dom.window.document.querySelector('[aria-label="枠操作の確認"]'));
    await React.act(async () => findButton("キャンセル").click());
    assert.equal(calls.length, 0);
    assert.equal(dom.window.document.querySelector('[aria-label="枠操作の確認"]'), null);
    await React.act(async () => findButton("削除").click());
    await React.act(async () => findButton("実行する").click());
    assert.deepEqual(calls, [{ kind: "delete", slotId: "a0" }]);
    assert.match(dom.window.document.body.textContent, /変更完了/);

    const selectAll = dom.window.document.querySelector('input[aria-label="すべて選択"]');
    await React.act(async () => selectAll.click());
    assert.equal(selectAll.checked, true);
    assert.ok(findButton("空き枠を削除 (4)").disabled, "max-3 atomic boundary must disable bulk operation");
    assert.ok(findButton("ラベル変更").disabled);
    assert.equal(calls.length, 1, "disabled batch controls must not invoke writes");
  });
});
