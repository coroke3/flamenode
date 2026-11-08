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
import { AdminTopView, buildPendingItems, pendingTotal } from "../.test-dist/apps/ops/src/routes/admin/AdminTop.js";
import { PermissionSimulatorPanel } from "../.test-dist/apps/ops/src/routes/admin/PermissionSimulator.js";
import { CostGuardBannerView } from "../.test-dist/apps/ops/src/components/layout/CostGuardBanner.js";
import { OpsRoutes } from "../.test-dist/apps/ops/src/routes/router.js";
import {
  EMPTY_ADMIN_TOP, adminReadRedirect, fetchAdminTop, fetchPermissionSimulator, normalizeSimulatorQuery, parseAdminTop,
} from "../.test-dist/apps/ops/src/api/adminTop.js";
import { fetchCostGuardBanner, parseCostGuardBanner } from "../.test-dist/apps/ops/src/api/adminBanner.js";

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
  assert.equal(adminCompatTarget("/admin/history/"), "/admin/audit");
  assert.equal(adminCompatTarget("/admin/events/x/"), "/manage/events/x");
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
  assert.ok(target.includes(expected));
});

const html = (el, path = "/admin") => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [path] }, el));
const top = (counts) => ({ ...EMPTY_ADMIN_TOP, counts: { ...EMPTY_ADMIN_TOP.counts, ...counts } });
const json = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });

test("MIG-0726 T01: admin gate Location per role matches CURRENT layout :23-27", () => {
  const ok = (role) => ({ status: "ok", summary: { loggedIn: true, role, canAccessAdmin: role === "admin", canAccessManage: true } });
  assert.equal(decideOpsAccess("admin", { status: "anonymous" }), "/entry");
  assert.equal(decideOpsAccess("admin", { status: "unavailable" }), "/entry?error=auth_temporarily_unavailable");
  assert.equal(decideOpsAccess("admin", ok("user")), "/dashboard");
  assert.equal(decideOpsAccess("admin", ok("moderator")), "/dashboard");
  assert.equal(decideOpsAccess("admin", ok("admin")), "allow");
});

test("MIG-0726 T01: /admin never renders the frame or dashboard before the gate allows", () => {
  const api = { getSummary: async () => ({ status: "anonymous" }), checkManageNavigation: async () => "deny" };
  const out = html(React.createElement(OpsRoutes, { api }));
  assert.match(out, /読み込み中/);
  assert.doesNotMatch(out, /data-admin-shell|管理ダッシュボード/);
});

test("MIG-0726 T02: all-zero counts show the success EmptyState and a zero total", () => {
  const out = html(React.createElement(AdminTopView, { data: EMPTY_ADMIN_TOP }));
  assert.match(out, /対応待ちはありません/);
  assert.match(out, /対応待ちなし/);
  assert.match(out, /data-state="clear"/);
  assert.equal((out.match(/fn-admin-pending-card /g) ?? []).length, 10);
});

test("MIG-0726 T03: reservedOpenSlots is shown but not part of the pending total", () => {
  const data = top({ reservedOpenSlots: 5 });
  const items = buildPendingItems(data.counts);
  assert.equal(items.length, 10);
  assert.equal(pendingTotal(items), 0);
  const out = html(React.createElement(AdminTopView, { data }));
  assert.match(out, /未提出予約枠: 5 件/);
  assert.match(out, /対応待ちはありません/);
  const busy = top({ pendingVideos: 2, moderationOverdue: 1, reservedOpenSlots: 5 });
  assert.equal(pendingTotal(buildPendingItems(busy.counts)), 3);
  const busyHtml = html(React.createElement(AdminTopView, { data: busy }));
  assert.doesNotMatch(busyHtml, /対応待ちはありません/);
  assert.match(busyHtml, /確認が必要/);
  assert.match(busyHtml, /href="\/admin\/moderation\?status=open&amp;overdue=1"/);
  assert.match(busyHtml, /mode: normal/);
});

test("MIG-0726 T04: simulator with an empty input never calls the API and shows no result", async () => {
  let calls = 0;
  const fetchFn = async () => { calls += 1; return new Response("{}"); };
  for (const query of [{ eventId: "", xUserId: "x" }, { eventId: "evt_1", xUserId: "" }, { eventId: "", xUserId: "" }]) {
    const result = await fetchPermissionSimulator(fetchFn, query);
    assert.equal(result.status, "ok");
    assert.equal(result.data.result, null);
  }
  assert.equal(calls, 0);
  assert.deepEqual(normalizeSimulatorQuery(new URLSearchParams("event_id=%20evt_1%20&x_user_id=%20")), { eventId: "evt_1", xUserId: "" });
  assert.match(html(React.createElement(PermissionSimulatorPanel, { eventId: "evt_1", xUserId: "", result: null })), /条件を入力してシミュレートしてください/);
  let url = "";
  await fetchPermissionSimulator(async (input) => { url = input; return new Response('{"eventId":"a","xUserId":"b","result":null}'); }, { eventId: "a b", xUserId: "@x" });
  assert.equal(url, "/api/admin-read/permissions/simulator?event_id=a+b&x_user_id=%40x");
});

