// MIG-0701 U03: /dashboard/settings (?tab ?x ?next ?onboarding), read-only; no write controls rendered.
import assert from "node:assert/strict";
import test from "node:test";
import { fakeApi, mount, ok, requestRow, settings, settingsX, user } from "./helpers.mjs";

const { navigation } = await import("../.test-dist/apps/app/src/routes/ui/AppLink.js");
const hrefs = (m) => [...m.container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
const api = (data) => fakeApi({ getSettings: ok(data) });
const panelIds = (m) => [...m.container.querySelectorAll('[role="tabpanel"]')].map((p) => p.id);
const tabLabels = (m) => [...m.container.querySelectorAll('[role="tab"]')].map((t) => t.querySelector(".settings-tabLabel").textContent);

test("query values are forwarded verbatim to the API and survive a fresh mount (deep link / reload)", async () => {
  const a = api(settings());
  const m = await mount("/dashboard/settings?tab=history&x=Foo&onboarding=1&next=%2Fentry", a);
  assert.deepEqual(a.calls[0], ["getSettings", { tab: "history", x: "Foo", onboarding: "1" }]);
  await m.unmount();
});

test("0X without history: link tab with the onboarding box; no write controls", async () => {
  const m = await mount("/dashboard/settings", api(settings()));
  assert.deepEqual(panelIds(m), ["settings-panel-link"]);
  const t = m.container.textContent;
  assert.match(t, /X ID を連携しましょう/);
  assert.match(t, /まず X ID を連携してください。承認後にいいね・セーブ・投稿ができます/);
  assert.equal(m.container.querySelectorAll("form, input, textarea, select").length, 0);
  assert.equal(m.container.querySelectorAll("button").length, 0);
  assert.deepEqual(tabLabels(m), ["X ID連携", "Discord"]);
  await m.unmount();
});

test("0X with request history: history tab is shown; pending count in lead and tab meta", async () => {
  const m = await mount("/dashboard/settings", api(settings({ requestHistory: [requestRow("r1"), requestRow("r2", { status: "rejected" })] })));
  assert.deepEqual(panelIds(m), ["settings-panel-history"]);
  const t = m.container.textContent;
  assert.match(t, /申請中の連携は「申請履歴」タブで確認できます。/);
  assert.match(t, /1件申請中/);
  assert.match(t, /申請中/);
  assert.match(t, /却下/);
  assert.match(t, /@reqx/);
  assert.equal(m.container.querySelectorAll("button").length, 0);
  await m.unmount();
});

test("1X approved+active: X panel with 使用中 marker, public page link, no forms", async () => {
  const x = settingsX("alpha", { x_name: "Alpha" });
  const m = await mount("/dashboard/settings", api(settings({ user: user({ active_x_user_id: "alpha" }), xIds: [x], panel: { xId: "alpha", iconCandidates: [], channelCandidates: [] } })));
  assert.deepEqual(panelIds(m), ["settings-panel-x"]);
  const t = m.container.textContent;
  assert.match(t, /@alpha/);
  assert.match(t, /この X ID の公開プロフィールとアクティブ設定を管理します。/);
  assert.match(t, /投稿・枠確保で使用中/);
  assert.match(t, /承認済み/);
  assert.match(t, /2023\/11\/15 連携/);
  assert.match(t, /連携した X ID ごとにプロフィールを編集し/);
  const pub = [...m.container.querySelectorAll('a[href="/user/alpha"]')];
  assert.equal(pub.length, 2);
  assert.equal(pub[0].getAttribute("target"), "_blank");
  assert.match(tabLabels(m).join("|"), /Alpha\|X ID連携\|Discord/);
  assert.equal(m.container.querySelectorAll("form, input, button").length, 0);
  await m.unmount();
});

test("multiX: active first, then approved, pending, rejected; ?x picks (case-insensitive); unknown ?x falls back to active", async () => {
  const xs = [
    settingsX("rej", { approval_status: "rejected" }),
    settingsX("pen", { approval_status: "pending" }),
    settingsX("two"),
    settingsX("act"),
  ];
  const base = { user: user({ active_x_user_id: "act" }), xIds: xs };
  const m = await mount("/dashboard/settings", api(settings(base)));
  assert.deepEqual(tabLabels(m).slice(0, 4), ["X act", "X two", "X pen", "X rej"]);
  assert.match(m.container.querySelector("#settings-x-h").textContent, /@act/);
  assert.equal(m.container.querySelector('[role="tab"][aria-selected="true"]').getAttribute("href"), "/dashboard/settings?x=act");
  assert.match(m.container.querySelector(".settings-tabMeta").textContent, /@act · アクティブ/);
  await m.unmount();

  const picked = await mount("/dashboard/settings?x=PEN", api(settings(base)));
  assert.match(picked.container.querySelector("#settings-x-h").textContent, /@pen/);
  assert.match(picked.container.textContent, /運営の承認後、この X ID をアクティブに設定して投稿できます。/);
  await picked.unmount();

  const rejected = await mount("/dashboard/settings?x=rej", api(settings(base)));
  assert.match(rejected.container.textContent, /却下された X ID です。再審査が必要な場合は運営にお問い合わせください。/);
  assert.match(rejected.container.textContent, /再申請待ち/);
  await rejected.unmount();

  const unknown = await mount("/dashboard/settings?x=nobody", api(settings(base)));
  assert.match(unknown.container.querySelector("#settings-x-h").textContent, /@act/);
  await unknown.unmount();
});

test("imported X note, and no active X: first sorted X is the panel", async () => {
  const m = await mount("/dashboard/settings", api(settings({ xIds: [settingsX("imp", { approval_status: "imported" })] })));
  assert.match(m.container.textContent, /旧データから移行された X ID です/);
  assert.match(m.container.textContent, /移行済み/);
  assert.ok(hrefs(m).includes("/user/imp"));
  await m.unmount();
});

test("?tab=link|history|discord|pending and legacy account|xids", async () => {
  const data = settings({ user: user({ name: "Taro", image: "https://img.test/d.png" }), xIds: [settingsX("a")], requestHistory: [requestRow("r1")] });
  for (const [url, panel] of [
    ["?tab=link", "settings-panel-link"], ["?tab=history", "settings-panel-history"], ["?tab=pending", "settings-panel-history"],
    ["?tab=discord", "settings-panel-discord"], ["?tab=account", "settings-panel-x"], ["?tab=xids", "settings-panel-x"],
    ["?tab=bogus", "settings-panel-x"],
  ]) {
    const m = await mount(`/dashboard/settings${url}`, api(data));
    assert.deepEqual(panelIds(m), [panel], url);
    await m.unmount();
  }
  const d = await mount("/dashboard/settings?tab=discord", api(data));
  assert.match(d.container.textContent, /FlameNode のログインに使用しています。変更はできません。/);
  assert.match(d.container.textContent, /接続済み/);
  assert.match(d.container.textContent, /Discord アカウントの変更・削除はできません。/);
  assert.match(d.container.textContent, /u1/);
  await d.unmount();
  const tabs = await mount("/dashboard/settings", api(data));
  assert.deepEqual(tabs.container.querySelectorAll('[role="tab"]')[1].getAttribute("href"), "/dashboard/settings?tab=history");
  assert.match(tabs.container.textContent, /申請履歴/);
  await tabs.unmount();
});

test("?next: back link and tab hrefs carry the sanitized next; settings self-reference is dropped", async () => {
  const data = settings({ xIds: [settingsX("a")] });
  const m = await mount("/dashboard/settings?next=%2Fentry%2Fslotted%3Fslot%3Dabc", api(data));
  assert.ok(hrefs(m).includes("/entry/slotted?slot=abc"));
  assert.match(m.container.textContent, /元の画面へ戻る/);
  assert.ok(hrefs(m).includes("/dashboard/settings?tab=link&next=%2Fentry%2Fslotted%3Fslot%3Dabc"));
  await m.unmount();
  const evil = await mount("/dashboard/settings?next=%2F%2Fevil.com", api(data));
  assert.ok(hrefs(evil).includes("/dashboard"));
  assert.ok(!hrefs(evil).includes("//evil.com"));
  await evil.unmount();
  const self = await mount("/dashboard/settings?next=%2Fdashboard%2Fsettings", api(data));
  assert.doesNotMatch(self.container.textContent, /元の画面へ戻る/);
  await self.unmount();
});

test("?onboarding=1 with terms accepted: 初回セットアップ header, link panel, no tab nav, history inline", async () => {
  const m = await mount("/dashboard/settings?onboarding=1&next=%2Fentry", api(settings({ requestHistory: [requestRow("r1")] })));
  const t = m.container.textContent;
  assert.match(t, /初回セットアップ/);
  assert.match(t, /X ID を登録/);
  assert.match(t, /FlameNode を使うには、活動名義となる X ID の連携申請が必要です/);
  assert.equal(m.container.querySelectorAll('[role="tablist"]').length, 0);
  assert.deepEqual(panelIds(m), ["settings-panel-link"]);
  assert.match(t, /申請済みのX IDと現在の状態を確認できます。/);
  assert.doesNotMatch(t, /元の画面へ戻る/);
  await m.unmount();
});

test("?onboarding=1 with terms pending / re-accept required: full redirect to /rules (CURRENT: onboarding self-href is blocked by the next sanitizer, so next=/dashboard)", async () => {
  for (const over of [{ is_tos_accepted: 0 }, { terms_reaccept_required: 1 }]) {
    const seen = [];
    navigation.replace = (to) => seen.push(to);
    const m = await mount("/dashboard/settings?onboarding=1&next=%2Fentry", api(settings({ user: user(over) })));
    assert.deepEqual(seen, ["/rules?next=%2Fdashboard"]);
    assert.equal(m.container.textContent, "");
    await m.unmount();
  }
  const seen = [];
  navigation.replace = (to) => seen.push(to);
  const defaultNext = await mount("/dashboard/settings?onboarding=1", api(settings({ user: user({ is_tos_accepted: 0 }) })));
  assert.deepEqual(seen, ["/rules?next=%2Fdashboard"]);
  await defaultNext.unmount();
  const plain = [];
  navigation.replace = (to) => plain.push(to);
  const noFlag = await mount("/dashboard/settings", api(settings({ user: user({ is_tos_accepted: 0 }) })));
  assert.deepEqual(plain, []);
  await noFlag.unmount();
});

test("request history rows: labels, merge text, revert hints, no withdraw/revert buttons", async () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const past = Math.floor(Date.now() / 1000) - 3600;
  const rows = [
    requestRow("m1", { request_type: "merge", status: "done", source_x_user_id: "s", target_x_user_id: "t", revert_deadline_at: future }),
    requestRow("m2", { request_type: "merge", status: "done", source_x_user_id: "s2", target_x_user_id: "t2", revert_deadline_at: past }),
    requestRow("m3", { request_type: "merge", status: "done", source_x_user_id: "s3", target_x_user_id: "t3", revert_deadline_at: future }),
    requestRow("rv", { request_type: "revert_merge", status: "pending", parent_request_id: "m3", source_x_user_id: "s3", target_x_user_id: "t3" }),
    requestRow("al", { request_type: "alias", requested_x_id: "old", target_x_user_id: "new", status: "approved", updated_at: 1_700_100_000 }),
    requestRow("ex", { request_type: "existing_link", requested_x_id: null, status: "cancelled" }),
  ];
  const m = await mount("/dashboard/settings?tab=history", api(settings({ requestHistory: rows })));
  const t = m.container.textContent;
  assert.match(t, /@s → @t/);
  assert.match(t, /X ID統合・/);
  assert.match(t, /作品・合作メンバー・チャプター・予約枠・審査案件を統合先へ付け替え、統合元を無効化/);
  assert.match(t, /まで取り消し申請できます/);
  assert.match(t, /差し戻し期限を過ぎています/);
  assert.match(t, /差し戻し済み、または申請中です/);
  assert.match(t, /@t3 → @s3 の取消/);
  assert.match(t, /統合取消・/);
  assert.match(t, /@old → @new/);
  assert.match(t, /旧別名申請・/);
  assert.match(t, /・最終更新 2023\/11\/16/);
  assert.match(t, /取消済み/);
  assert.match(t, /X ID連携・/);
  assert.equal(m.container.querySelectorAll("button").length, 0);
  assert.doesNotMatch(t, /取り下げる|統合を取り消す申請/);
  await m.unmount();
});

test("failures: 401 login with the sanitized next, 403 BAN, 5xx error screen", async () => {
  const anon = await mount("/dashboard/settings?next=%2Fentry", fakeApi({ getSettings: { status: "anonymous" } }));
  assert.ok(hrefs(anon).includes("/entry?next=%2Fentry"));
  await anon.unmount();
  const banned = await mount("/dashboard/settings", fakeApi({ getSettings: { status: "banned" } }));
  assert.match(banned.container.textContent, /利用が停止されています/);
  await banned.unmount();
  const down = await mount("/dashboard/settings", fakeApi({ getSettings: { status: "unavailable" } }));
  assert.match(down.container.textContent, /画面の表示中に問題が発生しました/);
  await down.unmount();
});
