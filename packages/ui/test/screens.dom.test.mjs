// MIG-0205 representative screens rendered to HTML and queried in a real DOM (jsdom).
// Checks CURRENT entry points (app/(public)/[id], event/[id], user/[id]) and the Work Order
// test cases T01 (empty), T02 (non-public = caller passes null), T04 (focus order = visual order).
// T03 (390px, no horizontal overflow) needs a layout engine; the browser evidence is in the PR.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { VideoDetailView, EventDetailView, CreatorView, eventVideoHref, VIDEO_RELATED_LIMIT } from "../dist/index.js";
import { videoFixture, eventFixture, creatorFixture } from "./screenFixtures.mjs";

const render = (C, props) => new JSDOM(renderToStaticMarkup(React.createElement(C, props))).window.document;
const hrefs = (doc, sel = "a") => [...doc.querySelectorAll(sel)].map((a) => a.getAttribute("href"));
const FOCUSABLE = "a[href], button, summary, [tabindex]:not([tabindex='-1'])";
const focusOrder = (doc) => [...doc.querySelectorAll(FOCUSABLE)].map((el) => el.getAttribute("aria-label") || el.textContent.trim());

test("video: CURRENT entry points (profile, X, YouTube, event, playlist, other events, music, members, related)", () => {
  const doc = render(VideoDetailView, { video: videoFixture() });
  assert.equal(doc.querySelector("h1").textContent, "空白合作");
  const links = hrefs(doc);
  for (const href of [
    "/user/vIXyOepPI395671",
    "https://x.com/vIXyOepPI395671",
    "https://www.youtube.com/@kuuhaku",
    "/event/pvsf2026sp",
    "https://www.youtube.com/playlist?list=PL123",
    "/event/pvsf-digest",
    "https://example.com/music",
    "/user/Maruihito_maru",
    "https://x.com/Fura1107_",
    "/r1",
  ]) {
    assert.ok(links.includes(href), `missing ${href}`);
  }
  // Off-site links open in a new tab with noopener (CURRENT).
  for (const a of doc.querySelectorAll('a[href^="https://"]')) {
    assert.equal(a.getAttribute("target"), "_blank");
    assert.match(a.getAttribute("rel"), /noopener/);
  }
  assert.match(doc.querySelector(".meta-i").textContent, /ホワイトスペースにおいで \/ 椎野乃々/, "music + credit");
  assert.deepEqual([...doc.querySelectorAll(".vd-details dt")].map((d) => d.textContent), ["みどころ", "制作エピソード", "あとがき"]);
  // ぴーふら has no public profile: name is text, not a link (CURRENT has_public_profile).
  const row2 = doc.querySelectorAll(".vd-mrow")[1];
  assert.equal(row2.querySelector("a[href^='/user/']"), null);
  assert.equal(doc.querySelectorAll(".vd-chapter").length, 4);
});

test("video: creator without public profile or X ID gets no profile/X link", () => {
  const video = videoFixture();
  video.creator = { name: "作者未設定" };
  const doc = render(VideoDetailView, { video });
  assert.equal(doc.querySelector(".vd-creator").tagName, "SPAN");
  assert.equal(doc.querySelector('[aria-label="投稿者へのリンク"]'), null);
  assert.ok(!hrefs(doc).some((h) => h?.startsWith("/user/") && !h.includes("Maruihito") && !h.includes("sum1")));
});

test("video: Islands are slots; the static render has no no-op buttons and no YouTube iframe", () => {
  const doc = render(VideoDetailView, { video: videoFixture() });
  assert.equal(doc.querySelectorAll("button").length, 0, "like/save/seek/view-switch belong to the Island (MIG-0507)");
  assert.equal(doc.querySelector("iframe"), null);
  assert.match(doc.querySelector('[data-island="video-interactions"]').textContent, /128/);
  const withIslands = render(VideoDetailView, {
    video: videoFixture(),
    player: React.createElement("div", { id: "player-island" }),
    interactions: React.createElement("div", { id: "like-island" }),
    members: React.createElement("div", { id: "members-island" }),
    chapters: React.createElement("div", { id: "chapters-island" }),
  });
  for (const id of ["player-island", "like-island", "members-island", "chapters-island"]) {
    assert.ok(withIslands.getElementById(id), id);
  }
  assert.equal(withIslands.querySelector(".vd-mtable"), null, "members slot replaces the static table");
  assert.equal(withIslands.querySelector(".vd-chapters"), null, "chapters slot replaces the static list");
});

