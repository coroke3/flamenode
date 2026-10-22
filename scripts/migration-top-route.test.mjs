// MIG-0506 characterization: built `/` vs CURRENT app/(public)/page.tsx (sections, order, limits, texts, links, head,
// JSON-LD), the recruit-card state/countdown vs CURRENT EventRecruitCard, and fail-closed snapshot handling.
// Run `npm run build -w @flamenode/ui && npm run build -w @flamenode/site` first (default-build tests read apps/site/dist).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";
import { TOP_KEY, TRENDING_KEY, LIST_FIRST_PAGE_KEY, RECOMMEND_KEY } from "../apps/site/src/lib/publicDataLoader.ts";
import { buildTopView, loadTopForBuild, recruitState, recruitCountdown, toEventCard } from "../apps/site/src/lib/topData.ts";

const DIST = path.resolve("apps/site/dist");
const built = fs.existsSync(path.join(DIST, "index.html"));
const skip = built ? false : "apps/site/dist missing: build @flamenode/site first";
const dom = (root, file = "index.html") => new JSDOM(fs.readFileSync(path.join(root, file), "utf-8")).window.document;
const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
const page = fs.readFileSync("app/(public)/page.tsx", "utf-8");
const recruitSrc = fs.readFileSync("src/components/layout/EventRecruitCard.tsx", "utf-8");

const NOW = 1_790_000_000;
const D = 86400;
const ev = (id, o = {}) => ({ id, title: `イベント${id}`, visibility_status: "public", start_time: null, end_time: null, entry_start_time: null, entry_end_time: null, ...o });

test("recruit card: state labels and countdown headings are CURRENT EventRecruitCard's", () => {
  for (const s of ["募集開始前", "募集期間中", "公開前作品受付中", "近日公開", "開催中", "終了", "満枠", "募集開始まで", "募集締切まで", "投稿期間まで", "投稿期間終了まで", "終了済み", "詳細ページへ"]) assert.ok(recruitSrc.includes(s), s);
  const accepting = ev("a", { entry_start_time: NOW - D, entry_end_time: NOW + 12 * D - 3600, start_time: NOW + 20 * D, end_time: NOW + 21 * D });
  assert.equal(recruitState(accepting, 5, NOW), "accepting");
  assert.equal(recruitState(accepting, 0, NOW), "full");
  const c = recruitCountdown(accepting, NOW, "accepting");
  assert.deepEqual([c.heading, c.seconds], ["募集締切まで", 12 * D - 3600]);
  const before = ev("b", { entry_start_time: NOW + 5 * D, entry_end_time: NOW + 9 * D, start_time: NOW + 20 * D });
  assert.equal(recruitState(before, null, NOW), "before_entry");
  assert.equal(recruitCountdown(before, NOW, "before_entry").heading, "募集開始まで");
  assert.equal(recruitState(ev("c", { entry_start_time: NOW - 9 * D, entry_end_time: NOW - D, start_time: NOW + 2 * D, end_time: NOW + 3 * D }), null, NOW), "soon");
  assert.equal(recruitState(ev("d", { entry_start_time: NOW - 9 * D, entry_end_time: NOW - D, start_time: NOW + 10 * D, end_time: NOW + 11 * D }), null, NOW), "after_entry");
  const ongoing = ev("e", { start_time: NOW - D, end_time: NOW + D });
  assert.equal(recruitState(ongoing, null, NOW), "ongoing");
  assert.equal(recruitCountdown(ongoing, NOW, "ongoing").heading, "投稿期間終了まで");
  assert.equal(recruitState(ev("f", { start_time: NOW - 3 * D, end_time: NOW - D }), null, NOW), "ended");
});

