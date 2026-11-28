// MIG-0711 U03: /entry UI sections, read-only route, and status/error preservation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, useLocation, useNavigationType } from "react-router-dom";
import test from "node:test";
import ts from "typescript";
import { dom, entryIndex, fakeApi, mount, onboardingState, user } from "./helpers.mjs";

const entryData = (over = {}) =>
  entryIndex({
    events: [{ id: "event-1", title: "受付中イベント", entry_end_time: 1_800_000_000, slots_available: 3 }],
    ...over,
  });

async function entry(data, path = "/entry") {
  return mount(path, fakeApi({ getEntryIndex: data }));
}
const hrefs = m => [...m.container.querySelectorAll("a")].map(a => a.getAttribute("href"));

test("T01/T05: guest gets CURRENT Discord login section, OAuthCallback copy and no fake empty event claim", async () => {
  const m = await entry({ status: "anonymous" }, "/entry?error=OAuthCallback&next=https%3A%2F%2Fevil.example");
  try {
    const text = m.container.textContent;
    assert.match(text, /参加・投稿/);
    assert.match(text, /まず Discord でログインしてください/);
    assert.match(text, /Discord認証を完了できませんでした/);
    assert.ok(m.container.querySelector('button[type="button"]'));
    assert.match(text, /ログイン後に受付中のイベントを確認できます/);
    assert.doesNotMatch(text, /現在受付中のイベントはありません/);
    assert.ok(hrefs(m).includes("/entry?next=%2Fentry%2Funslotted"));
  } finally { await m.unmount(); }
});

test("T02: synchronous double click initiates only one Discord CSRF preflight", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    // Keep the preflight pending: the user can click again before React commits pending UI.
    return new Promise(() => {});
  };
  let m;
  try {
    m = await entry({ status: "anonymous" });
    const button = [...m.container.querySelectorAll("button")].find((b) => b.textContent.includes("Discord"));
    assert.ok(button);
    await act(async () => {
      button.click();
      button.click();
    });
    // The shared route shell can make unrelated reads (e.g. a CostGuard banner).
    const csrfCalls = calls.filter(({ url }) => url === "/api/auth/csrf");
    assert.equal(csrfCalls.length, 1, "the same click burst cannot start a second OAuth flow");
    assert.equal(csrfCalls[0].init.credentials, "same-origin");
    assert.equal(button.disabled, true);
  } finally {
    if (m) await m.unmount();
    globalThis.fetch = previousFetch;
  }
});

test("T06: logged in pending terms, pending X and approved X match CURRENT section order", async () => {
  const states = [
    [onboardingState({ needsTermsAcceptance: true, canReserveSlot: false, canPost: false }), "初期設定が未完了です", "/onboarding?next=%2Fentry"],
    [onboardingState({ xIdentityStatus: "pending", canReserveSlot: true, canPost: false }), "X ID 承認待ち", "/onboarding?next=%2Fentry%2Funslotted"],
    [onboardingState({ xIdentityStatus: "none", canReserveSlot: true, canPost: false }), "作品投稿には X ID 連携が必要", "/onboarding?next=%2Fentry%2Funslotted"],
    [onboardingState({ xIdentityStatus: "approved", canReserveSlot: true, canPost: true, activeApprovedXId: "my_id" }), "投稿可能", "/entry/unslotted"],
  ];
  for (const [state, title, target] of states) {
    const m = await entry({ status: "ok", data: entryData({ state }) });
    try {
      assert.match(m.container.textContent, new RegExp(title));
      assert.ok(hrefs(m).includes(target), title);
      const eventHref = state.canReserveSlot ? "/event/event-1/slots" : "/onboarding?next=%2Fevent%2Fevent-1%2Fslots";
      assert.ok(hrefs(m).includes(eventHref), `CURRENT reservation guard for ${title}`);
      assert.match(m.container.textContent, /残り 3 枠/);
    } finally { await m.unmount(); }
  }
});

test("T06: saved slots show submission-needed / already-submitted with CURRENT hrefs", async () => {
  const data = entryData({
    state: onboardingState({ xIdentityStatus: "approved", canPost: true, activeApprovedXId: "active_x" }),
    user: user({ active_x_user_id: "active_x" }),
    reservedSlots: [
      { id: "s1", event_id: "event-1", video_id: null, slot_label: "通常枠", start_time: null, status: "reserved", event_title: "イベント1", event_entry_end_time: null },
      { id: "s2", event_id: "event-1", video_id: "video2", slot_label: null, start_time: null, status: "submitted", event_title: "イベント1", event_entry_end_time: null },
    ],
    truncated: true, nextOffset: 100,
  });
  const m = await entry({ status: "ok", data });
  try {
    assert.match(m.container.textContent, /投稿可能 · @active_x/);
    assert.match(m.container.textContent, /確保済み枠に提出する/);
    assert.match(m.container.textContent, /作品情報の登録を続ける/);
    assert.match(m.container.textContent, /提出済み/);
    assert.match(m.container.textContent, /一部のみ表示しています/);
    assert.ok(hrefs(m).includes("/entry/slotted?slot=s1"));
    assert.ok(hrefs(m).includes("/entry/slotted?slot=s2"));
  } finally { await m.unmount(); }
});

