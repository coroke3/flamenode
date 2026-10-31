import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { readFile } from "node:fs/promises";
import { AdminLayoutFrame } from "../.test-dist/apps/ops/src/routes/admin/AdminLayout.js";
import { AdminSidebarNav, isAdminNavActive } from "../.test-dist/apps/ops/src/routes/admin/AdminSidebarNav.js";
import { buildAdminNavGroups } from "../.test-dist/apps/ops/src/routes/admin/AdminNavGroups.js";
import { adminCompatTarget } from "../.test-dist/apps/ops/src/routes/admin/AdminRedirects.js";
import { decideOpsAccess } from "../.test-dist/apps/ops/src/routes/guard.js";

test("MIG-0726 U01: CURRENT admin layout element order, navigation and gated admin shell", () => {
  const html = renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: ["/admin"] },
      React.createElement(AdminLayoutFrame, {
        banner: React.createElement("div", { "data-testid": "banner" }),
        header: React.createElement("header", { "data-testid": "header" }),
        footer: React.createElement("footer", { "data-testid": "footer" }),
      }, React.createElement("p", null, "admin-content"))),
  );
  const index = (needle) => html.indexOf(needle);
  for (const token of ["data-admin-shell", 'data-fn-surface="admin"', 'data-console-mode="admin"',
    'class="admin-main"', "admin-content", 'aria-label="管理ナビゲーション"']) {
    assert.ok(index(token) !== -1, "missing " + token);
  }
  assert.ok(index('data-testid="banner"') < index('data-testid="header"'));
  assert.ok(index('data-testid="header"') < index('data-console-mode="admin"'));
  assert.ok(index("admin-content") < index('data-testid="footer"'));
  assert.ok(index("ADMIN") < index("管理ナビゲーション"));
  assert.equal(decideOpsAccess("admin", { status: "ok", summary: {
    loggedIn: true, role: "moderator", canAccessAdmin: true, canAccessManage: true
  }}), "/dashboard");
});

test("MIG-0726 U01: CURRENT nav order, query preference and route active state", () => {
  const groups = buildAdminNavGroups();
  assert.deepEqual(groups.map(g => g.title), [
    "概要", "審査・申請", "コンテンツ", "イベント", "ユーザー・権限", "システム", "高度な管理",
  ]);
  assert.equal(groups.flatMap(g => g.items).length, 22);
  assert.equal(buildAdminNavGroups(true).flatMap(g => g.items).at(-1).href, "/admin/spreadsheet");
  assert.equal(isAdminNavActive("/admin", "/admin/videos", "", groups), false);
  assert.equal(isAdminNavActive("/admin/videos?status=pending", "/admin/videos", "?status=pending", groups), true);
  assert.equal(isAdminNavActive("/admin/videos", "/admin/videos", "?status=pending", groups), false);
  assert.equal(isAdminNavActive("/admin/videos", "/admin/videos/abc", "", groups), true);
  assert.equal(isAdminNavActive("/admin/videos?status=pending", "/admin/videos", "?status=published", groups), false);
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ["/admin/videos?status=pending"] },
    React.createElement(AdminSidebarNav)));
  assert.match(html, /aria-current="page"/);
  assert.match(html, /管理ナビゲーション/);
  assert.match(html, /承認待ち作品/);
});

test("MIG-0726 U04: all five CURRENT compatible redirects preserve encoded ids", () => {
  for (const suffix of ["", "/edit", "/slots", "/staff"]) {
    assert.equal(adminCompatTarget("/admin/events/a%2Fb" + suffix),
      "/manage/events/a%2Fb" + suffix);
    assert.equal(adminCompatTarget("/admin/events/%E3%83%86%E3%82%B9%E3%83%88" + suffix),
      "/manage/events/%E3%83%86%E3%82%B9%E3%83%88" + suffix);
  }
  assert.equal(adminCompatTarget("/admin/history"), "/admin/audit");
  for (const path of ["/admin/events", "/admin/events/a/more", "/admin/other",
    "/admin/events/%bad/staff"]) assert.equal(adminCompatTarget(path), null);
});

test("MIG-0726: admin navigation CSS is token-for-token parity with CURRENT scoped selectors", async () => {
  const url = new URL("../../../", import.meta.url);
  const current = await readFile(new URL("src/components/admin/AdminSidebarNav.module.css", url), "utf8");
  const target = await readFile(new URL("apps/ops/src/styles/admin-shell.css", url), "utf8");
  let expected = current;
  for (const [before, after] of [
    [".navGroupTitle", ".admin-nav-group-title"],
    [".navLinkActive", ".admin-nav-link-active"],
    [".navGroup", ".admin-nav-group"],
    [".navLink", ".admin-nav-link"],
    [".nav", ".admin-nav"],
  ]) expected = expected.replaceAll(before, after);
  assert.ok(target.endsWith(expected));
});
