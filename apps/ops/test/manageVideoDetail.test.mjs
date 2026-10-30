import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";
import { createManageVideoDetailApi } from "../.test-dist/apps/ops/src/api/manageVideoDetail.js";
import { EventVideoDetailContent, safeReviewNextHref } from "../.test-dist/apps/ops/src/routes/manage/EventVideoDetail.js";
const h = (type, props, ...children) => React.createElement(type, props, ...children);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const video = (over = {}) => ({
  id: "vid/1", title: "作品", creator_name: "投稿者", creator_x_user_id: null,
  created_at: 1730000000, source_type: "youtube", youtube_video_id: "AbCdEfGhI12",
  music: null, credit: null, intro_comment: null, highlights: null,
  production_story: null, stagePermission: null, visibility_status: "pending",
  software_label: null, event_ids: ["event/1"],
  customAnswers: [{ label: "質問", answer: "答え", required: true }],
  members: [{ name: "参加者", role: "編集", x_user_id: null, is_public_member: false, chapters: null }],
  ...over,
});
const fixture = (over = {}) => ({
  isAdmin: false, event: { id: "event/1", title: "イベント", accent_color: null },
  pendingCount: 1, canReview: false, video: video(), truncated: false, ...over,
});
const render = (result, extra = {}) => new JSDOM(renderToStaticMarkup(h(MemoryRouter, null,
  h(EventVideoDetailContent, {
    eventId: "event/1", videoId: "vid/1", result, refresh() {}, navigate() {}, ...extra,
  })
))).window.document;

test("MIG-0724 U03: API GET preserves encoded event/video, cookie/no-store and validated contract", async () => {
  const requests = [];
  const api = createManageVideoDetailApi(async (path, init) => {
    requests.push([path, init]);
    return json(200, fixture());
  });
  const result = await api.getDetail("event/1", "vid/1");
  assert.equal(result.status, "ok");
  assert.equal(result.data.video.id, "vid/1");
  assert.equal(requests[0][0], "/api/manage/events/event%2F1/videos/vid%2F1");
  assert.equal(requests[0][1].credentials, "same-origin");
  assert.equal(requests[0][1].cache, "no-store");
  assert.equal(requests[0][1].method, "GET");
  assert.equal(requests.length, 1);
});

test("MIG-0724 U03: different event/video, no link, invalid shapes or over-limit data fail closed", async () => {
  const variants = [
    fixture({ event: { id: "elsewhere", title: "secret", accent_color: null } }),
    fixture({ video: video({ id: "other" }) }),
    fixture({ video: video({ event_ids: ["elsewhere"] }) }),
    fixture({ canReview: "yes" }),
    fixture({ truncated: "no" }),
    fixture({ video: video({ customAnswers: Array.from({ length: 101 }, () => ({ label: "", answer: "", required: false })) }) }),
    fixture({ video: video({ members: Array.from({ length: 101 }, () => ({ name: "", role: null, x_user_id: null, is_public_member: true, chapters: null })) }) }),
    fixture({ video: video({ created_at: Number.NaN }) }),
    fixture({ pendingCount: -1 }),
  ];
  for (const payload of variants) {
    const result = await createManageVideoDetailApi(async () => json(200, payload)).getDetail("event/1", "vid/1");
    assert.equal(result.status, "unavailable");
  }
  assert.equal((await createManageVideoDetailApi(async () => json(200, fixture())).getDetail("", "vid/1")).status, "unavailable");
});
test("MIG-0724 U03: 401/403/404/501/503 + abort never show protected data", async () => {
  for (const [status, expected] of [[401, "anonymous"], [403, "forbidden"], [404, "notFound"], [501, "unsupported"], [503, "unavailable"]]) {
    const result = await createManageVideoDetailApi(async () => json(status, {})).getDetail("event/1", "vid/1");
    assert.equal(result.status, expected);
  }
  const abort = new AbortController();
  const result = await createManageVideoDetailApi(async () => {
    abort.abort();
    return json(200, fixture());
  }).getDetail("event/1", "vid/1", abort.signal);
  assert.equal(result.status, "unavailable");
});
test("MIG-0724 U03 T05: staff without video.status sees details but no status buttons", () => {
  const document = render({ status: "ok", data: fixture() });
  assert.match(document.body.textContent, /作品審査 — 作品/);
  assert.match(document.body.textContent, /公開状態の変更権限がありません/);
  assert.match(document.body.textContent, /質問/);
  assert.match(document.body.textContent, /参加者/);
  assert.equal(document.querySelectorAll("button").length, 0);
  assert.ok(document.querySelector('a[href="/dashboard/edit/vid%2F1?privileged=event"]'));
  assert.ok(document.querySelector('a[href="/AbCdEfGhI12"]'));
  assert.equal(document.querySelectorAll('a[href^="/admin/videos/"]').length, 0);
});
test("MIG-0724 U03: admin and staff edit UI depends on audit-verified injected callbacks", () => {
  const data = fixture({ isAdmin: true, canReview: true });
  const readOnly = render({ status: "ok", data });
  assert.match(readOnly.body.textContent, /API移行の検証完了後/);
  assert.equal(readOnly.querySelectorAll("button").length, 0);
  assert.ok(readOnly.querySelector('a[href="/admin/videos/vid%2F1"]'));
  const action = async () => ({ ok: true });
  const live = render({ status: "ok", data }, { approveAction: action, approveAndNextAction: action, statusAction: action });
  assert.equal(live.querySelectorAll("button").length, 3);
  assert.ok(live.querySelector("select"));
  assert.doesNotMatch(live.body.textContent, /API移行の検証完了後/);
  const truncated = render({ status: "ok", data: fixture({ truncated: true }) });
  assert.match(truncated.querySelector('[role="alert"]')?.textContent ?? "", /APIの上限/);
});
test("MIG-0724 U03: stale content or read error never leaks private video", () => {
  for (const bad of [
    [{ status: "ok", data: fixture() }, { eventId: "other" }],
    [{ status: "ok", data: fixture() }, { videoId: "other" }],
    [{ status: "ok", data: fixture({ video: video({ event_ids: ["other"] }) }) }, {}],
    [{ status: "unavailable" }, {}],
  ]) {
    const document = render(bad[0], bad[1]);
    assert.doesNotMatch(document.body.textContent, /投稿者|参加者|質問/);
  }
});
test("MIG-0724 U03: approve-next href remains limited to the same event queue", () => {
  assert.equal(safeReviewNextHref("event/1", "/manage/events/event%2F1/videos/next?status=pending"), "/manage/events/event%2F1/videos/next?status=pending");
  for (const unsafe of [
    "https://attacker.test", "//attacker.test", "/admin/videos/2", "/manage/events/other/videos/next",
    "/manage/events/event%2F1/videos/", "/manage/events/event%2F1/videos//escape",
    "/manage/events/event%2F1/videos/%ZZ",
  ]) assert.equal(safeReviewNextHref("event/1", unsafe), null, unsafe);
});
