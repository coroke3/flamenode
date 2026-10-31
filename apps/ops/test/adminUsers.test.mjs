import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  normalizeUsersTab, usersListPath, usersPageHref, createAdminUsersApi,
} from "../.test-dist/apps/ops/src/api/adminUsers.js";
import { AdminUserManagementTabs } from "../.test-dist/apps/ops/src/components/admin/AdminUserManagementTabs.js";
import { permissionsPayload } from "../.test-dist/apps/ops/src/routes/admin/GlobalEditableFieldsPanel.js";

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
