import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  normalizeUsersTab, usersListPath, usersPageHref, createAdminUsersApi,
} from "../.test-dist/apps/ops/src/api/adminUsers.js";
import { AdminUserManagementTabs } from "../.test-dist/apps/ops/src/components/admin/AdminUserManagementTabs.js";
import { AdminUserDetailContent } from "../.test-dist/apps/ops/src/routes/admin/AdminUserDetail.js";
import { AdminUserEditContent, canConfirmUserBan, acquireAdminUserWriteLock } from "../.test-dist/apps/ops/src/routes/admin/AdminUserEdit.js";
import { createAdminUserEditMutations } from "../.test-dist/apps/ops/src/api/adminUserEdits.js";
import { permissionsPayload, fieldsSetFromCsv } from "../.test-dist/apps/ops/src/routes/admin/GlobalEditableFieldsPanel.js";

const response = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const fixture = {
  view: "discord", q: "test", status: "", paging: { page: 1, pageSize: 50, total: 1 },
  users: [{ id: "u1", name: "Tester", image: null, role: "user", is_banned: 0,
    can_create_events: 1, active_x_user_id: null, active_x_name: null, created_at: 1700000000000 }],
  xUsers: [], permissionSettings: { default_editable_fields: null, upcoming_editable_fields: null },
  degraded: false,
};

test("MIG-0731 T01: view=links redirects before reading protected API", async () => {
  let calls = 0;
  const api = createAdminUsersApi(async () => { calls++; throw Error("must not fetch"); });
  assert.deepEqual(await api.getUsers({ view: "links" }),
    { status: "redirect", to: "/admin/x-link-requests" });
  assert.equal(calls, 0);
  assert.equal(normalizeUsersTab("unknown"), "discord");
  assert.equal(normalizeUsersTab("permissions"), "permissions");
});

test("MIG-0731 U01: q/status/view/page are encoded and pagination preserves CURRENT filters", () => {
  assert.equal(usersListPath({ view: "discord", q: "A&B", status: "banned", page: "2" }),
    "/api/admin-read/users?view=discord&q=A%26B&status=banned&page=2");
  assert.equal(usersListPath({ view: "permissions", q: "private", status: "admin", page: "2" }),
    "/api/admin-read/users?view=permissions");
  assert.equal(usersListPath({ view: "xid", q: "@x", status: "admin" }),
    "/api/admin-read/users?view=xid&q=%40x");
  assert.equal(usersPageHref({ view: "discord", q: "A&B", status: "banned" }, 3),
    "/admin/users?view=discord&q=A%26B&status=banned&page=3");
});

test("MIG-0731 U01: GET validates untrusted response and rejects malformed/denied results", async () => {
  const seen = [];
  const api = createAdminUsersApi(async (url, init) => {
    seen.push({ url, init });
    return response(200, fixture);
  });
  const ok = await api.getUsers({ q: "test" });
  assert.equal(ok.status, "ok");
  assert.equal(ok.data.users[0].name, "Tester");
  assert.equal(seen[0].init.credentials, "same-origin");
  assert.equal(seen[0].init.cache, "no-store");
  assert.equal(seen[0].init.method, "GET");
  const invalid = createAdminUsersApi(async () => response(200, { users: [{ email: "private" }] }));
  assert.deepEqual(await invalid.getUsers({}), { status: "unavailable" });
  const forbidden = createAdminUsersApi(async () => response(403, { redirect: "https://evil.test" }));
  assert.deepEqual(await forbidden.getUsers({}), { status: "forbidden" });
  const denied = createAdminUsersApi(async () => response(401, {}));
  assert.deepEqual(await denied.getUsers({}), { status: "anonymous" });
});

test("MIG-0731 U01: permissions preserve repeated checkbox keys as JSON arrays", () => {
  assert.deepEqual(permissionsPayload(new Set(["members", "title"]), new Set(["chapters"])), {
    default_editable_fields: ["title", "members"],
    upcoming_editable_fields: ["chapters"],
  });
});

test("MIG-0731 U01: admin tab navigation preserves q/status only where CURRENT does", () => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(AdminUserManagementTabs, { view: "discord", q: "A&B", status: "banned" })));
  assert.match(html, /view=discord&amp;q=A%26B&amp;status=banned/);
  assert.match(html, /view=xid&amp;q=A%26B/);
  assert.match(html, /view=permissions/);
  assert.match(html, /\/admin\/x-link-requests/);
});

