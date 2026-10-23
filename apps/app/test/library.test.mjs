// MIG-0701 U02: /dashboard/library tabs, pagination, query round-trip, empty states, failures.
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { chapter, dom, fakeApi, flush, library, mount, ok, video } from "./helpers.mjs";

const hrefs = (m) => [...m.container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
const libApi = (fn) => fakeApi({ getLibrary: (q) => ok(fn(q)) });
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); });
  await flush();
};

test("tab and page from the URL are sent verbatim to the API (deep link / reload)", async () => {
  const api = libApi((q) => library({ tab: "collab", page: 3 }));
  const m = await mount("/dashboard/library?tab=collab&page=3", api);
  assert.deepEqual(api.calls[0], ["getLibrary", { tab: "collab", page: "3" }]);
  assert.match(m.container.textContent, /共同編集できる作品/);
  assert.match(m.container.textContent, /ページ|承認済み X ID がないため/);
  await m.unmount();
  const bare = fakeApi({ getLibrary: ok(library()) });
  const m2 = await mount("/dashboard/library", bare);
  assert.deepEqual(bare.calls[0], ["getLibrary", { tab: null, page: null }]);
  await m2.unmount();
});

test("tab row: 5 tabs, selected tab is primary, links keep ?tab, clicking re-requests (client navigation)", async () => {
  const api = libApi((q) => library({ tab: q.tab === "bookmark" ? "bookmark" : "like" }));
  const m = await mount("/dashboard/library", api);
  const tabs = [...m.container.querySelectorAll('[role="tab"]')];
  assert.deepEqual(tabs.map((t) => t.textContent), ["いいね", "セーブ", "自分の作品", "共同編集", "チャプター"]);
  assert.deepEqual(tabs.map((t) => t.getAttribute("href")), [
    "/dashboard/library?tab=like", "/dashboard/library?tab=bookmark", "/dashboard/library?tab=mine",
    "/dashboard/library?tab=collab", "/dashboard/library?tab=chapters",
  ]);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.ok(tabs[0].className.includes("fn-btn-primary"));
  await click(tabs[1]);
  assert.deepEqual(api.calls.at(-1), ["getLibrary", { tab: "bookmark", page: null }]);
  assert.equal(m.container.querySelectorAll('[role="tab"]')[1].getAttribute("aria-selected"), "true");
  await m.unmount();
});

test("like: grid with playlist hrefs, playlist button, count, other-tab hint on empty", async () => {
  const withItems = await mount("/dashboard/library", libApi(() => library({
    tab: "like",
    videos: [video("v1", { youtube_video_id: "abcdefghijk" }), video("v2")],
  })));
  const t = withItems.container.textContent;
  assert.match(t, /2 件を表示（ページ 1）/);
  assert.match(t, /いいねした作品をプレイリストで見る/);
  const h = hrefs(withItems);
  assert.ok(h.includes("/abcdefghijk?playlist=lib-like"));
  assert.ok(h.includes("/v2?playlist=lib-like"));
  await withItems.unmount();

  const empty = await mount("/dashboard/library", libApi(() => library({ tab: "like", hasOtherTabHits: true })));
  assert.match(empty.container.textContent, /まだ「いいね」した作品がありません。/);
  assert.match(empty.container.textContent, /もう一方のタブには作品があります。/);
  await empty.unmount();

  const bookmark = await mount("/dashboard/library?tab=bookmark", libApi(() => library({ tab: "bookmark", videos: [video("v3")] })));
  assert.match(bookmark.container.textContent, /セーブした作品をプレイリストで見る/);
  assert.ok(hrefs(bookmark).includes("/v3?playlist=lib-bookmark"));
  await bookmark.unmount();
  const emptyBookmark = await mount("/dashboard/library?tab=bookmark", libApi(() => library({ tab: "bookmark" })));
  assert.match(emptyBookmark.container.textContent, /まだ「セーブ」した作品がありません。/);
  assert.doesNotMatch(emptyBookmark.container.textContent, /もう一方のタブ/);
  await emptyBookmark.unmount();
});