test("MIG-0726: a malformed simulator result is unavailable, not a render crash", async () => {
  const ok = { found: true, eventId: "e", xUserId: "x", displayName: null, preset: null, presetLabel: null,
    resolvedKeys: ["a"], resolvedLabels: ["A"], spotlight: [{ key: "a", label: "A", allowed: true }] };
  const query = { eventId: "e", xUserId: "x" };
  const read = (result) => fetchPermissionSimulator(
    async () => new Response(JSON.stringify({ eventId: "e", xUserId: "x", result })), query);
  assert.equal((await read(ok)).status, "ok");
  assert.equal((await read(null)).status, "ok");
  const { spotlight: _s, ...noSpotlight } = ok;
  assert.equal((await read(noSpotlight)).status, "unavailable");
  assert.equal((await read({ ...ok, spotlight: [{ key: 1 }] })).status, "unavailable");
  assert.equal((await read("x")).status, "unavailable");
});

test("MIG-0726 U03: simulator result links to the encoded staff page", () => {
  const result = { found: true, eventId: "a/b", xUserId: "alice", displayName: null, preset: "public_staff",
    presetLabel: "公開スタッフ", resolvedKeys: [], resolvedLabels: [], spotlight: [{ key: "k", label: "L", allowed: true }] };
  const out = html(React.createElement(PermissionSimulatorPanel, { eventId: "a/b", xUserId: "alice", result }));
  assert.match(out, /href="\/manage\/events\/a%2Fb\/staff"/);
  assert.match(out, /権限キーはありません/);
  assert.match(out, /@alice/);
});

test("MIG-0726 T05/T06: compat targets keep static events pages out of the redirect", () => {
  assert.equal(adminCompatTarget("/admin/events/a%2Fb/staff"), "/manage/events/a%2Fb/staff");
  assert.equal(adminCompatTarget("/admin/history"), "/admin/audit");
  assert.equal(adminCompatTarget("/admin/events/new"), null);
  assert.equal(adminCompatTarget("/admin/events/templates"), null);
  assert.equal(adminCompatTarget("/admin/events/new/edit"), "/manage/events/new/edit");
});

test("MIG-0726 D-17-2: admin-read 401/403 map to /entry and the allow-listed redirect", async () => {
  assert.equal(adminReadRedirect({ status: "anonymous" }), "/entry");
  assert.equal(adminReadRedirect({ status: "forbidden" }), "/dashboard");
  assert.equal(adminReadRedirect({ status: "forbidden", redirect: "/entry" }), "/entry");
  assert.equal(adminReadRedirect({ status: "unavailable" }), null);
  const forbidden = await fetchAdminTop(json({ redirect: "https://evil.example/" }, 403));
  assert.equal(forbidden.status, "forbidden");
  assert.equal(forbidden.redirect, undefined);
  assert.equal((await fetchAdminTop(json({}, 401))).status, "anonymous");
  assert.deepEqual(parseAdminTop({ counts: { pendingVideos: "x", youtubeFailed: -1 }, mode: 3 }), EMPTY_ADMIN_TOP);
});

test("MIG-0726 U02/U05: banner follows the MIG-0661 schema and renders nothing for normal or invalid", async () => {
  assert.equal(CostGuardBannerView({ mode: "normal", reason: null }), null);
  const out = html(React.createElement(CostGuardBannerView, { mode: "maintenance", reason: "r1" }));
  assert.match(out, /メンテナンス中:/);
  assert.match(out, /\(理由: r1\)/);
  assert.match(out, /role="status"/);
  assert.equal(parseCostGuardBanner({ mode: "bogus", reason: null }), null);
  assert.equal(parseCostGuardBanner({ mode: "economy", reason: "x".repeat(2049) }), null);
  assert.equal(parseCostGuardBanner({ mode: "economy" }), null);
  assert.deepEqual(parseCostGuardBanner({ mode: "economy", reason: null }), { mode: "economy", reason: null });
  let path = "";
  const ok = await fetchCostGuardBanner(async (input) => { path = input; return new Response('{"mode":"read_only","reason":null}'); });
  assert.equal(path, "/api/admin-read/cost-guard-banner");
  assert.equal(ok.status, "ok");
  assert.equal((await fetchCostGuardBanner(json({ mode: "zzz", reason: null }))).status, "unavailable");
  assert.equal((await fetchCostGuardBanner(json({}, 403))).status, "forbidden");
});

test("MIG-0726: banner CSS is the CURRENT module mapped to global names", async () => {
  const url = new URL("../../../", import.meta.url);
  const current = await readFile(new URL("src/components/layout/CostGuardBanner.module.css", url), "utf8");
  const target = await readFile(new URL("apps/ops/src/styles/admin-shell.css", url), "utf8");
  const expected = current.replaceAll(".banner", ".cost-guard-banner").replaceAll(".inner", ".cost-guard-banner-inner")
    .replaceAll(".reason", ".cost-guard-banner-reason");
  assert.ok(target.includes(expected.trim()));
});