const detailFixture = {
  user: {
    id: "u1", name: "<script>alert(1)</script>", email: null, emailVerified: null,
    discord_id: "discord1", role: "user", can_create_events: 1,
    is_tos_accepted: 1, terms_reaccept_required: 0, is_banned: 0,
    is_notification_enabled: 1, active_x_user_id: "x1", created_at: 1700000000000,
  },
  xIds: [{ id: "x1", x_name: "creator", icon_url: null, approval_status: "approved" }],
  recentVideos: [{ id: "v1", title: "Video One", status: "public", created_at: 1700000000 }],
  recentByOperator: [], recentOnUser: [],
  likeCount: 2, bookmarkCount: 3, linkRequests: [],
};

test("MIG-0731 U02a: detail GET uses authorized no-store API and rejects malformed responses", async () => {
  const seen = [];
  const api = createAdminUsersApi(async (path, init) => {
    seen.push({ path, init });
    return response(200, detailFixture);
  });
  const result = await api.getUserDetail("u/1");
  assert.equal(result.status, "ok");
  assert.equal(result.data.user.id, "u1");
  assert.equal(seen[0].path, "/api/admin-read/users/u%2F1");
  assert.equal(seen[0].init.credentials, "same-origin");
  assert.equal(seen[0].init.cache, "no-store");
  assert.equal(seen[0].init.method, "GET");
  const malformed = createAdminUsersApi(async () => response(200, { user: { id: "u1" } }));
  assert.deepEqual(await malformed.getUserDetail("u1"), { status: "unavailable" });
  const forbidden = createAdminUsersApi(async () => response(403, { redirect: "https://evil.example" }));
  assert.deepEqual(await forbidden.getUserDetail("u1"), { status: "forbidden" });
  const anonymous = createAdminUsersApi(async () => response(401, {}));
  assert.deepEqual(await anonymous.getUserDetail("u1"), { status: "anonymous" });
  const notFound = createAdminUsersApi(async () => response(404, {}));
  assert.deepEqual(await notFound.getUserDetail("u1"), { status: "notFound" });
  assert.deepEqual(await api.getUserDetail(""), { status: "notFound" });
  assert.equal(seen.length, 1, "empty ID must not fetch");
});

test("MIG-0731 U02a: detail sections render private data only as React-escaped text", () => {
  const html = renderToStaticMarkup(React.createElement(AdminUserDetailContent, { data: detailFixture }));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  for (const label of ["IDの主体整理", "権限と状態", "連携 X ID", "投稿作品", "連携申請履歴",
    "このユーザーへの管理操作", "このユーザーが実行した管理操作"]) {
    assert.ok(html.includes(label), label);
  }
  assert.match(html, /Active X ライク: 2/);
  assert.match(html, /\/user\/x1/);
  assert.match(html, /\/admin\/users\/u1\/edit/);
});

test("MIG-0731 U02b: authorized edit DTO GET is fail-closed and no-store", async () => {
  const edit = {
    user: { id: "u1", name: "Tester", role: "user", is_banned: 0,
      can_create_events: 1, is_notification_enabled: 1 },
    xUserIds: ["x1"], truncated: false,
  };
  const calls = [];
  const api = createAdminUsersApi(async (path, init) => {
    calls.push({ path, init }); return response(200, edit);
  });
  const result = await api.getUserEdit("user/1");
  assert.equal(result.status, "ok");
  assert.equal(calls[0].path, "/api/admin-read/users/user%2F1/edit");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.credentials, "same-origin");
  const bad = createAdminUsersApi(async () => response(200, { ...edit, truncated: "no" }));
  assert.deepEqual(await bad.getUserEdit("u1"), { status: "unavailable" });
  const denied = createAdminUsersApi(async () => response(403, { redirect: "https://evil.example" }));
  assert.deepEqual(await denied.getUserEdit("u1"), { status: "forbidden" });
  const missing = createAdminUsersApi(async () => response(404, {}));
  assert.deepEqual(await missing.getUserEdit("u1"), { status: "notFound" });
  assert.deepEqual(await api.getUserEdit(""), { status: "notFound" });
  assert.equal(calls.length, 1);
  const markup = renderToStaticMarkup(React.createElement(AdminUserEditContent,
    { data: edit, onSaved() {} }));
  for (const label of ["ロール", "BAN 状態", "開催権限", "通知", "アイコン再計算"]) {
    assert.ok(markup.includes(label), label);
  }
});
test("MIG-0731 U02b: writes preserve exact Hono routes, JSON keys and fail-closed errors", async () => {
  const calls = [];
  const actions = createAdminUserEditMutations(async (path, init) => {
    calls.push({ path, init }); return response(200, { ok: true });
  });
  await actions.setRole("u/1", "moderator");
  await actions.setBanned("u/1", 1, "reason");
  await actions.setBanned("u/1", 0);
  await actions.setNotifications("u/1", 0);
  await actions.setCanCreateEvents("u/1", 1);
  await actions.refreshXIcon("x/1");
  assert.deepEqual(calls.map(x => x.path), [
    "/api/admin/users/u%2F1/role", "/api/admin/users/u%2F1/banned",
    "/api/admin/users/u%2F1/banned", "/api/admin/users/u%2F1/notifications",
    "/api/admin/users/u%2F1/can-create-events", "/api/admin/x-users/x%2F1/icon-refresh",
  ]);
  assert.deepEqual(calls.map(x => JSON.parse(x.init.body)), [
    { role: "moderator" }, { is_banned: 1, reason: "reason" },
    { is_banned: 0 }, { is_notification_enabled: 0 }, { can_create_events: 1 }, {},
  ]);
  assert.ok(calls.every(x => x.init.method === "POST" && x.init.credentials === "same-origin" &&
    x.init.cache === "no-store" && x.init.headers["content-type"] === "application/json"));
  assert.deepEqual(await actions.setBanned("u1", 1, ""), { status: "unavailable" });
  assert.equal(calls.length, 6, "missing BAN reason must never write");
  const bad = createAdminUserEditMutations(async () => response(500, { ok: true }));
  assert.deepEqual(await bad.setRole("u1", "user"), { status: "unavailable" });
  const denial = createAdminUserEditMutations(async () => response(401, {}));
  assert.deepEqual(await denial.setRole("u1", "admin"), { status: "anonymous" });
  const malformed = createAdminUserEditMutations(async () => response(200, { ok: "yes" }));
  assert.deepEqual(await malformed.setRole("u1", "admin"), { status: "unavailable" });
});