test("failed entry reads never impersonate guests; banned and loading protect the page", async () => {
  for (const [status, required, forbidden] of [
    ["unavailable", "画面の表示中に問題が発生しました", "まず Discord でログインしてください"],
    ["banned", "利用が停止されています", "受付中イベント"],
  ]) {
    const m = await entry({ status });
    try {
      assert.match(m.container.textContent, new RegExp(required));
      assert.doesNotMatch(m.container.textContent, new RegExp(forbidden));
    } finally { await m.unmount(); }
  }
  const m = await entry({ status: "ok", data: entryData({ user: user({ is_banned: 1 }) }) });
  try { assert.match(m.container.textContent, /利用が停止されています/); } finally { await m.unmount(); }
});

test("continuation: authenticated pages use offset, merge distinct events, and end without a repeat", async () => {
  const offsets = [];
  const first = entryData({ truncated: true, nextOffset: 100 });
  const next = entryData({
    events: [
      { id: "event-1", title: "受付中イベント", entry_end_time: 1_800_000_000, slots_available: 3 },
      { id: "event-2", title: "追加イベント", entry_end_time: 1_700_000_000, slots_available: 5 },
    ],
    truncated: false, nextOffset: null,
  });
  const api = fakeApi({ getEntryIndex: (offset) => {
    offsets.push(offset);
    return { status: "ok", data: offset === 100 ? next : first };
  } });
  const m = await mount("/entry", api);
  try {
    assert.deepEqual(offsets, [undefined]);
    let button = [...m.container.querySelectorAll("button")].find(b => b.textContent.includes("イベントをさらに表示"));
    assert.ok(button, "truncated API page must have an accessible continuation action");
    await act(async () => { button.click(); });
    assert.deepEqual(offsets, [undefined, 100]);
    assert.equal(m.container.querySelectorAll('a[href="/event/event-1/slots"]').length, 1, "deduplicate repeated event IDs");
    assert.equal(m.container.querySelectorAll('a[href="/event/event-2/slots"]').length, 1);
    assert.deepEqual(
      [...m.container.querySelectorAll("a.entry-eventCard")].map(a => a.getAttribute("href")),
      ["/event/event-2/slots", "/event/event-1/slots"],
      "event deadline ordering remains global across API pages",
    );
    assert.doesNotMatch(m.container.textContent, /イベントをさらに表示|一部のみ表示しています/);
  } finally { await m.unmount(); }
});

test("continuation: failed or cross-account reads cannot display another account's event data", async () => {
  const offsets = [];
  let response = { status: "unavailable" };
  const api = fakeApi({ getEntryIndex: (offset) => {
    offsets.push(offset);
    return offset === 100 ? response : { status: "ok", data: entryData({ truncated: true, nextOffset: 100 }) };
  } });
  const m = await mount("/entry", api);
  try {
    const click = async () => {
      const button = [...m.container.querySelectorAll("button")].find(b => b.textContent.includes("イベントをさらに表示"));
      assert.ok(button);
      await act(async () => { button.click(); });
    };
    await click();
    assert.match(m.container.textContent, /続きのイベントを取得できませんでした/);
    response = { status: "ok", data: entryData({
      user: user({ id: "other-user" }),
      events: [{ id: "secret", title: "別アカウントのイベント", entry_end_time: null, slots_available: 1 }],
      truncated: false, nextOffset: null,
    }) };
    await click();
    assert.doesNotMatch(m.container.textContent, /別アカウントのイベント/);
    assert.match(m.container.textContent, /続きのイベントを取得できませんでした/);
    assert.deepEqual(offsets, [undefined, 100, 100]);
  } finally { await m.unmount(); }
});

