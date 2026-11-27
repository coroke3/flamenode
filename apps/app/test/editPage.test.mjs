import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { dom, user } from "./helpers.mjs";
import { createVideoEditApi } from "../.test-dist/apps/app/src/api/videoEdit.js";
import { Edit } from "../.test-dist/apps/app/src/routes/dashboard/edit/Edit.js";

const { flushSync } = await import("react-dom");
const { createRoot } = await import("react-dom/client");
const READ_SCOPE = "a".repeat(64);
const { MemoryRouter } = await import("react-router-dom");

const access = (over = {}) => ({
  privilegeMode: "normal", ownership: { isCreatorOwner: true, isCollaboratorOwner: false, isOwner: true },
  canOfferAdminMode: false, canOfferEventMode: false, membershipHint: "none",
  sections: { identity: true, basics: true, youtube: true, credits: true, descriptions: true, members: true,
    memberChapters: true, primaryEvent: true, visibility: true, permissions: true },
  sectionEventSources: null, eventId: null, eventTitleForMode: null, canEditAnySection: true, ...over,
});
const enabledSections = (...keys) => Object.fromEntries(Object.keys(access().sections).map((key) => [key, keys.includes(key)]));
const header = (over = {}) => ({ id: "video-1", title: "既存作品", visibility_status: "private", youtube_video_id: "abcdefghijk", ...over });
const editPage = (over = {}) => ({
  kind: "edit", user: user(), access: access(), readScope: READ_SCOPE,
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
  kind: "ready", readScope: READ_SCOPE, attachedOptionsTruncated: false, eventOptions: [], truncated: false, nextOffset: null, customAnswers: {},
  customAnswersTruncated: false, stagePermissionAnswers: null, softwareSuggestions: [], iconCandidates: [],
  channelCandidates: [], ...over,
});
const eventOption = (id) => ({
  id, title: `イベント ${id}`, parts_json: null, youtube_description_template: null,
  required_video_fields_json: null, custom_questions: [], video_form_settings_json: null,
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
const offsetOf = (path) => Number(new URLSearchParams(path.split("?", 2)[1]).get("offset") ?? 0);
const href = (container, label) => [...container.querySelectorAll("a")]
  .find((a) => a.textContent.trim() === label)?.getAttribute("href");
const overview = (container) => container.querySelector(".vedit-overview-panel");
const adminMenu = (container) => container.querySelector('nav[aria-label="作品管理メニュー"]');
const editApi = (pageAccess, over = {}) => createVideoEditApi(async (path) =>
  json(isOptions(path) ? options() : editPage({ access: pageAccess, ...over })));

async function mountEdit(t, api, over = {}) {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  t.after(() => act(async () => root.unmount()));
  function ObserveCommit({ props, onCommit }) {
    React.useLayoutEffect(() => onCommit(), [props, onCommit]);
    return React.createElement(MemoryRouter, null, React.createElement(Edit, props));
  }
  let props = { api, videoId: "video-1", search: "", identityKey: "session-1:x-1", ...over };
  const render = async (changes = {}, onCommit = () => {}) => {
    props = { ...props, ...changes };
    await act(async () => {
      flushSync(() => root.render(React.createElement(ObserveCommit, { props, onCommit })));
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
  assert.deepEqual(await api.getFormOptions("id/?#%", "event", READ_SCOPE, signal), { status: "ok", data: options() });
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
    assert.equal((await api.getFormOptions("video-1", "normal", READ_SCOPE, signal)).status, expected);
  }
});

test("options aggregate cursors 0, 1 and 101 in order, including an empty page and page-zero provenance", async () => {
  const pages = new Map([
    [0, options({
      eventOptions: [eventOption("z")], truncated: true, nextOffset: 1,
      customAnswers: { "z:text": "same", "z:choices": ["a", "b"], constructor: "first own answer" },
      iconCandidates: ["first icon"],
    })],
    [1, options({
      truncated: true, nextOffset: 101, customAnswers: { "z:text": "same", toString: ["own answer"] },
      stagePermissionAnswers: "later stage value", softwareSuggestions: ["later software"],
      iconCandidates: ["later icon"], channelCandidates: ["later channel"],
    })],
    [101, options({
      eventOptions: [eventOption("b"), eventOption("a")],
      customAnswers: { "b:answer": "new", "z:choices": ["a", "b"], constructor: "first own answer" },
    })],
  ]);
  const calls = [];
  const api = createVideoEditApi(async (path, init) => {
    calls.push([path, init.signal]);
    const page = pages.get(offsetOf(path));
    assert.ok(page);
    return json(page);
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await api.getFormOptions("video-1", "event", READ_SCOPE, signal), {
    status: "ok",
    data: options({
      eventOptions: [eventOption("z"), eventOption("b"), eventOption("a")],
      customAnswers: {
        "z:text": "same", "z:choices": ["a", "b"], constructor: "first own answer",
        toString: ["own answer"], "b:answer": "new",
      },
      iconCandidates: ["first icon"],
    }),
  });
  assert.deepEqual(calls, [
    ["/api/personal/edit/video-1/form-options?privileged=event", signal],
    [`/api/personal/edit/video-1/form-options?privileged=event&offset=1&readScope=${READ_SCOPE}`, signal],
    [`/api/personal/edit/video-1/form-options?privileged=event&offset=101&readScope=${READ_SCOPE}`, signal],
  ]);
});

test("all 901 successive options offsets can be traversed and offset 900 still requires completion", async () => {
  const signal = new AbortController().signal;
  for (const [step, finalPage, expected] of [
    [1, options({ eventOptions: [eventOption("last")] }), "ok"],
    [100, options({ truncated: true }), "unavailable"],
    [100, options({ truncated: true, nextOffset: 901 }), "unavailable"],
  ]) {
    const offsets = [];
    const api = createVideoEditApi(async (path) => {
      const offset = offsetOf(path);
      offsets.push(offset);
      return json(offset === 900 ? finalPage : options({ truncated: true, nextOffset: offset + step }));
    });
    const result = await api.getFormOptions("video-1", "normal", READ_SCOPE, signal);
    assert.equal(result.status, expected);
    if (result.status === "ok") assert.deepEqual(result.data.eventOptions, [eventOption("last")]);
    assert.deepEqual(offsets, Array.from({ length: 900 / step + 1 }, (_, index) => index * step));
  }
});

test("invalid and non-forward options cursors fail without more requests", async () => {
  const cases = [
    [0, options({ truncated: true })], [0, options({ nextOffset: 1 })],
    ...[-1, 0, 0.5, "1", 101, Number.MAX_SAFE_INTEGER + 1].map((nextOffset) => [0, options({ truncated: true, nextOffset })]),
    [1, options({ truncated: true, nextOffset: 1 })], [1, options({ truncated: true, nextOffset: 0 })],
  ];
  for (const [offset, invalid] of cases) {
    const offsets = [];
    const api = createVideoEditApi(async (path) => {
      const readOffset = offsetOf(path);
      offsets.push(readOffset);
      return json(readOffset === offset ? invalid : options({ truncated: true, nextOffset: offset }));
    });
    assert.deepEqual(await api.getFormOptions("video-1", "normal", READ_SCOPE, new AbortController().signal), { status: "unavailable" });
    assert.deepEqual(offsets, offset === 0 ? [0] : [0, offset]);
  }
});

test("duplicate event IDs and conflicting answer values fail closed on any page", async () => {
  const cases = [
    [options({ eventOptions: [eventOption("e"), eventOption("e")] })],
    [options({ eventOptions: [eventOption("e")] }), options({ eventOptions: [eventOption("e")] })],
    ...[["one", "two"], ["a", ["a"]], [["a", "b"], ["b", "a"]], [["a"], ["a", "b"]]]
      .map(([first, second]) => [options({ customAnswers: { "e:q": first } }), options({ customAnswers: { "e:q": second } })]),
  ];
  for (const [first, second] of cases) {
    const offsets = [];
    const api = createVideoEditApi(async (path) => {
      const offset = offsetOf(path);
      offsets.push(offset);
      return json(offset === 0 && second ? { ...first, truncated: true, nextOffset: 1 } : second ?? first);
    });
    assert.deepEqual(await api.getFormOptions("video-1", "normal", READ_SCOPE, new AbortController().signal), { status: "unavailable" });
    assert.deepEqual(offsets, second ? [0, 1] : [0]);
  }
});

test("form-options traversal binds every page to the edit-page scope and rejects attached overflow", async () => {
  const signal = new AbortController().signal;
  const mismatchedFirst = createVideoEditApi(async () => json(options({ readScope: "b".repeat(64) })));
  assert.deepEqual(await mismatchedFirst.getFormOptions("video-1", "normal", READ_SCOPE, signal), { status: "unavailable" });

  const attachedOverflow = createVideoEditApi(async () => json(options({ attachedOptionsTruncated: true, truncated: true, nextOffset: 1 })));
  assert.deepEqual(await attachedOverflow.getFormOptions("video-1", "normal", READ_SCOPE, signal), { status: "unavailable" });

  const paths = [];
  const changedContinuation = createVideoEditApi(async (path) => {
    paths.push(path);
    return json(offsetOf(path) === 0
      ? options({ truncated: true, nextOffset: 1 })
      : options({ readScope: "b".repeat(64) }));
  });
  assert.deepEqual(await changedContinuation.getFormOptions("video-1", "normal", READ_SCOPE, signal), { status: "unavailable" });
  assert.deepEqual(paths, [
    "/api/personal/edit/video-1/form-options",
    `/api/personal/edit/video-1/form-options?offset=1&readScope=${READ_SCOPE}`,
  ]);
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
  assert.equal(overview(container), null);
  assert.equal(adminMenu(container), null);
});

test("switch-only uses the resolved privilege mode, CURRENT header links and notice without requesting options", async (t) => {
  const calls = [];
  const api = createVideoEditApi(async (path) => {
    calls.push(path);
    return json({ kind: "switch_only", user: user({ role: "admin" }), video: header({ id: "v/a?b" }),
      access: access({ sections: enabledSections(), canOfferAdminMode: true, canOfferEventMode: true, canEditAnySection: false }),
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
  assert.equal(adminMenu(container), null);
  const panel = overview(container);
  assert.ok(panel.classList.contains("vedit-overview-normal"), "use the resolved normal mode");
  assert.equal(container.querySelector("header").nextElementSibling, panel);
  assert.match(panel.nextElementSibling.textContent, /明示的に権限を切り替えてください。/);
});

test("edit pages keep the same requested mode through options continuation before showing the read shell", async (t) => {
  const calls = [];
  const api = createVideoEditApi(async (path, { signal }) => {
    calls.push([path, signal]);
    if (!isOptions(path)) return json(editPage({ access: access({ privilegeMode: "event" }) }));
    return json(offsetOf(path) === 0 ? options({ truncated: true, nextOffset: 100 }) : options());
  });
  const { container, render } = await mountEdit(t, api, { search: "?privileged=event&ignored=1" });
  assert.deepEqual(calls.map(([path]) => path), [
    "/api/personal/edit/video-1?privileged=event", "/api/personal/edit/video-1/form-options?privileged=event",
    `/api/personal/edit/video-1/form-options?privileged=event&offset=100&readScope=${READ_SCOPE}`,
  ]);
  assert.ok(calls.every(([, signal]) => signal === calls[0][1]));
  assert.equal(container.querySelector("h1").textContent, "既存作品");
  assert.equal(href(container, "通常モードへ戻る"), "/dashboard/edit/video-1");
  assert.equal(container.querySelector("[role=status], form"), null);
  await render({ search: "?privileged=event&ignored=2" });
  assert.equal(calls.length, 3);
});

test("permissions-only and incomplete snapshots cannot enable a form", async (t) => {
  const calls = [];
  const cases = [
    [editPage({ access: access({ sections: enabledSections("permissions"), canEditAnySection: false }) }), options(), /現在の権限では編集できる項目がありません。/],
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
    if (!fixture[2]) assert.equal(overview(container), null);
    const [page] = fixture;
    assert.equal(calls.length, page.membersTruncated || page.collabTruncated ? 1 : 2);
  }
});

test("a failing options continuation suppresses private data and preserves distinct failure views", async (t) => {
  const cases = [
    [() => json({}, 401), /ログインが必要です/], [() => json({}, 403), /利用が停止されています/],
    [() => json({ error: "not_found" }, 404), /ページが見つかりません/],
    [() => json({}, 404), /画面の表示中に問題が発生しました/],
    [() => json({ kind: "no_access" }), /画面の表示中に問題が発生しました/],
    [() => json({ error: "unavailable" }, 503), /画面の表示中に問題が発生しました/],
    [() => json(options({ customAnswersTruncated: true, truncated: true, nextOffset: 2 })), /画面の表示中に問題が発生しました/],
  ];
  const calls = [];
  const make = (reply) => createVideoEditApi(async (path) => {
    calls.push(path);
    if (!isOptions(path)) return json(editPage({
      user: user({ role: "admin" }), access: access({ privilegeMode: "admin" }), permissionSummary: permissionSummary(),
    }));
    return offsetOf(path) === 0 ? json(options({ truncated: true, nextOffset: 1 })) : reply();
  });
  const { container, render } = await mountEdit(t, make(cases[0][0]), { search: "?privileged=admin" });
  assert.equal(href(container, "Discord でログイン"), "/entry?next=%2Fdashboard%2Fedit%2Fvideo-1");
  for (const [reply, notice] of cases) {
    calls.length = 0;
    await render({ api: make(reply) });
    assert.deepEqual(calls.filter(isOptions).map(offsetOf), [0, 1]);
    assert.match(container.textContent, notice);
    assert.doesNotMatch(container.textContent, /既存作品/);
    assert.equal(container.querySelector("form, #video-collab-perms"), null);
    assert.equal(overview(container), null);
    assert.equal(adminMenu(container), null);
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
  assert.equal(overview(container), null);
});

test("normal overview orders all ten permission labels, links headings and keeps both empty messages", async (t) => {
  const mixed = { ...access().sections, basics: false, credits: false, members: false, primaryEvent: false, permissions: false };
  const { container, render } = await mountEdit(t, editApi(access({ sections: mixed })));
  const panel = overview(container);
  const heading = panel.querySelector("h2.vedit-overview-heading");
  assert.equal(heading.textContent, "現在の編集権限");
  assert.equal(panel.getAttribute("aria-labelledby"), heading.id);
  assert.equal(heading.querySelector("svg").getAttribute("aria-hidden"), "true");
  assert.equal(heading.querySelector("svg").getAttribute("width"), "11");
  const blocks = [...panel.querySelectorAll(".vedit-overview-lists > section.vedit-overview-listBlock")];
  const titles = blocks.map((block) => block.querySelector("h3.vedit-overview-listTitle"));
  assert.deepEqual(titles.map((title) => title.textContent), ["編集可能", "編集不可"]);
  assert.deepEqual(blocks.map((block) => block.getAttribute("aria-labelledby")), titles.map((title) => title.id));
  assert.equal(new Set([heading.id, ...titles.map((title) => title.id)]).size, 3);
  assert.deepEqual(blocks.map((block) => [...block.querySelectorAll(".vedit-overview-list li")].map((li) => li.textContent)), [
    ["提出者情報", "YouTube URL", "紹介文・振り返り", "メンバーチャプター", "公開状態"],
    ["作品タイトル・基本情報", "楽曲・クレジット", "合作メンバー", "所属イベント", "共同編集権限"],
  ]);

  for (const [sections, title, empty] of [
    [enabledSections(), "編集可能", "現在、編集できる項目はありません。"],
    [access().sections, "編集不可", "すべての項目が編集可能です。"],
  ]) {
    await render({ api: editApi(access({ sections })) });
    const message = overview(container).querySelector(".vedit-overview-emptyList");
    assert.equal(message.previousElementSibling.textContent, title);
    assert.equal(message.textContent, empty);
  }
});

test("normal overview keeps the CURRENT owner, event, admin and generic lead precedence", async (t) => {
  const { container, render } = await mountEdit(t, editApi(access()));
  const outsider = { isCreatorOwner: false, isCollaboratorOwner: false, isOwner: false };
  for (const [over, lead] of [
    [{ canOfferEventMode: true, canOfferAdminMode: true }, "所有者向け一般作品権限が適用されています。編集できる項目とできない項目は以下のとおりです。"],
    [{ ownership: outsider, canOfferEventMode: true, canOfferAdminMode: true }, "通常モードでは編集できません。上部からイベント運営権限へ切り替えると、許可された項目を編集できます。"],
    [{ ownership: outsider, canOfferAdminMode: true }, "通常モードでは編集できません。上部から管理者権限へ明示的に切り替えてください。"],
    [{ ownership: outsider }, "現在の通常モードで編集できる項目とできない項目は以下のとおりです。"],
  ]) {
    await render({ api: editApi(access(over)) });
    assert.equal(overview(container).querySelector(".vedit-overview-lead").textContent, lead);
  }
});

test("event overview names distinct editable sources in section order and only falls back for missing titles", async (t) => {
  const eventAccess = access({
    privilegeMode: "event",
    sections: { ...access().sections, primaryEvent: false, permissions: false },
    eventTitleForMode: "   共通イベント   ",
    sectionEventSources: {
      basics: { eventId: "second", eventTitle: "  同じ名前 " },
      identity: { eventId: "missing-title", eventTitle: null },
      descriptions: { eventId: "another-id", eventTitle: "同じ名前" },
      members: { eventId: "third", eventTitle: "別イベント" },
      permissions: { eventId: "locked", eventTitle: "ロック済み" },
      unknown: { eventId: "unknown", eventTitle: "不明" },
    },
  });
  const { container, render } = await mountEdit(t, editApi(eventAccess), { search: "?privileged=event" });
  const panel = overview(container);
  assert.ok(panel.classList.contains("vedit-overview-event"));
  assert.equal(panel.querySelector("h2").textContent, "イベント運営権限で編集中");
  assert.equal(panel.querySelector("h2 svg[aria-hidden=true]").getAttribute("width"), "12");
  assert.equal(panel.querySelector(".vedit-overview-eventName").textContent, "権限元イベント: 共通イベント / 同じ名前 / 別イベント");
  assert.equal(panel.querySelector(".vedit-overview-lead").textContent, "項目ごとに異なるイベントの運営権限が適用されています。");

  await render({ api: editApi({ ...eventAccess, sections: enabledSections("identity", "basics"), sectionEventSources: {
    identity: { eventId: "empty", eventTitle: "" }, basics: { eventId: "whitespace", eventTitle: "   " },
  } }) });
  assert.equal(overview(container).querySelector(".vedit-overview-eventName"), null);
  assert.equal(overview(container).querySelector(".vedit-overview-lead").textContent, "付与された運営権限の範囲内でのみ、作品情報を編集できます。");
});

test("admin overview appears between the page header and management card with the CURRENT audit note", async (t) => {
  const api = editApi(access({ privilegeMode: "admin" }), { user: user({ role: "admin" }), permissionSummary: permissionSummary() });
  const { container } = await mountEdit(t, api, { search: "?privileged=admin" });
  const panel = overview(container);
  const following = dom.window.Node.DOCUMENT_POSITION_FOLLOWING;
  assert.ok(panel.classList.contains("vedit-overview-admin"));
  assert.ok(container.querySelector("header").compareDocumentPosition(panel) & following);
  assert.ok(panel.compareDocumentPosition(container.querySelector("#video-collab-perms")) & following);
  assert.equal(panel.querySelector("h2").textContent, "管理者権限で編集中");
  assert.equal(panel.querySelector("h2 svg[aria-hidden=true]").getAttribute("width"), "12");
  assert.equal(panel.querySelector(".vedit-overview-lead").textContent, "提出主体や所属イベントなど、通常では変更できない項目も編集できます。");
  assert.equal(panel.querySelector(".vedit-overview-auditNote").textContent, "管理者権限での変更は監査ログに記録されます。必要な操作のみ行ってください。");
  assert.equal(panel.querySelector("ul, h3, .vedit-overview-eventName"), null);
});

test("admin edit renders the six CURRENT destinations as native links with one active tab", async (t) => {
  const videoId = "v/#?+%";
  const expectedId = "v%2F%23%3F%2B%25";
  const admin = user({ role: "admin" });
  const make = (id, youtubeId) => editApi(access({ privilegeMode: "admin" }), {
    user: admin, video: { ...editPage().video, id, youtube_video_id: youtubeId },
  });
  const { container, render } = await mountEdit(t, make(videoId, "abcdefghijk"), { videoId, search: "?privileged=admin" });
  const menu = adminMenu(container);
  assert.equal(menu.className, "fn-console-resource-tabs");
  assert.equal(container.querySelector("header").nextElementSibling, menu);
  assert.equal(menu.nextElementSibling, overview(container));
  const links = [...menu.querySelectorAll("a")];
  assert.deepEqual(links.map((link) => [link.textContent, link.getAttribute("href")]), [
    ["管理詳細", `/admin/videos/${expectedId}`], ["メンバー", `/admin/videos/${expectedId}/members`],
    ["内容編集", `/dashboard/edit/${expectedId}?privileged=admin`],
    ["編集権限", `/dashboard/edit/${expectedId}/permissions?privileged=admin`],
    ["公開ページ", "/abcdefghijk"], ["監査ログ", `/admin/audit?table=videos&record=${expectedId}`],
  ]);
  assert.deepEqual(links.filter((link) => link.hasAttribute("aria-current")), [links[2]]);
  assert.equal(links[2].getAttribute("aria-current"), "page");
  let intercepted;
  container.addEventListener("click", (event) => {
    intercepted = event.defaultPrevented;
    event.preventDefault(); // Let the test inspect the dispatch without navigating jsdom.
  });
  await act(async () => {
    for (const [index, link] of links.entries()) {
      assert.equal(link.className, `fn-btn fn-btn-sm ${index === 2 ? "fn-btn-primary" : "fn-btn-ghost"}`);
      assert.equal(link.querySelector("svg[aria-hidden=true]").getAttribute("width"), "11");
      intercepted = undefined;
      link.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
      assert.equal(intercepted, false, link.getAttribute("href"));
    }
  });

  await render({ api: make(videoId, "//outside.test") });
  assert.equal(href(adminMenu(container), "公開ページ"), "/list");
  await render({ videoId: "video-1", api: make("video-1", "//outside.test") });
  assert.equal(href(adminMenu(container), "公開ページ"), "/video-1");
  await render({ api: createVideoEditApi(() => new Promise(() => {})) }, () => {
    assert.match(container.textContent, /読み込み中/);
    assert.equal(adminMenu(container), null);
  });
});

test("admin navigation requires edit kind and both resolved admin mode and server user role", async (t) => {
  const admin = user({ role: "admin" });
  const adminAccess = access({ privilegeMode: "admin" });
  const { container, render } = await mountEdit(t, editApi(access(), { user: admin }), { search: "?privileged=admin" });
  assert.ok(overview(container));
  assert.equal(adminMenu(container), null, "requesting admin mode alone does not show the menu");
  for (const [api, search] of [
    [editApi(access({ privilegeMode: "event" }), { user: admin }), "?privileged=event"],
    [editApi(adminAccess), "?privileged=admin"],
    [createVideoEditApi(async () => json({
      kind: "switch_only", user: admin, video: header(), access: adminAccess, message: "switch_event", events: [],
    })), "?privileged=admin"],
  ]) {
    await render({ api, search });
    assert.ok(overview(container));
    assert.equal(adminMenu(container), null);
  }
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
    access: access({ sections: enabledSections("permissions"), canEditAnySection: false }),
    permissionSummary: permissionSummary({ editorCount: 0, unlinkedEditorCount: 0, notifiableEditorCount: 0, displayNames: "", warnings: [] }),
  });
  const api = createVideoEditApi(async (path) => json(isOptions(path) ? options() : page));
  const { container } = await mountEdit(t, api, { search: "?privileged=admin" });
  const card = container.querySelector("#video-collab-perms");
  assert.match(card.textContent, /編集権限設定 0人まだ編集権限を付与された人はいません。/);
  assert.match(container.textContent, /現在の権限では編集できる項目がありません。/);
  assert.equal(overview(container).querySelector(".vedit-overview-list").textContent, "共同編集権限");
  assert.equal(href(card, "編集できる人を管理"), "/dashboard/edit/video-1/permissions");
  assert.equal(container.querySelector("form"), null);
});

test("identity, video, mode and client changes hide snapshots and stop stale reads and continuation", async (t) => {
  const calls = [];
  const fetch = (path, { signal }) => new Promise((resolve) => calls.push({ path, signal, resolve }));
  const api = createVideoEditApi(fetch);
  const { container, render } = await mountEdit(t, api);
  const resolve = (index, payload) => act(async () => calls[index].resolve(json(payload)));
  await resolve(0, editPage());
  await resolve(1, options());
  assert.match(container.textContent, /既存作品/);

  const loading = () => {
    assert.match(container.textContent, /読み込み中/);
    assert.doesNotMatch(container.textContent, /既存作品/);
    assert.equal(overview(container), null);
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
  assert.equal(calls.length, 5, "the next options request waits for the first response");
  await resolve(4, options({ truncated: true, nextOffset: 1 }));
  loading();
  assert.equal(calls[5].path, `/api/personal/edit/video-2/form-options?offset=1&readScope=${READ_SCOPE}`);
  await render({ search: "?privileged=event" }, () => {
    loading();
    assert.equal(calls[5].signal.aborted, true, "abort before the mode commit's passive effects");
  });
  await resolve(5, options({ truncated: true, nextOffset: 2 }));
  assert.equal(calls.length, 7, "a stale options response cannot start another request");
  loading();
  await resolve(6, second);
  await resolve(7, options());
  assert.match(container.textContent, /既存作品/);

  await render({ api: createVideoEditApi(fetch) }, loading);
  assert.equal(calls[7].signal.aborted, true);
  await resolve(8, second);
  await resolve(9, options({ truncated: true, nextOffset: 1 }));
  assert.equal(calls[10].path, `/api/personal/edit/video-2/form-options?privileged=event&offset=1&readScope=${READ_SCOPE}`);
  await render({ api: createVideoEditApi(() => new Promise(() => {})) }, () => {
    loading();
    assert.equal(calls[10].signal.aborted, true, "abort before the client commit's passive effects");
  });
  await resolve(10, options({ truncated: true, nextOffset: 2 }));
  assert.equal(calls.length, 11, "replacing the client also stops pagination");
  loading();
});


test("MIG-0717 U01c: session A-B-A with both X IDs null rejects late private reads", async (t) => {
  const calls = [];
  const api = createVideoEditApi((path, { signal }) =>
    new Promise((resolve) => calls.push({ path, signal, resolve })));
  const { container, render } = await mountEdit(t, api, { identityKey: "discord-A:null-x" });
  const finish = (index, data) => act(async () => calls[index].resolve(json(data)));
  const privatePage = (owner, name) => editPage({
    video: { ...editPage().video, title: name },
    permissionSummary: permissionSummary({ displayNames: owner + " private collaborators" }),
  });
  const assertLoading = () => {
    assert.match(container.textContent, /読み込み中/);
    assert.equal(overview(container), null);
    assert.equal(adminMenu(container), null);
    assert.equal(container.querySelector("#video-collab-perms"), null);
    assert.doesNotMatch(container.textContent, /PRIVATE-A|PRIVATE-B|private collaborators/);
  };

  await finish(0, privatePage("A", "PRIVATE-A"));
  await finish(1, options());
  assert.match(container.textContent, /PRIVATE-A/);
  assert.match(container.textContent, /A private collaborators/);

  // A -> B: an unassigned X ID alone is not a sufficiently strong identity key.
  await render({ identityKey: "discord-B:null-x" }, assertLoading);
  assert.equal(calls[0].signal.aborted, true);
  await finish(2, privatePage("B", "PRIVATE-B"));
  assert.equal(calls.length, 4, "B options must not start before B page is accepted");

  // B -> A before B's options finish; stale B options cannot publish B's private UI.
  await render({ identityKey: "discord-A:null-x" }, assertLoading);
  assert.equal(calls[3].signal.aborted, true);
  await finish(3, options());
  assertLoading();
  assert.equal(calls.length, 5, "retired B options cannot continue pagination");
  await finish(4, privatePage("A", "PRIVATE-A"));
  await finish(5, options());
  assert.match(container.textContent, /PRIVATE-A/);
  assert.match(container.textContent, /A private collaborators/);
  assert.doesNotMatch(container.textContent, /PRIVATE-B|B private collaborators/);

  // Repeat A -> B -> A with B's page itself arriving after the return to A.
  await render({ identityKey: "discord-B:null-x" }, assertLoading);
  await render({ identityKey: "discord-A:null-x" }, assertLoading);
  assert.equal(calls[6].signal.aborted, true);
  await finish(6, privatePage("B", "PRIVATE-B"));
  assert.equal(calls.length, 8, "retired B page cannot start B options");
  assertLoading();
  await finish(7, privatePage("A", "PRIVATE-A"));
  await finish(8, options());
  assert.match(container.textContent, /PRIVATE-A/);
  assert.doesNotMatch(container.textContent, /PRIVATE-B|B private collaborators/);
  assert.equal(adminMenu(container), null);
  assert.equal(container.querySelector("form"), null);
});

test("MIG-0717 U01c: test-only trusted host versions null-X identity scopes across A-B-A", async (t) => {
  const calls = [];
  const api = createVideoEditApi((path, { signal }) =>
    new Promise((resolve) => calls.push({ path, signal, resolve })));
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  t.after(() => act(async () => root.unmount()));

  const identityKeys = [];
  let changeIdentity = () => {};
  function TestOnlyTrustedHost() {
    const [identity, setIdentity] = React.useState({ session: "discord-A", activeXId: null });
    const [generation, setGeneration] = React.useState(0);
    const identityKey = JSON.stringify([generation, identity.session, identity.activeXId]);
    identityKeys.push(identityKey);
    changeIdentity = (next) => {
      setIdentity(next);
      setGeneration((value) => value + 1);
    };
    return React.createElement(MemoryRouter, null, React.createElement(Edit, {
      api, videoId: "video-1", search: "?privileged=admin", identityKey,
    }));
  }

  await act(async () => {
    flushSync(() => root.render(React.createElement(TestOnlyTrustedHost)));
  });
  const transition = async (session) => act(async () =>
    changeIdentity({ session, activeXId: null }));
  const finish = async (index, payload) =>
    act(async () => calls[index].resolve(json(payload)));
  const privatePage = (owner, title) => editPage({
    user: user({ role: "admin" }),
    access: access({ privilegeMode: "admin" }),
    video: { ...editPage().video, title },
    permissionSummary: permissionSummary({ displayNames: owner + " private collaborators" }),
  });
  const assertLoading = () => {
    assert.match(container.textContent, /読み込み中/);
    assert.doesNotMatch(container.textContent, /PRIVATE-|private collaborators/);
    assert.equal(overview(container), null);
    assert.equal(adminMenu(container), null);
    assert.equal(container.querySelector("form, #video-collab-perms"), null);
  };

  const firstAKey = identityKeys.at(-1);
  await transition("discord-B");
  const bKey = identityKeys.at(-1);
  await transition("discord-A");
  const returnedAKey = identityKeys.at(-1);
  assert.notEqual(firstAKey, returnedAKey, "the host generation must distinguish A -> B -> A even with null X");
  assert.notEqual(bKey, returnedAKey);
  assert.equal(calls.length, 3, "each committed identity generation starts one page request");
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].signal.aborted, true);
  assertLoading();

  await finish(0, privatePage("A stale", "PRIVATE-A-STALE"));
  await finish(1, privatePage("B stale", "PRIVATE-B-STALE"));
  assertLoading();
  assert.equal(calls.length, 3, "retired page receipts cannot start options requests");

  await finish(2, privatePage("A", "PRIVATE-A"));
  assert.equal(calls.length, 4, "current A page starts its options request");
  await transition("discord-B");
  assert.equal(calls[3].signal.aborted, true);
  assertLoading();
  await finish(4, privatePage("B", "PRIVATE-B"));
  assert.equal(calls.length, 6, "B page starts its options request");

  await transition("discord-A");
  assert.equal(calls[5].signal.aborted, true);
  assertLoading();
  await finish(3, options({ truncated: true, nextOffset: 1 }));
  await finish(5, options({ truncated: true, nextOffset: 1 }));
  assertLoading();
  assert.equal(calls.length, 7, "retired A/B options cannot continue pagination or publish private UI");

  await finish(6, privatePage("A current", "PRIVATE-A-CURRENT"));
  assert.equal(calls.length, 8, "the current A page alone starts the final options request");
  await finish(7, options());
  assert.match(container.textContent, /PRIVATE-A-CURRENT/);
  assert.match(container.textContent, /A current private collaborators/);
  assert.doesNotMatch(container.textContent, /PRIVATE-A-STALE|PRIVATE-B-STALE|PRIVATE-B|B private collaborators/);
  assert.ok(adminMenu(container), "the current complete admin page may publish its private menu");
  assert.equal(container.querySelector("form"), null, "this checkpoint still does not mount VideoForm");
});

test("MIG-0717 U02b2b preserves the CURRENT neutral EmptyState structure and spacing for not_found", async (t) => {
  const api = createVideoEditApi(async () => json({ error: "not_found" }, 404));
  const { container } = await mountEdit(t, api);
  const outer = container.querySelector(".fn-public-container.fn-page");
  assert.ok(outer);
  assert.equal(outer.style.paddingBlock, "48px 64px");
  const panel = outer.querySelector("section.fn-empty-state.empty-state-empty.empty-state-tone-neutral");
  assert.ok(panel);
  assert.equal(panel.querySelector("h2.empty-state-title")?.textContent, "ページが見つかりません");
  assert.ok(panel.querySelector(".empty-state-icon[aria-hidden]"));
  assert.equal(panel.querySelector(".empty-state-description")?.textContent,
    "URL を確認するか、トップページから再度お探しください。");
  const action = panel.querySelector(".empty-state-actions a");
  assert.ok(action);
  assert.equal(action.getAttribute("href"), "/");
  assert.equal(action.textContent.trim(), "トップへ戻る");
  assert.ok(action.classList.contains("fn-btn-primary"));
  assert.equal(panel.querySelector("h1"), null);
  assert.equal(container.querySelector(".fn-page--video-edit"), null);
});
