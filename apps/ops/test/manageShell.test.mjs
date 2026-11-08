import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { MemoryRouter } from "react-router-dom";
import { loadManageNavigation } from "../.test-dist/apps/ops/src/api/manageNavigation.js";
import { loadManageDashboard } from "../.test-dist/apps/ops/src/api/manageDashboard.js";
import { loadOperationMode } from "../.test-dist/apps/ops/src/api/operationMode.js";
import { shouldRenderManageSidebar, decideManageNavigation } from "../.test-dist/apps/ops/src/routes/manage/ManageLayout.js";
import { shouldWarnManageActiveXMismatch } from "../.test-dist/apps/ops/src/routes/manage/ManageActiveXNotice.js";
import { ManageSidebarNav, classifyManageEvent, filterManageEvents, isManageHrefActive } from "../.test-dist/apps/ops/src/routes/manage/ManageSidebarNav.js";
import { manageReviewTarget } from "../.test-dist/apps/ops/src/routes/manage/ManageReviewRedirect.js";
import { manageKpiClasses, ManageDashboardContent } from "../.test-dist/apps/ops/src/routes/manage/ManageDashboard.js";
import { NotificationOutboxSummary } from "../.test-dist/apps/ops/src/components/notifications/NotificationOutboxSummary.js";
import { summarizeNotificationPayload } from "../.test-dist/apps/ops/src/components/notifications/notificationDisplay.js";
import { formatUnix, formatRelative } from "../.test-dist/apps/ops/src/routes/manage/manageFormat.js";

const access = { isAdmin: false, canAccessAdmin: false, canAccessManage: true, canManageXIdLinkRequests: false };
const event = { id: "e1", title: "Event 1", accent_color: null, visibility_status: "public", start_time: null, end_time: null, entry_start_time: null, entry_end_time: null, pending_review_count: 3 };
const nav = { access, activeXUserId: "writer", manageStaffXUserIds: ["editor"], events: [event], truncated: false };
const dashboard = { ...nav, events: [{ ...event, staff_role: "representative" }], eventsTruncated: false,
  pendingReviewTotal: 3, acceptingEventCount: 1, failedNotificationCount: 1,
  notificationSchemaMissing: false, notifications: [], inbox: [] };
const fetchJson = (code, body) => async (path, init) => {
  assert.equal(init.method, "GET");
  assert.equal(init.cache, "no-store");
  assert.equal(init.credentials, "same-origin");
  assert.ok(path.startsWith("/api/"));
  return new Response(JSON.stringify(body), { status: code, headers: { "content-type": "application/json" } });
};

test("MIG-0719 T01: Manage navigation uses canonical DTO, 403 reason and fail-closed semantics", async () => {
  const ok = await loadManageNavigation(fetchJson(200, nav));
  assert.equal(ok.status, "ok");
  assert.equal(ok.data.events[0].id, "e1");
  assert.equal(decideManageNavigation(ok), null);
  const denial = await loadManageNavigation(fetchJson(403, { reason: "manage_access_required" }));
  assert.equal(decideManageNavigation(denial), "/dashboard");
  const unexpected = await loadManageNavigation(fetchJson(403, { error: "Forbidden" }));
  assert.match(decideManageNavigation(unexpected), /auth_temporarily_unavailable/);
  assert.equal(decideManageNavigation(await loadManageNavigation(fetchJson(401, {}))), "/entry");
  for (const broken of [{ ...nav, events: [ { id: "bad" } ] }, { ...nav, manageStaffXUserIds: null }, []]) {
    assert.equal((await loadManageNavigation(fetchJson(200, broken))).status, "unavailable");
  }
  assert.equal((await loadManageNavigation(fetchJson(503, {}))).status, "unavailable");
});

test("MIG-0719 T02/T07: sidebar absent with no permissions; Active X warning is presentation only", () => {
  assert.equal(shouldRenderManageSidebar({ ...nav, events: [] }), false);
  assert.equal(shouldRenderManageSidebar({ ...nav, access: { ...access, isAdmin: true }, events: [] }), true);
  assert.equal(shouldRenderManageSidebar({ ...nav, access: { ...access, canManageXIdLinkRequests: true }, events: [] }), true);
  assert.equal(shouldWarnManageActiveXMismatch("writer", ["writer"]), false);
  assert.equal(shouldWarnManageActiveXMismatch("writer", ["editor"]), true);
  assert.equal(shouldWarnManageActiveXMismatch(null, ["editor"]), false);
  assert.equal(shouldWarnManageActiveXMismatch("writer", []), false);
  assert.equal(isManageHrefActive("/manage", "/manage/events/e1"), false);
  assert.equal(isManageHrefActive("/manage/events/e1", "/manage/events/e1/slots"), true);
  assert.deepEqual(filterManageEvents([event], " EVENT "), [event]);
  assert.equal(classifyManageEvent(event), "active");
  assert.equal(classifyManageEvent({ ...event, visibility_status: "private" }), "ended");
});