test("continuation: rapid double click performs one bounded API read", async () => {
  const offsets = [];
  let finishNextPage;
  const first = entryData({ truncated: true, nextOffset: 100 });
  const api = fakeApi({ getEntryIndex: (offset) => {
    offsets.push(offset);
    if (offset == null) return { status: "ok", data: first };
    return new Promise((resolve) => { finishNextPage = resolve; });
  } });
  const m = await mount("/entry", api);
  try {
    const button = [...m.container.querySelectorAll("button")].find(b => b.textContent.includes("イベントをさらに表示"));
    assert.ok(button);
    await act(async () => {
      button.click();
      button.click();
    });
    assert.deepEqual(offsets, [undefined, 100], "button double click must not double the D1 read");
    assert.equal(button.disabled, true);
    await act(async () => {
      finishNextPage({ status: "ok", data: entryData({ events: [], truncated: false, nextOffset: null }) });
    });
    assert.doesNotMatch(m.container.textContent, /イベントをさらに表示/);
  } finally {
    await m.unmount();
  }
});

test("continuation: session expiry or ban immediately removes authenticated event and slot data", async () => {
  for (const [status, expected] of [
    ["anonymous", "ログインが必要です"],
    ["banned", "利用が停止されています"],
  ]) {
    const first = entryData({
      truncated: true, nextOffset: 100,
      reservedSlots: [{
        id: "private-slot", event_id: "event-1", video_id: null, slot_label: "非公開枠",
        start_time: null, status: "reserved", event_title: "非公開イベント",
        event_entry_end_time: null,
      }],
    });
    const api = fakeApi({ getEntryIndex: (offset) =>
      offset == null ? { status: "ok", data: first } : { status },
    });
    const m = await mount("/entry", api);
    try {
      assert.match(m.container.textContent, /非公開イベント/);
      const button = [...m.container.querySelectorAll("button")].find(b => b.textContent.includes("イベントをさらに表示"));
      assert.ok(button);
      await act(async () => { button.click(); });
      assert.match(m.container.textContent, new RegExp(expected), status);
      assert.doesNotMatch(m.container.textContent, /非公開イベント|非公開枠|受付中イベント/, status);
    } finally {
      await m.unmount();
    }
  }
});


test("continuation denial cannot outlive the exact first-page snapshot", async () => {
  const { continuationAccessForSnapshot } = await import("../.test-dist/apps/app/src/routes/entry/EntryIndex.js");
  const first = entryData({ user: user({ id: "account-a" }) });
  const refreshed = entryData({ user: user({ id: "account-a" }) });
  const other = entryData({ user: user({ id: "account-b" }) });
  for (const status of ["anonymous", "banned"]) {
    const denied = { firstPage: first, status };
    assert.equal(continuationAccessForSnapshot(denied, first), status);
    assert.equal(continuationAccessForSnapshot(denied, other), null,
      "stale 401/403 cannot gate another account");
    assert.equal(continuationAccessForSnapshot(denied, refreshed), null,
      "stale 401/403 cannot gate a refreshed first-page snapshot for the same account");
    assert.equal(continuationAccessForSnapshot(denied, null), null);
  }
  assert.equal(continuationAccessForSnapshot(null, first), null);
});


test("continuation: new first-page snapshot for the same account cannot reuse stale paged events", async () => {
  const { EntryIndexView } = await import("../.test-dist/apps/app/src/routes/entry/EntryIndex.js");
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  const oldFirst = entryData({ truncated: true, nextOffset: 100 });
  const newFirst = entryData({
    events: [{ id: "event-new", title: "新しい受付データ", entry_end_time: null, slots_available: 1 }],
    truncated: false, nextOffset: null,
  });
  const api = fakeApi({ getEntryIndex: () => ({
    status: "ok",
    data: entryData({
      events: [{ id: "event-stale", title: "古い追加ページ", entry_end_time: null, slots_available: 2 }],
      truncated: false, nextOffset: null,
    }),
  }) });
  const render = (data) => React.createElement(MemoryRouter, null,
    React.createElement(EntryIndexView, { api, data, next: "/entry", authError: null }));
  try {
    await act(async () => root.render(render(oldFirst)));
    const button = [...container.querySelectorAll("button")].find(b => b.textContent.includes("イベントをさらに表示"));
    assert.ok(button);
    await act(async () => button.click());
    assert.match(container.textContent, /古い追加ページ/);
    await act(async () => root.render(render(newFirst)));
    assert.match(container.textContent, /新しい受付データ/);
    assert.doesNotMatch(container.textContent, /古い追加ページ|受付中イベント/,
      "new read snapshot must never combine previous same-user pages");
  } finally {
    await act(async () => root.unmount());
  }
});


