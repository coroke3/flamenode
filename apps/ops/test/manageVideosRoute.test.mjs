// MIG-0724 U03b: actual URL param to authorized Hono GET, no unapproved mutation wiring.
import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { JSDOM } from "jsdom";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { readFileSync } from "node:fs";
import { ManageVideosRoute, ManageVideoDetailRoute } from "../.test-dist/apps/ops/src/routes/manage/ManageVideosRoute.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://flamenode.test/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
// jsdom does not supply ResizeObserver; TableScroll uses it only for visual affordances.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const response = (status, value) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});

function listFixture() {
  return {
    isAdmin: false, event: { id: "event/1", title: "Event A", accent_color: null },
    pendingCount: 1, canApproveVideoStatus: true, statusFilter: "review",
    filterLabel: "審査待ち", isReviewFilter: true, offset: 0, pageSize: 100,
    rows: [{ id: "vid/1", title: "READ_ONLY_VIDEO", source_type: "youtube",
      youtube_video_id: null, display_name: "投稿者", visibility_status: "pending",
      created_at: 1730000000, stage_permission_summary: "—", required_unanswered_count: 0 }],
  };
}
function detailFixture() {
  return {
    isAdmin: false, event: { id: "event/1", title: "Event A", accent_color: null },
    pendingCount: 1, canReview: true, truncated: false,
    video: {
      id: "vid/1", title: "PRIVATE_REVIEW_DETAIL", creator_name: "投稿者",
      creator_x_user_id: null, created_at: 1730000000, source_type: "youtube",
      youtube_video_id: null, music: null, credit: null, intro_comment: null,
      highlights: null, production_story: null, stagePermission: null,
      visibility_status: "pending", software_label: null, event_ids: ["event/1"],
      customAnswers: [], members: [],
    },
  };
}
async function renderRoute(path, element) {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  await React.act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [path] },
    React.createElement(Routes, null,
      React.createElement(Route, { path: "/manage/events/:id/videos", element: element.list }),
      React.createElement(Route, { path: "/manage/events/:id/videos/:videoId", element: element.detail })))));
  return { target, cleanup: async () => React.act(async () => { root.unmount(); target.remove(); }) };
}

test("MIG-0724 U03b: mounted list honors encoded event ID and never exposes write actions", async () => {
  const calls = [];
  const fetchFn = async (path, init) => { calls.push({ path, init }); return response(200, listFixture()); };
  const ui = await renderRoute("/manage/events/event%2F1/videos",
    { list: React.createElement(ManageVideosRoute, { fetchFn }), detail: React.createElement(ManageVideoDetailRoute, { fetchFn }) });
  try {
    assert.deepEqual(calls.map(x => x.path), ["/api/manage/events/event%2F1/videos?status=review&offset=0"]);
    assert.match(ui.target.textContent, /READ_ONLY_VIDEO/);
    assert.equal(ui.target.querySelectorAll("form").length, 0);
    assert.ok(ui.target.querySelector('a[href="/manage/events/event%2F1/videos/vid%2F1"]'));
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.cache, "no-store");
  } finally { await ui.cleanup(); }
});

test("MIG-0724 U03b: mounted detail reads correct scope and leaves status edits disabled", async () => {
  const calls = [];
  const fetchFn = async (path, init) => { calls.push({ path, init }); return response(200, detailFixture()); };
  const ui = await renderRoute("/manage/events/event%2F1/videos/vid%2F1",
    { list: React.createElement(ManageVideosRoute, { fetchFn }), detail: React.createElement(ManageVideoDetailRoute, { fetchFn }) });
  try {
    assert.deepEqual(calls.map(x => x.path), ["/api/manage/events/event%2F1/videos/vid%2F1"]);
    assert.match(ui.target.textContent, /PRIVATE_REVIEW_DETAIL/);
    assert.match(ui.target.textContent, /API移行の検証完了後に有効/);
    assert.equal(ui.target.querySelectorAll("form").length, 0);
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.credentials, "same-origin");
  } finally { await ui.cleanup(); }
});

test("MIG-0724 U03b: source router mounts both routes only inside existing Ops manage gate", () => {
  const source = readFileSync(new URL("../src/routes/router.tsx", import.meta.url), "utf8");
  assert.match(source, /<OpsGate surface="manage"/);
  assert.match(source, /path="events\/:id\/videos" element=\{<ManageVideosRoute \/>}/);
  assert.match(source, /path="events\/:id\/videos\/:videoId" element=\{<ManageVideoDetailRoute \/>}/);
});
