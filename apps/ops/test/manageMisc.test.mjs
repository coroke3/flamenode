import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  notificationCenterPath, readManageNotifications,
} from "../.test-dist/apps/ops/src/api/manageNotifications.js";
import {
  ManageNotificationsBody,
} from "../.test-dist/apps/ops/src/routes/manage/ManageNotifications.js";

const fixture = {
  isAdmin: false, activeXUserId: null, manageStaffXUserIds: [],
  eventFilter: "a/b", notifFilter: "all", statusFilter: "",
  managedEvents: [{ id: "a/b", title: "テストイベント" }],
  eventTitles: { "a/b": "テストイベント" },
  schemaMissing: false, failedCount: 0, notifications: [],
};
const response = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const render = (data, query = "") => renderToStaticMarkup(
  React.createElement(MemoryRouter, null,
    React.createElement(ManageNotificationsBody, {
      data, search: new URLSearchParams(query), change: () => {},
    }),
  ),
);

test("MIG-0725 U02: preserve CURRENT GET filter names and encode special IDs", () => {
  assert.equal(
    notificationCenterPath(new URLSearchParams("event=a%2Fb&notif=x_id&status=failed&unused=ignored")),
    "/api/manage/notifications?event=a%2Fb&notif=x_id&status=failed",
  );
  assert.equal(notificationCenterPath(new URLSearchParams("notif=&status=")),
    "/api/manage/notifications?notif=&status=");
  assert.equal(notificationCenterPath(new URLSearchParams()), "/api/manage/notifications");
});

test("MIG-0725 U02: GET is no-store/same-origin and validates entire contract", async () => {
  let request;
  const control = new AbortController();
  const result = await readManageNotifications(async (path, init) => {
    request = { path, init };
    return response(200, fixture);
  }, new URLSearchParams("event=a%2Fb"), control.signal);
  assert.equal(result.status, "ok");
  assert.equal(result.data.managedEvents[0].id, "a/b");
  assert.equal(request.path, "/api/manage/notifications?event=a%2Fb");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.cache, "no-store");
  assert.equal(request.init.credentials, "same-origin");
  assert.equal(request.init.signal, control.signal);
});

test("MIG-0725 U02 T03: inaccessible event 404 remains 404 and no data leaks", async () => {
  for (const [http, expected] of [
    [401, "anonymous"], [403, "forbidden"], [404, "notFound"],
    [500, "unavailable"], [501, "unsupported"],
  ]) {
    const value = await readManageNotifications(async () => response(http, {}),
      new URLSearchParams("event=other-user-event"));
    assert.equal(value.status, expected);
    assert.equal("data" in value, false);
  }
  const invalid = await readManageNotifications(async () => response(200, {
    ...fixture, notifications: [{ id: "partial-protected-row" }],
  }), new URLSearchParams());
  assert.deepEqual(invalid, { status: "unavailable" });
});

