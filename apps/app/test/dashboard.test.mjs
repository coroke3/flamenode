// MIG-0701 U02: /dashboard states (0X / 1X / multiX, onboarding banners, empty states, hero slot, failures).
import assert from "node:assert/strict";
import test from "node:test";
import { chapter, dashboard, fakeApi, linkedX, mount, ok, onboardingState, user, video } from "./helpers.mjs";

const hrefs = (m) => [...m.container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
const page = async (data, path = "/dashboard") => mount(path, fakeApi({ getDashboard: ok(data) }));

test("0X: X ID 未連携 header, banner, and every empty state with its CURRENT link", async () => {
  const m = await page(dashboard({ user: user({ name: "Taro" }), onboarding: onboardingState({ xIdentityStatus: "none", canReserveSlot: true }) }));
  const t = m.container.textContent;
  assert.match(t, /Taro/);
  assert.match(t, /X ID 未連携/);
  assert.match(t, /投稿・一部機能には X ID が必要です。 枠確保は可能です。/);
  assert.match(t, /X ID を連携すると、承認後に作品の投稿やマイ・ギャラリーが使えるようになります。/);
  assert.match(t, /X ID を連携すると、共同編集できる作品が表示されます。/);
  assert.match(t, /X ID がまだ連携されていません。/);
  assert.match(t, /まだ投稿したチャプターコメントはありません。/);
  assert.match(t, /現在、ステータス更新が必要な枠はありません。/);
  const h = hrefs(m);
  assert.ok(h.includes("/dashboard/settings?next=/dashboard"));
  assert.ok(h.includes("/dashboard/settings"));
  assert.ok(h.includes("/entry"));
  assert.equal(h.filter((x) => x === "/dashboard/settings").length >= 3, true);
  await m.unmount();
});

test("terms pending: 初期設定が未完了です banner; canReserveSlot=false sends the X ID section to onboarding", async () => {
  const m = await page(dashboard({ onboarding: onboardingState({ needsTermsAcceptance: true, canReserveSlot: false }) }));
  assert.match(m.container.textContent, /初期設定が未完了です/);
  assert.match(m.container.textContent, /初期設定を続ける/);
  assert.doesNotMatch(m.container.textContent, /枠確保は可能です/);
  assert.ok(hrefs(m).includes("/onboarding?next=%2Fdashboard"));
  await m.unmount();
});

test("1X approved + active: no banner, X name/handle header, stats, アクティブ badge, edit links, すべて見る", async () => {
  const x = linkedX("alpha", { x_name: "Alpha", icon_url: "https://img.test/a.png" });
  const m = await page(dashboard({
    user: user({ active_x_user_id: "alpha", image: "https://img.test/discord.png" }),
    onboarding: onboardingState({ xIdentityStatus: "approved", activeApprovedXId: "alpha", canPost: true }),
    linkedXUsers: [x],
    myVideos: { items: [video("v1", { youtube_video_id: "abcdefghijk", icon_url: "https://lh3.googleusercontent.com/d/FILEID123456" })], hasMore: true },
    collabVideos: { items: [video("v2", { status: "private" })], hasMore: false },
    myChapters: { items: [chapter("c1", { visibility: "private", youtube_video_id: " yt123456789 " })], hasMore: true },
    stats: { likes: 12345, views: 1000000, video_count: 3, event_count: 2 },
  }));
  const t = m.container.textContent;
  assert.match(t, /Alpha/);
  assert.match(t, /@alpha/);
  assert.doesNotMatch(t, /X ID 未連携|活動名義（Active X ID）の設定が必要です|申請完了/);
  assert.match(t, /12,345/);
  assert.match(t, /1,000,000/);
  assert.match(t, /3 本/);
  assert.match(t, /2 本/);
  assert.doesNotMatch(t, /統計は連携済み名義の合算です/);
  assert.match(t, /アクティブ/);
  const h = hrefs(m);
  assert.ok(h.includes("/dashboard/edit/v1"));
  assert.ok(h.includes("/dashboard/edit/v2"));
  assert.ok(h.includes("/dashboard/library?tab=mine"));
  assert.ok(!h.includes("/dashboard/library?tab=collab"));
  assert.ok(h.includes("/dashboard/library?tab=chapters"));
  assert.ok(h.includes("/yt123456789"));
  assert.match(t, /非公開/);
  assert.match(t, /12秒/);
  const img = [...m.container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
  assert.ok(img.includes("https://img.test/a.png"));
  assert.ok(img.includes("/api/youtube-thumbnail/abcdefghijk/mqdefault"));
  assert.ok(img.includes("/api/google-drive-image/FILEID123456"));
  await m.unmount();
});

test("multiX: merged-stats note, pending/rejected/active badges, approved without Active X banner", async () => {
  const m = await page(dashboard({
    user: user({ active_x_user_id: null }),
    onboarding: onboardingState({ xIdentityStatus: "approved", activeApprovedXId: null }),
    linkedXUsers: [linkedX("a"), linkedX("b", { approval_status: "pending" }), linkedX("c", { approval_status: "rejected" })],
  }));
  const t = m.container.textContent;
  assert.match(t, /X ID 未選択/);
  assert.match(t, /統計は連携済み名義の合算です。マイ・ギャラリーは Active X ID の作品のみ表示します。/);
  assert.match(t, /承認待ち/);
  assert.match(t, /再申請/);
  assert.match(t, /活動名義（Active X ID）の設定が必要です/);
  assert.match(t, /Active X ID を設定すると、その名義の作品が表示されます。/);
  assert.match(t, /共同編集できる作品はまだありません。/);
  await m.unmount();
});

test("no approved X: gallery/collab explain why; pending and rejected banners", async () => {
  const onlyPending = await page(dashboard({
    onboarding: onboardingState({ xIdentityStatus: "pending", requestedXId: "req1" }),
    linkedXUsers: [linkedX("req1", { approval_status: "pending" })],
  }));
  assert.match(onlyPending.container.textContent, /申請完了・承認待ち/);
  assert.match(onlyPending.container.textContent, /@req1 の連携を運営が確認しています。 イベント枠の確保は利用できます。/);
  assert.match(onlyPending.container.textContent, /承認済み X ID がないため、作品を表示していません。/);
  assert.match(onlyPending.container.textContent, /承認済み X ID がないため、共同編集できる作品を表示していません。/);
  await onlyPending.unmount();

  const noReq = await page(dashboard({ onboarding: onboardingState({ xIdentityStatus: "pending" }) }));
  assert.match(noReq.container.textContent, /X ID 連携の申請を運営が確認しています。/);
  await noReq.unmount();

  const rejected = await page(dashboard({
    onboarding: onboardingState({ xIdentityStatus: "rejected" }),
    linkedXUsers: [linkedX("r", { approval_status: "rejected" })],
  }));
  assert.match(rejected.container.textContent, /X ID 申請を確認できませんでした/);
  assert.match(rejected.container.textContent, /申請が却下されました。設定から再申請できます。/);
  await rejected.unmount();
});

test("approved + Active X but no works: 自分の作品はまだ登録されていません + 作品を投稿する", async () => {
  const m = await page(dashboard({
    user: user({ active_x_user_id: "a" }),
    onboarding: onboardingState({ xIdentityStatus: "approved", activeApprovedXId: "a", canPost: true }),
    linkedXUsers: [linkedX("a")],
  }));
  assert.match(m.container.textContent, /自分の作品はまだ登録されていません。/);
  assert.match(m.container.textContent, /作品を投稿する/);
  await m.unmount();
});

test("hero slot: reserved (canPost / not), submitted with video, submitted without video, accent color", async () => {
  const slot = (over) => ({
    slot: { id: "s1", status: "reserved", start_time: 1_700_000_000, slot_label: "A", video_id: null, ...over },
    event: { id: "e1", title: "Event One", accent_color: "#ff0000" },
  });
  const reservedPost = await page(dashboard({ activeSlot: slot({}), onboarding: onboardingState({ canPost: true }) }));
  assert.match(reservedPost.container.textContent, /アクティブ枠/);
  assert.match(reservedPost.container.textContent, /Event One/);
  assert.match(reservedPost.container.textContent, /状態: reserved/);
  assert.match(reservedPost.container.textContent, /2023\/11\/15 07:13/);
  assert.ok(hrefs(reservedPost).includes("/entry/slotted?slot=s1"));
  assert.match(reservedPost.container.querySelector("section").getAttribute("style") ?? "", /--event-accent/);
  await reservedPost.unmount();

  const reservedNoPost = await page(dashboard({ activeSlot: slot({ start_time: null }), onboarding: onboardingState({ canPost: false }) }));
  assert.match(reservedNoPost.container.textContent, /A · 状態: reserved/);
  assert.ok(hrefs(reservedNoPost).includes("/onboarding?next=%2Fentry%2Fslotted%3Fslot%3Ds1"));
  await reservedNoPost.unmount();

  const submitted = await page(dashboard({ activeSlot: slot({ status: "submitted", video_id: "vid9" }) }));
  assert.ok(hrefs(submitted).includes("/dashboard/edit/vid9"));
  assert.ok(hrefs(submitted).includes("/event/e1"));
  assert.match(submitted.container.textContent, /提出内容を確認/);
  await submitted.unmount();

  const submittedNoVideo = await page(dashboard({ activeSlot: slot({ status: "submitted", video_id: null, start_time: null, slot_label: null }) }));
  assert.match(submittedNoVideo.container.textContent, /未指定 · 状態: submitted/);
  assert.match(submittedNoVideo.container.textContent, /枠を確保する/);
  await submittedNoVideo.unmount();
});

test("API failures map like CURRENT: 401 login, 403 BAN, 5xx data notice (not logout)", async () => {
  const anon = await mount("/dashboard", fakeApi({ getDashboard: { status: "anonymous" } }));
  assert.match(anon.container.textContent, /ログインが必要です/);
  assert.ok(hrefs(anon).includes("/entry?next=%2Fdashboard"));
  await anon.unmount();
  const banned = await mount("/dashboard", fakeApi({ getDashboard: { status: "banned" } }));
  assert.match(banned.container.textContent, /利用が停止されています/);
  await banned.unmount();
  const down = await mount("/dashboard", fakeApi({ getDashboard: { status: "unavailable" } }));
  assert.match(down.container.textContent, /データを読み込めませんでした。ページを再読み込みしてください。/);
  assert.doesNotMatch(down.container.textContent, /ログインが必要です/);
  await down.unmount();
});

test("dashboard issues exactly one read request and no session read", async () => {
  const api = fakeApi({ getDashboard: ok(dashboard()) });
  const m = await mount("/dashboard", api);
  assert.deepEqual(api.calls.map((c) => c[0]), ["getDashboard"]);
  await m.unmount();
});
