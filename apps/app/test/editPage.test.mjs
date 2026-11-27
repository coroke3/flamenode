import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { dom, user } from "./helpers.mjs";
import { createVideoEditApi } from "../.test-dist/apps/app/src/api/videoEdit.js";
import { Edit } from "../.test-dist/apps/app/src/routes/dashboard/edit/Edit.js";

const { flushSync } = await import("react-dom");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router-dom");

const access = (over = {}) => ({
  privilegeMode: "normal", ownership: { isCreatorOwner: true, isCollaboratorOwner: false, isOwner: true },
  canOfferAdminMode: false, canOfferEventMode: false, membershipHint: "none",
  sections: { identity: true, basics: true, youtube: true, credits: true, descriptions: true, members: true,
    memberChapters: true, primaryEvent: true, visibility: true, permissions: true },
  sectionEventSources: null, eventId: null, eventTitleForMode: null, canEditAnySection: true, ...over,
});
const header = (over = {}) => ({ id: "video-1", title: "既存作品", visibility_status: "private", youtube_video_id: "abcdefghijk", ...over });
const editPage = (over = {}) => ({
  kind: "edit", user: user(), access: access(),
  video: { ...header(), updated_at: 1, scheduling_type: null, collaboration_type: "solo", primary_event_id: null,
    part: null, creator_display_name: null, creator_x_user_id: null, creator_icon_url: null,
    creator_profile_text: null, creator_youtube_channel_url: null, creator_other_social_links: null, music: null,
    music_reference_url: null, credit: null, intro_comment: null, highlights: null, production_story: null,
    closing_comment: null },
  disabledSections: [], disabledFields: [], canEditEvents: true, canChangeSubmitter: false, defaultProfile: null,
  softwareLabel: null, isCollab: false, eventIds: [], events: [], members: [], membersTruncated: false, xIdOptions: [],
  permissionSummary: null, collabTruncated: false, ...over,
});
const options = (over = {}) => ({
  kind: "ready", eventOptions: [], truncated: false, nextOffset: null, customAnswers: {},
  customAnswersTruncated: false, stagePermissionAnswers: null, softwareSuggestions: [], iconCandidates: [],
  channelCandidates: [], ...over,
});
const permissionSummary = (over = {}) => ({
  editorCount: 3, unlinkedEditorCount: 1, notifiableEditorCount: 2, displayNames: "参加者 A、参加者 B、参加者 C",
  warnings: [{ tone: "warning", title: "連携待ち", detail: "連携後に通知できます。" },
    { tone: "info", title: "通知設定を確認" }], ...over,
});

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8" },
});
const isOptions = (path) => path.split("?", 1)[0].endsWith("/form-options");
const href = (container, label) => [...container.querySelectorAll("a")]
  .find((a) => a.textContent.trim() === label)?.getAttribute("href");

async function mountEdit(t, api, over = {}) {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  t.after(() => act(async () => root.unmount()));
  let props = { api, videoId: "video-1", search: "", identityKey: "session-1:x-1", ...over };
  const render = async (changes = {}, onCommit = () => {}) => {
    props = { ...props, ...changes };
    await act(async () => {
      flushSync(() => root.render(React.createElement(MemoryRouter, null, React.createElement(Edit, props))));
      onCommit();
    });
  };
  await render();
  return { container, render };
}