test("continuation: stale 403 cannot gate refreshed same-account first page", async () => {
  const { EntryIndexView } = await import("../.test-dist/apps/app/src/routes/entry/EntryIndex.js");
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  const oldFirst = entryData({ truncated: true, nextOffset: 100 });
  const newFirst = entryData({
    events: [{ id: "event-new", title: "新しい受付画面", entry_end_time: null, slots_available: 2 }],
    truncated: false, nextOffset: null,
  });
  const api = fakeApi({ getEntryIndex: () => ({ status: "banned" }) });
  const render = (data) => React.createElement(MemoryRouter, null,
    React.createElement(EntryIndexView, { api, data, next: "/entry", authError: null }));
  try {
    await act(async () => root.render(render(oldFirst)));
    const button = [...container.querySelectorAll("button")].find(
      b => b.textContent.includes("イベントをさらに表示"));
    assert.ok(button);
    await act(async () => button.click());
    assert.match(container.textContent, /利用が停止されています/);
    await act(async () => root.render(render(newFirst)));
    assert.match(container.textContent, /新しい受付画面/,
      "a fresh same-user first page must not inherit the old read's banned state");
    assert.doesNotMatch(container.textContent, /利用が停止されています/);
  } finally {
    await act(async () => root.unmount());
  }
});

// MIG-0716 U01a: page presentation only. Trusted route/access/paging and real writes remain later gates.
const [{ Slotted }, { Unslotted }, { VideoForm }, { UnslottedPostForm }, { StatusPanel },
  { AppLink, navigation }, { Icon }, { formatUnix }, entryContracts] = await Promise.all([
  import("../.test-dist/apps/app/src/routes/entry/Slotted.js"),
  import("../.test-dist/apps/app/src/routes/entry/Unslotted.js"),
  import("../.test-dist/apps/app/src/components/forms/VideoForm.js"),
  import("../.test-dist/apps/app/src/components/forms/UnslottedPostForm.js"),
  import("../.test-dist/apps/app/src/components/ui/StatusPanel.js"),
  import("../.test-dist/apps/app/src/routes/ui/AppLink.js"),
  import("../.test-dist/apps/app/src/routes/ui/Icon.js"),
  import("../.test-dist/apps/app/src/routes/ui/format.js"),
  import("../.test-dist/packages/contracts/src/personal/index.js"),
]);
const origin = "https://public.example:8443/config/path?ignored=1#ignored";
const portCalls = [];
const formPorts = Object.fromEntries(["submit", "searchXUsers", "applyPermissionBatch"].map(name =>
  [name, (...args) => { portCalls.push([name, ...args]); throw new Error(`Unexpected page effect: ${name}`); }]));
const refresh = () => { portCalls.push(["refresh"]); };
const pageProps = data => ({ data, publicOrigin: origin, ports: formPorts, onRefresh: refresh });

function formPageData(kind, over = {}) {
  const option = {
    id: "event/春%", title: "公開イベント", parts_json: '["A","B"]',
    youtube_description_template: "{{event_url}}", required_video_fields_json: null, custom_questions: [],
  };
  const common = {
    user: user({ active_x_user_id: "active_x" }), activeXId: "active_x", submitBlock: null,
    initialProfile: { display_name: "投稿者", icon_url: null, profile_text: "紹介文", youtube_channel_url: null, other_social_links: null },
    xIdOptions: [{ id: "active_x", x_name: "投稿者" }], softwareSuggestions: ["編集ソフト"],
    iconCandidates: [], channelCandidates: [], truncated: false, nextOffset: null,
  };
  return kind === "slotted" ? entryContracts.SlottedEntryResponseSchema.parse({
    ...common, kind: "ready", activeXName: "投稿者", slotPart: "A",
    slot: { id: "slot/予約", slot_label: "通常枠", display_name: null, has_reservation_group: true,
      reserved_at_x_id: "reserved_x", start_time: 1_800_000_000, end_time: 1_800_000_600, group_size: 2 },
    event: { id: option.id, title: option.title }, eventOptions: [{ ...option, video_form_settings_json: null }], ...over,
  }) : entryContracts.UnslottedEntryResponseSchema.parse({
    ...common, eventQuery: "合成 %_", eventOptions: [{ ...option, status_label: "終了済" }], ...over,
  });
}