test("MIG-0719 T02: sidebar remains usable when browser localStorage throws", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "https://flamenode.test/manage/events/e1",
  });
  // Simulate the browser refusing both storage reads and writes.
  Object.defineProperty(dom.window, "localStorage", {
    configurable: true,
    get() { throw new Error("SecurityError: blocked storage"); },
  });
  const keys = ["window", "document", "navigator", "HTMLElement", "Node", "IS_REACT_ACT_ENVIRONMENT"];
  const original = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys.slice(0, 5)) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    await React.act(async () => {
      root.render(React.createElement(MemoryRouter, { initialEntries: ["/manage/events/e1"] },
        React.createElement(ManageSidebarNav, {
          events: [event], showXLinkRequests: false, warnActiveX: false, activeX: null,
        })));
    });
    assert.match(dom.window.document.body.textContent, /Event 1/);
    assert.match(dom.window.document.body.textContent, /最近/);
    assert.match(dom.window.document.body.textContent, /運営トップ/);
  } finally {
    await React.act(async () => { root.unmount(); });
    for (const key of keys) {
      const descriptor = original.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});

test("MIG-0719 T03: dashboard validates DTO; pending and failed KPI, alert and empty state", async () => {
  assert.equal((await loadManageDashboard(fetchJson(200, dashboard))).status, "ok");
  assert.equal((await loadManageDashboard(fetchJson(200, { ...dashboard, pendingReviewTotal: "3" }))).status, "unavailable");
  assert.match(manageKpiClasses(dashboard).pending, /--warn/);
  assert.match(manageKpiClasses(dashboard).failed, /--danger/);
  assert.doesNotMatch(manageKpiClasses({ pendingReviewTotal: 0, failedNotificationCount: 0 }).pending, /--warn/);
  const render = data => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(ManageDashboardContent, { data })));
  const html = render(dashboard);
  assert.match(html, /通知センターで確認/);
  assert.match(html, /審査待ち作品 3 件/);
  assert.match(html, /Active X ID と運営権限/);
  assert.match(html, /運営状況一覧/);
  assert.match(render({ ...dashboard, events: [] }), /担当イベントはありません/);
});

test("MIG-0719 T04: review redirect encodes opaque ID only once", () => {
  assert.equal(manageReviewTarget("a b"), "/manage/events/a%20b/videos?status=pending");
  assert.equal(manageReviewTarget("a/b"), "/manage/events/a%2Fb/videos?status=pending");
});

test("MIG-0719 T05: operation-mode banner all modes, normal and failed", async () => {
  for (const mode of ["normal", "economy", "read_only", "static_only", "maintenance"]) {
    const response = await loadOperationMode(fetchJson(200, { mode, reason: "テスト" }));
    assert.deepEqual(response, { status: "ok", data: { mode, reason: "テスト" } });
  }
  assert.equal((await loadOperationMode(fetchJson(200, { mode: "future", reason: null }))).status, "unavailable");
  assert.equal((await loadOperationMode(fetchJson(200, { mode: "economy", reason: "x".repeat(2049) }))).status, "unavailable");
  assert.equal((await loadOperationMode(fetchJson(503, {}))).status, "unavailable");
  assert.equal(summarizeNotificationPayload(JSON.stringify({ content: "one\ntwo" })).preview, "one");
  assert.equal(summarizeNotificationPayload("{").preview, "—");
});

test("MIG-0719 T06: Ops packaging dry-run has a fixed target and rejects routes/bindings", async () => {
  const { assertOpsStaticConfig, opsDryRunArgs } = await import("../scripts/dryRun.mjs");
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.equal(assertOpsStaticConfig(config), true);
  // The offline-only packaging guard must not silently accept a changed runtime
  // compatibility profile, or a missing profile that Wrangler will default.
  const date = 'compatibility_date = "2026-07-21"';
  const flags = 'compatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]';
  assert.ok(config.includes(date) && config.includes(flags));
  assert.throws(() => assertOpsStaticConfig(config.replace(date, 'compatibility_date = "2027-01-01"')), /Unsafe Ops config value: \.compatibility_date/);
  assert.throws(() => assertOpsStaticConfig(config.replace(flags, 'compatibility_flags = ["nodejs_compat", "unsafe_eval"]')), /Unsafe Ops config value: \.compatibility_flags/);
  assert.throws(() => assertOpsStaticConfig(config.replace(date, "")), /Missing mandatory Ops config key: \.compatibility_date/);
  assert.throws(() => assertOpsStaticConfig(config.replace(flags, "")), /Missing mandatory Ops config key: \.compatibility_flags/);
  assert.throws(() => assertOpsStaticConfig(config + '\nroute = "example.invalid/*"'), /Unapproved/);
  assert.throws(() => assertOpsStaticConfig(config + '\n[[d1_databases]]'), /only one assets table/);
  assert.throws(() => assertOpsStaticConfig(config.replace("workers_dev = false", "workers_dev = true")), /Unsafe/);
  const args = opsDryRunArgs(resolve("/tmp/ops-review-only"));
  assert.ok(args.includes("--dry-run"));
  assert.ok(args.includes("apps/ops/wrangler.toml"));
  assert.throws(() => opsDryRunArgs("relative/path"), /Absolute/);
});

