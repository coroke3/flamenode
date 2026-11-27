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
    // Hono/SQLite order: untimed NULL first, then numeric start_time/sort_order.
    slot("s3", { status: "submitted", start_time: null, sort_order: 3,
      slot_label: "No.3", video_id: "vid/a?&" }),
    slot("s1", { status: "available", start_time: 1700000000, sort_order: 1 }),
    slot("s2", { status: "reserved", start_time: 1700000060, sort_order: 2,
      display_name: "User <name>", reserved_x_id_snapshot: "x_name",
      discord_display_name: "Discord Name", discord_id: "1234" }),
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

test("MIG-0722 U02a: filter nav, counts, encoded URLs, CURRENT cap description and XSS-safe title", () => {
  const current = data();
  const html = render(React.createElement(EventSlotsView, {
    eventId: "ev id", status: "reserved", data: current,
  }));
  assert.match(html, /Example &lt;Event&gt;/);
  assert.match(html, /全3件中、最大500件/);
  assert.doesNotMatch(html, /最大500件まで表示しています|条件を絞り込んでください/);
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

test("MIG-0722 U02b-6: EventSlotsView composes injected forms and actions only with complete callbacks", () => {
  let invoked = 0;
  const writeActions = {
    onGenerate: async () => { invoked++; return { ok: true }; },
    onClearAvailable: async () => { invoked++; return { ok: true }; },
    onAction: async () => { invoked++; return { ok: true }; },
    canManageSubmittedSlots: true,
  };
  const current = data();
  const noWrites = render(React.createElement(EventSlotsView, {
    eventId: "ev id", status: "all", data: current,
  }));
  assert.doesNotMatch(noWrites, /一括生成|空き枠を全削除|すべて選択/);
  assert.match(noWrites, /編集・削除機能は移行中/);

  const partial = render(React.createElement(EventSlotsView, {
    eventId: "ev id", status: "all", data: current,
    writeActions: { onAction: writeActions.onAction },
  }));
  assert.doesNotMatch(partial, /一括生成|空き枠を全削除|すべて選択/);

  const injected = render(React.createElement(EventSlotsView, {
    eventId: "ev id", status: "all", data: current, writeActions,
  }));
  assert.match(injected, /枠を追加・一括編集/);
  assert.match(injected, /一括生成/);
  assert.match(injected, /空き枠を全削除/);
  assert.match(injected, /すべて選択/);
  assert.match(injected, /削除/);
  assert.match(injected, /強制解放|作品のみ解放/,
    "CURRENT grants submitted-slot actions to authorized event.slots staff, not only admins");
  const noSubmittedPermission = render(React.createElement(EventSlotsView, {
    eventId: "ev id", status: "all", data: current,
    writeActions: { ...writeActions, canManageSubmittedSlots: false },
  }));
  assert.doesNotMatch(noSubmittedPermission, /強制解放|作品のみ解放/,
    "submitted actions require an explicit injected write capability");
  const admin = render(React.createElement(EventSlotsView, {
    eventId: "ev id", status: "all", data: data({ isAdmin: true }), writeActions,
  }));
  assert.match(admin, /強制解放/);
  assert.match(admin, /作品のみ解放/);
  const empty = render(React.createElement(EventSlotsView, {
    eventId: "ev id", status: "all", data: data({
      slots: [], total: 0, counts: { available: 0, reserved: 0, submitted: 0 },
    }), writeActions,
  }));
  assert.match(empty, /枠がまだないため、一括生成フォーム/);
  assert.doesNotMatch(empty, /枠の追加機能は移行中/);
  assert.equal(invoked, 0, "SSR is not permitted to invoke any injected write");
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
  assert.doesNotMatch(safe, /強制解放|作品のみ解放|alertdialog/);
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
    assert.ok(dom.window.document.querySelector('.manage-slot-list [role="alertdialog"]'));
    await React.act(async () => findButton("キャンセル").click());
    assert.equal(calls.length, 0);
    assert.equal(dom.window.document.querySelector('.manage-slot-list [role="alertdialog"]'), null);
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

test("MIG-0722 U02b-2: filter and event changes discard stale selections and pending destructive actions", async () => {
  await withSlotDom(async (dom, root) => {
    let writes = 0;
    const onAction = async () => { writes++; return { ok: true }; };
    const a = slot("a", { event_id: "ev id", status: "available" });
    const b = slot("b", { event_id: "ev id", status: "reserved" });
    const renderList = (eventId, rows) => React.createElement(MemoryRouter, null,
      React.createElement(SlotList, {
        eventId, slots: rows, partGapMinutes: 15, parts: [], onAction,
      }));
    await React.act(async () => root.render(renderList("ev id", [a, b])));
    const checkbox = dom.window.document.querySelector('input[aria-label="枠 a を選択"]');
    assert.ok(checkbox);
    await React.act(async () => checkbox.click());
    assert.match(dom.window.document.body.textContent, /1件選択中/);
    const deleteButton = [...dom.window.document.querySelectorAll("button")]
      .find(button => button.textContent.trim() === "削除");
    await React.act(async () => deleteButton.click());
    assert.ok(dom.window.document.querySelector('.manage-slot-list [role="alertdialog"]'));

    // Simulate a status filter response reusing the same mounted component.
    await React.act(async () => root.render(renderList("ev id", [b])));
    assert.equal(dom.window.document.querySelector('.manage-slot-list [role="alertdialog"]'), null);
    assert.doesNotMatch(dom.window.document.body.textContent, /1件選択中/);
    await React.act(async () => root.render(renderList("ev id", [a, b])));
    const fresh = dom.window.document.querySelector('input[aria-label="枠 a を選択"]');
    assert.equal(fresh.checked, false, "previously selected row must stay unselected");

    await React.act(async () => fresh.click());
    assert.match(dom.window.document.body.textContent, /1件選択中/);
    await React.act(async () => root.render(renderList("another-event", [
      slot("a", { event_id: "another-event" }),
    ])));
    const other = dom.window.document.querySelector('input[aria-label="枠 a を選択"]');
    assert.equal(other.checked, false, "even matching row IDs do not carry selection across events");
    assert.equal(writes, 0);
  });
});

test("MIG-0722 U02b: old in-flight slot mutation must not display on a different event", async () => {
  for (const outcome of ["success", "reject"]) {
    await withSlotDom(async (dom, root) => {
      let settle;
      const calls = [];
      let changed = 0;
      const onAction = op => {
        calls.push(op);
        return new Promise((resolve, reject) => {
          settle = outcome === "success" ? resolve : reject;
        });
      };
      const view = (eventId, rows) => React.createElement(MemoryRouter, null,
        React.createElement(SlotList, {
          eventId, slots: rows, partGapMinutes: 15, parts: [], onAction,
          onChanged: () => { changed++; },
        }));
      const first = [slot("shared", { event_id: "old-event", status: "available" })];
      await React.act(async () => root.render(view("old-event", first)));
      const findButton = label => [...dom.window.document.querySelectorAll("button")]
        .find(button => button.textContent.trim() === label);
      await React.act(async () => findButton("削除").click());
      assert.ok(dom.window.document.querySelector('.manage-slot-list [role="alertdialog"]'));
      await React.act(async () => findButton("実行する").click());
      assert.deepEqual(calls, [{ kind: "delete", slotId: "shared" }]);
      assert.equal(changed, 0);
      const second = [slot("shared", { event_id: "new-event", status: "available" })];
      await React.act(async () => root.render(view("new-event", second)));
      assert.equal(dom.window.document.querySelector('.manage-slot-list [role="alertdialog"]'), null);
      await React.act(async () => {
        if (outcome === "success") settle({ ok: true, message: "OLD-SUCCESS" });
        else settle(new Error("OLD-ERROR"));
      });
      assert.doesNotMatch(dom.window.document.body.textContent, /OLD-SUCCESS|通信エラー/);
      assert.equal(changed, 0, "stale response cannot refresh another event");
      assert.ok(findButton("削除"), "new event controls remain available");
    });
  }
});

test("MIG-0722 U02b-5: A-B-A slot context generation rejects original mutation result", async () => {
  await withSlotDom(async (dom, root) => {
    const rowsA = [slot("shared", { event_id: "A", status: "available" })];
    const rowsB = [slot("shared", { event_id: "B", status: "available" })];
    let settle;
    let writes = 0, refreshes = 0;
    const onAction = () => {
      writes++;
      return new Promise(resolve => { settle = resolve; });
    };
    const onChanged = () => { refreshes++; };
    const renderList = (eventId, rows) => React.createElement(MemoryRouter, null,
      React.createElement(SlotList, {
        eventId, slots: rows, partGapMinutes: 15, parts: [], onAction, onChanged,
      }));
    const button = label => [...dom.window.document.querySelectorAll("button")]
      .find(el => el.textContent.trim() === label);
    await React.act(async () => root.render(renderList("A", rowsA)));
    await React.act(async () => button("削除").click());
    await React.act(async () => button("実行する").click());
    assert.equal(writes, 1);
    await React.act(async () => root.render(renderList("B", rowsB)));
    await React.act(async () => root.render(renderList("A", rowsA)));
    await React.act(async () => settle({ ok: true, message: "STALE-A" }));
    assert.equal(refreshes, 0);
    assert.doesNotMatch(dom.window.document.body.textContent, /STALE-A/);
    assert.equal(writes, 1);
  });
});

test("MIG-0722 U02b-7: unmount invalidates pending slot action response", async () => {
  await withSlotDom(async (dom, root) => {
    let settle;
    let refreshed = 0;
    const onAction = () => new Promise(resolve => { settle = resolve; });
    const rows = [slot("a", { event_id: "ev id", status: "available" })];
    await React.act(async () => root.render(React.createElement(MemoryRouter, null,
      React.createElement(SlotList, {
        eventId: "ev id", slots: rows, partGapMinutes: 15, parts: [], onAction,
        onChanged: () => { refreshed++; },
      }))));
    const click = label => [...dom.window.document.querySelectorAll("button")]
      .find(button => button.textContent.trim() === label).click();
    await React.act(async () => click("削除"));
    await React.act(async () => click("実行する"));
    assert.equal(typeof settle, "function", "write callback started");
    await React.act(async () => root.render(React.createElement("p", null, "離脱済み")));
    await React.act(async () => settle({ ok: true, message: "OLD-SUCCESS" }));
    assert.equal(refreshed, 0, "unmounted view must not refresh");
    assert.doesNotMatch(dom.window.document.body.textContent, /OLD-SUCCESS/);
  });
});

test("MIG-0722 U02b-8: permission-loss refetch hides previous private slots and actions", async () => {
  await withSlotDom(async (dom, root) => {
    let requests = 0;
    let replyRevoked;
    const fetchFn = async () => {
      requests++;
      if (requests === 1) {
        return new Response(JSON.stringify(data()), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Promise(resolve => { replyRevoked = resolve; });
    };
    const operations = [];
    const writeActions = {
      onGenerate: async () => ({ ok: true }),
      onClearAvailable: async () => ({ ok: true }),
      onAction: async operation => {
        operations.push(operation);
        return { ok: true, message: "成功" };
      },
    };
    await React.act(async () => root.render(React.createElement(MemoryRouter, null,
      React.createElement(EventSlots, {
        eventId: "ev id", fetchFn, writeActions,
      }))));
    // Response.json() is async; advance the event loop until React has
    // committed the first authorized read.
    for (let attempt = 0; attempt < 6 &&
         !dom.window.document.body.textContent.includes("User <name>"); attempt++) {
      await React.act(async () => { await new Promise(resolve => setImmediate(resolve)); });
    }
    assert.match(dom.window.document.body.textContent, /User <name>/);
    const findButton = label => [...dom.window.document.querySelectorAll("button")]
      .find(button => button.textContent.trim() === label);
    await React.act(async () => findButton("削除").click());
    await React.act(async () => findButton("実行する").click());
    assert.equal(operations.length, 1);
    assert.equal(requests, 2, "a successful injected action must trigger one re-fetch");
    assert.equal(typeof replyRevoked, "function", "revoked request must be held in flight");
    assert.match(dom.window.document.body.textContent, /枠を読み込み中/);
    assert.doesNotMatch(dom.window.document.body.textContent, /User <name>|枠を追加・一括編集/);
    await React.act(async () => replyRevoked(new Response(null, { status: 403 })));
    assert.match(dom.window.document.body.textContent, /権限がありません/);
    assert.doesNotMatch(dom.window.document.body.textContent, /User <name>|すべて選択|一括生成/);
  });
});

test("MIG-0722 U02b-9: submitted-slot capability revocation invalidates pending and in-flight results", async () => {
  await withSlotDom(async (dom, root) => {
    const slots = [slot("submitted", { status: "submitted", event_id: "ev id" })];
    const calls = [];
    let settle, changed = 0;
    const onAction = op => {
      calls.push(op);
      return new Promise(resolve => { settle = resolve; });
    };
    const onChanged = () => { changed++; };
    const view = permitted => React.createElement(MemoryRouter, null,
      React.createElement(SlotList, {
        eventId: "ev id", slots, partGapMinutes: 15, parts: [], onAction, onChanged,
        canManageSubmittedSlots: permitted,
      }));
    const button = label => [...dom.window.document.querySelectorAll("button")]
      .find(element => element.textContent.trim() === label);

    await React.act(async () => root.render(view(true)));
    assert.ok(button("強制解放"), "authorized event.slots staff has submitted actions");
    await React.act(async () => button("強制解放").click());
    assert.ok(dom.window.document.querySelector('.manage-slot-list [role="alertdialog"]'));
    await React.act(async () => root.render(view(false)));
    assert.equal(dom.window.document.querySelector('.manage-slot-list [role="alertdialog"]'), null,
      "revoking permission invalidates an unconfirmed destructive action");
    assert.equal(button("強制解放"), undefined);
    assert.equal(calls.length, 0, "unconfirmed operation was never issued");

    await React.act(async () => root.render(view(true)));
    await React.act(async () => button("強制解放").click());
    await React.act(async () => button("強制解放する").click());
    assert.deepEqual(calls, [{ kind: "force-release-submitted", slotId: "submitted" }]);
    assert.equal(typeof settle, "function");
    await React.act(async () => root.render(view(false)));
    await React.act(async () => settle({ ok: true, message: "OLD-PERMISSION-SUCCESS" }));
    assert.equal(changed, 0, "stale callback must not refresh a revoked context");
    assert.doesNotMatch(dom.window.document.body.textContent, /OLD-PERMISSION-SUCCESS/);
    assert.equal(button("強制解放"), undefined);
  });
});

test("MIG-0722 U02b-10: new list operations own their lock after event or capability rotation", async () => {
  for (const scenario of ["event", "A-B-A", "adapter", "capability"]) {
    for (const rejectOld of [false, true]) {
      await withSlotDom(async (dom, root) => {
        const rowsA = [
          slot("available", { event_id: "A", status: "available" }),
          slot("submitted", { event_id: "A", status: "submitted" }),
        ];
        const rowsB = [slot("available", { event_id: "B", status: "available" })];
        const calls = [];
        const pending = [];
        let refreshes = 0;
        const port = name => operation => {
          calls.push({ name, operation });
          return new Promise((resolve, reject) => pending.push({ resolve, reject }));
        };
        const a = port("A");
        const b = port("B");
        const onChanged = () => { refreshes++; };
        const view = (eventId, slots, onAction, permitted) => React.createElement(MemoryRouter, null,
          React.createElement(SlotList, {
            eventId, slots, partGapMinutes: 15, parts: [], onAction, onChanged,
            canManageSubmittedSlots: permitted,
          }));
        const button = label => [...dom.window.document.querySelectorAll("button")]
          .find(el => el.textContent.trim() === label);
        await React.act(async () => root.render(view("A", rowsA, a, true)));
        await React.act(async () => button(scenario === "capability" ? "強制解放" : "削除").click());
        await React.act(async () => button(scenario === "capability" ? "強制解放する" : "実行する").click());
        assert.equal(calls.length, 1);
        assert.equal(button("削除").disabled, true);

        if (scenario === "A-B-A") {
          await React.act(async () => root.render(view("B", rowsB, b, true)));
          await React.act(async () => root.render(view("A", rowsA, a, true)));
        } else if (scenario === "capability") {
          await React.act(async () => root.render(view("A", rowsA, a, false)));
          assert.equal(button("強制解放"), undefined, "revoked submitted controls stay hidden");
        } else if (scenario === "adapter") {
          await React.act(async () => root.render(view("A", rowsA, b, true)));
        } else {
          await React.act(async () => root.render(view("B", rowsB, b, true)));
        }
        assert.equal(button("削除").disabled, false, scenario + " must not inherit the old lock");
        await React.act(async () => button("削除").click());
        await React.act(async () => {
          const confirm = button("実行する");
          confirm.click();
          confirm.click();
        });
        assert.equal(calls.length, 2);
        assert.deepEqual(calls[1].operation, { kind: "delete", slotId: "available" });
        assert.equal(button("削除").disabled, true);
        await React.act(async () => {
          if (rejectOld) pending[0].reject(new Error("OLD-ERROR"));
          else pending[0].resolve({ ok: true, message: "OLD-SUCCESS" });
        });
        assert.equal(refreshes, 0);
        assert.doesNotMatch(dom.window.document.body.textContent, /OLD-SUCCESS|通信エラー/);
        assert.equal(button("削除").disabled, true, "old finally cannot unlock the new request");
        await React.act(async () => button("削除").click());
        assert.equal(calls.length, 2, "no duplicate or automatic retry");
        await React.act(async () => pending[1].resolve({ ok: true, message: "NEW-SUCCESS" }));
        assert.equal(refreshes, 1);
        assert.equal(button("削除").disabled, false);
        assert.match(dom.window.document.body.textContent, /NEW-SUCCESS/);
      });
    }
  }
});


test("MIG-0722 T04: resolved batch failure re-reads once and shows its message only after authorized GET", async () => {
  for (const status of [200, 401, 403, 404, 503]) {
    await withSlotDom(async (dom, root) => {
      const initial = data();
      const updated = data({ slots: initial.slots.map(row =>
        row.id === "s2" ? { ...row, display_name: "Fresh authorized holder" } : row) });
      const json = value => new Response(JSON.stringify(value), {
        status: 200, headers: { "content-type": "application/json" },
      });
      let reads = 0;
      let finishRead;
      const fetchFn = async () => {
        reads++;
        if (reads === 1 || reads === 3) return json(initial);
        return new Promise(resolve => { finishRead = resolve; });
      };
      const operations = [];
      const writes = {
        onGenerate: async () => ({ ok: true }),
        onClearAvailable: async () => ({ ok: true }),
        onAction: async operation => {
          operations.push(operation);
          return { ok: false, message: "DOMAIN-FAILURE: 枠の状態が変わりました。" };
        },
      };
      const view = actions => React.createElement(MemoryRouter, null,
        React.createElement(EventSlots, { eventId: "ev id", fetchFn, writeActions: actions }));
      const body = () => dom.window.document.body.textContent;
      const flushUntil = async predicate => {
        for (let i = 0; i < 10 && !predicate(); i++) {
          await React.act(async () => { await new Promise(resolve => setImmediate(resolve)); });
        }
        assert.ok(predicate(), body());
      };
      const button = label => [...dom.window.document.querySelectorAll("button")]
        .find(element => element.textContent.trim() === label);

      await React.act(async () => root.render(view(writes)));
      await flushUntil(() => body().includes("User <name>"));
      await React.act(async () => dom.window.document.querySelector('input[aria-label="枠 s1 を選択"]').click());
      await React.act(async () => button("空き枠を削除 (1)").click());
      assert.equal(operations.length, 0, "confirmation precedes mutation");
      await React.act(async () => button("実行する").click());
      assert.deepEqual(operations, [{ kind: "batch-delete", slotIds: ["s1"] }]);
      assert.equal(reads, 2, "resolved domain failure must re-read exactly once");
      assert.match(body(), /枠を読み込み中/);
      assert.doesNotMatch(body(), /User <name>|DOMAIN-FAILURE|一括生成/);

      await React.act(async () => finishRead(status === 200 ? json(updated) : new Response(null, { status })));
      await flushUntil(() => !body().includes("枠を読み込み中"));
      assert.equal(reads, 2);
      if (status === 200) {
        assert.match(body(), /Fresh authorized holder/);
        assert.doesNotMatch(body(), /User <name>/);
        assert.equal([...dom.window.document.querySelectorAll('[role="alert"]')]
          .filter(node => node.textContent.includes("DOMAIN-FAILURE")).length, 1);
        assert.equal(button("削除").disabled, false);
        // Rotating a write port on the same event invalidates old feedback.
        await React.act(async () => root.render(view({ ...writes, onAction: async () => ({ ok: true }) })));
        assert.doesNotMatch(body(), /DOMAIN-FAILURE/);
        await React.act(async () => root.render(view(writes)));
        assert.doesNotMatch(body(), /DOMAIN-FAILURE/, "A-B-A cannot revive old feedback");
      } else {
        assert.doesNotMatch(body(), /User <name>|Fresh authorized holder|DOMAIN-FAILURE|一括生成|すべて選択/);
        if (status === 503) {
          await React.act(async () => button("再読み込み").click());
          await flushUntil(() => body().includes("User <name>"));
          assert.equal(reads, 3);
          assert.doesNotMatch(body(), /DOMAIN-FAILURE/, "manual retry cannot replay an old receipt");
        }
      }
      assert.equal(operations.length, 1, "never retry a mutation automatically");
    });
  }
});

test("MIG-0722 T04: transport rejection is distinct from a resolved domain failure", async () => {
  await withSlotDom(async (dom, root) => {
    let reads = 0;
    let writes = 0;
    const fetchFn = async () => {
      reads++;
      return new Response(JSON.stringify(data()), {
        status: 200, headers: { "content-type": "application/json" },
      });
    };
    const writeActions = {
      onGenerate: async () => ({ ok: true }),
      onClearAvailable: async () => ({ ok: true }),
      onAction: async () => { writes++; throw new Error("transport rejected"); },
    };
    await React.act(async () => root.render(React.createElement(MemoryRouter, null,
      React.createElement(EventSlots, { eventId: "ev id", fetchFn, writeActions }))));
    for (let i = 0; i < 10 && !dom.window.document.body.textContent.includes("User <name>"); i++) {
      await React.act(async () => { await new Promise(resolve => setImmediate(resolve)); });
    }
    const button = label => [...dom.window.document.querySelectorAll("button")]
      .find(element => element.textContent.trim() === label);
    await React.act(async () => button("削除").click());
    await React.act(async () => button("実行する").click());
    assert.equal(writes, 1);
    assert.equal(reads, 1, "CURRENT catch does not trigger router.refresh");
    assert.match(dom.window.document.body.textContent, /枠操作中に通信エラー/);
    assert.equal(button("削除").disabled, false);
  });
});


test("MIG-0722 U02b-12: stale same-event list/batch receipts invalidate only the current authorized view", async () => {
  for (const scenario of [
    { oldKind: "list", navigation: "rotate", order: "new-first" },
    { oldKind: "batch", navigation: "roundtrip", order: "new-first" },
    { oldKind: "list", navigation: "rotate", order: "old-first" },
    { oldKind: "batch", navigation: "rotate", order: "old-first-reject" },
    { oldKind: "list", navigation: "other", order: "old-first" },
    { oldKind: "batch", navigation: "rotate", order: "new-first", deny: true },
  ]) {
    await withSlotDom(async (dom, root) => {
      const initial = data();
      let oldCommitted = false;
      let newCommitted = false;
      let deny = false;
      const reads = [];
      const fetchFn = async path => {
        const eventId = decodeURIComponent(path.split("/")[4]);
        reads.push(eventId);
        if (deny && eventId === "ev id") return new Response(null, { status: 403 });
        const slots = initial.slots
          .filter(row => eventId !== "ev id" || !oldCommitted || row.id !== "s1")
          .map(row => ({ ...row, event_id: eventId,
            ...(eventId === "ev id" && newCommitted && row.id === "s2" ?
              { status: "available", display_name: null, reserved_x_id_snapshot: null,
                discord_display_name: null, discord_id: null } : {}) }));
        const counts = { available: 0, reserved: 0, submitted: 0 };
        for (const row of slots) counts[row.status]++;
        return new Response(JSON.stringify(data({
          event: { ...initial.event, id: eventId, title: eventId === "other" ? "Other event" : "Event A" },
          slots, counts, total: slots.length,
        })), { status: 200, headers: { "content-type": "application/json" } });
      };
      let oldResolve, newResolve, newReject;
      const calls = [];
      const oldPort = () => {
        calls.push("old");
        return new Promise(resolve => { oldResolve = resolve; });
      };
      const nextPort = () => {
        calls.push("new");
        return new Promise((resolve, reject) => { newResolve = resolve; newReject = reject; });
      };
      const oldWrites = {
        onGenerate: async () => ({ ok: true }),
        onClearAvailable: oldPort,
        onAction: oldPort,
      };
      const newWrites = { ...oldWrites, onAction: nextPort };
      const view = (eventId, writeActions) => React.createElement(MemoryRouter, null,
        React.createElement(EventSlots, { eventId, fetchFn, writeActions }));
      const body = () => dom.window.document.body.textContent;
      const button = label => [...dom.window.document.querySelectorAll("button")]
        .find(element => element.textContent.trim() === label);
      const row = id => dom.window.document.querySelector('input[aria-label="枠 ' + id + ' を選択"]');
      const waitFor = async predicate => {
        for (let i = 0; i < 10 && !predicate(); i++) {
          await React.act(async () => { await new Promise(resolve => setImmediate(resolve)); });
        }
        assert.ok(predicate(), JSON.stringify(scenario) + " " + body());
      };
      await React.act(async () => root.render(view("ev id", oldWrites)));
      await waitFor(() => body().includes("Event A"));
      if (scenario.oldKind === "list") {
        await React.act(async () => button("削除").click());
        await React.act(async () => button("実行する").click());
      } else {
        await React.act(async () => button("空き枠を全削除").click());
        await React.act(async () => button("全削除する").click());
      }
      assert.deepEqual(calls, ["old"]);
      if (scenario.navigation !== "rotate") {
        await React.act(async () => root.render(view("other", newWrites)));
        await waitFor(() => body().includes("Other event"));
        if (scenario.navigation === "other") {
          const before = reads.length;
          oldCommitted = true;
          await React.act(async () => oldResolve({ ok: true, message: "OBSOLETE-RECEIPT" }));
          assert.equal(reads.length, before, "unrelated event must not refetch");
          assert.match(body(), /Other event/);
          assert.doesNotMatch(body(), /OBSOLETE-RECEIPT/);
          assert.deepEqual(calls, ["old"]);
          return;
        }
      }
      await React.act(async () => root.render(view("ev id", newWrites)));
      await waitFor(() => body().includes("Event A") && row("s1") !== null);
      const before = reads.length;
      await React.act(async () => button("解放").click());
      await React.act(async () => button("実行する").click());
      assert.deepEqual(calls, ["old", "new"]);
      assert.equal(button("解放").disabled, true);
      if (scenario.order === "new-first") {
        newCommitted = true;
        await React.act(async () => newResolve({ ok: true, message: "NEW-RECEIPT" }));
        await waitFor(() => reads.length === before + 1 && row("s1") !== null &&
          !body().includes("User <name>"));
        assert.match(body(), /NEW-RECEIPT/, "current receipt survives authorized refresh");
        deny = Boolean(scenario.deny);
        oldCommitted = true;
        await React.act(async () => oldResolve({ ok: true, message: "OBSOLETE-RECEIPT" }));
        await waitFor(() => reads.length === before + 2 && !body().includes("枠を読み込み中"));
        assert.equal(row("s1"), null);
        if (deny) {
          assert.match(body(), /権限がありません/);
          assert.doesNotMatch(body(), /Event A|すべて選択|一括生成|NEW-RECEIPT/);
        } else {
          assert.match(body(), /Event A/);
          assert.match(body(), /NEW-RECEIPT/, "stale invalidation does not replace current receipt");
          assert.doesNotMatch(body(), /User <name>/);
        }
      } else {
        oldCommitted = true;
        await React.act(async () => oldResolve({ ok: true, message: "OBSOLETE-RECEIPT" }));
        assert.equal(reads.length, before, "stale settlement must not unmount a pending new write");
        assert.equal(button("解放").disabled, true);
        await React.act(async () => button("解放").click());
        assert.deepEqual(calls, ["old", "new"]);
        if (scenario.order === "old-first-reject") {
          await React.act(async () => newReject(new Error("transport")));
        } else {
          newCommitted = true;
          await React.act(async () => newResolve({ ok: true }));
        }
        await waitFor(() => reads.length === before + 1 && row("s1") === null &&
          body().includes("Event A"));
        if (scenario.order === "old-first-reject") {
          assert.match(body(), /枠操作中に通信エラー/);
          assert.match(body(), /User <name>/);
        }
      }
      assert.doesNotMatch(body(), /OBSOLETE-RECEIPT/);
      assert.deepEqual(calls, ["old", "new"], "no automatic replay");
    });
  }
});


test("MIG-0722 U02b-12: authorized success receipts survive the refresh for all four UI action families", async () => {
  const cases = [
    ...["single", "batch", "generate", "clear"].flatMap(kind =>
      [false, true].map(pending => ({ kind, pending, status: 200 }))),
    { kind: "single", pending: true, status: 401 },
    { kind: "batch", pending: true, status: 403 },
    { kind: "generate", pending: true, status: 404 },
    { kind: "clear", pending: true, status: 503 },
  ];
  for (const { kind, pending, status } of cases) {
    await withSlotDom(async (dom, root) => {
      const previousFormData = Object.getOwnPropertyDescriptor(globalThis, "FormData");
      Object.defineProperty(globalThis, "FormData", {
        configurable: true, writable: true, value: dom.window.FormData,
      });
      try {
        const initial = data();
        const fresh = data({ slots: initial.slots.map(row =>
          row.id === "s2" ? { ...row, display_name: "Fresh holder" } : row) });
        const json = value => new Response(JSON.stringify(value), {
          status: 200, headers: { "content-type": "application/json" },
        });
        let reads = 0;
        let resolveRead;
        const fetchFn = async () => {
          reads++;
          if (reads === 1 || reads === 3) return json(initial);
          return new Promise(resolve => { resolveRead = resolve; });
        };
        const calls = [];
        const message = kind === "generate" ? "7 件の枠を生成しました。"
          : kind === "clear" ? "3 件の空き枠を削除しました。" : "SUCCESS-" + kind;
        const settle = (action, input) => {
          calls.push({ action, input });
          return Promise.resolve({ ok: true, pendingPublicReflection: pending,
            ...(kind === "generate" ? { created: 7 } :
              kind === "clear" ? { created: 3 } : { message }) });
        };
        const writes = {
          onGenerate: request => settle("generate", request),
          onClearAvailable: () => settle("clear"),
          onAction: operation => settle("list", operation),
        };
        const view = actions => React.createElement(MemoryRouter, null,
          React.createElement(EventSlots, { eventId: "ev id", fetchFn, writeActions: actions }));
        const body = () => dom.window.document.body.textContent;
        const button = label => [...dom.window.document.querySelectorAll("button")]
          .find(node => node.textContent.trim() === label);
        const waitFor = async predicate => {
          for (let i = 0; i < 10 && !predicate(); i++) {
            await React.act(async () => { await new Promise(resolve => setImmediate(resolve)); });
          }
          assert.ok(predicate(), kind + " " + status + " " + body());
        };
        await React.act(async () => root.render(view(writes)));
        await waitFor(() => body().includes("User <name>"));
        if (kind === "generate") {
          await React.act(async () => button("時間なし").click());
          const form = dom.window.document.querySelector('form[aria-label="枠の一括生成"]');
          form.querySelector('[name="count"]').value = "7";
          await React.act(async () => form.dispatchEvent(new dom.window.Event("submit", {
            bubbles: true, cancelable: true,
          })));
          assert.deepEqual(calls, [{ action: "generate",
            input: { mode: "count", count: 7, label_prefix: "No.", start_index: 1 } }]);
        } else if (kind === "clear") {
          await React.act(async () => button("空き枠を全削除").click());
          assert.equal(calls.length, 0);
          await React.act(async () => button("全削除する").click());
          assert.deepEqual(calls, [{ action: "clear", input: undefined }]);
        } else {
          if (kind === "batch") {
            await React.act(async () => dom.window.document.querySelector('input[aria-label="枠 s1 を選択"]').click());
            await React.act(async () => button("空き枠を削除 (1)").click());
          } else {
            await React.act(async () => button("削除").click());
          }
          assert.equal(calls.length, 0);
          await React.act(async () => button("実行する").click());
          assert.deepEqual(calls, [{ action: "list", input: kind === "batch"
            ? { kind: "batch-delete", slotIds: ["s1"] } : { kind: "delete", slotId: "s1" } }]);
        }
        assert.equal(reads, 2);
        assert.match(body(), /枠を読み込み中/);
        assert.ok(!body().includes(message));
        assert.doesNotMatch(body(), /User <name>|公開画面への反映は処理中/);
        await React.act(async () => resolveRead(status === 200 ? json(fresh) : new Response(null, { status })));
        await waitFor(() => !body().includes("枠を読み込み中"));
        if (status === 200) {
          assert.match(body(), /Fresh holder/);
          const receipts = [...dom.window.document.querySelectorAll('[role="status"]')]
            .filter(node => node.textContent.includes(message));
          assert.equal(receipts.length, 1);
          assert.equal(receipts[0].textContent.trim(),
            message + (pending ? " 公開画面への反映は処理中です。" : ""));
          await React.act(async () => root.render(view({ ...writes, onAction: async () => ({ ok: true }) })));
          assert.ok(!body().includes(message), "port rotation drops old receipt");
          await React.act(async () => root.render(view(writes)));
          assert.ok(!body().includes(message), "A-B-A cannot revive old receipt");
        } else {
          assert.ok(!body().includes(message));
          assert.doesNotMatch(body(), /Fresh holder|User <name>|公開画面への反映は処理中|すべて選択/);
          if (status === 503) {
            await React.act(async () => button("再読み込み").click());
            await waitFor(() => body().includes("User <name>"));
            assert.equal(reads, 3);
            assert.ok(!body().includes(message));
          }
        }
        assert.equal(calls.length, 1, "never replay a mutation");
      } finally {
        if (previousFormData) Object.defineProperty(globalThis, "FormData", previousFormData);
        else delete globalThis.FormData;
      }
    });
  }
});


test("MIG-0722 U02b-12: shared snapshot dispatch gate serializes list and batch writes", async () => {
  for (const first of ["list", "batch"]) {
    for (const outcome of ["success", "failure", "rejection"]) {
      await withSlotDom(async (dom, root) => {
        let reads = 0;
        let finishRead;
        const json = () => new Response(JSON.stringify(data()), {
          status: 200, headers: { "content-type": "application/json" },
        });
        const fetchFn = async () => {
          reads++;
          if (reads === 1) return json();
          return new Promise(resolve => { finishRead = resolve; });
        };
        const calls = [];
        let settle, reject;
        const port = family => () => {
          calls.push(family);
          return new Promise((resolve, fail) => { settle = resolve; reject = fail; });
        };
        const writeActions = {
          onGenerate: port("generate"), onClearAvailable: port("batch"), onAction: port("list"),
        };
        const button = label => [...dom.window.document.querySelectorAll("button")]
          .find(node => node.textContent.trim() === label);
        const body = () => dom.window.document.body.textContent;
        const waitFor = async predicate => {
          for (let i = 0; i < 10 && !predicate(); i++) {
            await React.act(async () => { await new Promise(resolve => setImmediate(resolve)); });
          }
          assert.ok(predicate(), first + " " + outcome + " " + body());
        };
        await React.act(async () => root.render(React.createElement(MemoryRouter, null,
          React.createElement(EventSlots, { eventId: "ev id", fetchFn, writeActions }))));
        await waitFor(() => body().includes("User <name>"));
        // Prepare both confirmations before any dispatch. The second click is
        // deliberately in the same React batch, before disabled props commit.
        await React.act(async () => button("削除").click());
        await React.act(async () => button("空き枠を全削除").click());
        const listConfirm = button("実行する");
        const batchConfirm = button("全削除する");
        assert.ok(listConfirm && batchConfirm);
        await React.act(async () => {
          (first === "list" ? listConfirm : batchConfirm).click();
          (first === "list" ? batchConfirm : listConfirm).click();
        });
        assert.deepEqual(calls, [first], "only the first same-turn operation may dispatch");
        assert.equal(reads, 1);
        assert.equal(button("削除").disabled, true);
        assert.equal(button("空き枠を全削除").disabled, true);
        assert.equal(button("解放").disabled, true);
        assert.equal((first === "list" ? batchConfirm : listConfirm).disabled, true);
        await React.act(async () => {
          button("削除").click();
          button("空き枠を全削除").click();
        });
        assert.deepEqual(calls, [first], "hanging first write fences all competing controls");

        const message = "FIRST-" + first + "-" + outcome;
        if (outcome === "rejection") {
          await React.act(async () => reject(new Error("transport")));
        } else {
          await React.act(async () => settle({ ok: outcome === "success", message,
            pendingPublicReflection: outcome === "success" }));
        }
        const shouldRefresh = outcome === "success" || (first === "list" && outcome === "failure");
        if (shouldRefresh) {
          assert.equal(reads, 2);
          assert.match(body(), /枠を読み込み中/);
          assert.doesNotMatch(body(), /User <name>|FIRST-/);
          await React.act(async () => finishRead(json()));
          await waitFor(() => body().includes(message));
          const receipts = [...dom.window.document.querySelectorAll('[role="alert"], [role="status"]')]
            .filter(node => node.textContent.includes(message));
          assert.equal(receipts.length, 1);
          assert.equal(receipts[0].textContent.trim(), message +
            (outcome === "success" ? " 公開画面への反映は処理中です。" : ""));
        } else {
          assert.equal(reads, 1, "rejection and batch domain failure retain CURRENT no-refresh behavior");
          assert.match(body(), outcome === "rejection" ? /枠操作中に通信エラー/ : /FIRST-batch-failure/);
        }
        assert.equal(button("削除").disabled, false);
        assert.equal(button("空き枠を全削除").disabled, false);
        assert.deepEqual(calls, [first]);
        // The other family can start explicitly after the authorized refresh
        // (or a non-refresh failure); its receipt cannot be overwritten by
        // the first operation's already settled callback.
        const second = first === "list" ? "batch" : "list";
        if (second === "batch") {
          await React.act(async () => button("空き枠を全削除").click());
          await React.act(async () => button("全削除する").click());
        } else {
          await React.act(async () => button("削除").click());
          await React.act(async () => button("実行する").click());
        }
        assert.deepEqual(calls, [first, second]);
        await React.act(async () => reject(new Error("second transport")));
        assert.deepEqual(calls, [first, second], "no automatic replay");
        if (shouldRefresh) assert.ok(!body().includes(message), "new operation clears prior refreshed receipt");
      });
    }
  }
});


test("MIG-0722 U02b: submitted release confirmation preserves CURRENT group-impact warnings", async () => {
  const releaseText = "枠の確保状態は維持したまま、現在提出されている作品を枠から外します。利用者はこの枠へ別の作品を再度提出できます。";
  const groupText = "同じ提出グループの連続枠もまとめて未提出状態へ戻します。";
  const forceText = "作品は削除せず、提出済み枠との紐付けだけを解除して空き状態に戻します。連続枠の場合は同じ提出グループをまとめて解放します。";
  for (const kind of ["release-submitted-video", "force-release-submitted"]) {
    for (const grouped of [false, true]) {
      await withSlotDom(async (dom, root) => {
        const calls = [];
        const rows = [
          slot("other", { status: "submitted", reservation_group_id: "other-group" }),
          slot("target", { status: "submitted", reservation_group_id: grouped ? "target-group" : null }),
        ];
        const onAction = async operation => { calls.push(operation); return { ok: true }; };
        const view = React.createElement(MemoryRouter, null, React.createElement(SlotList, {
          eventId: "ev id", slots: rows, partGapMinutes: 15, parts: [],
          onAction, canManageSubmittedSlots: true,
        }));
        await React.act(async () => root.render(view));
        const doc = dom.window.document;
        const label = kind === "release-submitted-video" ? "作品のみ解放" : "強制解放";
        const row = [...doc.querySelectorAll("tbody tr")][1];
        const action = [...row.querySelectorAll("button")].find(button => button.textContent.trim() === label);
        const dialog = () => doc.querySelector('.manage-slot-list [role="alertdialog"]');
        const button = text => [...dialog().querySelectorAll("button")]
          .find(element => element.textContent.trim() === text);
        const expected = kind === "release-submitted-video"
          ? releaseText + (grouped ? groupText : "") : forceText;
        const expectedTitle = kind === "release-submitted-video"
          ? "作品の提出を解除しますか？" : "提出済み枠を強制解放しますか？";
        const confirmLabel = kind === "release-submitted-video" ? "作品のみ解放" : "強制解放する";
        const verifyDialog = () => {
          const modal = dialog();
          assert.ok(modal);
          assert.equal(modal.getAttribute("aria-modal"), "true");
          assert.equal(doc.getElementById(modal.getAttribute("aria-labelledby")).textContent, expectedTitle);
          assert.equal(doc.getElementById(modal.getAttribute("aria-describedby")).textContent, expected);
          assert.ok(button(confirmLabel).classList.contains("fn-btn-danger"));
        };

        await React.act(async () => action.click());
        verifyDialog();
        assert.deepEqual(calls, [], "opening a confirmation never dispatches");
        await React.act(async () => button("キャンセル").click());
        assert.equal(dialog(), null);
        assert.deepEqual(calls, [], "cancel never dispatches");

        await React.act(async () => action.click());
        verifyDialog();
        await React.act(async () => button(confirmLabel).click());
        assert.deepEqual(calls, [{ kind, slotId: "target" }]);
        assert.equal(dialog(), null);
      });
    }
  }
});


test("MIG-0722 U02b: shared slot confirmation uses CURRENT danger dialog and cancels on Escape or backdrop", async () => {
  await withSlotDom(async (dom, root) => {
    const calls = [];
    const rows = [slot("a")];
    const onAction = async operation => { calls.push(operation); return { ok: true }; };
    const view = writeBlocked => React.createElement(MemoryRouter, null,
      React.createElement(SlotList, { eventId: "ev id", slots: rows, partGapMinutes: 15,
        parts: [], onAction, writeBlocked }));
    const doc = dom.window.document;
    const modal = () => doc.querySelector('.manage-slot-list [role="alertdialog"]');
    const clickDelete = () => [...doc.querySelectorAll("button")]
      .find(element => element.textContent.trim() === "削除").click();
    const escape = () => doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      key: "Escape", bubbles: true,
    }));
    const backdrop = () => doc.querySelector(".manage-slot-list .confirm-backdrop");
    await React.act(async () => root.render(view(false)));

    for (const cancel of [escape, () => backdrop().click()]) {
      await React.act(async () => clickDelete());
      const dialog = modal();
      assert.ok(dialog);
      assert.equal(dialog.getAttribute("aria-modal"), "true");
      assert.equal(doc.getElementById(dialog.getAttribute("aria-labelledby")).textContent, "枠操作を実行しますか？");
      assert.equal(doc.getElementById(dialog.getAttribute("aria-describedby")).textContent, "選択した枠の状態を変更します。");
      const confirm = dialog.querySelector("button.fn-btn-danger");
      assert.ok(confirm);
      assert.equal(confirm.textContent, "実行する");
      assert.equal(doc.activeElement, confirm);
      await React.act(async () => dialog.click());
      assert.equal(modal(), dialog, "click inside does not dismiss");
      await React.act(async () => cancel());
      assert.equal(modal(), null);
      assert.deepEqual(calls, []);
    }

    await React.act(async () => clickDelete());
    await React.act(async () => root.render(view(true)));
    const blocked = modal();
    assert.ok(blocked);
    const buttons = [...blocked.querySelectorAll("button")];
    assert.equal(buttons.length, 2);
    assert.ok(buttons.every(button => button.disabled));
    await React.act(async () => { escape(); backdrop().click(); buttons.forEach(button => button.click()); });
    assert.equal(modal(), blocked, "busy confirmation cannot dismiss or dispatch");
    assert.deepEqual(calls, []);
    await React.act(async () => root.render(view(false)));
    await React.act(async () => escape());
    assert.equal(modal(), null);
    assert.deepEqual(calls, []);

    await React.act(async () => clickDelete());
    await React.act(async () => modal().querySelector("button.fn-btn-danger").click());
    assert.deepEqual(calls, [{ kind: "delete", slotId: "a" }]);
    assert.equal(modal(), null);
  });
});


test("MIG-0722 U02a D-17-7: 500-row cap retains CURRENT description without a new truncation notice", () => {
  for (const { total, shown, filter, counts } of [
    { total: 499, shown: 499, filter: "all", counts: { available: 499, reserved: 0, submitted: 0 } },
    { total: 500, shown: 500, filter: "all", counts: { available: 500, reserved: 0, submitted: 0 } },
    { total: 501, shown: 500, filter: "all", counts: { available: 501, reserved: 0, submitted: 0 } },
    { total: 700, shown: 500, filter: "reserved", counts: { available: 200, reserved: 500, submitted: 0 } },
  ]) {
    const slots = Array.from({ length: shown }, (_, i) => slot("cap-" + i, {
      status: filter === "reserved" ? "reserved" : "available",
      start_time: 1700000000 + i, sort_order: i,
    }));
    const html = render(React.createElement(EventSlotsView, {
      eventId: "ev id", status: filter, data: data({
        total, counts, slots, statusFilter: filter, atLimit: shown === 500,
      }),
    }));
    assert.ok(html.includes(`枠管理 — 全${total}件中、最大500件を表示`));
    assert.ok(html.includes(`枠一覧 (${shown})`));
    const tbody = html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0];
    assert.ok(tbody, "slot table must render");
    assert.equal((tbody.match(/<tr(?:\s|>)/g) ?? []).length, shown);
    assert.equal((html.match(/manage-slot-stat-value/g) ?? []).length, 4);
    assert.doesNotMatch(html, /最大500件まで表示しています|条件を絞り込んでください/);
  }
});

test("MIG-0722 U02a: CURRENT zero-total empty state is distinct from an empty filter", () => {
  let invoked = 0;
  const call = async () => { invoked++; return { ok: true }; };
  const complete = { onGenerate: call, onClearAvailable: call, onAction: call };
  for (const status of ["all", "available", "reserved", "submitted"]) {
    for (const writeActions of [undefined, { onAction: call }, complete]) {
      const html = render(React.createElement(EventSlotsView, {
        eventId: "ev id", status, writeActions,
        data: data({ statusFilter: status, total: 0, slots: [],
          counts: { available: 0, reserved: 0, submitted: 0 } }),
      }));
      const dom = new JSDOM(html);
      try {
        const doc = dom.window.document;
        const section = doc.querySelector('section[aria-label="枠一覧"]');
        assert.ok(section);
        assert.match(section.textContent, /枠一覧 \(0\)/);
        const empty = section.querySelector(".fn-empty-state.empty-tone-warning");
        assert.ok(empty);
        assert.equal(empty.querySelector(".empty-title")?.textContent, "枠はまだありません");
        assert.equal(empty.querySelector(".empty-description")?.textContent,
          writeActions === complete ? "上のフォームから作成してください。" : "枠の追加機能は移行中です。");
        const back = empty.querySelector("a.fn-btn-ghost");
        assert.equal(back?.getAttribute("href"), "/manage/events/ev%20id");
        assert.equal(back?.textContent, "イベント概要へ");
        assert.equal(Boolean(doc.querySelector('section[aria-label="枠を追加・一括編集"]')),
          writeActions === complete);
        assert.equal(section.querySelector("table"), null);
        assert.equal(section.querySelector("button"), null);
      } finally {
        dom.window.close();
      }
    }
  }
  for (const writeActions of [undefined, complete]) {
    const html = render(React.createElement(EventSlotsView, {
      eventId: "ev id", status: "available", writeActions,
      data: data({ statusFilter: "available", total: 3, slots: [],
        counts: { available: 0, reserved: 2, submitted: 1 } }),
    }));
    const dom = new JSDOM(html);
    try {
      const section = dom.window.document.querySelector('section[aria-label="枠一覧"]');
      assert.ok(section);
      assert.match(section.textContent, /枠一覧 \(0\)/);
      assert.match(section.textContent, /枠はまだありません。/);
      assert.equal(section.querySelector(".fn-empty-state"), null);
      assert.doesNotMatch(section.textContent, /上のフォームから作成してください|枠の追加機能は移行中/);
    } finally {
      dom.window.close();
    }
  }
  assert.equal(invoked, 0, "render must not dispatch any write");
});
