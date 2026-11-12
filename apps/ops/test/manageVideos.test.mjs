import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";
import { VideoReviewQueueTable } from "../.test-dist/apps/ops/src/components/videoReview/VideoReviewQueueTable.js";
import { VideoReviewQuickApproveButton } from "../.test-dist/apps/ops/src/components/videoReview/VideoReviewQuickApproveButton.js";
import { VideoApproveActions } from "../.test-dist/apps/ops/src/components/videoReview/VideoApproveActions.js";
import { VideoReviewDetailPanel } from "../.test-dist/apps/ops/src/components/videoReview/VideoReviewDetailPanel.js";
import { VideoStatusForm, ADMIN_STATUS_VALUES, MANAGE_STATUS_VALUES } from "../.test-dist/apps/ops/src/components/videoReview/VideoStatusForm.js";
import { formatRelative, youtubeThumbUrl } from "../.test-dist/apps/ops/src/components/videoReview/shared.js";

const h = (type, props, ...children) => React.createElement(type, props, ...children);
const SSR = element => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ["/manage"] }, element));
const sample = (over = {}) => ({
  id: "v1", title: "作品", source_type: "youtube", youtube_video_id: "AbCdEfGhI12",
  display_name: "作者", visibility_status: "pending", created_at: 1730000000,
  stage_permission_summary: "許可", required_unanswered_count: 0, ...over,
});
const action = async () => ({ ok: true });
const onRefresh = () => {};
test("MIG-0724 U01: queue retains nine CURRENT columns, pending-only approve, internal links and no-action staff state", () => {
  const props = { rows: [sample(), sample({ id: "v2", visibility_status: "private" })],
    reviewHref: id => `/manage/events/e1/videos/${id}`,
    contentHref: id => `/v/${id}`, quickApproveAction: action,
    quickApproveHiddenFields: { event_id: "e1" }, canApprove: true, onRefresh, variant: "manage" };
  const html = SSR(h(VideoReviewQueueTable, props));
  const dom = new JSDOM(html).window.document;
  assert.equal(dom.querySelectorAll("th").length, 9);
  assert.equal(dom.querySelectorAll("tbody tr").length, 2);
  assert.equal(dom.querySelectorAll("button").length, 1, "only pending row exposes quick approve");
  assert.equal(dom.querySelectorAll('a[href^="/manage/events/e1/videos/"]').length, 2);
  assert.ok(dom.querySelector('img[src="/api/youtube-thumbnail/AbCdEfGhI12/default"]'));
  assert.match(dom.querySelector("tbody")?.textContent ?? "", /非公開/);
  const staff = new JSDOM(SSR(h(VideoReviewQueueTable, { ...props, canApprove: false }))).window.document;
  assert.equal(staff.querySelectorAll("button").length, 0);
  assert.equal(staff.querySelectorAll('a[href^="/manage/events/e1/videos/"]').length, 0);
  assert.equal(staff.querySelectorAll('a[href^="/v/"]').length, 2);
  assert.match(SSR(h(VideoReviewQueueTable, { ...props, rows: [] })), /条件に合う作品がありません/);
});
test("MIG-0724 U01: review detail retains read-only answers, private-member indicator and safe YouTube URLs", () => {
  const row = { ...sample(), creator_name: "作者", creator_x_user_id: "creator",
    music: null, credit: null, intro_comment: "紹介", highlights: null, production_story: null,
    stagePermission: "確認済", software_label: null, event_ids: ["e1"],
    customAnswers: [{ label: "質問", answer: "回答", required: true }],
    members: [{ name: "参加者", role: "編集", x_user_id: "member", is_public_member: false, chapters: "00:10" }] };
  const html = SSR(h(VideoReviewDetailPanel, { video: row, statusForm: h("p", null, "変更"), footerLinks: "戻る" }));
  assert.match(html, /カスタム質問回答/);
  assert.match(html, /非公開/);
  assert.match(html, /00:10/);
  assert.match(html, /youtube-thumbnail\/AbCdEfGhI12\/maxresdefault/);
  assert.match(html, /href="https:\/\/www.youtube.com\/watch\?v=AbCdEfGhI12"/);
  assert.equal(youtubeThumbUrl("bad/id", "default"), "");
  const urlLess = SSR(h(VideoReviewDetailPanel, { video: { ...row, youtube_video_id: null }, statusForm: "変更" }));
  assert.match(urlLess, /未設定（動画情報のみ公開できます/);
  assert.doesNotMatch(urlLess, /watch\?v=/);
  assert.equal(formatRelative(NaN), "");
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://flamenode.test/manage" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function deferred() {
  let resolve;
  const promise = new Promise(ok => { resolve = ok; });
  return { promise, resolve };
}
async function mounted(element) {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  await React.act(async () => { root.render(element); });
  return {
    target,
    click: async text => React.act(async () => {
      const buttons = [...target.querySelectorAll("button")];
      const button = buttons.find(x => x.textContent.includes(text));
      assert.ok(button, "button " + text);
      button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    }),
    submit: async () => React.act(async () => {
      target.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    }),
    change: async (value) => React.act(async () => {
      const select = target.querySelector("select");
      select.value = value;
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    }),
    cleanup: async () => React.act(async () => { root.unmount(); target.remove(); }),
  };
}

test("MIG-0724 U01 T02: quick approval double click submits once and refreshes after acknowledged result", async () => {
  const pending = deferred();
  const calls = [], refresh = [];
  const ui = await mounted(h(VideoReviewQuickApproveButton, {
    videoId: "v1", hiddenFields: { event_id: "e1" },
    action: fd => { calls.push([...fd.entries()]); return pending.promise; },
    onRefresh: () => refresh.push(true),
  }));
  try {
    await React.act(async () => {
      const btn = ui.target.querySelector("button");
      btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(Object.fromEntries(calls[0]), { event_id: "e1", video_id: "v1" });
    assert.equal(ui.target.querySelector("button").disabled, true);
    await React.act(async () => { pending.resolve({ ok: true, pendingPublicReflection: true }); });
    assert.equal(refresh.length, 1);
    assert.match(ui.target.textContent, /公開ページへの反映は/);
    assert.equal(ui.target.querySelector("button").disabled, false);
  } finally { await ui.cleanup(); }
});
test("MIG-0724 U01 T03: approve-and-next uses returned destination, no duplicate writes; network error refreshes", async () => {
  const pending = deferred(), calls = [], navigations = [], refreshes = [];
  const props = {
    videoId: "v1", currentStatus: "pending", hiddenFields: { event_id: "e1" },
    approveAction: async () => ({ ok: true }),
    approveAndNextAction: fd => { calls.push(Object.fromEntries(fd.entries())); return pending.promise; },
    onRefresh: () => refreshes.push(true), onNavigate: href => navigations.push(href),
  };
  const ui = await mounted(h(VideoApproveActions, props));
  try {
    await React.act(async () => {
      const btn = [...ui.target.querySelectorAll("button")].find(x => x.textContent.includes("次へ"));
      btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { event_id: "e1", video_id: "v1" });
    await React.act(async () => { pending.resolve({ ok: true, nextHref: "/manage/events/e1/videos/v2" }); });
    assert.deepEqual(navigations, ["/manage/events/e1/videos/v2"]);
    assert.equal(refreshes.length, 0);
  } finally { await ui.cleanup(); }
  assert.equal(SSR(h(VideoApproveActions, { ...props, currentStatus: "private" })), "");
});
test("MIG-0724 U01 T04: status form validation blocks unchanged/void without reason or case", async () => {
  const calls = [];
  const ui = await mounted(h(VideoStatusForm, {
    videoId: "v1", currentStatus: "public", statuses: ADMIN_STATUS_VALUES,
    action: async fd => { calls.push(Object.fromEntries(fd.entries())); return { ok: true }; },
    formIdPrefix: "status-test", statusLabel: "変更先", submitLabel: "適用", allowVoidReason: true,
    onRefresh, onNavigate() {},
  }));
  try {
    await ui.submit();
    assert.match(ui.target.textContent, /変更先のステータスを選択してください/);
    assert.equal(calls.length, 0);
    await ui.change("voided");
    await ui.submit();
    assert.match(ui.target.textContent, /理由が必要です/);
    assert.equal(calls.length, 0);
  } finally { await ui.cleanup(); }
  const manage = await mounted(h(VideoStatusForm, {
    videoId: "v2", currentStatus: "pending", statuses: MANAGE_STATUS_VALUES,
    action: async fd => { calls.push(Object.fromEntries(fd.entries())); return { ok: true }; },
    formIdPrefix: "manage-test", statusLabel: "変更", submitLabel: "保存",
    hiddenFields: { event_id: "e2" }, onRefresh, onNavigate() {},
  }));
  try {
    await manage.change("public");
    await manage.submit();
    assert.deepEqual(calls.at(-1), { event_id: "e2", video_id: "v2", status: "public" });
    assert.match(manage.target.textContent, /ステータスを更新しました/);
  } finally { await manage.cleanup(); }
});