test("MIG-0719 router: admin routes keep a single main landmark", async () => {
  const { OpsRoutes } = await import("../.test-dist/apps/ops/src/routes/router.js");
  const dom = new JSDOM("<!doctype html><div id=root></div>", { url: "http://localhost/admin/cost-guard" });
  const saved = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  try {
    const api = {
      getSummary: async () => ({ status: "ok", summary: { role: "admin", canAccessAdmin: true, canAccessManage: true } }),
      checkManageNavigation: async () => "allow",
    };
    const root = createRoot(dom.window.document.getElementById("root"));
    root.render(React.createElement(MemoryRouter, { initialEntries: ["/admin/cost-guard"] }, React.createElement(OpsRoutes, { api })));
    for (let i = 0; i < 50 && !dom.window.document.querySelector("main"); i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(dom.window.document.querySelectorAll("main").length, 1);
    root.unmount();
  } finally {
    globalThis.window = saved.window; globalThis.document = saved.document;
  }
});

test("MIG-0719 U03 parity: notification summary matches CURRENT label, badges, guidance and translated error", () => {
  const row = { type: "video_approved", status: "failed", payload_json: JSON.stringify({ content: "hello" }), attempt_count: 5, last_error: "discord_dm_bot_token_unconfigured", dedupe_key: null, recipient_user_id: null };
  const html = renderToStaticMarkup(React.createElement(NotificationOutboxSummary, { row }));
  assert.match(html, /作品が公開されました/);
  assert.doesNotMatch(html, />video_approved</);
  assert.match(html, /fn-badge-danger">失敗</);
  assert.match(html, />作品</);
  assert.match(html, /宛先: 運営チャンネル/);
  assert.match(html, /Discord Bot の認証設定に問題があります。/);
  assert.match(html, /利用者 DM 用 Bot Token \(DISCORD_BOT_TOKEN\) が未設定です。/);
  assert.match(html, /color:var\(--accent-danger\)/);
  assert.doesNotMatch(html, /discord_dm_bot_token_unconfigured/);
  const sent = renderToStaticMarkup(React.createElement(NotificationOutboxSummary, { row: { ...row, status: "sent", last_error: null, recipient_user_id: "u1" } }));
  assert.match(sent, /fn-badge-accent">送信済み</);
  assert.match(sent, /宛先: u1/);
  assert.doesNotMatch(sent, /認証設定/);
});

test("MIG-0719 U03 parity: Manage dates are Asia/Tokyo regardless of process time zone", () => {
  const sec = Date.UTC(2026, 9, 31, 15, 30) / 1000; // 2026-11-01 00:30 JST
  assert.equal(formatUnix(sec, { dateOnly: true }), "2026/11/01");
  assert.equal(formatUnix(sec), "2026/11/01 00:30");
  assert.equal(formatUnix(null), "-");
  assert.equal(formatRelative(sec, (sec + 5 * 60) * 1000), "5分前");
  assert.equal(formatRelative(sec, (sec + 10) * 1000), "今");
});

test("MIG-0719 U01 parity: only the ended sidebar group is a collapsible details", () => {
  const ended = { ...event, id: "old", title: "Old", start_time: 1, end_time: 2 };
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(ManageSidebarNav, { events: [event, ended], showXLinkRequests: false, warnActiveX: false, activeX: null })));
  assert.match(html, /<details class="console-sidebar-event-group"><summary class="console-sidebar-event-group-title">終了<\/summary>/);
  assert.match(html, /<h3 class="console-sidebar-event-group-title">開催中・公開中<\/h3>/);
});

test("MIG-0719 U03 parity: dashboard dated cells carry relative text and CURRENT classes", () => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(ManageDashboardContent, { data: { ...dashboard, notificationSchemaMissing: true, notifications: [{ id: "n1", type: "video_approved", status: "sent", payload_json: "{}", attempt_count: 1, last_error: null, dedupe_key: null, recipient_user_id: null, event_id: "e1", created_at: Date.UTC(2026, 9, 31, 15, 30) / 1000 }] } })));
  assert.match(html, /manage-notification-th-date/);
  assert.match(html, /manage-notification-event-cell/);
  assert.match(html, /2026\/11\/01 00:30/);
  assert.match(html, /fn-td-muted/);
  assert.match(html, /`npm.cmd run db:local-apply`/);
});