test("video: no YouTube shows CURRENT fallback; related unavailable / empty / limit", () => {
  const video = { ...videoFixture(), hasYoutube: false, relatedUnavailable: true };
  const doc = render(VideoDetailView, { video });
  assert.match(doc.querySelector(".vd-player").textContent, /YouTube動画は未登録ですが、作品情報を公開しています。/);
  assert.match(doc.querySelector('[role="status"]').textContent, /関連動画用の共有データを一時的に利用できません/);
  const empty = render(VideoDetailView, { video: { ...videoFixture(), related: [] } });
  assert.match(empty.querySelector(".vd-side").textContent, /関連動画はまだありません。/);
  const many = Array.from({ length: 20 }, (_, i) => ({ href: `/x${i}`, title: `t${i}` }));
  const limited = render(VideoDetailView, { video: { ...videoFixture(), related: many } });
  assert.equal(limited.querySelectorAll(".vd-related a").length, VIDEO_RELATED_LIMIT);
});

test("T02: null (non-public / deleted, excluded by the caller) renders only an empty state", () => {
  for (const [C, key, back] of [
    [VideoDetailView, "video", "/list"],
    [EventDetailView, "event", "/event"],
    [CreatorView, "creator", "/user"],
  ]) {
    const doc = render(C, { [key]: null });
    assert.equal(doc.querySelector("h1"), null, `${key}: no title`);
    assert.ok(doc.querySelector(".fn-empty-state"), `${key}: empty state`);
    assert.deepEqual(hrefs(doc), [back]);
  }
});

test("event: entry action follows CURRENT (reserve / submit / none), guideline and playlist links", () => {
  const reserve = render(EventDetailView, { event: eventFixture() });
  const primary = reserve.querySelector(".ed-head .fn-btn--primary");
  assert.equal(primary.getAttribute("href"), "/event/pvsf2026s/slots");
  assert.equal(primary.textContent, "枠を確保する");
  assert.ok(hrefs(reserve).includes("/rules"));
  assert.ok(hrefs(reserve).includes("https://www.youtube.com/playlist?list=PL999"));
  const submit = render(EventDetailView, { event: { ...eventFixture(), entryAction: "submit" } });
  assert.equal(submit.querySelector(".ed-head .fn-btn--primary").getAttribute("href"), "/entry");
  const none = render(EventDetailView, { event: { ...eventFixture(), entryAction: null, playlistUrl: null } });
  assert.equal(none.querySelector(".ed-head .fn-btn--primary"), null);
  assert.ok(!hrefs(none).some((h) => h?.startsWith("https://www.youtube.com/playlist")));
});

test("event: metrics, slot parts, staff, videos and CURRENT hrefs", () => {
  const doc = render(EventDetailView, { event: eventFixture() });
  assert.deepEqual([...doc.querySelectorAll(".metric span")].map((s) => s.textContent), ["作品", "クリエイター", "埋まり枠", "募集締切まで"]);
  const meters = [...doc.querySelectorAll('[role="meter"]')].map((m) => m.getAttribute("aria-valuenow"));
  assert.deepEqual(meters, ["90", "70"]);
  assert.ok(hrefs(doc).includes("/event/pvsf2026s/slots"));
  assert.ok(hrefs(doc).includes("/event/pvsf2026s/release"));
  assert.ok(hrefs(doc).includes("/list?event=pvsf2026s"), "videoTotal > shown → すべて見る");
  assert.deepEqual(hrefs(doc, ".grid-v a"), ["/yt0000001?playlist=pvsf2026s", "/e2?playlist=pvsf2026s", "/yt0000003?playlist=pvsf2026s"]);
  assert.equal(eventVideoHref("e", { id: "a b", youtubeVideoId: "  " }), "/a%20b?playlist=e");
  const staff = [...doc.querySelectorAll(".ed-staff-row")];
  assert.equal(staff[0].querySelector("a.fn-row").getAttribute("href"), "/user/shingainen");
  assert.equal(staff[1].querySelector("a.fn-row"), null, "no public profile → no profile link");
  assert.match(staff[1].textContent, /運営/, "role label default");
  assert.ok(staff[1].querySelector('a[href="https://x.com/stick"]'));
});

test("T01: empty event video list and empty creator works show CURRENT empty text", () => {
  const ev = render(EventDetailView, { event: { ...eventFixture(), videos: [], videoTotal: 0 } });
  assert.match(ev.querySelector('section[aria-labelledby="ed-posts"]').textContent, /このイベントの公開済み作品はまだありません。/);
  assert.ok(!hrefs(ev).includes("/list?event=pvsf2026s"));
  const c = creatorFixture();
  c.works = { ...c.works, items: [], total: 0, totalPages: 0 };
  c.collabs = { ...c.collabs, items: [], total: 0, totalPages: 0 };
  const doc = render(CreatorView, { creator: c });
  assert.match(doc.querySelector('section[aria-labelledby="works"]').textContent, /まだ公開されている作品がありません。/);
  assert.equal(doc.querySelector('section[aria-labelledby="collab"]'), null, "CURRENT hides collabs when total is 0");
  assert.equal(doc.querySelector(".fn-pagination"), null);
});

