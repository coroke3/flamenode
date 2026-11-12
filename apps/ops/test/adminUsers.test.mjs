import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  normalizeUsersTab, usersListPath, usersPageHref, createAdminUsersApi,
} from "../.test-dist/apps/ops/src/api/adminUsers.js";
import { AdminUserManagementTabs } from "../.test-dist/apps/ops/src/components/admin/AdminUserManagementTabs.js";
import { AdminUserDetailContent, formatAdminVideoDate } from "../.test-dist/apps/ops/src/routes/admin/AdminUserDetail.js";
import { DiscordRows, XIdRows, formatAdminUserCreatedRelative } from "../.test-dist/apps/ops/src/routes/admin/AdminUsers.js";
import { AdminUserEditContent, canConfirmUserBan, acquireAdminUserWriteLock } from "../.test-dist/apps/ops/src/routes/admin/AdminUserEdit.js";
import { createAdminUserEditMutations } from "../.test-dist/apps/ops/src/api/adminUserEdits.js";
import { permissionsPayload, fieldsSetFromCsv, isValidPermissionSaveResponse, acquirePermissionSaveLock, createEditableFieldsMutations } from "../.test-dist/apps/ops/src/routes/admin/GlobalEditableFieldsPanel.js";

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

test("MIG-0731 U04: privileged permission save response is schema-validated and serialized", () => {
  const valid = {
    ok: true, message: "saved",
    settings: { default_editable_fields: "title", upcoming_editable_fields: null },
  };
  assert.equal(isValidPermissionSaveResponse(valid), true);
  assert.equal(isValidPermissionSaveResponse({ ...valid, message: { html: "<script>" } }), false);
  assert.equal(isValidPermissionSaveResponse({ ...valid,
    settings: { default_editable_fields: ["title"], upcoming_editable_fields: null } }), false);
  assert.equal(isValidPermissionSaveResponse({ ok: true, settings: {} }), false);
  assert.equal(isValidPermissionSaveResponse({ ok: "true" }), false);
  const lock = { current: false };
  assert.equal(acquirePermissionSaveLock(lock), true);
  assert.equal(acquirePermissionSaveLock(lock), false);
  lock.current = false;
  assert.equal(acquirePermissionSaveLock(lock), true);
});


test("MIG-0731 U04: CURRENT Discord and X-ID list avatar parity (icon, fallback, untrusted label)", () => {
  const discordWithImage = renderToStaticMarkup(React.createElement(DiscordRows, {
    rows: [{ ...fixture.users[0], image: "https://cdn.discordapp.com/avatars/u1/avatar.png" }],
  }));
  assert.match(discordWithImage, /<img[^>]*src="https:\/\/cdn\.discordapp\.com\/avatars\/u1\/avatar\.png"/);
  assert.match(discordWithImage, /Tester/);
  const discordFallback = renderToStaticMarkup(React.createElement(DiscordRows, {
    rows: [{ ...fixture.users[0], name: "<admin>", image: null }],
  }));
  assert.doesNotMatch(discordFallback, /<img/);
  assert.match(discordFallback, /&lt;admin&gt;/);
  assert.doesNotMatch(discordFallback, /<admin>/);

  const x = {
    id: "x-user/1", x_name: "X Persona", icon_url: "https://drive.google.com/file/d/abcDEF123/view",
    approval_status: "approved", primary_auth_user_id: null,
    primary_auth_user_name: null, linked_auth_user_count: 0, active_holder_count: 0,
  };
  const xImage = renderToStaticMarkup(React.createElement(XIdRows, { rows: [x] }));
  assert.match(xImage, /<img[^>]*src="\/api\/google-drive-image\/abcDEF123"/);
  assert.match(xImage, /X Persona/);
  const xFallback = renderToStaticMarkup(React.createElement(XIdRows, {
    rows: [{ ...x, icon_url: null, x_name: "<private>" }],
  }));
  assert.doesNotMatch(xFallback, /<img/);
  assert.match(xFallback, /&lt;private&gt;/);
  assert.doesNotMatch(xFallback, /<private>/);
});


