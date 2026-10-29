import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";
import { ManageEventTabs, resolveManageEventNav } from "../.test-dist/apps/ops/src/components/manage/ManageEventTabs.js";
import { ManageEventMoreMenu } from "../.test-dist/apps/ops/src/components/manage/ManageEventMoreMenu.js";
import { ManageEventPageShell } from "../.test-dist/apps/ops/src/components/manage/ManageEventPageShell.js";

const eventId = "alpha beta/日本";
const encodedId = encodeURIComponent(eventId);
function markup(element, url = `/manage/events/${encodedId}`) {
  return renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [url] }, element));
}
function doc(element, url) {
  return new JSDOM(markup(element, url)).window.document;
}
function activeLinks(element, url) {
  return [...doc(element, url).querySelectorAll('[aria-current="page"]')].map(a => a.textContent.trim());
}

test("MIG-0720 U01: CURRENT tab query and path precedence", () => {
  const base = `/manage/events/${encodedId}`;
  const cases = [
    [base, "", "overview"], [base + "/", "", "overview"],
    [base + "/videos", "status=pending", "pending"],
    [base + "/videos", "status=all", "content"],
    [base + "/videos", "status=pending&status=all", "pending"],
    [base + "/slots", "", "content"],
    [base + "/audience", "", "content"],
    [base + "/staff", "", "settings"],
    [base + "/youtube-playlist", "", "settings"],
    [base + "/edit", "", "settings"],
  ];
  for (const [pathname, query, expected] of cases) {
    assert.equal(resolveManageEventNav({ pathname, searchParams: new URLSearchParams(query), eventId }), expected, pathname + query);
  }
  assert.equal(resolveManageEventNav({ pathname: "/manage/events/other", searchParams: new URLSearchParams(), eventId }), "overview");
});

test("MIG-0720 U01: primary/sub-tabs preserve CURRENT selection and URL encoding", () => {
  const tabs = React.createElement(ManageEventTabs, { eventId, pendingCount: 3 });
  const pending = doc(tabs, `/manage/events/${encodedId}/videos?status=pending`);
  assert.deepEqual(activeLinks(tabs, `/manage/events/${encodedId}/videos?status=pending`), ["対応待ち", "提出状況"]);
  assert.match(pending.querySelector(".fn-console-event-tab-count").textContent, /3/);
  assert.equal(pending.querySelector(".fn-console-event-tabs a").getAttribute("href"), `/manage/events/${encodedId}`);
  assert.ok(pending.querySelector(`a[href="/manage/events/${encodedId}/videos?status=all"]`));
  assert.deepEqual(activeLinks(tabs, `/manage/events/${encodedId}/audience`), ["参加者・作品", "登録者プレビュー"]);
  assert.deepEqual(activeLinks(tabs, `/manage/events/${encodedId}/staff`), ["設定", "運営メンバー"]);
  assert.deepEqual(activeLinks(tabs, `/manage/events/${encodedId}`), ["概要"]);
});

test("MIG-0720 U01: more-menu hides privileged links from non-admin UI", () => {
  const nonAdmin = doc(React.createElement(ManageEventMoreMenu, { eventId, isAdmin: false }));
  assert.ok(nonAdmin.querySelector(`a[href="/manage/notifications?event=${encodedId}"]`));
  assert.ok(nonAdmin.querySelector(`a[href="/event/${encodedId}"]`));
  assert.equal(nonAdmin.querySelector('a[href^="/admin/"]'), null);
  const admin = doc(React.createElement(ManageEventMoreMenu, { eventId, isAdmin: true }));
  assert.equal(admin.querySelectorAll('a[href^="/admin/"]').length, 4);
  assert.ok(admin.querySelector(`a[href="/admin/audit?table=events&record=${encodedId}"]`));
});

test("MIG-0720 U01: shell parity, conditional Active X warning, no backend privilege grant", () => {
  const base = { eventId, title: "テストイベント", children: React.createElement("div", null, "本文"), pendingCount: 0 };
  const render = props => doc(React.createElement(ManageEventPageShell, { ...base, ...props }));
  const hidden = render({ showActiveXNotice: true, activeXUserId: "owner", manageStaffXUserIds: ["owner"] });
  assert.equal(hidden.querySelector(".manage-active-x-notice"), null);
  const noOwner = render({ showActiveXNotice: true, activeXUserId: "other", manageStaffXUserIds: [] });
  assert.equal(noOwner.querySelector(".manage-active-x-notice"), null);
  const mismatch = render({ showActiveXNotice: true, activeXUserId: " other ", manageStaffXUserIds: ["owner"] });
  assert.match(mismatch.querySelector(".manage-active-x-notice").textContent, /Active X ID と運営権限の X ID が一致していません/);
  assert.equal(mismatch.querySelector(".manage-active-x-notice a").getAttribute("href"), "/dashboard/settings");
  assert.match(mismatch.querySelector(".fn-console-title").textContent, /テストイベント/);
  assert.ok(mismatch.querySelector('a[href="/manage"]'));
  assert.equal(mismatch.querySelector(".fn-console-event-tab-count"), null);
  assert.match(mismatch.body.textContent, /本文/);
});
