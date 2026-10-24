// MIG-0505 characterization: /list, /recommend, /trending built HTML vs CURRENT pages (texts, links, head, empty
// states, public-only projection) and the /list query-key table (G03 / T05) vs CURRENT ListIndexView + next.config.
// Run `npm run build -w @flamenode/ui && npm run build -w @flamenode/site` first (default-build tests read apps/site/dist).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { LIST_QUERY_KEYS, LIST_PAGE_SIZE, LIST_MAX_PAGE, normalizeListQuery } from "../apps/site/src/lib/listQuery.ts";
import { loadListingForBuild } from "../apps/site/src/lib/listingData.ts";
import { LIST_FIRST_PAGE_KEY, RECOMMEND_KEY, TRENDING_KEY, TOP_KEY } from "../apps/site/src/lib/publicDataLoader.ts";
import { formatUnix } from "../src/lib/utils/format.ts";

const DIST = path.resolve("apps/site/dist");
const built = fs.existsSync(path.join(DIST, "list/index.html"));
const skip = built ? false : "apps/site/dist missing: build @flamenode/site first";
// test:unit runs before the ui build, so ListView is imported only when packages/ui/dist exists (CI REQUIRE_BUILT step fails instead of skipping).
const uiBuilt = fs.existsSync(path.resolve("packages/ui/dist/index.js"));
const skipUi = uiBuilt ? false : "packages/ui/dist missing: build @flamenode/ui first";
if (process.env.REQUIRE_BUILT && (skip || skipUi)) throw new Error("REQUIRE_BUILT is set but " + (skip || skipUi));
const { ListView } = uiBuilt ? await import("@flamenode/ui") : {};
const dom = (root, file) => new JSDOM(fs.readFileSync(path.join(root, file), "utf-8")).window.document;
const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
const listSrc = fs.readFileSync("app/(public)/list/ListIndexView.tsx", "utf-8");
const nextConfig = fs.readFileSync("next.config.mjs", "utf-8");

test("G03/T05: /list keys equal next.config.mjs rewrite keys and CURRENT normalization limits", () => {
  const keys = nextConfig.match(/source: "\/list", destination: "\/list\/~query", keys: \[([^\]]*)\]/)[1].match(/"(\w+)"/g).map((k) => k.replaceAll('"', ""));
  assert.deepEqual([...LIST_QUERY_KEYS], keys);
  assert.ok(listSrc.includes("const PAGE_SIZE = 24;") && LIST_PAGE_SIZE === 24);
  assert.ok(listSrc.includes("Math.ceil(5_000 / PAGE_SIZE)") && LIST_MAX_PAGE === 209);
  for (const lit of ["MAX_SEARCH_LENGTH = 100", "MAX_EVENT_ID_LENGTH = 128", "MIN_SEARCH_CHARS = 2", "rawSort.slice(0, 16)", '"index" ? "index"', '"compact" ? "compact"', "value.trim().slice(0, 12)"]) {
    assert.ok(listSrc.replace(/\s+/g, " ").includes(lit.replace(/\s+/g, " ")), `CURRENT has ${lit}`);
  }
  assert.match(fs.readFileSync("src/lib/db/listQueries.ts", "utf-8"), /value === "old" \|\| value === "score"\) return value;\s*return "new"/);
});

test("G03/T05: every key with value / empty / unknown gives CURRENT's result and twin routing", () => {
  const d = normalizeListQuery({});
  assert.deepEqual([d.q, d.sort, d.page, d.event, d.view, d.routesToQueryTwin], ["", "new", 1, "", "grid", false]);
  const cases = [
    [{ q: " 作品 " }, { q: "作品", routesToQueryTwin: true }],
    [{ q: "" }, { q: "", routesToQueryTwin: false }],
    [{ q: "a" }, { searchTooShort: true }],
    [{ q: "！？" }, { searchTooShort: true }],
    [{ q: "x".repeat(300) }, { q: "x".repeat(100) }],
    [{ sort: "old" }, { sort: "old", routesToQueryTwin: true }],
    [{ sort: "score" }, { sort: "score" }],
    [{ sort: "" }, { sort: "new", routesToQueryTwin: false }],
    [{ sort: "bogus" }, { sort: "new", routesToQueryTwin: true }],
    [{ page: "3" }, { page: 3 }],
    [{ page: "" }, { page: 1, routesToQueryTwin: false }],
    [{ page: "0" }, { page: 1 }],
    [{ page: "-2" }, { page: 1 }],
    [{ page: "abc" }, { page: 1 }],
    [{ page: "99999999" }, { page: 209 }],
    [{ page: "9".repeat(40) }, { page: 209 }],
    [{ event: " pvsf2026sp " }, { event: "pvsf2026sp", routesToQueryTwin: true }],
    [{ event: "" }, { event: "", routesToQueryTwin: false }],
    [{ event: "e".repeat(200) }, { event: "e".repeat(128) }],
    [{ view: "index" }, { view: "index", routesToQueryTwin: true }],
    [{ view: "compact" }, { view: "compact" }],
    [{ view: "" }, { view: "grid", routesToQueryTwin: false }],
    [{ view: "tiles" }, { view: "grid", routesToQueryTwin: true }],
    [{ q: ["", "dup"] }, { q: "", routesToQueryTwin: true }],
  ];
  for (const [input, want] of cases) {
    const got = normalizeListQuery(input);
    for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, `${JSON.stringify(input)} -> ${k}`);
  }
  assert.equal(normalizeListQuery({ unknownKey: "x" }).routesToQueryTwin, false, "unknown keys never reach the twin");
});