test("MIG-0731 U04: both admin user tables preserve CURRENT keyboard-accessible horizontal scroll", () => {
  const discord = renderToStaticMarkup(React.createElement(DiscordRows, { rows: fixture.users }));
  const xId = renderToStaticMarkup(React.createElement(XIdRows, { rows: [] }));
  for (const html of [discord, xId]) {
    assert.match(html, /class="fn-hscroll-surface"/);
    assert.match(html, /class="fn-table-scroll fn-scroll-affordance"/);
    assert.match(html, /横にスクロールして全体を表示できます/);
    assert.match(html, /<table class="fn-table"/);
    assert.match(html, /<thead>/);
  }
  assert.match(discord, /Discord/);
  assert.match(xId, /Discord連携/);
});


test("MIG-0731 U04: CURRENT X-ID approval badge semantics survive Ops migration", () => {
  const base = {
    id: "x1", x_name: "Account", icon_url: null,
    primary_auth_user_id: null, primary_auth_user_name: null,
    linked_auth_user_count: 0, active_holder_count: 0,
  };
  for (const [status, tone, label] of [
    ["approved", "accent", "承認済み"],
    ["rejected", "danger", "却下"],
    ["pending", "warning", "承認待ち"],
    [null, "warning", "未設定"],
    ["imported", "warning", "未設定"],
  ]) {
    const html = renderToStaticMarkup(React.createElement(XIdRows, {
      rows: [{ ...base, approval_status: status }],
    }));
    assert.ok(html.includes('class="fn-badge fn-badge-' + tone + '">' + label + "</span>"),
      "incorrect approval status badge for " + String(status));
  }
  const active = renderToStaticMarkup(React.createElement(XIdRows, {
    rows: [{ ...base, approval_status: "approved", active_holder_count: 2 }],
  }));
  assert.match(active, /class="fn-badge fn-badge-soft"[^>]*>active<\/span>/);
});

test("MIG-0731 U04: CURRENT registration relative-time boundary parity (seconds and milliseconds)", () => {
  const now = 1800000000;
  const cases = [
    [0, "今"], [59, "今"], [60, "1分前"], [3599, "59分前"],
    [3600, "1時間前"], [86399, "23時間前"], [86400, "1日前"],
    [2591999, "29日前"], [2592000, "1か月前"],
    [31535999, "12か月前"], [31536000, "1年前"],
  ];
  for (const [age, expected] of cases) {
    assert.equal(formatAdminUserCreatedRelative(now - age, now), expected, "seconds: " + age);
    assert.equal(formatAdminUserCreatedRelative((now - age) * 1000, now), expected, "milliseconds: " + age);
  }
  assert.equal(formatAdminUserCreatedRelative(Number.NaN, now), "");
  assert.equal(formatAdminUserCreatedRelative(now + 10, now), "今");
});