test("both canonical reads encode the video segment and use the same abortable private GET", async () => {
  const calls = [];
  const page = { kind: "no_access", message: "not_editable", public_id: "video-1" };
  const api = createVideoEditApi(async (path, init) => {
    calls.push([path, init]);
    return json(isOptions(path) ? options() : page);
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await api.getPage("id/?#%", "admin", signal), { status: "ok", data: page });
  assert.deepEqual(await api.getFormOptions("id/?#%", "event", signal), { status: "ok", data: options() });
  assert.deepEqual(calls.map(([path]) => path), [
    "/api/personal/edit/id%2F%3F%23%25?privileged=admin",
    "/api/personal/edit/id%2F%3F%23%25/form-options?privileged=event",
  ]);
  for (const [, init] of calls) {
    assert.deepEqual(init, { method: "GET", credentials: "same-origin", cache: "no-store",
      headers: { accept: "application/json" }, signal });
  }
  for (const id of ["", ".", "..", "\ud800"]) {
    assert.equal((await api.getPage(id, "normal", signal)).status, "unavailable");
  }
  assert.equal(calls.length, 2);
});

test("canonical edit statuses, MIME and schemas govern both read results", async () => {
  const signal = new AbortController().signal;
  for (const [reply, expected] of [
    [() => json(editPage(), 401), "anonymous"], [() => json(editPage(), 403), "banned"],
    [() => json({ error: "not_found" }, 404), "not_found"],
    [() => json({ error: "not_found", message: "proxy" }, 404), "unavailable"],
    [() => json({ error: "Not Found" }, 404), "unavailable"],
    [() => json({ error: "not_found" }), "unavailable"],
    [() => json(editPage(), 503), "unavailable"],
    [() => new Response('{"error":"not_found"}', { status: 404 }), "unavailable"],
    [() => new Response(JSON.stringify({ kind: "no_access", message: "not_editable", public_id: "v" })), "unavailable"],
    [() => new Response("{", { headers: { "content-type": "application/json" } }), "unavailable"],
    [() => json(editPage({ membersTruncated: undefined })), "unavailable"],
    [() => json(options({ customAnswers: { "e:q": false } })), "unavailable"],
    [() => { throw new Error("transport failure"); }, "unavailable"],
  ]) {
    const api = createVideoEditApi(async () => reply());
    assert.equal((await api.getPage("video-1", "normal", signal)).status, expected);
    assert.equal((await api.getFormOptions("video-1", "normal", signal)).status, expected);
  }
});

test("repeat privilege queries fall back to normal and denied reads expose only the safe CURRENT links", async (t) => {
  const calls = [];
  const api = createVideoEditApi(async (path) => {
    calls.push(path);
    return json({ kind: "no_access", message: "event_staff_insufficient", public_id: "ytNONE" });
  });
  const { container } = await mountEdit(t, api, { search: "?privileged=admin&privileged=admin" });
  assert.deepEqual(calls, ["/api/personal/edit/video-1"]);
  assert.match(container.textContent, /編集権限がありませんこの作品に対する運営権限が不足しています。/);
  assert.equal(href(container, "ダッシュボードへ"), "/dashboard");
  assert.equal(href(container, "公開ページを見る"), "/video-1");
  assert.equal(container.querySelector("header, form"), null);
});

test("switch-only uses the resolved privilege mode, CURRENT header links and notice without requesting options", async (t) => {
  const calls = [];
  const api = createVideoEditApi(async (path) => {
    calls.push(path);
    return json({ kind: "switch_only", user: user({ role: "admin" }), video: header({ id: "v/a?b" }),
      access: access({ canOfferAdminMode: true, canOfferEventMode: true, canEditAnySection: false }),
      message: "switch_admin", events: [] });
  });
  const { container } = await mountEdit(t, api, { videoId: "v/a?b", search: "?privileged=event" });
  assert.deepEqual(calls, ["/api/personal/edit/v%2Fa%3Fb?privileged=event"]);
  assert.equal(container.querySelector("h1").textContent, "既存作品");
  assert.match(container.textContent, /通常編集モードでは編集できる項目がありません。上部の「管理者権限で編集」から明示的に権限を切り替えてください。/);
  assert.equal(href(container, "管理者権限で編集"), "/dashboard/edit/v%2Fa%3Fb?privileged=admin");
  assert.equal(href(container, "イベント運営権限で編集"), "/dashboard/edit/v%2Fa%3Fb?privileged=event");
  assert.equal(href(container, "通常モードへ戻る"), undefined);
  assert.equal(href(container, "FlameNode で見る"), "/abcdefghijk");
  assert.equal(href(container, "YouTube で確認"), "https://www.youtube.com/watch?v=abcdefghijk");
  assert.equal(container.querySelector("form"), null);
});

test("edit pages read options once with the same requested mode before showing the read shell", async (t) => {
  const calls = [];
  const api = createVideoEditApi(async (path, { signal }) => {
    calls.push([path, signal]);
    return json(isOptions(path) ? options() : editPage({ access: access({ privilegeMode: "event" }) }));
  });
  const { container, render } = await mountEdit(t, api, { search: "?privileged=event&ignored=1" });
  assert.deepEqual(calls.map(([path]) => path), [
    "/api/personal/edit/video-1?privileged=event", "/api/personal/edit/video-1/form-options?privileged=event",
  ]);
  assert.equal(calls[0][1], calls[1][1]);
  assert.equal(container.querySelector("h1").textContent, "既存作品");
  assert.equal(href(container, "通常モードへ戻る"), "/dashboard/edit/video-1");
  assert.equal(container.querySelector("[role=status], form"), null);
  await render({ search: "?privileged=event&ignored=2" });
  assert.equal(calls.length, 2);
});

test("permissions-only and incomplete snapshots cannot enable a form", async (t) => {
  const calls = [];
  const cases = [
    [editPage({ access: access({ canEditAnySection: false }) }), options(), /現在の権限では編集できる項目がありません。/],
    [editPage({ membersTruncated: true }), options()],
    [editPage({ collabTruncated: true, permissionSummary: permissionSummary() }), options()],
    [editPage(), options({ customAnswersTruncated: true })], [editPage(), options({ truncated: true })],
    [editPage(), options({ nextOffset: 100 })],
  ];
  const make = ([page, formOptions]) => createVideoEditApi(async (path) => {
    calls.push(path);
    return json(isOptions(path) ? formOptions : page);
  });
  const { render, container } = await mountEdit(t, make(cases[0]));
  for (const fixture of cases) {
    calls.length = 0;
    await render({ api: make(fixture) });
    assert.match(container.textContent, fixture[2] ?? /画面の表示中に問題が発生しました/);
    if (!fixture[2]) assert.doesNotMatch(container.textContent, /既存作品/);
    assert.equal(container.querySelector("form, #video-collab-perms"), null);
    const [page] = fixture;
    assert.equal(calls.length, page.membersTruncated || page.collabTruncated ? 1 : 2);
  }
});

test("lost form-options access suppresses the earlier private page and preserves distinct failure views", async (t) => {
  const cases = [
    [() => json({}, 401), /ログインが必要です/], [() => json({}, 403), /利用が停止されています/],
    [() => json({ error: "not_found" }, 404), /ページが見つかりません/],
    [() => json({}, 404), /画面の表示中に問題が発生しました/],
    [() => json({ kind: "no_access" }), /画面の表示中に問題が発生しました/],
  ];
  const make = (reply) => createVideoEditApi(async (path) => isOptions(path) ? reply() :
    json(editPage({ permissionSummary: permissionSummary() })));
  const { container, render } = await mountEdit(t, make(cases[0][0]), { search: "?privileged=event" });
  assert.equal(href(container, "Discord でログイン"), "/entry?next=%2Fdashboard%2Fedit%2Fvideo-1");
  for (const [reply, notice] of cases) {
    await render({ api: make(reply) });
    assert.match(container.textContent, notice);
    assert.doesNotMatch(container.textContent, /既存作品/);
    assert.equal(container.querySelector("form, #video-collab-perms"), null);
  }
});

test("a page response for a different video never starts form options or exposes its header", async (t) => {
  const calls = [];
  const api = createVideoEditApi(async (path) => {
    calls.push(path);
    return json(editPage());
  });
  const { container } = await mountEdit(t, api, { videoId: "video-2" });
  assert.deepEqual(calls, ["/api/personal/edit/video-2"]);
  assert.match(container.textContent, /画面の表示中に問題が発生しました/);
  assert.doesNotMatch(container.textContent, /既存作品/);
});

test("the default edit client renders complete permission counts, names and warnings with a safe resolved-mode link", async (t) => {
  const id = "v/a?b";
  const page = editPage({ access: access({ privilegeMode: "event" }), permissionSummary: permissionSummary() });
  page.video.id = id;
  const fetch = t.mock.method(globalThis, "fetch", async (path) => json(isOptions(path) ? options() : page));
  const { container } = await mountEdit(t, undefined, { videoId: id, search: "?privileged=event" });
  assert.deepEqual(fetch.mock.calls.map(({ arguments: [path] }) => path), [
    "/api/personal/edit/v%2Fa%3Fb?privileged=event", "/api/personal/edit/v%2Fa%3Fb/form-options?privileged=event",
  ]);
  const card = container.querySelector("#video-collab-perms");
  assert.equal(card.querySelector("h2").textContent, "参加者の編集権限");
  assert.match(card.textContent, /編集権限設定 3人 · X ID連携待ち 1人 · 通知可能 2人/);
  assert.match(card.textContent, /参加者 A、参加者 B、参加者 C/);
  assert.deepEqual([...card.querySelectorAll('[role="status"]')].map((notice) => notice.textContent),
    ["連携待ち連携後に通知できます。", "通知設定を確認"]);
  assert.equal(href(card, "編集できる人を管理"), "/dashboard/edit/v%2Fa%3Fb/permissions?privileged=event");
});

test("a permission-only page can show the empty summary, using the resolved normal mode", async (t) => {
  const page = editPage({
    access: access({ canEditAnySection: false }),
    permissionSummary: permissionSummary({ editorCount: 0, unlinkedEditorCount: 0, notifiableEditorCount: 0, displayNames: "", warnings: [] }),
  });
  const api = createVideoEditApi(async (path) => json(isOptions(path) ? options() : page));
  const { container } = await mountEdit(t, api, { search: "?privileged=admin" });
  const card = container.querySelector("#video-collab-perms");
  assert.match(card.textContent, /編集権限設定 0人まだ編集権限を付与された人はいません。/);
  assert.match(container.textContent, /現在の権限では編集できる項目がありません。/);
  assert.equal(href(card, "編集できる人を管理"), "/dashboard/edit/video-1/permissions");
  assert.equal(container.querySelector("form"), null);
});

test("identity, video, mode and client changes hide snapshots immediately and abort stale reads", async (t) => {
  const calls = [];
  const api = createVideoEditApi((path, { signal }) => new Promise((resolve) => calls.push({ path, signal, resolve })));
  const { container, render } = await mountEdit(t, api);
  const resolve = (index, payload) => act(async () => calls[index].resolve(json(payload)));
  await resolve(0, editPage());
  await resolve(1, options());
  assert.match(container.textContent, /既存作品/);

  const loading = () => {
    assert.match(container.textContent, /読み込み中/);
    assert.doesNotMatch(container.textContent, /既存作品/);
  };
  await render({ identityKey: "session-2:x-1" }, loading);
  assert.equal(calls[1].signal.aborted, true);
  await render({ videoId: "video-2" }, loading);
  assert.equal(calls[2].signal.aborted, true);
  await resolve(2, editPage());
  assert.equal(calls.length, 4, "a stale page cannot start an options request");

  const second = editPage();
  second.video.id = "video-2";
  await resolve(3, second);
  await render({ search: "?privileged=event" }, loading);
  assert.equal(calls[4].signal.aborted, true);
  await resolve(4, options());
  loading();
  await resolve(5, second);
  await resolve(6, options());
  assert.match(container.textContent, /既存作品/);

  await render({ api: createVideoEditApi(() => new Promise(() => {})) }, loading);
  assert.equal(calls[6].signal.aborted, true);
});
