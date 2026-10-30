// MIG-0711 U03: /entry UI sections, read-only route, and status/error preservation.
import assert from "node:assert/strict";
import { act } from "react";
import test from "node:test";
import { entryIndex, fakeApi, mount, onboardingState, user } from "./helpers.mjs";

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
