// MIG-0711 U03: /entry UI sections, read-only route, and status/error preservation.
import assert from "node:assert/strict";
import test from "node:test";
import { fakeApi, mount, onboardingState, user } from "./helpers.mjs";

const entryData = (over = {}) => ({
  user: user(),
  state: onboardingState(),
  events: [{ id: "event-1", title: "受付中イベント", entry_end_time: 1_800_000_000, slots_available: 3 }],
  reservedSlots: [],
  truncated: false,
  nextOffset: null,
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
      assert.ok(hrefs(m).includes("/event/event-1/slots"), "event list route preserved");
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
