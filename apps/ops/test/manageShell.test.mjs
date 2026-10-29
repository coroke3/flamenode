import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { loadManageNavigation } from "../.test-dist/apps/ops/src/api/manageNavigation.js";
import { loadManageDashboard } from "../.test-dist/apps/ops/src/api/manageDashboard.js";
import { loadOperationMode } from "../.test-dist/apps/ops/src/api/operationMode.js";
import { shouldRenderManageSidebar, decideManageNavigation } from "../.test-dist/apps/ops/src/routes/manage/ManageLayout.js";
import { shouldWarnManageActiveXMismatch } from "../.test-dist/apps/ops/src/routes/manage/ManageActiveXNotice.js";
import { classifyManageEvent, filterManageEvents, isManageHrefActive } from "../.test-dist/apps/ops/src/routes/manage/ManageSidebarNav.js";
import { manageReviewTarget } from "../.test-dist/apps/ops/src/routes/manage/ManageReviewRedirect.js";
import { manageKpiClasses, ManageDashboardContent } from "../.test-dist/apps/ops/src/routes/manage/ManageDashboard.js";
import { summarizePayload } from "../.test-dist/apps/ops/src/components/notifications/NotificationOutboxSummary.js";

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
  assert.equal((await loadOperationMode(fetchJson(503, {}))).status, "unavailable");
  assert.equal(summarizePayload(JSON.stringify({ content: "one\ntwo" })), "one");
  assert.equal(summarizePayload("{"), "—");
});

test("MIG-0719 T06: Ops packaging dry-run has a fixed target and rejects routes/bindings", async () => {
  const { assertOpsStaticConfig, opsDryRunArgs } = await import("../scripts/dryRun.mjs");
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.equal(assertOpsStaticConfig(config), true);
  assert.throws(() => assertOpsStaticConfig(config + '\nroute = "example.invalid/*"'), /Unapproved/);
  assert.throws(() => assertOpsStaticConfig(config + '\n[[d1_databases]]'), /only one assets table/);
  assert.throws(() => assertOpsStaticConfig(config.replace("workers_dev = false", "workers_dev = true")), /Unsafe/);
  const args = opsDryRunArgs(resolve("/tmp/ops-review-only"));
  assert.ok(args.includes("--dry-run"));
  assert.ok(args.includes("apps/ops/wrangler.toml"));
  assert.throws(() => opsDryRunArgs("relative/path"), /Absolute/);
});