test("MIG-0725 U02 T04: filter select and event deep link are rendered safely", () => {
  const html = render({
    ...fixture, notifications: [{
      id: "n1", type: "video_submitted", status: "dead_letter",
      payload_json: JSON.stringify({ content: "<script>bad()</script>\nnext" }),
      attempt_count: 2, last_error: "timeout", dedupe_key: null,
      recipient_user_id: "user1", event_id: "a/b", created_at: 1700000000,
      recipient: { userName: "投稿者", discordId: "123", notificationsEnabled: true },
    }], failedCount: 1,
  }, "event=a%2Fb&notif=video&status=failed");
  assert.match(html, /name="event"[^>]*>/);
  assert.match(html, /name="notif"[^>]*>/);
  assert.match(html, /name="status"[^>]*>/);
  assert.match(html, /最終失敗 1 件/);
  assert.match(html, /href="\/manage\/events\/a%2Fb"/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("MIG-0725 U02: admin event selector hidden, 50-row empty state and schema warning", () => {
  const html = render({
    ...fixture, isAdmin: true, managedEvents: [], schemaMissing: true,
  });
  assert.doesNotMatch(html, /name="event"/);
  assert.match(html, /notification_outbox/);
  assert.match(html, /通知はありません/);
  assert.match(html, /href="\/manage"/);
});

test("MIG-0725 U02: CURRENT absolute/relative date parity and malformed timestamp fail-safe", () => {
  const row = {
    id: "dt-1", type: "video_submitted", status: "sent",
    payload_json: "{}", attempt_count: 0, last_error: null, dedupe_key: null,
    recipient_user_id: null, event_id: "a/b", created_at: Math.floor(Date.now() / 1000) - 125,
    recipient: null,
  };
  const good = render({ ...fixture, notifications: [row] });
  assert.match(good, /dateTime="[^"]+"/);
  assert.match(good, /2分前/);
  assert.match(good, /manage-notification-date-cell/);
  // z.number() accepts an integer outside JS Date's valid range; no RangeError.
  const invalid = render({ ...fixture, notifications: [{ ...row, created_at: Number.MAX_SAFE_INTEGER }] });
  assert.match(invalid, /manage-notification-date-cell/);
  assert.doesNotMatch(invalid, /dateTime=/);
  assert.match(invalid, /—/);
});


test("MIG-0725 U02: inherited Object.prototype keys cannot crash notification or event titles", () => {
  for (const inherited of ["constructor", "__proto__", "toString", "valueOf"]) {
    const row = {
      id: "n-inherited", type: inherited, status: inherited,
      payload_json: "{}", attempt_count: 0, last_error: null, dedupe_key: null,
      recipient_user_id: null, event_id: inherited, created_at: 1700000000,
      recipient: null,
    };
    const html = render({ ...fixture, notifications: [row], eventTitles: {} });
    assert.match(html, /fn-badge/, inherited);
    assert.ok(html.includes(inherited), "raw unknown status/type must be readable: " + inherited);
    assert.ok(html.includes('/manage/events/' + encodeURIComponent(inherited)), inherited);
    assert.ok(html.includes(inherited.slice(0, 8) + "…"), "unknown event has short fallback");
  }
  const own = render({ ...fixture, notifications: [{
    id: "n-owned", type: "video_submitted", status: "sent",
    payload_json: "{}", attempt_count: 0, last_error: null, dedupe_key: null,
    recipient_user_id: null, event_id: "constructor", created_at: 1700000000,
    recipient: null,
  }], eventTitles: { constructor: "実際のイベント名" } });
  assert.match(own, /実際のイベント名/, "explicit own event titles remain usable");
  assert.match(own, /送信済み/, "ordinary status label remains intact");
});


test("MIG-0725 U02: CURRENT category, severity and delivery badges remain distinct", () => {
  const makeRow = (type, status = "sent") => ({
    id: type, type, status, payload_json: "{}", attempt_count: 0,
    last_error: null, dedupe_key: null, recipient_user_id: null,
    event_id: null, created_at: 1700000000, recipient: null,
  });
  for (const [type, category, badge] of [
    ["video_voided", "作品", "fn-badge-danger"],
    ["moderation_created", "モデレーション", "fn-badge-warning"],
    ["ops_youtube_playlist_sync_failed", "システム", "fn-badge-danger"],
    ["announcement_broadcast", "お知らせ", "fn-badge-soft"],
    ["slot_deadline_reminder", "枠", "fn-badge-warning"],
    ["event_updated", "イベント", "fn-badge-soft"],
  ]) {
    const html = render({ ...fixture, notifications: [makeRow(type)] });
    assert.ok(html.includes(category), "category: " + type);
    assert.ok(html.includes(badge), "severity: " + type);
  }
  assert.match(render({ ...fixture, notifications: [makeRow("video_approved")] }), /fn-badge-accent/, "sent status");
  assert.match(render({ ...fixture, notifications: [makeRow("video_approved", "processing")] }), /fn-badge-warning/, "processing status");
});
