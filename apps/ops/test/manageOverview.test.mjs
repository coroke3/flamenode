// MIG-0720 U02..U05 — typed event overview, template save (SA-035), and audience preview tests.
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { JSDOM } from "jsdom";
import {
  loadManageAudience,
  loadManageOverview,
  manageAudiencePath,
  manageOverviewPath,
  normalizeManageNotifFilter,
} from "../.test-dist/apps/ops/src/api/manageOverview.js";
import { saveEventAsTemplate } from "../.test-dist/apps/ops/src/api/eventTemplates.js";
import { EventOverview, ManageEventOverviewContent } from "../.test-dist/apps/ops/src/routes/manage/EventOverview.js";
import {
  EventAudience,
  ManageEventAudienceContent,
  sortManageAudience,
} from "../.test-dist/apps/ops/src/routes/manage/EventAudience.js";
import { SaveEventTemplateForm } from "../.test-dist/apps/ops/src/routes/manage/SaveEventTemplateForm.js";
import { ManageEventAudienceRoute, ManageEventOverviewRoute } from "../.test-dist/apps/ops/src/routes/router.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://flamenode.test" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "FormData", "Event", "MouseEvent"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function validOverview(id = "ev-1", notifCategory = "all") {
  return {
    isAdmin: false,
    event: {
      id,
      title: "テストイベント",
      accent_color: "#ff6600",
      visibility_status: "public",
      start_time: 1700000000,
      end_time: 1700086400,
      entry_start_time: 1699900000,
      entry_end_time: 1700000000,
      pending_review_count: 3,
    },
    editorRole: "representative",
    activeXUserId: "other",
    manageStaffXUserIds: ["owner"],
    publicVideoCount: 18,
    slotCounts: { available: 2, reserved: 3, submitted: 5 },
    pendingVideos: [{ id: "video-1", title: "未審査作品", display_name: "作者A", created_at: 123 }],
    auditLogs: [
      { id: "audit-1", operation: "UPDATE", actor_user_id: "user-1", created_at: 200 },
    ],
    notifCategory,
    notifCounts: { all: 1, video: 1, x_id: 0, slot: 0, chapter: 0, other: 0 },
    notificationSchemaMissing: false,
    notifications: [{
      id: "note-1",
      type: "video_new",
      status: "pending",
      payload_json: "{}",
      attempt_count: 0,
      last_error: null,
      dedupe_key: null,
      recipient_user_id: "user-1",
      event_id: id,
      created_at: 125,
      recipient: {
        userName: "テスト受信者",
        discordId: "123456",
        notificationsEnabled: true,
      },
    }],
  };
}