test("default build (no snapshot): CURRENT empty states and heads, no controls that do nothing", { skip }, () => {
  const list = dom(DIST, "list/index.html");
  assert.equal(list.title, "作品一覧 | FlameNode");
  assert.equal(list.querySelector('meta[name="description"]').content, "FlameNodeに投稿された公開作品を、新着順やスコア順で探せます。");
  assert.equal(list.querySelector('link[rel="canonical"]').href, "https://flamenode.net/list");
  assert.equal(text(list.querySelector("h1")), "作品一覧");
  assert.match(text(list.querySelector("main")), /0 works/);
  assert.match(text(list.querySelector(".lv-empty")), /作品一覧への反映を準備しています。しばらくしてから再読み込みしてください。/);
  assert.equal(list.querySelector("main form, main button, main input, main select"), null);

  const rec = dom(DIST, "recommend/index.html");
  assert.equal(rec.title, "おすすめ作品 | FlameNode");
  assert.equal(rec.querySelector('link[rel="canonical"]').href, "https://flamenode.net/recommend");
  assert.equal(text(rec.querySelector(".rc-empty")), "まだおすすめできる作品がありません。");
  assert.deepEqual([...rec.querySelectorAll(".rc-tabs a")].map((a) => [text(a), a.getAttribute("href")]), [["人気作品", "#rail-hot"], ["新着", "#rail-fresh"], ["見落としがち", "#rail-underrated"], ["イベント", "#rail-events"], ["まとめて見る", "#rail-more"]]);
  assert.equal(rec.querySelector('main a[href="/list"]').textContent.trim(), "一覧でさらに探す");

  const tr = dom(DIST, "trending/index.html");
  assert.equal(tr.title, "急上昇ランキング | FlameNode");
  assert.equal(tr.querySelector('link[rel="canonical"]').href, "https://flamenode.net/trending");
  assert.match(text(tr.querySelector("main")), /ランキングを準備中です視聴データの集計が完了すると、ここに急上昇作品が表示されます。/);
});

test("CURRENT titles/descriptions/empty strings are the ones in the pages", () => {
  const rec = fs.readFileSync("app/(public)/recommend/page.tsx", "utf-8");
  const trend = fs.readFileSync("app/(public)/trending/page.tsx", "utf-8");
  for (const s of ["次に見る作品を探す", "いま見るなら", "まだおすすめできる作品がありません。", "イベントから見る", "新着だけど良さそう", "一覧でさらに探す", "すべて見る →", 'moreHref="/list?sort=new"', "RAIL_DISPLAY_LIMIT = 8"]) assert.ok(rec.includes(s), s);
  for (const s of ["FlameNode内で最近よく視聴されている作品のランキングです。", "TRENDING_PAGE_LIMIT = 30", "ランキングデータが古い可能性があります。しばらくしてから再度ご確認ください。", "最終更新（JST）:", "1週間", "回視聴"]) assert.ok(trend.includes(s) || fs.readFileSync("src/components/video/RankedVideoCard.tsx", "utf-8").includes(s), s);
  assert.ok(listSrc.includes("作品一覧への反映を準備しています。しばらくしてから再読み込みしてください。"));
});