const sourceRoot = new URL("../../../", import.meta.url);
const sourceAst = path => ts.createSourceFile(path, readFileSync(new URL(path, sourceRoot), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compileReference = source => ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const panelAst = sourceAst("src/components/ui/StatusPanel.tsx");
const panelFunction = panelAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "StatusPanel");
assert.ok(panelFunction, "use the actual CURRENT StatusPanel function");
const CurrentStatusPanel = new Function("React", "styles",
  `${compileReference(panelFunction.getText(panelAst).replace(/^export /, ""))}; return StatusPanel;`)(React,
  Object.fromEntries(["panel", "text", "body", "action", "info", "success", "warning", "danger"].map(name => [name, `status-panel-${name}`])));

// Only the CURRENT page tail/declarations are extracted. Both sides mount the same real TARGET forms;
// this isolates page mapping from the separately tested B04 controller divergence and browser comparison.
const currentPages = Object.fromEntries(["slotted", "unslotted"].map(kind => {
  const ast = sourceAst(`app/(auth)/entry/${kind}/page.tsx`);
  const page = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword));
  const names = new Set([kind === "slotted" ? "activeXApprovalStatus" : "activeXIsLinked", "submitBlockedReason", "canPost", "initialProfile"]);
  const declarations = page.body.statements.filter(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(declaration => names.has(declaration.name.getText(ast))));
  assert.equal(declarations.length, names.size);
  const lastReturn = [...page.body.statements].reverse().find(ts.isReturnStatement);
  let body = [...declarations, lastReturn].map(node => node.getText(ast)).join("\n");
  body = body.replace('<AppShell size="default" className="fn-entry-flow">', '<div className="fn-public-container fn-page fn-entry-flow">')
    .replace("</AppShell>", "</div>")
    .replace(/<(VideoForm|UnslottedPostForm)\b/, '<$1 {...ports} onRefresh={onRefresh}');
  const bindings = "user,slot,ev,activeX,activeXId,xRow,xIdOptions,slotStart,slotEnd,groupSize,reservedAtXId,nextPath,initialEventIds,slotPart,softwareSuggestions,iconCandidates,channelCandidates,eventOptions,enrichedEventOptions,eventQuery,ports,onRefresh";
  const compiled = compileReference(`function CurrentPage(context) { const {${bindings}} = context; ${body} }`);
  const Current = new Function("React", "Link", "StatusPanel", "VideoForm", "UnslottedPostForm", "Icon", "formatUnix", "styles",
    `${compiled}; return CurrentPage;`)(React, AppLink, CurrentStatusPanel, VideoForm, UnslottedPostForm, Icon, formatUnix,
    Object.fromEntries(["eventSearchForm", "eventSearchLabel", "eventSearchInput", "eventSearchMeta"].map(name => [name, `entry-unslotted-${name}`])));
  return [kind, Current];
}));

function currentPageContext(data) {
  const eventOptions = data.eventOptions.map(option => ({ ...option,
    youtube_description_event_url: `https://public.example:8443/event/${encodeURIComponent(option.id)}` }));
  return {
    ...data, activeX: data.activeXId, activeXId: data.user.active_x_user_id,
    xRow: { ...data.initialProfile, x_name: data.kind === "ready" ? data.activeXName : data.initialProfile.display_name,
      approval_status: ["pending", "rejected", "not_approved"].includes(data.submitBlock) ? data.submitBlock : "approved" },
    slot: data.slot && { ...data.slot, reservation_group_id: data.slot.has_reservation_group ? "group" : null },
    ev: data.event, slotStart: data.slot?.start_time, slotEnd: data.slot?.end_time, groupSize: data.slot?.group_size,
    reservedAtXId: data.slot?.reserved_at_x_id, initialEventIds: data.event ? [data.event.id] : [],
    nextPath: data.slot?.id ? `/entry/slotted?slot=${encodeURIComponent(data.slot.id)}` : "/entry/slotted",
    eventOptions, enrichedEventOptions: eventOptions, ports: formPorts, onRefresh: refresh,
  };
}
const staticPage = (Page, props) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Page, props)));
function* pageElements(element) {
  if (!React.isValidElement(element)) return;
  yield element;
  for (const child of React.Children.toArray(element.props.children)) yield* pageElements(child);
}
function inspectPage(Page, props) {
  let tree;
  function Probe() { tree = Page(props); return null; }
  staticPage(Probe, {}); // Real React hook dispatcher, without replacing or mounting the child component.
  return [...pageElements(tree)];
}

