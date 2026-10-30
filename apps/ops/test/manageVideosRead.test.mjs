import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";
import { createManageVideosApi, normalizeVideoFilter } from "../.test-dist/apps/ops/src/api/manageVideos.js";
import { EventVideosContent } from "../.test-dist/apps/ops/src/routes/manage/EventVideos.js";
const h = (type, props, ...children) => React.createElement(type, props, ...children);
const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const row = id => ({
  id, title: id, source_type: "youtube", youtube_video_id: null,
  display_name: "author", visibility_status: "pending", created_at: 1730000000,
  stage_permission_summary: "—", required_unanswered_count: 0,
});
const page = (offset, rows, options = {}) => ({
  isAdmin: false, event: { id: "event/1", title: "イベント", accent_color: null },
  pendingCount: 150, canApproveVideoStatus: true, statusFilter: "review",
  filterLabel: "審査待ち", isReviewFilter: true,
  offset, pageSize: 100, rows, ...options,
});
const create = fn => createManageVideosApi(fn);
test("MIG-0724 U02 T01: 150 rows require exactly two sequential GETs and no more than 200", async () => {
  const requests = [];
  const api = create(async (path, init) => {
    requests.push({ path, init });
    return response(200, requests.length === 1
      ? page(0, Array.from({ length: 100 }, (_, i) => row(`v${i}`)))
      : page(100, Array.from({ length: 50 }, (_, i) => row(`v${i + 100}`))));
  });
  const result = await api.getList("event/1", "review");
  assert.equal(result.status, "ok");
  assert.equal(result.data.rows.length, 150);
  assert.deepEqual(requests.map(x => x.path), [
    "/api/manage/events/event%2F1/videos?status=review&offset=0",
    "/api/manage/events/event%2F1/videos?status=review&offset=100",
  ]);
  for (const req of requests) {
    assert.equal(req.init.method, "GET");
    assert.equal(req.init.credentials, "same-origin");
    assert.equal(req.init.cache, "no-store");
  }
});
test("MIG-0724 U02: 200 exactly stops after two, 0 needs one", async () => {
  let n = 0;
  const exact = await create(async () => response(200,
    page(n++ * 100, Array.from({ length: 100 }, (_, i) => row(`v${n * 100 + i}`))))).getList("event/1", "review");
  assert.equal(n, 2);
  assert.equal(exact.status, "ok");
  assert.equal(exact.data.rows.length, 200);
  let emptyCalls = 0;
  const empty = await create(async () => { emptyCalls++; return response(200, page(0, [])); }).getList("event/1", "review");
  assert.equal(emptyCalls, 1);
  assert.equal(empty.status, "ok");
});
test("MIG-0724 U02: fail-closed on page 2 unavailable, metadata drift, duplicate IDs, invalid row and wrong event", async () => {
  const first = page(0, Array.from({ length: 100 }, (_, i) => row(`v${i}`)));
  for (const second of [
    { status: 503, data: { error: "Unavailable" } },
    { status: 200, data: page(100, [row("v100")], { pendingCount: 148 }) },
    { status: 200, data: page(100, [row("v99")]) },
    { status: 200, data: page(100, [row("v100")], { canApproveVideoStatus: "yes" }) },
    { status: 200, data: page(100, [row("v100")], { event: { id: "other", title: "secret", accent_color: null } }) },
    { status: 200, data: page(0, [row("v100")]) },
  ]) {
    let step = 0;
    const api = create(async () => step++ === 0 ? response(200, first) : response(second.status, second.data));
    const result = await api.getList("event/1", "review");
    assert.equal(result.status, "unavailable", JSON.stringify(second).slice(0, 120));
  }
});
test("MIG-0724 U02: 401/403/404 and aborted reads never render partial queue", async () => {
  for (const [status, expected] of [[401, "anonymous"], [403, "forbidden"], [404, "notFound"], [501, "unsupported"]]) {
    const api = create(async () => response(status, status === 403 ? { redirect: "/dashboard" } : {}));
    assert.equal((await api.getList("event/1", "review")).status, expected);
  }
  const controller = new AbortController();
  let calls = 0;
  const api = create(async () => {
    calls++;
    controller.abort();
    return response(200, page(0, []));
  });
  assert.equal((await api.getList("event/1", "review", controller.signal)).status, "unavailable");
  assert.equal(calls, 1);
});
test("MIG-0724 U02: statuses preserve CURRENT default/invalid/all contract", () => {
  assert.equal(normalizeVideoFilter(null), "review");
  assert.equal(normalizeVideoFilter("unexpected"), "review");
  assert.equal(normalizeVideoFilter(""), "");
  assert.equal(normalizeVideoFilter("all"), "");
  assert.equal(normalizeVideoFilter("pending"), "pending");
  assert.equal(normalizeVideoFilter("closed"), "closed");
});
test("MIG-0724 U02 T05: deny approve UI when staff lacks video.status; no previous event/filter data", () => {
  const render = (result, statusFilter = "review", eventId = "event/1") =>
    new JSDOM(renderToStaticMarkup(h(MemoryRouter, null,
      h(EventVideosContent, { eventId, statusFilter, result, refresh() {} })))).window.document;
  const denied = render({ status: "ok", data: page(0, [row("v1")], { canApproveVideoStatus: false }) });
  assert.equal(denied.querySelectorAll('a[href*="/videos/v1"]').length, 0);
  assert.equal(denied.querySelectorAll("button").length, 0);
  assert.ok(denied.querySelector('a[href="/dashboard/edit/v1?privileged=event"]'), "non-Ops dashboard edit link must remain a document link");
  assert.match(denied.body.textContent, /作品・審査/);
  const staleEvent = render({ status: "ok", data: page(0, [row("secret")]) }, "review", "event/2");
  assert.doesNotMatch(staleEvent.body.textContent, /secret/);
  const staleFilter = render({ status: "ok", data: page(0, [row("secret")]) }, "");
  assert.doesNotMatch(staleFilter.body.textContent, /secret/);
  const empty = render({ status: "ok", data: page(0, []) });
  assert.match(empty.body.textContent, /審査待ちはありません/);
  assert.equal(empty.querySelector('[aria-current="page"]')?.textContent, "審査待ち");
  const forbidden = render({ status: "forbidden" });
  assert.doesNotMatch(forbidden.body.textContent, /作品・審査/);
});