test("event card: pill tone, status label and range follow CURRENT PublicEventCard", () => {
  const card = toEventCard(ev("a", { entry_start_time: NOW - D, entry_end_time: NOW + D, start_time: NOW + 5 * D, end_time: NOW + 6 * D }), NOW);
  assert.equal(card.tone, "accent");
  assert.equal(toEventCard(ev("b", { start_time: NOW + 5 * D, end_time: NOW + 6 * D }), NOW).tone, "warn");
  assert.equal(toEventCard(ev("c", { start_time: NOW - 5 * D, end_time: NOW - 4 * D }), NOW).tone, "muted");
  assert.equal(toEventCard(ev("d", { start_time: NOW + D, end_time: NOW + 2 * D }), NOW).statusLabel, "開始前");
  assert.equal(toEventCard(ev("e", { start_time: null, end_time: null }), NOW).rangeLabel, "- - -", "CURRENT quirk: formatUnix(null) is \"-\", so an undated event shows \"- - -\"");
  assert.match(card.rangeLabel, /^\d{4}\/\d{2}\/\d{2} - \d{4}\/\d{2}\/\d{2}$/);
});

const row = (n, extra = {}) => ({ id: `v${n}`, title: `作品${n}`, youtube_video_id: `AAAAAAAAA${String(n).padStart(2, "0")}`, display_name: `作者${n}`, icon_url: null, primary_event_id: null, scheduled_time: 1790000000 + n, status: "public", ...extra });
const nowSec = Math.floor(Date.now() / 1000);
const topPayload = () => ({
  generated_at: nowSec,
  recommended: Array.from({ length: 12 }, (_, i) => row(10 + i)).concat([row(99, { status: "private" })]),
  latest: Array.from({ length: 12 }, (_, i) => row(30 + i)),
  nostalgic: Array.from({ length: 3 }, (_, i) => row(60 + i)),
  active_events: [
    ev("pvsf", { title: "PVSF2026", entry_start_time: nowSec - D, entry_end_time: nowSec + 12 * D - 3600, start_time: nowSec + 20 * D, end_time: nowSec + 21 * D }),
    ev("ongo", { title: "開催中祭", start_time: nowSec - D, end_time: nowSec + D }),
  ],
  latest_events: Array.from({ length: 5 }, (_, i) => ev(`le${i}`, { start_time: nowSec + (i + 1) * D, end_time: nowSec + (i + 2) * D })),
  announcements: Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, title: `お知らせ${i}`, body: i === 0 ? "あ".repeat(200) : "本文" })),
  creators: [{ id: "c1", x_name: "c1", icon_url: null, video_count: 1, collab_count: 0 }],
  slot_stats: [{ event_id: "pvsf", available: 32, total: 160 }],
  stats: { publicVideos: 3240, creators: 812, activeEvents: 2 },
});
const trendingPayload = (generated = nowSec) => ({ schema_version: 1, generated_at: generated, items: Array.from({ length: 10 }, (_, i) => ({ ...row(80 + i), primary_event_title: null, views_2d: 1, views_5d: 2, views_7d: 3, views_30d: 4, rank: i + 1 })) });

function envelope(key, payload, over = {}) {
  return { schemaVersion: 1, generation: "g1", key, visibility: "public", payload, sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"), ...over };
}
function writeSnapshot(dir, { top = topPayload(), trending = trendingPayload() } = {}, over = {}) {
  fs.mkdirSync(path.join(dir, "snapshot/top"), { recursive: true });
  fs.mkdirSync(path.join(dir, "snapshot/trending"), { recursive: true });
  // The other pages of the same site build need their own snapshots (a configured build is all-or-nothing).
  fs.mkdirSync(path.join(dir, "snapshot/list"), { recursive: true });
  fs.mkdirSync(path.join(dir, "snapshot/recommend"), { recursive: true });
  fs.writeFileSync(path.join(dir, LIST_FIRST_PAGE_KEY), JSON.stringify(envelope(LIST_FIRST_PAGE_KEY, { videos: [row(1)], total: 1 })));
  fs.writeFileSync(path.join(dir, RECOMMEND_KEY), JSON.stringify(envelope(RECOMMEND_KEY, { generated_at: 1, recommended: [row(2)], latest: [], underrated: [], creators: [] })));
  fs.writeFileSync(path.join(dir, TOP_KEY), JSON.stringify(envelope(TOP_KEY, top, over.top)));
  fs.writeFileSync(path.join(dir, TRENDING_KEY), JSON.stringify(envelope(TRENDING_KEY, trending, over.trending)));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schemaVersion: 1, generation: "g1", allowedKeys: [TOP_KEY, TRENDING_KEY, LIST_FIRST_PAGE_KEY, RECOMMEND_KEY], blockedKeys: [] }));
  return { FLAMENODE_SNAPSHOT_DIR: dir, FLAMENODE_SNAPSHOT_MANIFEST_FILE: path.join(dir, "manifest.json"), FLAMENODE_SNAPSHOT_GENERATION: "g1" };
}