test("MIG-0716 U01a: actual CURRENT page JSX preserves text/order/links/summary/search and block semantics", () => {
  for (const [kind, Page, blocks] of [
    ["slotted", Slotted, [null, "no_active_x", "pending", "rejected", "not_approved"]],
    ["unslotted", Unslotted, [null, "no_active_x", "not_linked", "not_approved"]],
  ]) {
    const baseline = formPageData(kind);
    const cases = blocks.map(submitBlock => formPageData(kind, {
      submitBlock,
      user: user({ active_x_user_id: submitBlock === "no_active_x" ? null : "active_x" }),
      activeXId: kind === "unslotted" && submitBlock === "no_active_x" ? null : "active_x",
      xIdOptions: submitBlock === "not_linked" ? [] : baseline.xIdOptions,
    }));
    const emptyProfile = Object.fromEntries(Object.keys(baseline.initialProfile).map(key => [key, ""]));
    cases.push(formPageData(kind, { initialProfile: emptyProfile, ...(kind === "slotted"
      ? { activeXName: "", slot: { ...baseline.slot, start_time: 0, end_time: 0, display_name: "", slot_label: "", reserved_at_x_id: "", has_reservation_group: false } }
      : { eventQuery: "", eventOptions: [] }) }));
    if (kind === "slotted") cases.push(formPageData(kind, { activeXName: null,
      initialProfile: { ...baseline.initialProfile, display_name: baseline.user.name },
      slot: { ...baseline.slot, start_time: null, end_time: null, slot_label: null, reserved_at_x_id: null } }));
    for (const [index, data] of cases.entries()) {
      assert.equal(staticPage(Page, pageProps(data)), staticPage(currentPages[kind], currentPageContext(data)), `${kind} CURRENT case ${index}`);
    }
  }
  assert.deepEqual(portCalls, []);
});

test("MIG-0716 U01a: exact StatusPanel keeps all four tones, default tone and optional body/action markup", () => {
  for (const tone of [undefined, "info", "success", "warning", "danger"]) {
    for (const children of [undefined, "", 0, React.createElement("p", null, "説明")]) {
      for (const action of [null, React.createElement("a", { href: "/entry" }, "戻る")]) {
        const props = { title: "状態", tone, children, action };
        assert.equal(renderToStaticMarkup(React.createElement(StatusPanel, props)),
          renderToStaticMarkup(React.createElement(CurrentStatusPanel, props)));
      }
    }
  }
});

test("MIG-0716 U01a: actual child props preserve references, all non-null blocks and origin-derived event context", () => {
  for (const [kind, Page, Child] of [["slotted", Slotted, VideoForm], ["unslotted", Unslotted, UnslottedPostForm]]) {
    const base = formPageData(kind), extraId = "other ?&+%";
    const eventOptions = [{ ...base.eventOptions[0], id: extraId, title: "先頭の別イベント",
      parts_json: '["C"]', required_video_fields_json: '["music"]',
      ...(kind === "slotted" ? { video_form_settings_json: '{"stage_permission":{"enabled":true}}' } : {}),
      custom_questions: [{ id: "q1", event_id: extraId, question_key: "answer", label: "非公開質問", description: null,
        type: "select", required: true, options: ["A", "B"], placeholder: "選択", max_length: 12,
        sort_order: 3, is_active: true, visibility: "private" }] }, base.eventOptions[0]];
    for (const submitBlock of [null, "no_active_x", "not_linked", "pending", "rejected", "not_approved"]) {
      const data = formPageData(kind, { eventOptions, submitBlock, user: user({ active_x_user_id: null }) });
      for (const profileValue of [null, ""]) {
        data.initialProfile = { display_name: "", icon_url: profileValue, profile_text: profileValue,
          youtube_channel_url: profileValue, other_social_links: profileValue };
        const child = inspectPage(Page, pageProps(data)).find(element => element.type === Child);
        assert.ok(child, "blocked pages still compose the real child; they are not incomplete-snapshot guards");
        for (const name of Object.keys(formPorts)) assert.equal(child.props[name], formPorts[name]);
        assert.equal(child.props.onRefresh, refresh);
        for (const name of ["xIdOptions", "softwareSuggestions", "iconCandidates", "channelCandidates"]) assert.equal(child.props[name], data[name]);
        assert.equal(child.props.draftAuthUserId, data.user.id);
        assert.equal(child.props.activeXId, data.activeXId, "slot snapshot is presentation identity, never local authorization");
        assert.equal(typeof child.props.submitBlockedReason, submitBlock === null ? "undefined" : "string");
        if (submitBlock !== null) assert.ok(child.props.submitBlockedReason.length > 0);
        for (const [name, value] of Object.entries(data.initialProfile)) {
          assert.equal(child.props.defaultProfile[name], value ?? undefined);
          assert.equal(child.props.initial[name], value ?? undefined);
        }
        assert.deepEqual(child.props.eventOptions, data.eventOptions.map(option => ({ ...option,
          youtube_description_event_url: `https://public.example:8443/event/${encodeURIComponent(option.id)}` })));
        assert.equal(child.props.eventOptions[0].custom_questions, data.eventOptions[0].custom_questions);
        if (kind === "slotted") {
          assert.equal(child.props.mode, "slot"); assert.equal(child.props.slotId, data.slot.id);
          assert.deepEqual(child.props.initial.event_ids, [data.event.id]); assert.equal(child.props.initial.part, data.slotPart);
        }
      }
    }
    const httpChild = inspectPage(Page, { ...pageProps(formPageData(kind)), publicOrigin: "http://localhost:9012/subpath" }).find(element => element.type === Child);
    assert.match(httpChild.props.eventOptions[0].youtube_description_event_url, /^http:\/\/localhost:9012\/event\//);
  }
});

async function mountFormPage(element, path = "/entry/unslotted") {
  const previous = new Map();
  for (const name of ["FormData", "File", "Blob", "HTMLFormElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement"]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [path] }, element)));
  return { container, unmount: async () => {
    try { await act(async () => root.unmount()); } finally {
      container.remove();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
      }
    }
  } };
}

