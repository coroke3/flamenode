// MIG-0725 U03b: unmounted X-link pending view; read-only until API actions and permissions are reviewed.
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";
import {
  ManageXLinkRequestsBody, ManageXLinkRequestsView, xLinkRequestRedirect,
} from "../.test-dist/apps/ops/src/routes/manage/ManageXLinkRequests.js";

const h = (type, props, ...children) => React.createElement(type, props, ...children);
const render = (element) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ["/manage/x-link-requests"] }, element));
const row = {
  id: "req/1", requested_x_id: "alice", requested_by_auth_user_id: "account1",
  discord_name: "Discord Staff", discord_image: null, requested_at: 1_700_000_000,
  request_type: "new_link", target_x_user_id: null, requested_x_name: "Alice",
  requested_icon_url: "https://static.example/avatar.png", requested_approval_status: "pending",
  target_icon_url: null, target_approval_status: null,
};

test("U03b pending queue retains CURRENT fields and never shows unverified mutation buttons", () => {
  const html = render(h(ManageXLinkRequestsBody, { data: { rows: [row] } }));
  const doc = new JSDOM(html).window.document;
  assert.match(html, /X ID 申請/);
  assert.match(html, /1件/);
  assert.match(html, /Discord Staff/);
  assert.match(html, /account1/);
  assert.match(html, /req\/1/);
  assert.match(html, /X ID連携/);
  assert.ok(doc.querySelector('a[href="https://x.com/alice"]'));
  assert.ok(doc.querySelector('a[href="/user/alice"]'));
  assert.ok(doc.querySelector('a[href="/manage"]'));
  assert.equal(doc.querySelectorAll("tbody tr").length, 1);
  assert.equal(doc.querySelectorAll("button").length, 0);
  assert.doesNotMatch(html, /理由を添えて却下|処理しました/);
});

test("U03b empty, owner-denied and unavailable states do not leak private request rows", () => {
  const empty = render(h(ManageXLinkRequestsBody, { data: { rows: [] } }));
  assert.match(empty, /承認待ちの X ID 連携申請はありません/);
  for (const status of ["loading", "anonymous", "forbidden", "notFound", "unavailable", "unsupported"]) {
    const data = status === "forbidden" ? { status, reason: "manage_access_required" } : { status };
    const html = render(h(ManageXLinkRequestsView, { data }));
    assert.doesNotMatch(html, /account1|Discord Staff|req\/1/);
  }
  assert.match(render(h(ManageXLinkRequestsView, { data: { status: "notFound" } })), /ページが見つかりません/);
  assert.equal(xLinkRequestRedirect({ status: "anonymous" }), "/entry?next=%2Fmanage%2Fx-link-requests");
  assert.equal(xLinkRequestRedirect({ status: "forbidden", reason: "manage_access_required" }), "/dashboard");
  assert.equal(xLinkRequestRedirect({ status: "forbidden" }), "/entry?error=auth_temporarily_unavailable");
  assert.equal(xLinkRequestRedirect({ status: "notFound" }), null);
});

test("U03b unsafe icon URL, hostile text and invalid Unix range cannot inject HTML or crash", () => {
  const html = render(h(ManageXLinkRequestsBody, { data: { rows: [{
    ...row, id: "<script>alert(1)</script>", requested_x_id: "evil\" onerror=\"x",
    requested_x_name: "<img src=x onerror=alert(1)>", discord_name: "<script>bad()</script>",
    discord_image: "javascript:alert(1)", requested_icon_url: "data:image/svg+xml;base64,evil",
    target_x_user_id: "target", target_icon_url: "//evil.invalid/a",
    requested_at: Number.MAX_VALUE, request_type: "constructor",
  }] } }));
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelectorAll("script").length, 0);
  assert.equal(doc.querySelectorAll('img[src^="javascript:"]').length, 0);
  assert.equal(doc.querySelectorAll('img[src^="data:"]').length, 0);
  assert.equal(doc.querySelectorAll('img[src^="//"]').length, 0);
  assert.equal(doc.querySelectorAll("button").length, 0);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(html, /constructor/);
  assert.ok(doc.querySelector("tbody")?.textContent.includes("—"));
  assert.ok(doc.querySelector('a[href^="https://x.com/"]'));
});