test("creator: back link, social links, portfolio, independent works/collab pagination hrefs", () => {
  const doc = render(CreatorView, { creator: creatorFixture() });
  const links = hrefs(doc);
  for (const href of ["/user", "https://x.com/012345rty", "https://www.youtube.com/@otako", "https://example.com/", "/user/012345rty/portfolio"]) {
    assert.ok(links.includes(href), `missing ${href}`);
  }
  const [works, collabs] = doc.querySelectorAll(".fn-pagination");
  assert.ok(hrefs(works.ownerDocument, ".fn-pagination a").includes("/user/012345rty?worksPage=2"));
  assert.ok([...collabs.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/user/012345rty?collabPage=2"));
  assert.ok(![...works.querySelectorAll("a")].some((a) => a.getAttribute("href").includes("collabPage")));
  const mail = render(CreatorView, { creator: { ...creatorFixture(), socialLinks: [{ label: "メール", url: "mailto:a@example.com" }] } });
  assert.equal(mail.querySelector('a[href^="mailto:"]').getAttribute("target"), null, "mailto opens in place (CURRENT)");
});

test("T04: keyboard focus order follows the visual (single-column) order", () => {
  const video = focusOrder(render(VideoDetailView, { video: videoFixture() }));
  const idx = (list, s) => list.findIndex((l) => l.includes(s));
  const vOrder = ["空白合作チーム", "FlameNode のプロフィール", "X (@vIXyOepPI395671)", "YouTube チャンネル", "PVSF2026Sp", "YouTube再生リスト", "PVSF まとめ動画", "ホワイトスペース", "詳細コメント", "参加メンバー", "丸い人", "個々々々々々人"];
  const vIdx = vOrder.map((s) => idx(video, s));
  assert.ok(vIdx.every((i) => i >= 0), JSON.stringify(video));
  assert.deepEqual([...vIdx].sort((a, b) => a - b), vIdx);
  const event = focusOrder(render(EventDetailView, { event: eventFixture() }));
  const eOrder = ["枠を確保する", "YouTube再生リスト", "ガイドライン", "枠表へ", "すべて見る", "投稿予定を見る", "【幼虫アニメ】", "新概念"].map((s) => idx(event, s));
  assert.ok(eOrder.every((i) => i >= 0), JSON.stringify(event));
  assert.deepEqual([...eOrder].sort((a, b) => a - b), eOrder);
  const creator = focusOrder(render(CreatorView, { creator: creatorFixture() }));
  const cOrder = ["クリエイター一覧", "X @012345rty", "YouTube", "Web サイト", "ポートフォリオ表示", "作品 1", "次のページ", "作品 5"].map((s) => idx(creator, s));
  assert.ok(cOrder.every((i) => i >= 0), JSON.stringify(creator));
  assert.deepEqual([...cOrder].sort((a, b) => a - b), cOrder);
});

test("a11y: icon-only links have names, images are decorative or named, headings start at h1", () => {
  for (const doc of [
    render(VideoDetailView, { video: videoFixture() }),
    render(EventDetailView, { event: eventFixture() }),
    render(CreatorView, { creator: creatorFixture() }),
  ]) {
    for (const a of doc.querySelectorAll("a")) {
      const name = a.getAttribute("aria-label") || a.textContent.trim();
      assert.ok(name, `unnamed link ${a.outerHTML.slice(0, 80)}`);
    }
    for (const img of doc.querySelectorAll("img")) assert.ok(img.hasAttribute("alt"));
    assert.equal(doc.querySelectorAll("h1").length, 1);
    for (const svg of doc.querySelectorAll("svg")) assert.equal(svg.getAttribute("aria-hidden"), "true");
    const ids = [...doc.querySelectorAll("[id]")].map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, "unique ids");
    for (const el of doc.querySelectorAll("[aria-labelledby]")) assert.ok(doc.getElementById(el.getAttribute("aria-labelledby")));
  }
});

test("screens.css / components.css use only tokens.css variables or their own layout variables", () => {
  const tokens = fs.readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
  const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  for (const file of ["screens.css", "components.css"]) {
    const css = fs.readFileSync(new URL(`../src/styles/${file}`, import.meta.url), "utf8");
    for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
  }
  for (const file of ["screens.css", "components.css"]) {
    const css = fs.readFileSync(new URL(`../src/styles/${file}`, import.meta.url), "utf8");
    const used = [...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
    assert.deepEqual(used.filter((v) => !defined.has(v)), [], file);
  }
});
