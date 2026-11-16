import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";
import {
  AdminVideoMembersReadView,
  AdminVideoMembersReadPage,
  currentAdminVideoMembersResult,
} from "../.test-dist/apps/ops/src/routes/admin/AdminVideoMembers.js";

const member = (name, overrides = {}) => ({
  name, x_user_id: "verified_x", role: "作画", comment: "担当",
  order_index: 0, can_edit: 0, is_public_member: 1,
  chapters: [{ time: "1:23", label: "映像", note: "備考" }],
  ...overrides,
});
const snapshot = (id, members = [member("Alice")]) => ({
  video: { id, title: "作品 " + id, youtube_video_id: "yt_id", collaboration_type: "collab" },
  initialMembers: members,
});
const wrap = (node) => React.createElement(MemoryRouter, null, node);
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json" },
});

test("MIG-0730 U02b preview preserves CURRENT public participant/chapter display but has no write controls", () => {
  const html = renderToStaticMarkup(wrap(
    React.createElement(AdminVideoMembersReadView, {
      videoId: "id with space",
      data: snapshot("id with space"),
    }),
  ));
  for (const text of ["作品 id with space", "Alice", "@verified_x", "作画",
    "1:23", "映像", "備考", "合作作品：ON", "閲覧のみ"]) {
    assert.ok(html.includes(text), "expected display: " + text);
  }
  assert.match(html, /\/admin\/videos\/id%20with%20space/);
  assert.doesNotMatch(html, /type="submit"|参加者設定を保存|編集を確定/);
  const empty = renderToStaticMarkup(wrap(
    React.createElement(AdminVideoMembersReadView, {
      videoId: "empty",
      data: { ...snapshot("empty", []), video: { ...snapshot("empty").video, collaboration_type: null } },
    }),
  ));
  assert.match(empty, /合作作品：OFF/);
  assert.match(empty, /公開参加者は登録されていません/);
});

test("MIG-0730 U02b render-time identity epoch prevents A-B-A private data reuse", () => {
  const fetchFn = async () => json(snapshot("a"));
  const previous = {
    videoId: "a", fetchFn, epoch: 7,
    result: { status: "ok", data: snapshot("a", [member("OLD_PRIVATE_A")]) },
  };
  assert.equal(currentAdminVideoMembersResult("a", fetchFn, 7, previous), previous.result);
  assert.equal(currentAdminVideoMembersResult("b", fetchFn, 8, previous), null);
  assert.equal(currentAdminVideoMembersResult("a", fetchFn, 9, previous), null,
    "a return to the same video ID must not resurrect prior authorized data");
  assert.equal(currentAdminVideoMembersResult("a", () => json(snapshot("a")), 7, previous), null);
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/admin/videos/a/members",
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function deferred() {
  let resolve;
  return { promise: new Promise(done => { resolve = done; }), resolve: (v) => resolve(v) };
}
function setup() {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const calls = [];
  const fetchFn = (url, init) => {
    const wait = deferred();
    calls.push({ ...wait, url, signal: init?.signal });
    return wait.promise;
  };
  const render = async (videoId) => React.act(async () => {
    root.render(wrap(React.createElement(AdminVideoMembersReadPage, { videoId, fetchFn })));
  });
  const cleanup = async () => React.act(async () => { root.unmount(); target.remove(); });
  return { target, calls, render, cleanup };
}

test("MIG-0730 U02b already displayed private video A data disappears immediately on B navigation", async () => {
  const ui = setup();
  try {
    await ui.render("a");
    assert.match(ui.target.textContent, /読み込み中/);
    await React.act(async () => { ui.calls[0].resolve(json(snapshot("a", [member("PRIVATE_A")]))); });
    assert.match(ui.target.textContent, /PRIVATE_A/);

    await ui.render("b");
    assert.equal(ui.calls[0].signal.aborted, true);
    assert.doesNotMatch(ui.target.textContent, /PRIVATE_A/);
    assert.match(ui.target.textContent, /読み込み中/);
    await React.act(async () => { ui.calls[1].resolve(json(snapshot("b", [member("PRIVATE_B")]))); });
    assert.match(ui.target.textContent, /PRIVATE_B/);
    assert.doesNotMatch(ui.target.textContent, /PRIVATE_A/);
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02b 403 and obsolete aborted response cannot re-display private participant data", async () => {
  const ui = setup();
  try {
    await ui.render("a");
    await ui.render("b");
    assert.equal(ui.calls[0].signal.aborted, true);
    await React.act(async () => { ui.calls[0].resolve(json(snapshot("a", [member("PRIVATE_A")]))); });
    assert.doesNotMatch(ui.target.textContent, /PRIVATE_A/);
    await React.act(async () => { ui.calls[1].resolve(json({ reason: "forbidden" }, 403)); });
    assert.match(ui.target.textContent, /権限がありません/);
    assert.doesNotMatch(ui.target.textContent, /PRIVATE_A/);
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02b invalid UTF-16 route ID fails without any network and no endless loading", async () => {
  const ui = setup();
  try {
    await ui.render("\uD800");
    assert.equal(ui.calls.length, 0);
    assert.match(ui.target.textContent, /取得できませんでした/);
    assert.doesNotMatch(ui.target.textContent, /読み込み中/);
  } finally { await ui.cleanup(); }
});