function validAudience(id = "ev-1") {
  return {
    isAdmin: false,
    event: { id, title: "テストイベント", accent_color: "#3366ff" },
    pendingCount: 2,
    audience: [
      {
        x_user_id: "alice",
        x_name: "Alice Name",
        icon_url: null,
        approval_status: "approved",
        slot_count: 2,
        submitted_count: 1,
        video_count: 1,
      },
      {
        x_user_id: "bob",
        x_name: null,
        icon_url: null,
        approval_status: null,
        slot_count: 1,
        submitted_count: 0,
        video_count: 3,
      },
    ],
    truncated: false,
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

test("T01 / U02: notification query normalization matches backend (?notif=foo -> all), and event route is encoded", () => {
  for (const category of ["video", "x_id", "slot", "chapter", "other"]) {
    assert.equal(normalizeManageNotifFilter(category), category);
  }
  for (const invalid of [null, "", "foo", "ALL", "pending", "admin", "__proto__", "all"]) {
    assert.equal(normalizeManageNotifFilter(invalid), "all");
  }
  assert.equal(manageOverviewPath("日本 / x", "all"), "/api/manage/events/%E6%97%A5%E6%9C%AC%20%2F%20x");
  assert.equal(manageOverviewPath("ev-1", "x_id"), "/api/manage/events/ev-1?notif=x_id");
  assert.equal(manageAudiencePath("日本 / x"), "/api/manage/events/%E6%97%A5%E6%9C%AC%20%2F%20x/audience");
});

test("U02: same-origin no-store GET with validated event ID/filter and DTO", async () => {
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

test("U02: invalid event keys and mismatched authorization scope cannot display event data", async () => {
  for (const key of ["", "  ", "x\nother", "x".repeat(257)]) {
    const f = fakeFetch(200, validOverview());
    assert.deepEqual(await loadManageOverview(f.request, key, "all"), { status: "notFound" });
    assert.equal(f.calls.length, 0);
  }
  for (const body of [
    validOverview("other-event"),
    validOverview("ev-1", "x_id"),
    { ...validOverview(), publicVideoCount: "18" },
    { ...validOverview(), manageStaffXUserIds: "owner" },
    { ...validOverview(), notifications: [{ id: "only-id" }] },
    { error: "private text" },
  ]) {
    const f = fakeFetch(200, body);
    assert.deepEqual(await loadManageOverview(f.request, "ev-1", "all"), { status: "unavailable" });
  }
});

test("T02 / U02: authoritative 401/403/404 and retryable errors are never treated as data; 404 renders NotFoundView", async () => {
  const cases = [
    [401, null, "anonymous"],
    [403, { redirect: "https://evil.invalid" }, "forbidden"],
    [404, null, "notFound"],
    [501, null, "unsupported"],
    [503, null, "unavailable"],
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

  // T02: unassigned event 404 renders NotFoundView (not a normal page).
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  try {
    const notFoundFetch = fakeFetch(404, { error: "not_found" });
    await React.act(async () => {
      root.render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/manage/events/unassigned-ev?notif=foo"] },
          React.createElement(EventOverview, { eventId: "unassigned-ev", fetchFn: notFoundFetch.request }),
        ),
      );
    });
    assert.equal(notFoundFetch.calls.length, 1);
    // T01: ?notif=foo normalized to all (no ?notif query sent).
    assert.equal(notFoundFetch.calls[0].path, "/api/manage/events/unassigned-ev");
    assert.match(target.textContent, /ページが見つかりません/);
    assert.doesNotMatch(target.textContent, /テストイベント|進行状況/);
  } finally {
    await React.act(async () => {
      root.unmount();
      target.remove();
    });
  }
});

test("T03 / U02: SSR renders full CURRENT overview parity; non-admin hides SaveEventTemplateForm and admin shows it", () => {
  const data = validOverview();
  const nonAdminRoot = React.createElement(
    MemoryRouter,
    { initialEntries: ["/manage/events/ev-1?notif=all"] },
    React.createElement(ManageEventOverviewContent, { data }),
  );
  const doc = new JSDOM(renderToStaticMarkup(nonAdminRoot)).window.document;
  assert.match(doc.body.textContent, /テストイベント/);
  assert.match(doc.body.textContent, /代表/);
  assert.match(doc.body.textContent, /対応が必要です/);
  assert.match(doc.body.textContent, /審査待ち 3 件があります。/);
  assert.match(doc.body.textContent, /公開作品 18 件/);
  assert.match(doc.body.textContent, /8 \/ 10/);
  assert.equal(doc.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"), "80");
  assert.match(doc.body.textContent, /確保済\s*3/);
  assert.match(doc.body.textContent, /提出済\s*5/);
  assert.match(doc.body.textContent, /未審査作品/);
  assert.match(doc.body.textContent, /作者A/);
  assert.match(doc.body.textContent, /Active X ID と運営権限/);
  assert.match(doc.body.textContent, /イベント更新履歴/);
  assert.match(doc.body.textContent, /UPDATE/);
  assert.match(doc.body.textContent, /user-1/);
  assert.ok(doc.querySelector('a[href="/manage/events/ev-1/videos/video-1"]'));
  assert.ok(doc.querySelector('a[href="/dashboard/edit/video-1?privileged=event"]'));
  assert.ok(doc.querySelector('a[href="/manage/events/ev-1/audience"]'));
  assert.ok(doc.querySelector('a[href="/manage/events/ev-1/edit#section-required"]'));
  assert.ok(doc.querySelector('a[href="/manage/events/ev-1?notif=x_id"]'));
  assert.equal(
    doc.querySelector('nav[aria-label="通知カテゴリフィルタ"] a[href="/manage/events/ev-1"]')?.getAttribute("aria-current"),
    "page",
  );

  // T03: non-admin does not see SaveEventTemplateForm or /admin/ links.
  assert.equal(doc.querySelector(".manage-template-card"), null);
  assert.equal(doc.querySelector('input[name="event_id"]'), null);
  assert.equal(doc.querySelectorAll('a[href^="/admin/"]').length, 0, "non-admin sees no admin actions");

  // T03: admin sees SaveEventTemplateForm and admin video link.
  const adminData = { ...validOverview(), isAdmin: true };
  const adminDoc = new JSDOM(
    renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/manage/events/ev-1"] },
        React.createElement(ManageEventOverviewContent, { data: adminData }),
      ),
    ),
  ).window.document;
  assert.match(adminDoc.body.textContent, /管理者/);
  assert.ok(adminDoc.querySelector(".manage-template-card"));
  assert.equal(adminDoc.querySelector('input[name="event_id"]')?.getAttribute("value"), "ev-1");
  assert.equal(adminDoc.querySelector('input[name="name"]')?.getAttribute("value"), "テストイベント テンプレート");
  assert.ok(adminDoc.querySelector('a[href="/admin/videos/video-1"]'));

  const settingsRoot = React.createElement(
    MemoryRouter,
    { initialEntries: ["/manage/events/ev-1/edit"] },
    React.createElement(ManageEventOverviewContent, { data }),
  );
  const settingsDoc = new JSDOM(renderToStaticMarkup(settingsRoot)).window.document;
  assert.ok(
    settingsDoc.querySelector('a[href="/manage/events/ev-1/staff"]'),
    "settings subtab links to the staff route when settings navigation is active",
  );

  const loadingRoot = React.createElement(
    MemoryRouter,
    {},
    React.createElement(EventOverview, {
      eventId: "ev-1",
      fetchFn: async () => {
        throw Error("not called on SSR");
      },
    }),
  );
  const loading = renderToStaticMarkup(loadingRoot);
  assert.match(loading, /読み込み中/);
  assert.doesNotMatch(loading, /テストイベント/);
});

test("U02: notification schema fallback is explicit and hides collapsible notification section", () => {
  const data = validOverview();
  data.notificationSchemaMissing = true;
  const root = React.createElement(
    MemoryRouter,
    {},
    React.createElement(ManageEventOverviewContent, { data }),
  );
  const doc = new JSDOM(renderToStaticMarkup(root)).window.document;
  assert.match(doc.body.textContent, /イベント通知の絞り込みに必要な DB migration が未適用です/);
  assert.equal(doc.querySelector('nav[aria-label="通知カテゴリフィルタ"]'), null);
  assert.match(doc.body.textContent, /公開作品 18 件/);
});

test("T04 / U03 & U05: SaveEventTemplateForm prevents double-submit, preserves input on {ok:false}, and triggers refresh on success", async () => {
  // Direct client validation & HTTP status safety checks
  const invalidClient = fakeFetch(200, { ok: true, templateId: "etmpl_1" });
  const emptyName = await saveEventAsTemplate(invalidClient.request, {
    event_id: "ev-1",
    name: "   ",
    description: null,
  });
  assert.equal(emptyName.status, "ok");
  assert.equal(emptyName.data.ok, false);
  assert.equal(invalidClient.calls.length, 0);

  const spoof500 = fakeFetch(500, { ok: true, templateId: "etmpl_spoof" });
  assert.deepEqual(
    await saveEventAsTemplate(spoof500.request, { event_id: "ev-1", name: "Valid", description: null }),
    { status: "unavailable" },
  );

  // DOM interaction test: double submit while in flight sends 1 request; error keeps inputs; retry succeeds and calls onSaved.
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const calls = [];
  const saved = [];
  let resolveFirst;
  const firstPromise = new Promise((r) => {
    resolveFirst = r;
  });
  let callIndex = 0;
  const fetchFn = async (path, init) => {
    calls.push({ path, init });
    callIndex += 1;
    if (callIndex === 1) return firstPromise;
    return new Response(JSON.stringify({ ok: true, templateId: "etmpl_1", message: "テンプレートを保存しました。" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await React.act(async () => {
      root.render(
        React.createElement(SaveEventTemplateForm, {
          eventId: "ev-1",
          eventTitle: "テストイベント",
          fetchFn,
          onSaved: () => saved.push("saved"),
        }),
      );
    });

    const form = target.querySelector("form");
    const nameInput = form.elements.namedItem("name");
    const descInput = form.elements.namedItem("description");
    nameInput.value = "カスタムテンプレート名";
    descInput.value = "テスト用メモ";

    // Rapid double submit before first request resolves
    await React.act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(calls.length, 1, "double submit must send only 1 POST");
    assert.equal(calls[0].path, "/api/admin/event-templates");
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      event_id: "ev-1",
      name: "カスタムテンプレート名",
      description: "テスト用メモ",
    });
    assert.equal(target.querySelector('button[type="submit"]').disabled, true);

    // Resolve first call with { ok: false, message }
    await React.act(async () => {
      resolveFirst(
        new Response(JSON.stringify({ ok: false, message: "テンプレート名が重複しています。" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    assert.match(target.querySelector('[role="alert"]').textContent, /テンプレート名が重複しています。/);
    assert.equal(nameInput.value, "カスタムテンプレート名", "input value must be preserved on error");
    assert.equal(descInput.value, "テスト用メモ", "description value must be preserved on error");
    assert.equal(saved.length, 0);

    // Submit again -> succeeds and calls onSaved (refreshKey increment)
    await React.act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(calls.length, 2);
    assert.equal(saved.length, 1);
    assert.match(target.querySelector('[role="status"]').textContent, /テンプレートを保存しました。/);
    assert.equal(target.querySelector('[role="alert"]'), null);
  } finally {
    await React.act(async () => {
      root.unmount();
      target.remove();
    });
  }
});

test("T05 / U04: loadManageAudience validates DTO/eventId, sorts >100 rows as CURRENT, and does not display truncated", async () => {
  const valid = validAudience("ev-1");
  const f = fakeFetch(200, valid);
  const res = await loadManageAudience(f.request, "ev-1");
  assert.equal(res.status, "ok");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, "/api/manage/events/ev-1/audience");

  // Wrong event ID or invalid key fails closed
  assert.deepEqual(await loadManageAudience(fakeFetch(200, valid).request, "ev-2"), { status: "unavailable" });
  assert.deepEqual(await loadManageAudience(fakeFetch(200, valid).request, " "), { status: "notFound" });

  // T05: 105 rows sorted by submitted_count desc, video_count desc, slot_count desc; truncated=true is not rendered.
  const manyRows = Array.from({ length: 105 }, (_, i) => ({
    x_user_id: `user_${i}`,
    x_name: i === 104 ? "Top Submitter" : `User ${i}`,
    icon_url: null,
    approval_status: "approved",
    slot_count: i % 5,
    submitted_count: i === 104 ? 99 : i % 3,
    video_count: i === 103 ? 50 : i % 4,
  }));
  const sorted = sortManageAudience(manyRows);
  assert.equal(sorted[0].x_user_id, "user_104");

  const largeAudience = {
    ...validAudience("ev-1"),
    audience: manyRows,
    truncated: true,
  };
  const html = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/manage/events/ev-1/audience"] },
      React.createElement(ManageEventAudienceContent, { data: largeAudience }),
    ),
  );
  const doc = new JSDOM(html).window.document;
  assert.match(doc.body.textContent, /登録者プレビュー — 105 名（読み取り専用）/);
  const rows = [...doc.querySelectorAll("table.manage-audience-table tbody tr")];
  assert.equal(rows.length, 105);
  assert.match(rows[0].textContent, /Top Submitter/);
  assert.match(rows[0].textContent, /@user_104/);
  assert.ok(rows[0].querySelector('a.manage-audience-name[href="/user/user_104"]'));
  assert.ok(rows[0].querySelector("strong"), "submitted_count > 0 renders in <strong>");
  assert.doesNotMatch(doc.body.textContent, /truncated|上限|100件を超え/i);
});

test("U02b & U04: overview and audience URL routes resolve an ID and render only loading state before authorized GET", () => {
  const overviewRoot = React.createElement(
    MemoryRouter,
    { initialEntries: ["/manage/events/ev-1"] },
    React.createElement(
      Routes,
      null,
      React.createElement(Route, {
        path: "/manage/events/:id",
        element: React.createElement(ManageEventOverviewRoute),
      }),
    ),
  );
  const overviewHtml = renderToStaticMarkup(overviewRoot);
  assert.match(overviewHtml, /読み込み中/);
  assert.doesNotMatch(overviewHtml, /テストイベント|未審査作品/);

  const audienceRoot = React.createElement(
    MemoryRouter,
    { initialEntries: ["/manage/events/ev-1/audience"] },
    React.createElement(
      Routes,
      null,
      React.createElement(Route, {
        path: "/manage/events/:id/audience",
        element: React.createElement(ManageEventAudienceRoute),
      }),
    ),
  );
  const audienceHtml = renderToStaticMarkup(audienceRoot);
  assert.match(audienceHtml, /読み込み中/);
  assert.doesNotMatch(audienceHtml, /テストイベント|Alice Name/);
});