test("MIG-0716 U01a: initial incomplete/origin guards never transiently mount forms or touch drafts, IDB or ports", async () => {
  const storage = dom.window.Storage.prototype, original = new Map(), accesses = [], transientForms = [];
  const idb = Object.getOwnPropertyDescriptor(dom.window, "indexedDB");
  let m;
  for (const name of ["getItem", "setItem", "removeItem"]) {
    original.set(name, storage[name]);
    storage[name] = function (...args) { accesses.push([name, ...args]); return original.get(name).apply(this, args); };
  }
  Object.defineProperty(dom.window, "indexedDB", { configurable: true, value: { open() { accesses.push(["indexedDB.open"]); throw Error("Guard mounted a draft"); } } });
  const observer = new dom.window.MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType === 1 && (node.matches("form,fieldset") || node.querySelector("form,fieldset"))) transientForms.push(node.outerHTML);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  try {
    const guarded = [];
    for (const [kind, Page] of [["slotted", Slotted], ["unslotted", Unslotted]]) {
      for (const [truncated, nextOffset] of [[true, 100], [true, null], [false, 100]]) {
        guarded.push(React.createElement(Page, { key: `${kind}-${truncated}-${nextOffset}`, ...pageProps(formPageData(kind, { truncated, nextOffset })) }));
      }
      for (const publicOrigin of ["", "/relative", "not a URL", "ftp://public.example", "mailto:operator@example.test"]) {
        guarded.push(React.createElement(Page, { key: `${kind}-${publicOrigin}`, ...pageProps(formPageData(kind)), publicOrigin }));
      }
    }
    m = await mountFormPage(React.createElement(React.Fragment, null, ...guarded));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
    assert.equal(m.container.querySelectorAll('[role="alert"]').length, guarded.length);
    assert.equal(m.container.querySelector("form,fieldset"), null);
    assert.deepEqual(transientForms, []); assert.deepEqual(accesses, []); assert.deepEqual(portCalls, []);
  } finally {
    if (m) await m.unmount();
    observer.disconnect();
    for (const [name, fn] of original) storage[name] = fn;
    if (idb) Object.defineProperty(dom.window, "indexedDB", idb); else delete dom.window.indexedDB;
  }
  assert.deepEqual(transientForms, []); assert.deepEqual(accesses, []); assert.deepEqual(portCalls, []);
});

test("MIG-0716 U01a: redirect-only DTO uses the same normalized family and existing full-navigation seam", async () => {
  const original = navigation.replace, replacements = [];
  navigation.replace = to => replacements.push(to);
  function Location() { const here = useLocation(), type = useNavigationType(); return React.createElement("output", null, type + " " + here.pathname + here.search + here.hash); }
  const unsafe = ["https://evil.example/dashboard/edit/id", "//evil.example/entry", "/dashboard\\edit\\id", "/entry\n",
    "/entry-extra", "/entry/nested", "/dashboard/editing/id", "/dashboard/edit/", "/dashboard/edit/id/extra",
    "/dashboard/edit/../../../outside", "/dashboard/edit/%2e%2e/%2e%2e/outside", "/dashboard/edit/%ZZ",
    "/e%6etry", "/dashboard/%65dit/id", "/dashboard/edit/%5c%5cevil", "/dashboard/edit/%0A"];
  try {
    for (const [to, expected, full] of [
      ["/entry?from=slot#form", "/entry?from=slot#form", false],
      ["/dashboard/edit/video-1?from=slot#form", "/dashboard/edit/video-1?from=slot#form", true],
      ["/dashboard/./edit/video-1", "/dashboard/edit/video-1", true],
      ...unsafe.map(to => [to, "/entry", false]),
    ]) {
      replacements.length = 0;
      const data = entryContracts.SlottedEntryResponseSchema.parse({ kind: "redirect", to });
      const m = await mountFormPage(React.createElement(React.Fragment, null,
        React.createElement(Slotted, { ...pageProps(data), publicOrigin: "invalid-ready-only-origin" }), React.createElement(Location)), "/entry/slotted?slot=old");
      try {
        assert.equal(m.container.querySelector("form"), null);
        assert.deepEqual(replacements, full ? [expected] : [], to);
        assert.equal(m.container.querySelector("output").textContent, full ? "POP /entry/slotted?slot=old" : "REPLACE " + expected, to);
      } finally { await m.unmount(); }
    }
  } finally { navigation.replace = original; }
  assert.deepEqual(portCalls, []);
});