test("CURRENT page.tsx limits, section texts and order are the ones the model uses", async () => {
  for (const s of ["TOP_SHELF_DISPLAY_LIMIT = 8", "FlameNodeで注目", "今週のピックアップ", "新着アップロード", "懐かしの映像", "最近のイベント", "おすすめできる作品がまだありません。", "公開作品がまだありません。", "対象になる作品がまだありません。", "公開中のイベントがまだありません。", "body.length > 180", 'moreHref="/list?sort=old"', 'moreLabel="過去の作品を見る"', "!trendingLoaded.tooOldForHome"]) assert.ok(page.includes(s), s);
  const order = ["sec-trending", "sec-recommend", "sec-latest", "懐かしの映像", "sec-events"].map((s) => page.indexOf(s));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "CURRENT section order");
  const { normalizeStaticTop } = await import("../src/lib/publicData/staticTopCore.ts");
  const view = buildTopView(normalizeStaticTop(topPayload()), [], nowSec, () => 0.5);
  assert.deepEqual(view.shelves.map((s) => s.id), ["recommend", "latest", "nostalgic"], "no trending shelf without items");
  assert.ok(view.shelves.every((s) => s.items.length <= 8));
  assert.equal(view.shelves[0].items.some((i) => i.id === "v99"), false, "non-public row never shown");
  assert.equal(view.announcements.length, 3);
  assert.equal(view.announcements[0].body.length, 182, "179 chars + '...'  (CURRENT slice(0, 179))");
});

test("default build (no snapshot): CURRENT empty shelves, head and JSON-LD, no do-nothing controls", { skip }, () => {
  const doc = dom(DIST);
  assert.equal(doc.title, "FlameNode");
  assert.equal(doc.querySelector('link[rel="canonical"]').href, "https://flamenode.net/");
  assert.equal(doc.querySelector('meta[property="og:title"]').content, "FlameNode");
  assert.equal(text(doc.querySelector("h1")), "映像の、結節点。");
  assert.deepEqual([...doc.querySelectorAll("main .tp-empty")].map(text), ["おすすめできる作品がまだありません。", "公開作品がまだありません。", "対象になる作品がまだありません。", "公開中のイベントがまだありません。"]);
  assert.equal(doc.querySelector("main button, main form, main input"), null);
  const ld = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent));
  const site = ld.find((x) => x["@type"] === "WebSite");
  assert.equal(site.potentialAction["query-input"], "required name=search_term_string");
  assert.equal(site.potentialAction.target.urlTemplate, "https://flamenode.net/list?q={search_term_string}");
  assert.ok(page.includes("urlTemplate: absoluteUrl(\"/list?q={search_term_string}\")"));
  assert.ok(ld.some((x) => x["@graph"]), "site-wide graph stays");
});

