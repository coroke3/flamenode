// MIG-0506 characterization: built `/` vs CURRENT app/(public)/page.tsx (sections, order, limits, texts, links, head,
// JSON-LD), the recruit-card state/countdown vs CURRENT EventRecruitCard, and fail-closed snapshot handling.
// Run `npm run build -w @flamenode/ui && npm run build -w @flamenode/site` first (default-build tests read apps/site/dist).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";
import { buildTopView, loadTopForBuild, recruitState, recruitCountdown, toEventCard } from "../apps/site/src/lib/topData.ts";
import { D, ev, nowSec, topPayload, trendingPayload, writeSnapshot, writeFixtureSnapshot } from "./fixtures/topSnapshotFixture.mjs";

const DIST = path.resolve("apps/site/dist");
const built = fs.existsSync(path.join(DIST, "index.html"));
const skip = built ? false : "apps/site/dist missing: build @flamenode/site first";
// test:unit runs before the site build; the CI REQUIRE_BUILT step fails instead of skipping.
if (process.env.REQUIRE_BUILT && skip) throw new Error("REQUIRE_BUILT is set but " + skip);
const dom = (root, file = "index.html") => new JSDOM(fs.readFileSync(path.join(root, file), "utf-8")).window.document;
const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
const page = fs.readFileSync("app/(public)/page.tsx", "utf-8");
const recruitSrc = fs.readFileSync("src/components/layout/EventRecruitCard.tsx", "utf-8");

const NOW = 1_790_000_000;
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
    const env = writeFixtureSnapshot(dir);
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
    for (const shelf of main.querySelectorAll(".tp-shelf")) {
      assert.equal(shelf.getAttribute("tabindex"), "0", "keyboard-scrollable region");
      assert.ok(shelf.querySelectorAll(".tp-shelf-i").length <= 8);
      assert.equal(shelf.getAttribute("role"), "region");
    }
    const trending = main.querySelector("#sec-trending").closest("section");
    assert.deepEqual([...trending.querySelectorAll(".tp-shelf-rank")].map(text), ["1", "2", "3", "4", "5", "6", "7", "8"]);
    assert.equal(trending.querySelector(".sec-head a").getAttribute("href"), "/trending");
    const links = Object.fromEntries([...main.querySelectorAll("section.tp-sec")].map((s) => [s.querySelector("h2").id, s.querySelector(".sec-head a")?.getAttribute("href")]));
    assert.deepEqual(links, { "sec-trending": "/trending", "sec-recommend": "/recommend", "sec-latest": "/list", "sec-nostalgic": "/list?sort=old", "sec-events": "/event" });
    assert.equal(text(main.querySelector("#sec-nostalgic ~ *, #sec-nostalgic").closest("section").querySelector(".sec-head a")), "過去の作品を見る →".replace(" →", ""));
    const pickHrefs = [...main.querySelector("#sec-recommend").closest("section").querySelectorAll(".tp-shelf-i a")].map((a) => a.getAttribute("href"));
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
    // a partly set snapshot env never silently falls back to the empty page
    const full = writeSnapshot(dir);
    for (const missing of Object.keys(full)) {
      await assert.rejects(loadTopForBuild({ ...full, [missing]: undefined }, nowSec), /Snapshot env incomplete/, `${missing} missing`);
    }
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