function envelope(key, payload, over = {}) {
  return { schemaVersion: 1, generation: "g1", key, visibility: "public", payload, sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"), ...over };
}
const row = (n, extra = {}) => ({ id: `v${n}`, title: `作品${n}`, youtube_video_id: `AAAAAAAAA${String(n).padStart(2, "0")}`, display_name: `作者${n}`, icon_url: null, primary_event_id: n % 2 ? "ev1" : null, scheduled_time: 1790000000 + n, status: "public", ...extra });
function writeSnapshot(dir, { list, recommend, trending }, over = {}) {
  fs.mkdirSync(path.join(dir, "snapshot/list"), { recursive: true });
  fs.mkdirSync(path.join(dir, "snapshot/recommend"), { recursive: true });
  fs.mkdirSync(path.join(dir, "snapshot/trending"), { recursive: true });
  fs.writeFileSync(path.join(dir, LIST_FIRST_PAGE_KEY), JSON.stringify(envelope(LIST_FIRST_PAGE_KEY, list, over.list)));
  fs.writeFileSync(path.join(dir, RECOMMEND_KEY), JSON.stringify(envelope(RECOMMEND_KEY, recommend, over.recommend)));
  fs.writeFileSync(path.join(dir, TRENDING_KEY), JSON.stringify(envelope(TRENDING_KEY, trending, over.trending)));
  // `/` is built from the same snapshot set (MIG-0506); a configured build is all-or-nothing.
  fs.mkdirSync(path.join(dir, "snapshot/top"), { recursive: true });
  fs.writeFileSync(path.join(dir, TOP_KEY), JSON.stringify(envelope(TOP_KEY, { generated_at: 1, recommended: [row(1)] })));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schemaVersion: 1, generation: "g1", allowedKeys: [LIST_FIRST_PAGE_KEY, RECOMMEND_KEY, TRENDING_KEY, TOP_KEY], blockedKeys: [] }));
  return { FLAMENODE_SNAPSHOT_DIR: dir, FLAMENODE_SNAPSHOT_MANIFEST_FILE: path.join(dir, "manifest.json"), FLAMENODE_SNAPSHOT_GENERATION: "g1" };
}
const fixture = () => ({
  list: { videos: [row(1), row(2), row(3, { status: "private" }), row(4, { status: "voided" })], total: 1234 },
  recommend: {
    generated_at: 1790000000,
    recommended: Array.from({ length: 12 }, (_, i) => row(10 + i, { creator_x_user_id: `c${i}` })),
    latest: Array.from({ length: 4 }, (_, i) => row(30 + i, { creator_x_user_id: `d${i}` })),
    underrated: [row(40, { creator_x_user_id: "u0" }), row(41, { status: "private" })],
    creators: [],
  },
  trending: { schema_version: 1, generated_at: 1790000000, items: [
    { ...row(50), primary_event_title: "第一回", views_2d: 10, views_5d: 20, views_7d: 12345, views_30d: 99, rank: 1 },
    { ...row(51), primary_event_title: null, views_2d: 1, views_5d: 2, views_7d: 7, views_30d: 9, rank: 2 },
    { ...row(52, { status: "private" }), primary_event_title: null, views_2d: 1, views_5d: 2, views_7d: 7, views_30d: 9 },
  ] },
});