test("MIG-0716 U01a: real slotted form receives fixed event/part, profile, input and description URL", async () => {
  dom.window.localStorage.clear();
  const data = formPageData("slotted"), m = await mountFormPage(React.createElement(Slotted, pageProps(data)));
  try {
    assert.equal(document.title, "枠提出 | FlameNode");
    const form = m.container.querySelector("form.vform-form");
    assert.ok(form); assert.equal(m.container.querySelectorAll("form").length, 1);
    let payload = new dom.window.FormData(form);
    assert.equal(payload.get("mode"), "slot"); assert.equal(payload.get("slot_id"), data.slot.id);
    assert.deepEqual(payload.getAll("event_ids"), [data.event.id]); assert.equal(payload.get("part"), "A");
    assert.equal(payload.get("creator_x_user_id"), "active_x"); assert.equal(payload.get("active_x_snapshot"), "active_x");
    assert.equal(payload.get("display_name"), "投稿者"); assert.equal(payload.get("profile_text"), "紹介文");
    assert.ok([...form.querySelectorAll("textarea")].some(input => input.value === `https://public.example:8443/event/${encodeURIComponent(data.event.id)}`));
    await act(async () => {
      const input = form.elements.namedItem("title");
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "作品の新しい題名");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    payload = new dom.window.FormData(form);
    assert.equal(payload.get("title"), "作品の新しい題名"); assert.equal(payload.get("part"), "A");
    assert.deepEqual(payload.getAll("event_ids"), [data.event.id]); assert.deepEqual(portCalls, []);
  } finally { await m.unmount(); dom.window.localStorage.clear(); }
});

test("MIG-0716 U01a: complete empty/eligible unslotted pages keep search separate from the actual selected free form", async () => {
  for (const empty of [true, false]) {
    dom.window.localStorage.clear();
    const data = formPageData("unslotted", empty ? { eventOptions: [] } : {});
    const m = await mountFormPage(React.createElement(Unslotted, pageProps(data)));
    try {
      assert.equal(document.title, "枠なし投稿 | FlameNode");
      const search = m.container.querySelector('form[role="search"]');
      assert.equal(search.method, "get"); assert.equal(search.elements.event_q.maxLength, 100);
      assert.equal(new dom.window.FormData(search).get("event_q"), data.eventQuery);
      assert.equal(m.container.querySelector("form.vform-form"), null, "an affiliation choice precedes the real form");
      const radios = m.container.querySelectorAll('input[name="unslotted_affiliation_choice"]');
      assert.equal(radios[0].disabled, false); assert.equal(radios[1].disabled, empty);
      await act(async () => radios[empty ? 0 : 1].click());
      if (!empty) {
        assert.equal(m.container.querySelector("form.vform-form"), null, "event affiliation also needs an eligible event selection");
        await act(async () => {
          const select = m.container.querySelector("#unslotted_event_choice");
          select.value = data.eventOptions[0].id;
          select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
        });
      }
      const form = m.container.querySelector("form.vform-form");
      assert.ok(form); assert.equal(m.container.querySelectorAll("form").length, 2);
      const payload = new dom.window.FormData(form);
      assert.equal(payload.get("mode"), "free"); assert.equal(payload.has("slot_id"), false); assert.equal(payload.has("event_q"), false);
      assert.deepEqual(payload.getAll("event_ids"), empty ? [] : [data.eventOptions[0].id]);
      assert.equal(payload.get("creator_x_user_id"), "active_x"); assert.equal(payload.get("display_name"), "投稿者");
      assert.equal(new dom.window.FormData(search).get("event_q"), data.eventQuery);
      if (!empty) assert.ok([...form.querySelectorAll("textarea")].some(input => input.value === `https://public.example:8443/event/${encodeURIComponent(data.eventOptions[0].id)}`));
      assert.deepEqual(portCalls, []);
    } finally { await m.unmount(); dom.window.localStorage.clear(); }
  }
});