test("snapshot build: intro, news, recruit cards, shelves, events and CTA follow CURRENT", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fn-top-"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fn-top-out-"));
  try {
    const env = writeSnapshot(dir);
    execFileSync(process.execPath, [path.resolve("node_modules/astro/astro.js"), "build", "--outDir", out], { cwd: path.resolve("apps/site"), env: { ...process.env, ...env }, stdio: "pipe" });
    const doc = dom(out);
    const main = doc.querySelector("main");
    assert.deepEqual([...main.querySelectorAll(".metric")].map(text), ["3,240作品", "812クリエイター", "2開催中イベント"]);
    assert.deepEqual([...main.querySelectorAll(".tp-copy .actions a")].map((a) => [text(a), a.getAttribute("href")]), [["作品を見にいく", "/list"], ["イベントを探す", "/event"]]);
    assert.match(text(main.querySelector(".tp-lead")), /個人制作映像のアーカイブと、イベントを束ねるプラットフォーム。/);

    assert.equal(main.querySelectorAll(".tp-news article").length, 3, "announcements capped at 3");
    assert.ok(text(main.querySelector(".tp-news article p")).endsWith("..."));

    const primary = main.querySelector(".tp-aside .tp-rec");
    assert.match(text(primary), /PVSF.*募集期間中.*PVSF2026.*募集締切まで.*12.*日.*埋まり枠 128\/160.*詳細ページへ/);
    assert.equal(primary.querySelector("a.fn-btn").getAttribute("href"), "/event/pvsf");
    assert.match(text(main.querySelector(".tp-recruits")), /ONGO.*開催中/);

    const ids = [...main.querySelectorAll("section[aria-labelledby]")].map((s) => s.getAttribute("aria-labelledby"));
    assert.deepEqual(ids, ["sec-trending", "sec-recommend", "sec-latest", "sec-nostalgic", "sec-events"], "CURRENT order");
    for (const shelf of main.querySelectorAll(".shelf")) {
      assert.equal(shelf.getAttribute("tabindex"), "0", "keyboard-scrollable region");
      assert.ok(shelf.querySelectorAll(".shelf-i").length <= 8);
      assert.equal(shelf.getAttribute("role"), "region");
    }
    const trending = main.querySelector("#sec-trending").closest("section");
    assert.deepEqual([...trending.querySelectorAll(".shelf-rank")].map(text), ["1", "2", "3", "4", "5", "6", "7", "8"]);
    assert.equal(trending.querySelector(".sec-head a").getAttribute("href"), "/trending");
    const links = Object.fromEntries([...main.querySelectorAll("section.tp-sec")].map((s) => [s.querySelector("h2").id, s.querySelector(".sec-head a")?.getAttribute("href")]));
    assert.deepEqual(links, { "sec-trending": "/trending", "sec-recommend": "/recommend", "sec-latest": "/list", "sec-nostalgic": "/list?sort=old", "sec-events": "/event" });
    assert.equal(text(main.querySelector("#sec-nostalgic ~ *, #sec-nostalgic").closest("section").querySelector(".sec-head a")), "過去の作品を見る →".replace(" →", ""));
    const pickHrefs = [...main.querySelector("#sec-recommend").closest("section").querySelectorAll(".shelf-i a")].map((a) => a.getAttribute("href"));
    assert.equal(pickHrefs.length, 8);
    assert.ok(pickHrefs.every((h) => /^\/AAAAAAAAA\d\d$/.test(h)) && !pickHrefs.includes("/AAAAAAAAA99"));
    assert.equal(main.querySelectorAll("#sec-events ~ .grid-v a, section[aria-labelledby=sec-events] .grid-v a").length, 4, "CURRENT keeps 4 latest events");
    assert.deepEqual([...main.querySelectorAll(".tp-closing a")].map((a) => [text(a), a.getAttribute("href")]), [["新規投稿を始める →", "/entry"], ["FlameNodeについて", "/about"]]);
    assert.match(text(main.querySelector(".tp-closing")), /Upload your frame.あなたのフレームをアーカイブに残す。/);
    assert.equal(main.querySelector("button, form, input"), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("trending joins the top page only while fresh (CURRENT tooOldForHome); broken snapshots fail closed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fn-top-bad-"));
  try {
    assert.equal((await loadTopForBuild({}, nowSec)).shelves[0].id, "recommend");
    const fresh = await loadTopForBuild(writeSnapshot(dir), nowSec);
    assert.equal(fresh.shelves[0].id, "trending");
    const old = await loadTopForBuild(writeSnapshot(dir, { trending: trendingPayload(nowSec - 25 * 3600) }), nowSec);
    assert.equal(old.shelves[0].id, "recommend", "older than 24h is left out");
    await assert.rejects(loadTopForBuild(writeSnapshot(dir, {}, { top: { sha256: "a".repeat(64) } }), nowSec), { code: "HASH_MISMATCH" });
    await assert.rejects(loadTopForBuild(writeSnapshot(dir, {}, { top: { visibility: "private" } }), nowSec), { code: "NOT_PUBLIC" });
    await assert.rejects(loadTopForBuild(writeSnapshot(dir, { top: { recommended: [], latest: [] } }), nowSec), { code: "TOP_INVALID" });
    await assert.rejects(loadTopForBuild(writeSnapshot(dir, { trending: { schema_version: 9, generated_at: 1, items: [] } }), nowSec), { code: "TOP_INVALID" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
