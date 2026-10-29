import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createXidLinkRequestsApi } from "../.test-dist/apps/ops/src/api/xidLinkRequests.js";
import { XLinkRequestTable, formatRequestTime } from "../.test-dist/apps/ops/src/components/xid/XLinkRequestTable.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const pending = {
  id: "request-1", requested_x_id: "example", requested_by_auth_user_id: "auth-1", discord_name: "Example",
  discord_image: null, requested_at: 1_700_000_000, request_type: "new_link", target_x_user_id: null,
  requested_x_name: null, requested_icon_url: null, requested_approval_status: null,
  target_icon_url: null, target_approval_status: null,
};
const body = { pending: [pending], recentRejected: [], recentAudit: [] };

test("MIG-0732 U01: admin read uses the authorized GET with no-store and validates DTO", async () => {
  const seen = [];
  const api = createXidLinkRequestsApi(async (path, init) => {
    seen.push({ path, init });
    return json(200, body);
  });
  assert.deepEqual(await api.get(), { status: "ok", data: body });
  assert.equal(seen[0].path, "/api/admin-read/x-link-requests");
  assert.equal(seen[0].init.method, "GET");
  assert.equal(seen[0].init.credentials, "same-origin");
  assert.equal(seen[0].init.cache, "no-store");
});
test("MIG-0732 U01: read fails closed for malformed and unavailable response", async () => {
  assert.deepEqual(await createXidLinkRequestsApi(async () => json(200, { pending: "not-an-array" })).get(),
    { status: "unavailable" });
  assert.deepEqual(await createXidLinkRequestsApi(async () => json(403, { redirect: "/dashboard" })).get(),
    { status: "forbidden", redirect: "/dashboard" });
  assert.deepEqual(await createXidLinkRequestsApi(async () => json(503, {})).get(),
    { status: "unavailable" });
});
test("MIG-0732 U01: approve and reject preserve request ID path and trimmed reason", async () => {
  const calls = [];
  const api = createXidLinkRequestsApi(async (path, init) => {
    calls.push({ path, init });
    return json(200, { ok: true, message: "処理しました。" });
  });
  assert.equal((await api.approve("a/b")).status, "ok");
  assert.equal((await api.reject("a/b", "  理由  ")).status, "ok");
  assert.equal(calls[0].path, "/api/xid/link-requests/a%2Fb/approve");
  assert.equal(calls[1].path, "/api/xid/link-requests/a%2Fb/reject");
  assert.equal(calls[1].init.body, JSON.stringify({ reason: "理由" }));
  for (const call of calls) {
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.credentials, "same-origin");
  }
});
test("MIG-0732 U01: table preserves action labels and empty state", () => {
  const api = createXidLinkRequestsApi(async () => json(200, { ok: true }));
  const html = renderToStaticMarkup(React.createElement(XLinkRequestTable, {
    rows: [pending], api, onChanged: () => {},
  }));
  for (const label of ["承認", "却下", "Xで確認", "FlameNode", "Discord", "example"]) {
    assert.ok(html.includes(label === "Discord" ? "Example" : label), label);
  }
  assert.ok(html.includes("https://x.com/example"));
  const empty = renderToStaticMarkup(React.createElement(XLinkRequestTable, {
    rows: [], api, onChanged: () => {},
  }));
  assert.ok(empty.includes("承認待ちの X ID 連携申請はありません"));
  assert.notEqual(formatRequestTime(1_700_000_000), "-");
});