test("MIG-0731 U04: CURRENT Discord role badges and audit link semantics", () => {
  const base = { ...fixture.users[0], can_create_events: 0 };
  const cases = [
    [{ role: "admin", is_banned: 0 }, "fn-badge-accent", "ADMIN"],
    [{ role: "moderator", is_banned: 0 }, "fn-badge-warning", "MOD"],
    [{ role: "user", is_banned: 0 }, "fn-badge-soft", "USER"],
    [{ role: null, is_banned: 0 }, "fn-badge-soft", "USER"],
    [{ role: "admin", is_banned: 1 }, "fn-badge-danger", "BAN"],
  ];
  for (const [fields, tone, label] of cases) {
    const html = renderToStaticMarkup(React.createElement(DiscordRows, {
      rows: [{ ...base, ...fields }],
    }));
    assert.ok(html.includes('class="fn-badge ' + tone + '">' + label + '</span>'),
      "incorrect role badge for " + JSON.stringify(fields));
    assert.match(html, /title="このユーザーが実行した管理操作の監査ログ"/);
    assert.match(html, /href="\/admin\/audit\?actor=u1"/);
  }
  const hosted = renderToStaticMarkup(React.createElement(DiscordRows, {
    rows: [{ ...base, can_create_events: 1 }],
  }));
  assert.match(hosted, /fn-badge fn-badge-accent" style="margin-left:4px">開催可/);
});

test("MIG-0731 U04: CURRENT detail privilege badges distinguish role, BAN, TOS, email, active X", () => {
  const render = (userChanges) => renderToStaticMarkup(React.createElement(AdminUserDetailContent, {
    data: { ...detailFixture, user: { ...detailFixture.user, ...userChanges } },
  }));
  const admin = render({ role: "admin", is_banned: 1, is_tos_accepted: 0,
    can_create_events: 1, emailVerified: null, terms_reaccept_required: 1 });
  assert.match(admin, /class="fn-badge fn-badge-accent">role: admin/);
  assert.match(admin, /class="fn-badge fn-badge-danger">BAN: ON/);
  assert.match(admin, /class="fn-badge fn-badge-danger">TOS: 未同意/);
  assert.match(admin, /class="fn-badge fn-badge-warning">email 認証: 未/);
  assert.match(admin, /class="fn-badge fn-badge-warning">再同意要求中/);
  assert.match(admin, /class="fn-badge fn-badge-accent">開催権限: ON/);
  assert.match(admin, /Active X: @x1/);

  const moderator = render({ role: "moderator", is_banned: 0, is_tos_accepted: 1,
    can_create_events: 0, emailVerified: 1700000000, terms_reaccept_required: 0 });
  assert.match(moderator, /class="fn-badge fn-badge-warning">role: moderator/);
  assert.match(moderator, /class="fn-badge fn-badge-soft">BAN: OFF/);
  assert.match(moderator, /class="fn-badge fn-badge-accent">TOS: 同意済/);
  assert.match(moderator, /class="fn-badge fn-badge-accent">email 認証: 済/);
  assert.match(moderator, /class="fn-badge fn-badge-neutral">開催権限: OFF/);
  assert.doesNotMatch(moderator, /再同意要求中/);
});

test("MIG-0731 U04: CURRENT detail hides Active X library counts when there is no active identity", () => {
  const html = renderToStaticMarkup(React.createElement(AdminUserDetailContent, {
    data: { ...detailFixture, user: { ...detailFixture.user, active_x_user_id: null },
      likeCount: 0, bookmarkCount: 0 },
  }));
  assert.match(html, /Active X: -/);
  assert.doesNotMatch(html, /Active X ライク:/);
  assert.doesNotMatch(html, /Active X ブックマーク:/);
  assert.match(html, /連携 X ID/);
});

test("MIG-0731 U04: every privileged user mutation invalidates access on 403 regardless of body", async () => {
  for (const body of [{ ok: false, message: "Not authorized" }, { ok: true }, { error: "no access" }]) {
    const calls = [];
    const writes = createAdminUserEditMutations(async (path, init) => {
      calls.push({ path, init });
      return response(403, body);
    });
    for (const action of [
      () => writes.setRole("u1", "moderator"),
      () => writes.setBanned("u1", 1, "reason"),
      () => writes.setNotifications("u1", 0),
      () => writes.setCanCreateEvents("u1", 1),
      () => writes.refreshXIcon("x1"),
    ]) {
      assert.deepEqual(await action(), { status: "forbidden" });
    }
    assert.equal(calls.length, 5);
    assert.ok(calls.every(({ init }) => init.credentials === "same-origin" &&
      init.cache === "no-store"));
  }
  const noJson = createAdminUserEditMutations(async () =>
    new Response("forbidden", { status: 403, headers: { "content-type": "text/plain" } }));
  assert.deepEqual(await noJson.setRole("u1", "user"), { status: "forbidden" });
  const validError = createAdminUserEditMutations(async () => response(400, {
    ok: false, message: "Invalid role",
  }));
  assert.deepEqual(await validError.setRole("u1", "user"),
    { status: "ok", data: { ok: false, message: "Invalid role" } });
});

test("MIG-0731 U04: permission policy writes fail closed on 403 without changing shared transport", async () => {
  const payload = permissionsPayload(new Set(["title"]), new Set());
  const calls = [];
  const denied = createEditableFieldsMutations(async (path, init) => {
    calls.push({ path, init });
    return response(403, { ok: false, message: "role revoked" });
  });
  assert.deepEqual(await denied.save(payload), { status: "forbidden" });
  assert.deepEqual(calls.map((c) => c.path), ["/api/admin/permissions/editable-fields"]);
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(JSON.parse(calls[0].init.body), payload);

  const malformedDenied = createEditableFieldsMutations(async () =>
    new Response("no", { status: 403 }));
  assert.deepEqual(await malformedDenied.save(payload), { status: "forbidden" });

  const notLoggedIn = createEditableFieldsMutations(async () => response(401, {}));
  assert.deepEqual(await notLoggedIn.save(payload), { status: "anonymous" });
  const validationError = createEditableFieldsMutations(async () => response(400, {
    ok: false, message: "Invalid payload",
  }));
  assert.deepEqual(await validationError.save(payload), {
    status: "ok", data: { ok: false, message: "Invalid payload" },
  });
});


test("MIG-0731 U04: linked-X detail uses CURRENT cards, active marker, approval tones, escaped labels", () => {
  const data = { ...detailFixture,
    xIds: [
      { id: "x/active", x_name: "<unsafe>", icon_url: null, approval_status: "approved" },
      { id: "x-pending", x_name: "Pending", icon_url: null, approval_status: "pending" },
      { id: "x-rejected", x_name: "Rejected", icon_url: null, approval_status: "rejected" },
    ],
    user: { ...detailFixture.user, active_x_user_id: "x/active" },
  };
  const html = renderToStaticMarkup(React.createElement(AdminUserDetailContent, { data }));
  assert.match(html, /class="fn-console-xid-grid"/);
  assert.match(html, /class="fn-console-xid-card fn-console-xid-card--active"/);
  assert.match(html, /class="fn-badge fn-badge-soft">Active<\/span>/);
  assert.match(html, /class="fn-badge fn-badge-accent">承認<\/span>/);
  assert.match(html, /class="fn-badge fn-badge-warning">待ち<\/span>/);
  assert.match(html, /class="fn-badge fn-badge-danger">却下<\/span>/);
  assert.match(html, /href="\/user\/x%2Factive"/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.equal((html.match(/class="fn-console-xid-card/g) ?? []).length, 3);
});

test("MIG-0731 U04: linked-X request table preserves CURRENT status badges, scrolling and escaping", () => {
  const data = { ...detailFixture, linkRequests: [
    { id: "r1", requested_x_id: "x&y", link_type: "merge", target_x_user_id: null, status: "rejected", requested_at: 1700000000 },
    { id: "r2", requested_x_id: "alias", link_type: "alias", target_x_user_id: "<x>", status: "approved", requested_at: 1700000000 },
    { id: "r3", requested_x_id: null, link_type: null, target_x_user_id: null, status: null, requested_at: 1700000000 },
  ] };
  const html = renderToStaticMarkup(React.createElement(AdminUserDetailContent, { data }));
  assert.match(html, /class="fn-hscroll-surface"/);
  assert.match(html, /class="fn-table-scroll fn-scroll-affordance"/);
  assert.match(html, /横にスクロールして全体を表示できます/);
  assert.match(html, /class="fn-badge fn-badge-danger">merge<\/span>/);
  assert.match(html, /class="fn-badge fn-badge-warning">alias<\/span>/);
  assert.match(html, /class="fn-badge fn-badge-soft">new<\/span>/);
  assert.match(html, /class="fn-badge fn-badge-danger">rejected<\/span>/);
  assert.match(html, /class="fn-badge fn-badge-accent">approved<\/span>/);
  assert.match(html, /class="fn-badge fn-badge-warning">pending<\/span>/);
  assert.match(html, /&lt;x&gt;/);
  assert.doesNotMatch(html, /<x>/);
  assert.match(html, /@x&amp;y/);
});


test("MIG-0731 U04: two audit timelines use CURRENT-specific fourth column and action tones", () => {
  const data = { ...detailFixture,
    recentOnUser: [
      { id: "t1", created_at: 1700000000, table_name: "users",
        operation: "DELETE", actor_user_id: "admin<1>", target_id: "u1" },
      { id: "t2", created_at: 1700000001, table_name: "users",
        operation: "CREATE", actor_user_id: null, target_id: "u1" },
    ],
    recentByOperator: [
      { id: "o1", created_at: 1700000002, table_name: "videos",
        operation: "UPDATE", actor_user_id: "u1", target_id: "record/a&b" },
    ],
  };
  const html = renderToStaticMarkup(React.createElement(AdminUserDetailContent, { data }));
  const target = html.split("このユーザーへの管理操作 (target_id 一致)")[1]
    .split("このユーザーが実行した管理操作 (operator 一致)")[0];
  const operator = html.split("このユーザーが実行した管理操作 (operator 一致)")[1];
  assert.match(target, /<th>実行者<\/th>/);
  assert.doesNotMatch(target, /<th>レコード<\/th>/);
  assert.match(target, /class="fn-badge fn-badge-danger">DELETE<\/span>/);
  assert.match(target, /class="fn-badge fn-badge-accent">CREATE<\/span>/);
  assert.match(target, /admin&lt;1&gt;/);
  assert.doesNotMatch(target, /<admin/);
  assert.match(operator, /<th>レコード<\/th>/);
  assert.doesNotMatch(operator, /<th>実行者<\/th>/);
  assert.match(operator, /class="fn-badge fn-badge-soft">UPDATE<\/span>/);
  assert.match(operator, /href="\/admin\/audit\?record=record%2Fa%26b"/);
  for (const section of [target, operator]) {
    assert.match(section, /class="fn-hscroll-surface"/);
    assert.match(section, /横にスクロールして全体を表示できます/);
  }
});

test("MIG-0731 U04: empty audit timelines do not expose table headers or stale data", () => {
  const html = renderToStaticMarkup(React.createElement(AdminUserDetailContent, {
    data: { ...detailFixture, recentOnUser: [], recentByOperator: [] },
  }));
  const section = html.split("このユーザーへの管理操作 (target_id 一致)")[1];
  assert.equal((section.match(/該当する履歴はありません。/g) ?? []).length, 2);
  assert.doesNotMatch(section, /<th>実行者<\/th>/);
  assert.doesNotMatch(section, /<th>レコード<\/th>/);
});


test("MIG-0731 U04: CURRENT video date is formatted in explicit JST, not runner timezone", () => {
  assert.equal(formatAdminVideoDate(Date.UTC(2020, 0, 1, 0, 0) / 1000), "2020/01/01");
  assert.equal(formatAdminVideoDate(Date.UTC(2019, 11, 31, 16, 0) / 1000), "2020/01/01");
  assert.equal(formatAdminVideoDate(Date.UTC(2019, 11, 31, 14, 59) / 1000), "2019/12/31");
  assert.equal(formatAdminVideoDate(Number.NaN), "—");
  assert.equal(formatAdminVideoDate(Number.POSITIVE_INFINITY), "—");
});

test("MIG-0731 U04: CURRENT detail uses relative audit/registration/application times and verified-email note", () => {
  const now = Math.floor(Date.now() / 1000);
  const data = {
    ...detailFixture,
    user: { ...detailFixture.user, created_at: (now - 120) * 1000,
      emailVerified: (now - 3700) * 1000 },
    recentVideos: [{ id: "v1", title: "Video One", status: "public",
      created_at: Date.UTC(2019, 11, 31, 16, 0) / 1000 }],
    recentOnUser: [{ id: "a1", table_name: "users", operation: "CREATE",
      actor_user_id: "admin", target_id: "u1", created_at: now - 120 }],
    recentByOperator: [],
    linkRequests: [{ id: "r1", requested_x_id: "x1", link_type: "new",
      target_x_user_id: null, status: "pending", requested_at: now - 120 }],
  };
  const html = renderToStaticMarkup(React.createElement(AdminUserDetailContent, { data }));
  assert.match(html, /登録 2分前/);
  assert.match(html, /email認証 1時間前/);
  assert.match(html, /Video One/);
  assert.match(html, /2020\/01\/01/);
  const relativeCount = (html.match(/2分前/g) ?? []).length;
  assert.ok(relativeCount >= 3, "registration, application and audit should use relative timestamps");
  const unverified = renderToStaticMarkup(React.createElement(AdminUserDetailContent, {
    data: { ...data, user: { ...data.user, emailVerified: null } },
  }));
  assert.doesNotMatch(unverified, /class="fn-console-note">email認証/);
});