test("MIG-0731 U04: CURRENT detail navigation preserves encoded video and audit record links", () => {
  const data = {
    ...detailFixture,
    recentVideos: [{ id: "video/a&b", title: "My video", status: "public", created_at: 1700000000 }],
    recentByOperator: [{
      id: "audit1", created_at: 1700000000, table_name: "videos",
      operation: "UPDATE", actor_user_id: "u1", target_id: "row/a&b",
    }],
  };
  const html = renderToStaticMarkup(React.createElement(AdminUserDetailContent, { data }));
  assert.match(html, /href="\/admin\/videos\/video%2Fa%26b"/);
  assert.match(html, /href="\/admin\/audit\?record=row%2Fa%26b"/);
  assert.match(html, /My video/);
  assert.doesNotMatch(html, /href="\/admin\/videos\/video\/a&amp;b"/);
});

test("MIG-0731 U02b BAN confirmation is bound to unchanged reason and current user state", () => {
  assert.equal(canConfirmUserBan("rule violation", "rule violation", false, false), true);
  assert.equal(canConfirmUserBan(" rule violation ", "rule violation", false, false), true);
  assert.equal(canConfirmUserBan("changed", "rule violation", false, false), false);
  assert.equal(canConfirmUserBan("", "", false, false), false);
  assert.equal(canConfirmUserBan("rule violation", null, false, false), false);
  assert.equal(canConfirmUserBan("rule violation", "rule violation", true, false), false);
  assert.equal(canConfirmUserBan("rule violation", "rule violation", false, true), false);
  const markup = renderToStaticMarkup(React.createElement(AdminUserEditContent, {
    data: { user: { id: "u1", name: "Tester", role: "user", is_banned: 0,
      can_create_events: 0, is_notification_enabled: 1 }, xUserIds: [], truncated: false },
    onSaved() {},
  }));
  assert.match(markup, /BAN 理由/);
  assert.doesNotMatch(markup, /role="alertdialog"/);
});

test("MIG-0731 U02b: admin mutations use a synchronous single-flight guard", () => {
  const lock = { current: false };
  assert.equal(acquireAdminUserWriteLock(lock), true);
  assert.equal(lock.current, true);
  assert.equal(acquireAdminUserWriteLock(lock), false, "second synchronous action must not start");
  lock.current = false; // finally after request completion
  assert.equal(acquireAdminUserWriteLock(lock), true);
});

test("MIG-0731 U04: CURRENT legacy editable permission scope keys expand, never disappear", () => {
  const legacy = fieldsSetFromCsv("video.basics,video.members,video.member_chapters");
  assert.deepEqual([...legacy].sort(), ["title", "part", "is_collab", "members", "chapters"].sort());
  const json = fieldsSetFromCsv('["video.credits","title","invalid-key"]');
  assert.deepEqual([...json].sort(), ["music", "music_reference_url", "credit", "title"].sort());
  assert.deepEqual(permissionsPayload(legacy, new Set()).default_editable_fields,
    ["title", "part", "is_collab", "members", "chapters"]);
  assert.deepEqual([...fieldsSetFromCsv("unknown-key")], []);
});
