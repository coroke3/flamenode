// MIG-0720 U02a — typed event overview read and safe SSR projection.
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";
import { loadManageOverview, normalizeManageNotifFilter, manageOverviewPath } from "../.test-dist/apps/ops/src/api/manageOverview.js";
import { EventOverview, ManageEventOverviewContent } from "../.test-dist/apps/ops/src/routes/manage/EventOverview.js";

function validOverview(id = "ev-1", notifCategory = "all") {
  return {
    isAdmin: false,
    event: {
      id, title: "テストイベント", accent_color: null, visibility_status: "public",
      start_time: null, end_time: null, entry_start_time: null, entry_end_time: null,
      pending_review_count: 3,
    },
    editorRole: "representative",
    activeXUserId: "other",
    manageStaffXUserIds: ["owner"],
    publicVideoCount: 18,
    slotCounts: { open: 2 },
    pendingVideos: [{ id: "video-1", title: "未審査作品", display_name: null, created_at: 123 }],
    auditLogs: [],
    notifCategory,
    notifCounts: { all: 1, video: 1, x_id: 0, slot: 0, chapter: 0, other: 0 },
    notificationSchemaMissing: false,
    notifications: [{
      id: "note-1", type: "video_new", status: "pending", payload_json: "{}",
      attempt_count: 0, last_error: null, dedupe_key: null,
      recipient_user_id: null, event_id: id, created_at: 125, recipient: null,
    }],
  };
}

function fakeFetch(status, value) {
  const calls = [];
  return {
    calls,
    request: async (path, init) => {
      calls.push({ path, init });
      return new Response(value === null ? "" : JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  };
}

test("U02a: notification query normalization matches backend, and event route is encoded", () => {
  for (const category of ["video", "x_id", "slot", "chapter", "other"]) {
    assert.equal(normalizeManageNotifFilter(category), category);
  }
  for (const invalid of [null, "", "ALL", "pending", "admin", "__proto__", "all"]) {
    assert.equal(normalizeManageNotifFilter(invalid), "all");
  }
  assert.equal(manageOverviewPath("日本 / x", "all"), "/api/manage/events/%E6%97%A5%E6%9C%AC%20%2F%20x");
  assert.equal(manageOverviewPath("ev-1", "x_id"), "/api/manage/events/ev-1?notif=x_id");
});

test("U02a: same-origin no-store GET with validated event ID/filter and DTO", async () => {
  const body = validOverview("ev-1", "video");
  const f = fakeFetch(200, body);
  const result = await loadManageOverview(f.request, "ev-1", "video");
  assert.equal(result.status, "ok");
  assert.deepEqual(result.data, body);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, "/api/manage/events/ev-1?notif=video");
  assert.equal(f.calls[0].init.method, "GET");
  assert.equal(f.calls[0].init.credentials, "same-origin");
  assert.equal(f.calls[0].init.cache, "no-store");
});

test("U02a: invalid event keys and mismatched authorization scope cannot display event data", async () => {
  for (const key of ["", "  ", "x\nother", "x".repeat(257)]) {
    const f = fakeFetch(200, validOverview());
    assert.deepEqual(await loadManageOverview(f.request, key, "all"), { status: "notFound" });
    assert.equal(f.calls.length, 0);
  }
  for (const body of [
    validOverview("other-event"), validOverview("ev-1", "x_id"),
    { ...validOverview(), publicVideoCount: "18" },
    { ...validOverview(), manageStaffXUserIds: "owner" },
    { ...validOverview(), notifications: [{ id: "only-id" }] },
    { error: "private text" },
  ]) {
    const f = fakeFetch(200, body);
    assert.deepEqual(await loadManageOverview(f.request, "ev-1", "all"), { status: "unavailable" });
  }
});

test("U02a: authoritative 401/403/404 and retryable errors are never treated as data", async () => {
  const cases = [
    [401, null, "anonymous"], [403, { redirect: "https://evil.invalid" }, "forbidden"],
    [404, null, "notFound"], [501, null, "unsupported"], [503, null, "unavailable"],
  ];
  for (const [status, body, expected] of cases) {
    const f = fakeFetch(status, body);
    const result = await loadManageOverview(f.request, "ev-1", "all");
    assert.equal(result.status, expected, String(status));
    assert.equal("data" in result, false, String(status));
    if (status === 403) assert.equal(result.redirect, undefined);
  }
  const aborted = new AbortController();
  aborted.abort();
  const f = fakeFetch(200, validOverview());
  assert.equal((await loadManageOverview(f.request, "ev-1", "all", aborted.signal)).status, "unavailable");
});

test("U02a: SSR renders only validated overview projection with safe links", () => {
  const data = validOverview();
  const root = React.createElement(MemoryRouter, { initialEntries: ["/manage/events/ev-1?notif=all"] },
    React.createElement(ManageEventOverviewContent, { data }));
  const doc = new JSDOM(renderToStaticMarkup(root)).window.document;
  assert.match(doc.textContent, /テストイベント/);
  assert.match(doc.textContent, /公開作品/);
  assert.match(doc.textContent, /未審査作品/);
  assert.match(doc.textContent, /Active X ID と運営権限/);
  assert.ok(doc.querySelector('a[href="/manage/events/ev-1/videos/video-1"]'));
  assert.ok(doc.querySelector('a[href="/manage/events/ev-1?notif=x_id"]'));
  assert.equal(doc.querySelector('a[href="/manage/events/ev-1"]')?.getAttribute("aria-current"), "page");
  assert.equal(doc.querySelectorAll('a[href^="/admin/"]').length, 0, "non-admin sees no admin actions");

  const loadingRoot = React.createElement(MemoryRouter, {},
    React.createElement(EventOverview, { eventId: "ev-1", fetchFn: async () => { throw Error("not called on SSR"); } }));
  const loading = renderToStaticMarkup(loadingRoot);
  assert.match(loading, /読み込み中/);
  assert.doesNotMatch(loading, /テストイベント/);
});

test("U02a: notification schema fallback is explicit and not misrepresented as empty inbox", () => {
  const data = validOverview();
  data.notificationSchemaMissing = true;
  const root = React.createElement(MemoryRouter, {},
    React.createElement(ManageEventOverviewContent, { data }));
  const doc = new JSDOM(renderToStaticMarkup(root)).window.document;
  assert.match(doc.textContent, /通知データを取得できません/);
  assert.equal(doc.querySelector('nav[aria-label="通知種別"]'), null);
  assert.match(doc.textContent, /公開作品/);
});