test("snapshot build: rendered HTML follows CURRENT rows, links, ordering and public-only projection", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fn-listing-"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fn-listing-out-"));
  try {
    const env = writeSnapshot(dir, fixture());
    execFileSync(process.execPath, [path.resolve("node_modules/astro/astro.js"), "build", "--outDir", out], { cwd: path.resolve("apps/site"), env: { ...process.env, ...env }, stdio: "pipe" });

    const list = dom(out, "list/index.html");
    const cards = [...list.querySelectorAll("main .grid-v > a")];
    assert.equal(cards.length, 2, "private and voided rows are not emitted");
    assert.deepEqual(cards.map((a) => a.getAttribute("href")), ["/AAAAAAAAA01", "/AAAAAAAAA02"], "CURRENT /{youtube id}");
    assert.equal(cards[0].querySelector("img").getAttribute("src"), "/api/youtube-thumbnail/AAAAAAAAA01/mqdefault");
    assert.match(text(cards[0]), /作品1.*作者1/);
    assert.match(text(list.querySelector("main")), /1,234 works/);
    assert.equal(list.querySelector(".lv-empty"), null);
    assert.ok(!fs.readFileSync(path.join(out, "list/index.html"), "utf-8").includes("作品3"));

    const rec = dom(out, "recommend/index.html");
    assert.equal(text(rec.querySelector("#hero-rec")), "いま見るなら");
    assert.ok(rec.querySelector(".rc-hero .fn-vc"));
    const ids = [...rec.querySelectorAll("main section[id^=rail-]")].map((s) => s.id);
    assert.deepEqual(ids.filter((id) => ["rail-hot", "rail-underrated", "rail-events", "rail-more", "rail-fresh"].indexOf(id) >= 0), ids, "only CURRENT rails");
    assert.ok(ids.indexOf("rail-hot") < ids.indexOf("rail-fresh"), "CURRENT order puts fresh last");
    for (const s of rec.querySelectorAll("main section[id^=rail-]")) assert.ok(s.querySelectorAll(".grid-v > a").length <= 8, `${s.id} <= 8 cards`);
    const more = Object.fromEntries([...rec.querySelectorAll("main section[id^=rail-]")].map((s) => [s.id, s.querySelector(".sec-head a")?.getAttribute("href")]));
    assert.equal(more["rail-fresh"], "/list?sort=new");
    assert.equal(more["rail-events"], "/event");
    assert.equal(more["rail-more"], "/list");
    assert.ok(!fs.readFileSync(path.join(out, "recommend/index.html"), "utf-8").includes("作品41"));

    const tr = dom(out, "trending/index.html");
    const rows = [...tr.querySelectorAll("ol.tr-list > li")];
    assert.equal(rows.length, 2, "private ranking row dropped");
    assert.match(text(rows[0]), /01.*作品50.*作者50.*第一回.*1週間 12,345回視聴/);
    assert.match(text(rows[1]), /02.*作品51.*1週間 7回視聴/);
    assert.equal(rows[0].querySelector("a").getAttribute("href"), "/AAAAAAAAA50");
    assert.match(text(tr.querySelector('main [role="status"]')), new RegExp(`最終更新（JST）: ${formatUnix(1790000000).replace(/[/]/g, "\\/")}`));
    assert.match(text(tr.querySelector("main")), /ランキングデータが古い可能性があります/, "stale at build time, as CURRENT evaluates at request time");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("fail closed: a configured but broken snapshot fails the build instead of publishing an empty page", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fn-listing-bad-"));
  try {
    assert.deepEqual(await loadListingForBuild({}), { list: null, recommend: null, trending: null });
    await assert.rejects(loadListingForBuild({ FLAMENODE_SNAPSHOT_DIR: dir }), /incomplete/);
    const good = fixture();
    const ok = await loadListingForBuild(writeSnapshot(dir, good));
    assert.equal(ok.list.videos.length, 2);
    assert.equal(ok.trending.items.length, 2);
    await assert.rejects(loadListingForBuild(writeSnapshot(dir, good, { list: { sha256: "a".repeat(64) } })), { code: "HASH_MISMATCH" });
    await assert.rejects(loadListingForBuild(writeSnapshot(dir, good, { trending: { visibility: "private" } })), { code: "NOT_PUBLIC" });
    await assert.rejects(loadListingForBuild(writeSnapshot(dir, { ...good, list: { videos: good.list.videos, total: 1 } })), { code: "LISTING_INVALID" });
    await assert.rejects(loadListingForBuild(writeSnapshot(dir, { ...good, recommend: { generated_at: 1, recommended: [], latest: [], underrated: [], creators: [] } })), { code: "LISTING_INVALID" });
    await assert.rejects(loadListingForBuild(writeSnapshot(dir, { ...good, trending: { schema_version: 9, generated_at: 1, items: [] } })), { code: "LISTING_INVALID" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ListView display modes (Island will reuse): compact grid and CURRENT index table columns", { skip: skipUi }, () => {
  const videos = [
    { id: "a", href: "/AAAAAAAAA01", title: "作品A", thumbnailUrl: "/t.jpg", creatorName: "作者A", eventId: "ev 1", eventTitle: "第一回", dateLabel: "2026/10/01" },
    { id: "b", href: "/b", title: "作品B", thumbnailUrl: null, creatorName: "作者B", eventId: null, dateLabel: "-" },
  ];
  const render = (props) => new JSDOM(renderToStaticMarkup(React.createElement(ListView, { videos, total: 2, emptyMessage: "x", ...props }))).window.document;
  const compact = render({ view: "compact" });
  assert.ok(compact.querySelector(".grid-v.lv-compact"));
  const index = render({ view: "index" });
  assert.deepEqual([...index.querySelectorAll("thead th")].map((th) => th.textContent || th.getAttribute("aria-label")), ["サムネイル", "作品", "クリエイター", "イベント", "公開日", "open"]);
  const [r1, r2] = index.querySelectorAll("tbody tr");
  assert.equal(r1.querySelector('a[href="/event/ev%201"]').textContent, "第一回");
  assert.equal(r1.querySelector('a[aria-label="作品Aを開く"]').getAttribute("href"), "/AAAAAAAAA01");
  assert.equal(r2.querySelector('[aria-label="イベントなし"]').textContent, "—");
  assert.equal(render({ videos: [], total: 0, emptyMessage: "条件に合う作品が見つかりませんでした。条件を変えてお試しください。" }).querySelector(".lv-empty").textContent.trim(), "条件に合う作品が見つかりませんでした。条件を変えてお試しください。");
});
