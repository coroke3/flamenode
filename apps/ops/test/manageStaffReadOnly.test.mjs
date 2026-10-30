import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { readManageStaff } from "../.test-dist/apps/ops/src/api/manageStaff.js";
import {
  EventStaffReadOnlyList, presetLabel,
} from "../.test-dist/apps/ops/src/routes/manage/EventStaffReadOnlyList.js";
import {
  EventStaffReadOnlyPage, EventStaffReadOnlyView,
} from "../.test-dist/apps/ops/src/routes/manage/EventStaffReadOnlyPage.js";

const json = (status, data) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json" },
});
const member = (overrides = {}) => ({
  id: "m1", x_user_id: "x1", display_name: "Member",
  permission_preset: "owner", is_public: 1, public_role_label: "代表",
  permission_keys: ["event.members"], x_name: "X Name", icon_url: null,
  ...overrides,
});
const staff = (overrides = {}) => ({
  event: { id: "ev1", title: "Test Event", accent_color: null },
  isAdmin: false, canManageMembers: false, pendingCount: 1,
  members: [member()], ownerCount: 1, publicCount: 1, approvedCount: 1,
  membersTruncated: false,
  ...overrides,
});
const render = node => renderToStaticMarkup(
  React.createElement(MemoryRouter, null, node),
);

test("MIG-0723 U01a: exact GET, URL-encoding, no-store, credentials and signal", async () => {
  let called;
  const signal = new AbortController().signal;
  const result = await readManageStaff("ev 1", async (path, init) => {
    called = { path, init };
    return json(200, staff());
  }, signal);
  assert.equal(result.status, "ok");
  assert.equal(called.path, "/api/manage/events/ev%201/staff");
  assert.equal(called.init.method, "GET");
  assert.equal(called.init.credentials, "same-origin");
  assert.equal(called.init.cache, "no-store");
  assert.equal(called.init.headers.accept, "application/json");
  assert.equal(called.init.signal, signal);
  assert.deepEqual(await readManageStaff("..", async () => { throw Error("should not fetch"); }),
    { status: "unavailable" });
});

test("MIG-0723 U01a: auth, IDOR 404, 503, network errors and malformed payload fail closed", async () => {
  for (const [code, expected] of [
    [401, "anonymous"], [403, "forbidden"], [404, "notFound"], [501, "unsupported"], [503, "unavailable"],
  ]) {
    const value = await readManageStaff("ev1", async () => json(code, {}));
    assert.equal(value.status, expected);
  }
  assert.deepEqual(await readManageStaff("ev1", async () => json(200, staff({ members: [{}] }))),
    { status: "unavailable" });
  assert.deepEqual(await readManageStaff("ev1", async () => json(200, { members: [] })),
    { status: "unavailable" });
  assert.deepEqual(await readManageStaff("ev1", async () => { throw Error("offline"); }),
    { status: "unavailable" });
  const controller = new AbortController();
  assert.deepEqual(await readManageStaff("ev1", async () => {
    controller.abort();
    return json(200, staff());
  }, controller.signal), { status: "unavailable" });
});

test("MIG-0723 U01a: CURRENT preset labels; inherited keys never become preset labels", () => {
  for (const [preset, label] of Object.entries({
    owner: "代表", manager: "運営", reviewer: "レビュー担当",
    slot_manager: "枠管理担当", content_editor: "作品修正担当",
    xid_reviewer: "X ID確認担当", public_staff: "表示のみスタッフ", custom: "カスタム",
  })) assert.equal(presetLabel(preset), label);
  for (const preset of [null, "__proto__", "constructor", "toString", "bogus"]) {
    assert.equal(presetLabel(preset), "未設定");
  }
});

test("MIG-0723 U01a: read-only list matches CURRENT owner, publication, role and X name", () => {
  const html = renderToStaticMarkup(React.createElement(EventStaffReadOnlyList, {
    members: [member(), member({
      id: "m2", permission_preset: "custom", is_public: 0,
      x_user_id: null, x_name: null, display_name: "Backup",
      public_role_label: null, icon_url: "javascript:alert(1)",
    })],
  }));
  assert.match(html, /X Name/);
  assert.match(html, /代表者/);
  assert.match(html, /公開/);
  assert.match(html, /非公開/);
  assert.match(html, /Backup/);
  assert.match(html, /カスタム/);
  assert.doesNotMatch(html, /javascript:/);
  const empty = renderToStaticMarkup(React.createElement(EventStaffReadOnlyList, { members: [] }));
  assert.match(empty, /まだ登録されていません/);
});

test("MIG-0723 U01a: no event.members means read-only, counts and cap are truthful", () => {
  const html = render(React.createElement(EventStaffReadOnlyView, {
    eventId: "ev one", data: staff({ ownerCount: 2, publicCount: 30, approvedCount: 60,
      membersTruncated: true }),
  }));
  assert.match(html, /Test Event/);
  assert.match(html, /100\+/);
  assert.match(html, /100件を超えています/);
  assert.match(html, /event.members 権限が必要/);
  assert.match(html, /\/manage\/events\/ev%20one/);
  assert.doesNotMatch(html, /削除する|メンバーを追加/);
  const privileged = render(React.createElement(EventStaffReadOnlyView, {
    eventId: "ev1", data: staff({ canManageMembers: true }),
  }));
  assert.match(privileged, /追加・編集機能は移行中/);
  assert.doesNotMatch(privileged, /event.members 権限が必要/);
  const loading = render(React.createElement(EventStaffReadOnlyPage, { eventId: "ev1" }));
  assert.match(loading, /読み込み中/);
});