test("mine / collab: edit hrefs, titles, and Active X / approved X empty states", async () => {
  const mine = await mount("/dashboard/library?tab=mine", libApi(() => library({ tab: "mine", activeApprovedXId: "a", videos: [video("m1")] })));
  assert.match(mine.container.textContent, /Active X ID 名義で投稿した作品を表示します。/);
  assert.ok(hrefs(mine).includes("/dashboard/edit/m1"));
  assert.ok(!mine.container.textContent.includes("プレイリストで見る"));
  await mine.unmount();

  const mineNoActive = await mount("/dashboard/library?tab=mine", libApi(() => library({ tab: "mine" })));
  assert.match(mineNoActive.container.textContent, /Active X ID を設定すると、その名義の作品を表示できます。/);
  await mineNoActive.unmount();
  const mineEmpty = await mount("/dashboard/library?tab=mine", libApi(() => library({ tab: "mine", activeApprovedXId: "a" })));
  assert.match(mineEmpty.container.textContent, /自分の作品はまだ登録されていません。/);
  await mineEmpty.unmount();

  const collabNoX = await mount("/dashboard/library?tab=collab", libApi(() => library({ tab: "collab", approvedXIdCount: 0 })));
  assert.match(collabNoX.container.textContent, /承認済み X ID がないため、共同編集できる作品を表示していません。/);
  await collabNoX.unmount();
  const collabEmpty = await mount("/dashboard/library?tab=collab", libApi(() => library({ tab: "collab", approvedXIdCount: 2 })));
  assert.match(collabEmpty.container.textContent, /共同編集できる作品はまだありません。/);
  await collabEmpty.unmount();
  const collab = await mount("/dashboard/library?tab=collab", libApi(() => library({ tab: "collab", approvedXIdCount: 1, videos: [video("c1")] })));
  assert.ok(hrefs(collab).includes("/dashboard/edit/c1"));
  await collab.unmount();
});

test("chapters tab: list rows, visibility badge, empty state", async () => {
  const m = await mount("/dashboard/library?tab=chapters", libApi(() => library({
    tab: "chapters", approvedXIdCount: 1,
    chapters: [chapter("1", { visibility: "private" }), chapter("2", { youtube_video_id: "abcdefghijk", visibility: null })],
  })));
  const t = m.container.textContent;
  assert.match(t, /自分のチャプターコメント/);
  assert.match(t, /承認済み X ID で投稿したチャプターコメントを表示します。/);
  assert.match(t, /2 件を表示（ページ 1）/);
  assert.match(t, /非公開/);
  assert.match(t, /公開/);
  assert.match(t, /12秒/);
  assert.ok(hrefs(m).includes("/v-1"));
  assert.ok(hrefs(m).includes("/abcdefghijk"));
  await m.unmount();
  const empty = await mount("/dashboard/library?tab=chapters", libApi(() => library({ tab: "chapters" })));
  assert.match(empty.container.textContent, /まだ投稿したチャプターコメントはありません。/);
  await empty.unmount();
});

test("pagination: 前へ/次へ keep tab, first page has no 前へ, empty later page offers 前へ", async () => {
  const first = await mount("/dashboard/library?tab=mine&page=1", libApi(() => library({ tab: "mine", page: 1, hasNextPage: true, activeApprovedXId: "a", videos: [video("a")] })));
  assert.ok(hrefs(first).includes("/dashboard/library?tab=mine&page=2"));
  assert.ok(!first.container.textContent.includes("前へ"));
  await first.unmount();
  const mid = await mount("/dashboard/library?tab=mine&page=2", libApi(() => library({ tab: "mine", page: 2, hasNextPage: true, activeApprovedXId: "a", videos: [video("a")] })));
  assert.ok(hrefs(mid).includes("/dashboard/library?tab=mine&page=1"));
  assert.ok(hrefs(mid).includes("/dashboard/library?tab=mine&page=3"));
  await mid.unmount();
  const last = await mount("/dashboard/library?tab=mine&page=3", libApi(() => library({ tab: "mine", page: 3, hasNextPage: false, activeApprovedXId: "a", videos: [video("a")] })));
  assert.ok(hrefs(last).includes("/dashboard/library?tab=mine&page=2"));
  assert.ok(!last.container.textContent.includes("次へ"));
  await last.unmount();
  const beyond = await mount("/dashboard/library?tab=like&page=9", libApi(() => library({ tab: "like", page: 9 })));
  assert.ok(hrefs(beyond).includes("/dashboard/library?tab=like&page=8"));
  await beyond.unmount();
});

test("failures: 401 login with library next, 403 BAN, 5xx keeps header+tabs with the data notice", async () => {
  const anon = await mount("/dashboard/library?tab=mine", fakeApi({ getLibrary: { status: "anonymous" } }));
  assert.ok(hrefs(anon).includes("/entry?next=%2Fdashboard%2Flibrary"));
  await anon.unmount();
  const banned = await mount("/dashboard/library", fakeApi({ getLibrary: { status: "banned" } }));
  assert.match(banned.container.textContent, /利用が停止されています/);
  await banned.unmount();
  const down = await mount("/dashboard/library?tab=chapters", fakeApi({ getLibrary: { status: "unavailable" } }));
  assert.match(down.container.textContent, /データを読み込めませんでした。ページを再読み込みしてください。/);
  assert.match(down.container.textContent, /自分のチャプターコメント/);
  assert.equal(down.container.querySelectorAll('[role="tab"]').length, 5);
  assert.doesNotMatch(down.container.textContent, /ログインが必要です/);
  await down.unmount();
});
