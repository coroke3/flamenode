import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { EventStaffManager } from "../.test-dist/apps/ops/src/routes/manage/EventStaffManager.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://flamenode.test" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "FormData"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const member = (patch = {}) => ({
  id: "staff-1", x_user_id: "alice", display_name: "Alice",
  permission_preset: "manager", is_public: 0, public_role_label: null,
  permission_keys: [], x_name: null, icon_url: null,
  ...patch,
});
const json = (status, value) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});

function fixture({ canManageMembers = true, members = [member()], ownerCount = 0,
  reply = json(409, { ok: false, message: "最後の代表者は削除・降格できません。" }),
  prompt = () => "", isSiteAdmin = false } = {}) {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const calls = [];
  const refresh = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return reply;
  };
  const view = async (patch = {}) => React.act(async () => {
    root.render(React.createElement(EventStaffManager, {
      eventId: "ev 1", members, ownerCount, canManageMembers,
      isSiteAdmin, fetchFn, onRefresh: () => refresh.push("refresh"),
      promptConfirm: prompt, ...patch,
    }));
  });
  const click = async (selector) => {
    const el = target.querySelector(selector);
    assert.ok(el, "expected button: " + selector);
    await React.act(async () => {
      el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    return el;
  };
  const cleanup = async () => {
    await React.act(async () => { root.unmount(); target.remove(); });
  };
  return { target, calls, refresh, view, click, cleanup };
}

test("MIG-0723 T04: without event.members, no mutation controls render", async () => {
  const ui = fixture({ canManageMembers: false });
  try {
    await ui.view();
    assert.match(ui.target.textContent, /閲覧のみ/);
    assert.equal(ui.target.querySelector("button"), null);
  } finally { await ui.cleanup(); }
});

test("MIG-0723 T01: cancelling remove prompt never sends any request", async () => {
  const ui = fixture({ prompt: () => null });
  try {
    await ui.view();
    await ui.click(".manage-staff-list-row");
    await ui.click(".manage-staff-editor button.fn-btn-danger");
    await ui.click(".manage-staff-editor > button.fn-btn-danger");
    assert.deepEqual(ui.calls, []);
    assert.deepEqual(ui.refresh, []);
  } finally { await ui.cleanup(); }
});

test("MIG-0723 T02: last-owner HTTP409 preserves exact server reason", async () => {
  const ui = fixture();
  try {
    await ui.view();
    await ui.click(".manage-staff-list-row");
    await ui.click(".manage-staff-editor button.fn-btn-danger");
    await ui.click(".manage-staff-editor > button.fn-btn-danger");
    assert.equal(ui.calls.length, 1);
    assert.equal(ui.calls[0].url, "/api/manage/events/ev%201/staff/staff-1");
    assert.equal(ui.calls[0].init.method, "DELETE");
    assert.equal(JSON.parse(ui.calls[0].init.body).confirm_text, "");
    assert.match(ui.target.querySelector('[role="alert"]').textContent,
      /最後の代表者は削除・降格できません/);
    assert.equal(ui.refresh.length, 0);
  } finally { await ui.cleanup(); }
});

test("MIG-0723: last owner cannot be deleted by UI; site-only preset is hidden", async () => {
  const ui = fixture({ members: [member({ permission_preset: "owner" })], ownerCount: 1 });
  try {
    await ui.view();
    await ui.click(".manage-staff-list-row");
    const buttons = [...ui.target.querySelectorAll("button")];
    const deletion = buttons.find(b => b.textContent.trim() === "削除");
    assert.equal(deletion?.disabled, true);
    assert.match(ui.target.textContent, /最後の代表者は削除・降格できません/);
    assert.equal([...ui.target.querySelectorAll("option")]
      .filter(o => o.value === "xid_reviewer").length, 0);
    assert.deepEqual(ui.calls, []);
  } finally { await ui.cleanup(); }
});

test("MIG-0723: completed creation writes exact body and calls refresh", async () => {
  const ui = fixture({ reply: json(200, { ok: true, message: "追加しました。" }) });
  try {
    await ui.view();
    await ui.click(".manage-staff-list-head button");
    const form = ui.target.querySelector(".manage-staff-add-form");
    form.elements.namedItem("display_name").value = "Bob";
    form.elements.namedItem("x_user_id").value = "bob_1";
    form.elements.namedItem("reason").value = "追加";
    await React.act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(ui.calls.length, 1);
    assert.equal(ui.calls[0].url, "/api/manage/events/ev%201/staff");
    assert.equal(ui.calls[0].init.method, "POST");
    assert.equal(ui.calls[0].init.credentials, "same-origin");
    assert.deepEqual(JSON.parse(ui.calls[0].init.body), {
      x_user_id: "bob_1", display_name: "Bob", permission_preset: "manager",
      permission_keys: "", is_public: "0", public_role_label: "",
      reason: "追加", confirm_text: "",
    });
    assert.deepEqual(ui.refresh, ["refresh"]);
    assert.match(ui.target.textContent, /追加しました/);
  } finally { await ui.cleanup(); }
});

test("MIG-0723: two submits before a render issue only one privileged write", async () => {
  let complete;
  const pendingReply = new Promise(resolve => { complete = resolve; });
  const ui = fixture({ reply: pendingReply });
  try {
    await ui.view();
    await ui.click(".manage-staff-list-head button");
    const form = ui.target.querySelector(".manage-staff-add-form");
    form.elements.namedItem("display_name").value = "Bob";
    form.elements.namedItem("x_user_id").value = "bob_1";
    form.elements.namedItem("reason").value = "追加";
    await React.act(async () => {
      const submit = () => form.dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
      submit();
      submit(); // React has not rendered the busy/disabled state yet.
      assert.equal(ui.calls.length, 1, "the second submit must be ignored synchronously");
      complete(json(200, { ok: true, message: "追加しました。" }));
    });
    assert.equal(ui.calls.length, 1);
    assert.deepEqual(ui.refresh, ["refresh"]);
    assert.match(ui.target.textContent, /追加しました/);
  } finally { await ui.cleanup(); }
});

test("MIG-0723: changing events during a write clears stale busy and ignores old completion", async () => {
  let complete;
  const pendingReply = new Promise(resolve => { complete = resolve; });
  const ui = fixture({ reply: pendingReply });
  try {
    await ui.view();
    await ui.click(".manage-staff-list-head button");
    const form = ui.target.querySelector(".manage-staff-add-form");
    form.elements.namedItem("display_name").value = "Bob";
    form.elements.namedItem("x_user_id").value = "bob_1";
    form.elements.namedItem("reason").value = "追加";
    await React.act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(ui.calls.length, 1);
    assert.equal(ui.target.querySelector(".manage-staff-list-head button").disabled, true);
    await ui.view({ eventId: "ev 2", members: [member({ id: "staff-2", x_user_id: "other" })] });
    assert.equal(ui.target.querySelector(".manage-staff-list-head button").disabled, false);
    assert.equal(ui.target.querySelector(".manage-staff-add-form"), null);
    await React.act(async () => { complete(json(200, { ok: true, message: "旧イベント保存" })); });
    assert.equal(ui.target.textContent.includes("旧イベント保存"), false);
    assert.deepEqual(ui.refresh, []);
    assert.equal(ui.calls.length, 1);
  } finally { await ui.cleanup(); }
});


test("MIG-0723 T03: staff CSV previews localized permissions and imports only clean rows", async () => {
  const ui = fixture({ reply: json(200, { ok: true, message: "CSVを反映しました。" }) });
  try {
    await ui.view();
    await ui.click("details.manage-staff-advanced summary");
    const button = [...ui.target.querySelectorAll("button")].find(el => el.textContent.trim() === "CSVを反映");
    assert.ok(button);
    assert.equal(button.disabled, false, "the canonical five-column sample must be importable");
    assert.match(ui.target.textContent, /新規 4 \/ 更新 0 \/ エラー 0/);
    await React.act(async () => { button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
    assert.equal(ui.calls.length, 1);
    assert.equal(ui.calls[0].url, "/api/manage/events/ev%201/staff/csv");
    assert.equal(ui.calls[0].init.method, "POST");
    const body = JSON.parse(ui.calls[0].init.body);
    assert.equal(body.reason, "スタッフCSV反映");
    assert.equal(body.rows.length, 4);
    assert.deepEqual(body.rows[3].permission_keys, ["event.slots", "video.basics"]);
    assert.equal(body.rows.some(row => row.errors.length), false);
    assert.deepEqual(ui.refresh, ["refresh"]);
  } finally { await ui.cleanup(); }
});

test("MIG-0723 T03: CSV owner assignment is rejected before any write", async () => {
  const ui = fixture();
  try {
    await ui.view();
    await ui.click("details.manage-staff-advanced summary");
    const textarea = ui.target.querySelector("textarea");
    assert.ok(textarea);
    const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set;
    await React.act(async () => {
      setValue.call(textarea, "表示名,X ID,担当プリセット,公開フラグ,公開ラベル\n代表,owner,owner,1,代表");
      textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    const button = [...ui.target.querySelectorAll("button")].find(el => el.textContent.trim() === "CSVを反映");
    assert.equal(button.disabled, true);
    assert.match(ui.target.textContent, /代表者の追加・変更はCSVでは行えません/);
    assert.deepEqual(ui.calls, []);
  } finally { await ui.cleanup(); }
});


test("MIG-0723 U01b: custom permission checklist submits selected canonical keys and hides site-admin grants", async () => {
  const ui = fixture({ reply: json(200, { ok: true, message: "追加しました。" }) });
  try {
    await ui.view();
    await ui.click(".manage-staff-list-head button");
    const assignment = ui.target.querySelector(".manage-staff-add-form .manage-staff-permission-assignment");
    assert.ok(assignment);
    const select = assignment.querySelector("select");
    const setSelect = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value").set;
    await React.act(async () => {
      setSelect.call(select, "custom");
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    assert.ok(assignment.querySelector('input[type="checkbox"][value="event.slots"]'));
    assert.equal(assignment.querySelector('input[type="checkbox"][value="event.public_api"]'), null);
    await ui.click('input[type="checkbox"][value="event.slots"]');
    const form = ui.target.querySelector(".manage-staff-add-form");
    form.elements.namedItem("display_name").value = "Bob";
    form.elements.namedItem("x_user_id").value = "bob_1";
    form.elements.namedItem("reason").value = "追加";
    await React.act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    const body = JSON.parse(ui.calls[0].init.body);
    assert.equal(body.permission_preset, "custom");
    assert.equal(body.permission_keys, "event.slots");
  } finally { await ui.cleanup(); }
});

test("MIG-0723 U01b: site admin can see admin-only custom permission options", async () => {
  const ui = fixture({ isSiteAdmin: true });
  try {
    await ui.view();
    await ui.click(".manage-staff-list-head button");
    const assignment = ui.target.querySelector(".manage-staff-add-form .manage-staff-permission-assignment");
    const select = assignment.querySelector("select");
    const setSelect = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value").set;
    await React.act(async () => {
      setSelect.call(select, "custom");
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    assert.ok(assignment.querySelector('input[type="checkbox"][value="event.public_api"]'));
    assert.ok(assignment.querySelector('input[type="checkbox"][value="xid.link_requests"]'));
  } finally { await ui.cleanup(); }
});

test("MIG-0723 U01b: editing a custom preset preserves existing keys and adds checklist selections", async () => {
  const ui = fixture({ members: [member({ permission_preset: "custom", permission_keys: ["video.basics"] })],
    reply: json(200, { ok: true, message: "変更しました。" }) });
  try {
    await ui.view();
    await ui.click(".manage-staff-list-row");
    const assignment = ui.target.querySelector(".manage-staff-editor .manage-staff-permission-assignment");
    assert.ok(assignment);
    assert.equal(assignment.querySelector('input[type="checkbox"][value="video.basics"]').checked, true);
    await ui.click('input[type="checkbox"][value="event.slots"]');
    const form = ui.target.querySelector(".manage-staff-editor form");
    form.elements.namedItem("reason").value = "権限変更";
    await React.act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    const body = JSON.parse(ui.calls[0].init.body);
    assert.equal(body.permission_preset, "custom");
    assert.equal(body.permission_keys, "video.basics,event.slots");
  } finally { await ui.cleanup(); }
});
