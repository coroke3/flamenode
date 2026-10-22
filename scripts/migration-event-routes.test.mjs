// MIG-0502 characterization: /event, /event/[id], /event/[id]/slots, /event/[id]/release on Astro against the
// CURRENT Next pages (query keys, texts, links, head, Event JSON-LD, zero-slot redirect, private fences) and the
// browser Islands (query filter, live slots, degraded read, hash mode).
// Run `npm run build -w @flamenode/ui && npm run build -w @flamenode/site` first (HTML tests read apps/site/dist).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { afterEach } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "https://flamenode.net/event" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const React = (await import("react")).default;
const client = await import("react-dom/client");
const liveRoots = [];
const createRoot = (...a) => { const r = client.createRoot(...a); liveRoots.push(r); return r; };
const hydrateRoot = (...a) => { const r = client.hydrateRoot(...a); liveRoots.push(r); return r; };
// A failed assertion must not leave a mounted Island (its refresh timer would keep the process alive).
afterEach(async () => {
  for (const r of liveRoots.splice(0)) {
    try {
      await React.act(async () => r.unmount());
    } catch {
      /* already unmounted */
    }
  }
});
const { renderToString } = await import("react-dom/server");
const { act } = React;
const h = React.createElement;

const { loadEventBuildData, buildEventDataFromPayloads } = await import("../apps/site/src/lib/eventData.ts");
const { parseEventsQuery, buildEventsIndexModel } = await import("../apps/site/src/lib/eventIndex.ts");
const { buildEventDetailData, buildEventJsonLd, getDayMetric, formatEventRange } = await import("../apps/site/src/lib/eventDetail.ts");
const { buildEventSlotsModel } = await import("../apps/site/src/lib/eventSlots.ts");
const { buildEventReleaseModel, formatDateKey, formatTime } = await import("../apps/site/src/lib/eventRelease.ts");
const { parseLiveSlots, fetchLiveSlots } = await import("../apps/site/src/lib/liveSlots.ts");
const { eventSlotsRedirectLines, mergeEventRedirects } = await import("../apps/site/src/integrations/eventRedirects.ts");
const { buildPageHead } = await import("../apps/site/src/lib/pageHead.ts");
const { EventsIndexIsland } = await import("../apps/site/src/components/EventsIndexIsland.ts");
const { EventDetailIsland } = await import("../apps/site/src/components/EventDetailIsland.ts");
const { EventSlotsIsland } = await import("../apps/site/src/components/EventSlotsIsland.ts");
const { EventReleaseIsland, modeFromHash } = await import("../apps/site/src/components/EventReleaseIsland.ts");

const DIST = path.resolve("apps/site/dist");
const built = fs.existsSync(path.join(DIST, "event/index.html")) && fs.existsSync(path.join(DIST, "event/autumn-collab-2026/index.html"));
const skip = built ? false : "apps/site/dist missing: build @flamenode/site first";
const load = (rel) => new JSDOM(fs.readFileSync(path.join(DIST, rel), "utf-8")).window.document;
const meta = (doc, sel) => doc.querySelector(sel)?.getAttribute("content");
const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
const read = (p) => fs.readFileSync(p, "utf-8");

const data = await loadEventBuildData({});
const NOW = 1_800_000_000; // 2027-01-15: every fixture event is either ended (2020) or scheduled (2100).
const T2100 = 4_102_444_800;
const detailOf = (id) => data.details.get(id);

const indexSrc = read("app/(public)/event/EventIndexView.tsx");
const detailSrc = read("app/(public)/event/[id]/page.tsx");
const slotsSrc = read("app/(public)/event/[id]/slots/page.tsx");
const releaseSrc = read("app/(public)/event/[id]/release/ReleaseView.tsx");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

// ---------- data fences (T03) ----------
test("data: private and unknown events produce no page object; fixtures normalize through CURRENT cores", () => {
  assert.deepEqual([...data.details.keys()].sort(), ["autumn-collab-2026", "no-slot-event-2100", "past-event-2020"]);
  assert.ok(!data.details.has("draft-secret-event"));
  assert.ok(!data.index.events.some((e) => e.id === "draft-secret-event"));
  assert.ok(!data.index.groupSections.flatMap((g) => g.events).some((e) => e.id === "draft-secret-event"));
  assert.deepEqual([...data.releases.keys()].sort(), ["autumn-collab-2026", "past-event-2020"]);
  // a release whose key and payload id disagree is not a page
  const mismatch = buildEventDataFromPayloads({
    source: "snapshot",
    index: null,
    details: { other: { event: { id: "x", title: "t", visibility_status: "public" } } },
    releases: {},
  });
  assert.equal(mismatch.details.size, 0);
  assert.equal(mismatch.index, null);
});

// ---------- U01 /event: query keys (G03) ----------
test("U01 query keys: value, empty and unknown for q / status / sort (CURRENT reads only these three)", () => {
  assert.deepEqual(parseEventsQuery("?q=%20abc%20&status=open&sort=deadline"), { q: "abc", status: "open", sort: "deadline" });
  assert.deepEqual(parseEventsQuery("?q=&status=&sort="), { q: "", status: "all", sort: "priority" });
  assert.deepEqual(parseEventsQuery("?status=zzz&sort=zzz&foo=1"), { q: "", status: "all", sort: "priority" });
  assert.deepEqual(parseEventsQuery(""), { q: "", status: "all", sort: "priority" });
  assert.deepEqual(parseEventsQuery("?status=ended&sort=new"), { q: "", status: "ended", sort: "new" });
  assert.deepEqual(parseEventsQuery("?status=upcoming&sort=start"), { q: "", status: "upcoming", sort: "start" });
  // CURRENT parse functions accept exactly these values
  for (const v of ["all", "open", "upcoming", "ended", "deadline", "start", "new"]) assert.ok(indexSrc.includes(`"${v}"`), v);
});

test("U01 result set for each key equals CURRENT's rules (hand-derived from the fixtures at a fixed clock)", () => {
  const titles = (model) => model.sections.flatMap((s) => s.events.map((e) => e.title));
  const base = buildEventsIndexModel(data.index, parseEventsQuery(""), NOW);
  assert.equal(base.hasActiveFilter, false);
  assert.deepEqual(base.sections.map((s) => [s.title, s.events.map((e) => e.id)]), [
    ["合作", ["autumn-collab-2026", "past-event-2020"]],
    ["その他のイベント", ["no-slot-event-2100"]],
  ]);
  assert.equal(base.sections[0].anchorId, "event-group-autumn");
  assert.equal(base.sections[0].subtitle, "ジャンル");
  assert.equal(base.total, 3);

  const ended = buildEventsIndexModel(data.index, parseEventsQuery("?status=ended"), NOW);
  assert.deepEqual(ended.sections.map((s) => [s.title, s.count, s.events.map((e) => e.id)]), [["検索結果", "01", ["past-event-2020"]]]);
  const upcoming = buildEventsIndexModel(data.index, parseEventsQuery("?status=upcoming"), NOW);
  assert.deepEqual(upcoming.sections[0].events.map((e) => e.id), ["no-slot-event-2100", "autumn-collab-2026"], "priority = start time ascending");
  const open = buildEventsIndexModel(data.index, parseEventsQuery("?status=open"), NOW);
  assert.deepEqual(open.sections[0].events.map((e) => e.id), ["autumn-collab-2026"]);

  // q matches operator names (not shown on cards), explanation, and group name/description
  assert.deepEqual(titles(buildEventsIndexModel(data.index, parseEventsQuery("?q=新概念"), NOW)), ["FlameNode Autumn Festival 2026"]);
  assert.deepEqual(titles(buildEventsIndexModel(data.index, parseEventsQuery("?q=%E7%B5%82%E4%BA%86%E6%B8%88%E3%81%BF"), NOW)), ["年越し合作 2020"]);
  assert.deepEqual(titles(buildEventsIndexModel(data.index, parseEventsQuery("?q=合作イベントのまとめ"), NOW)), ["FlameNode Autumn Festival 2026", "年越し合作 2020"]);
  assert.deepEqual(titles(buildEventsIndexModel(data.index, parseEventsQuery("?q=AUTUMN"), NOW)), ["FlameNode Autumn Festival 2026"]);

  // sort: new = start desc; start = start asc; deadline = entry end asc with missing last
  const order = (s) => buildEventsIndexModel(data.index, parseEventsQuery(`?sort=${s}`), NOW).sections[0].events.map((e) => e.id);
  assert.deepEqual(order("new"), ["autumn-collab-2026", "no-slot-event-2100", "past-event-2020"]);
  assert.deepEqual(order("start"), ["past-event-2020", "no-slot-event-2100", "autumn-collab-2026"]);
  // CURRENT quirk kept: normalizeUnix(null) is 0 (Number(null)), so events without an entry deadline sort first.
  assert.deepEqual(order("deadline"), ["no-slot-event-2100", "past-event-2020", "autumn-collab-2026"]);
  // empty value / unknown value = the default view
  assert.equal(buildEventsIndexModel(data.index, parseEventsQuery("?q=&sort=bogus&status=bogus"), NOW).hasActiveFilter, false);

  // empty / unavailable messages (CURRENT literals)
  const none = buildEventsIndexModel(data.index, parseEventsQuery("?q=zzzzzz"), NOW);
  assert.equal(none.emptyMessage, "条件に合うイベントが見つかりませんでした。");
  assert.equal(buildEventsIndexModel(null, parseEventsQuery(""), NOW).emptyMessage, "公開イベント一覧を一時的に表示できません。");
  assert.equal(buildEventsIndexModel({ events: [], groupSections: [], generatedAt: null }, parseEventsQuery(""), NOW).emptyMessage, "表示できるイベントがまだありません。");
  for (const literal of ["条件に合うイベントが見つかりませんでした。", "公開イベント一覧を一時的に表示できません。", "表示できるイベントがまだありません。", "検索結果", "その他のイベント", "募集中", "開催前", "開催済み", "このグループに表示できるイベントはまだありません。", "イベントを探す", "イベント名・説明・公開運営者を検索", "応募締切順", "おすすめ順", "開始日順", "新着順"]) {
    assert.ok(indexSrc.includes(literal), `CURRENT has ${literal}`);
  }
});

test("U01 status chips keep the other keys in their href (CURRENT chip hrefs)", () => {
  const model = buildEventsIndexModel(data.index, parseEventsQuery("?q=abc&sort=new"), NOW);
  assert.deepEqual(model.chips.map((c) => [c.label, c.href, c.active]), [
    ["すべて", "/event?q=abc&sort=new", true],
    ["受付中", "/event?q=abc&status=open&sort=new", false],
    ["開催前", "/event?q=abc&status=upcoming&sort=new", false],
    ["終了済み", "/event?q=abc&status=ended&sort=new", false],
  ]);
  assert.equal(model.showReset, true);
  assert.equal(buildEventsIndexModel(data.index, parseEventsQuery(""), NOW).chips[0].href, "/event");
});

test("U01 /event built HTML: default view, GET form, anchors, no private event", { skip }, () => {
  const doc = load("event/index.html");
  assert.equal(doc.title, "イベント | FlameNode");
  assert.equal(meta(doc, 'meta[name="description"]'), "FlameNodeで開催中・開催予定・アーカイブ済みの映像イベントを探せます。");
  assert.equal(doc.querySelector('link[rel="canonical"]').getAttribute("href"), "https://flamenode.net/event");
  const form = doc.querySelector("main form[role=search]");
  assert.equal(form.getAttribute("method"), "get");
  assert.equal(form.getAttribute("action"), "/event");
  assert.deepEqual([...form.querySelectorAll("[name]")].map((e) => e.getAttribute("name")), ["q", "status", "sort"]);
  assert.ok(doc.getElementById("event-group-autumn"), "group anchor for /groups/:slug redirects");
  const main = text(doc.querySelector("main"));
  assert.ok(main.includes("イベントを探す") && main.includes("3 events"));
  for (const t of ["FlameNode Autumn Festival 2026", "年越し合作 2020", "枠なしイベント", "その他のイベント"]) assert.ok(main.includes(t), t);
  assert.ok(!main.includes("下書きイベント"));
  const hrefs = [...doc.querySelectorAll("main a.ev-visual")].map((a) => a.getAttribute("href")).sort();
  assert.deepEqual(hrefs, ["/event/autumn-collab-2026", "/event/no-slot-event-2100", "/event/past-event-2020"]);
  assert.deepEqual([...doc.querySelectorAll(".seg a")].map((a) => a.getAttribute("href")), ["/event", "/event?status=open", "/event?status=upcoming", "/event?status=ended"]);
});

test("T03 private events leave no trace in any built file", { skip }, () => {
  for (const file of walk(DIST)) {
    if (!/\.(html|txt|json|js|css)$|_redirects$/.test(file)) continue;
    const body = read(file);
    for (const needle of ["draft-secret-event", "下書きイベント", "vid-private", "非公開の作品"]) {
      assert.ok(!body.includes(needle), `${needle} in ${path.relative(DIST, file)}`);
    }
  }
  assert.ok(!fs.existsSync(path.join(DIST, "event/draft-secret-event")));
});

// ---------- U02 /event/[id] ----------
test("U02 head: title/description/canonical/OGP follow CURRENT buildPageMetadata (image = img_url)", { skip }, () => {
  const doc = load("event/autumn-collab-2026/index.html");
  assert.equal(doc.title, "FlameNode Autumn Festival 2026 | FlameNode");
  assert.equal(meta(doc, 'meta[name="description"]'), "秋の音楽・動画クリエイター合同コラボレーションイベント。 1枠5分で連続上映します。");
  assert.equal(doc.querySelector('link[rel="canonical"]').getAttribute("href"), "https://flamenode.net/event/autumn-collab-2026");
  assert.equal(meta(doc, 'meta[property="og:type"]'), "website");
  assert.equal(meta(doc, 'meta[property="og:image"]'), "https://flamenode.net/brand/banner.png");
  assert.equal(meta(doc, 'meta[property="og:image:alt"]'), "FlameNode Autumn Festival 2026");
  assert.equal(doc.querySelector('meta[property="og:image:width"]'), null, "custom image has no width/height (CURRENT)");
  assert.equal(meta(doc, 'meta[name="twitter:image"]'), "https://flamenode.net/brand/banner.png");
  assert.equal(meta(doc, 'meta[name="robots"]'), "index, follow");
  assert.ok(detailSrc.includes("image: event.img_url ?? event.icon_url"));
  // no image -> brand card with size
  const plain = load("event/past-event-2020/index.html");
  assert.equal(meta(plain, 'meta[property="og:image"]'), "https://flamenode.net/brand/flamenode-social-card.png");
  assert.equal(meta(plain, 'meta[property="og:image:width"]'), "1200");
  assert.equal(buildPageHead({ path: "/x", title: "t", image: "/a.png" }).ogImage, "https://flamenode.net/a.png");
});

test("U07 G06 Event JSON-LD deep-equals CURRENT's eventJsonLd", { skip }, () => {
  const doc = load("event/autumn-collab-2026/index.html");
  const scripts = [...doc.querySelectorAll('script[type="application/ld+json"]')].filter((s) => !s.id);
  assert.equal(scripts.length, 1);
  const actual = JSON.parse(scripts[0].textContent);
  const event = data.details.get("autumn-collab-2026").event;
  const expected = JSON.parse(
    JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Event",
      name: "FlameNode Autumn Festival 2026",
      description: "秋の音楽・動画クリエイター合同コラボレーションイベント。 1枠5分で連続上映します。",
      url: "https://flamenode.net/event/autumn-collab-2026",
      image: ["https://flamenode.net/brand/banner.png"],
      startDate: new Date(event.start_time * 1000).toISOString(),
      endDate: new Date(event.end_time * 1000).toISOString(),
      eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
      location: { "@type": "VirtualLocation", url: "https://flamenode.net/event/autumn-collab-2026" },
      organizer: { "@type": "Organization", name: "FlameNode", url: "https://flamenode.net/" },
    }),
  );
  assert.deepEqual(actual, expected);
  assert.deepEqual(JSON.parse(JSON.stringify(buildEventJsonLd(event))), expected);
  // every key of CURRENT's literal is present
  for (const key of ["eventAttendanceMode", "VirtualLocation", "organizer", "startDate", "endDate", "OnlineEventAttendanceMode"]) assert.ok(detailSrc.includes(key), key);
  // an event with no times / no image drops those keys, as JSON.stringify drops undefined
  const bare = JSON.parse(JSON.stringify(buildEventJsonLd(data.details.get("no-slot-event-2100").event)));
  assert.equal("image" in bare, false);
  assert.ok(bare.startDate);
});

test("U02 detail body: CURRENT texts, links and no slot state in the static HTML", { skip }, () => {
  const doc = load("event/autumn-collab-2026/index.html");
  const main = text(doc.querySelector("main"));
  for (const t of ["枠を確保する", "YouTube再生リスト", "ガイドライン", "イベント概要", "上映枠", "投稿", "日程", "運営", "募集期間", "投稿期間", "【文字PV】スチールワンダー", "模範囚"]) assert.ok(main.includes(t), t);
  assert.ok(!main.includes("非公開の作品"));
  const hrefs = [...doc.querySelectorAll("main a")].map((a) => a.getAttribute("href"));
  assert.ok(hrefs.includes("/event/autumn-collab-2026/slots"));
  assert.ok(hrefs.includes("/rules"));
  assert.ok(hrefs.includes("https://www.youtube.com/playlist?list=PLabcdefghijklmnop"));
  assert.ok(hrefs.includes("/dKw1xV41f8s?playlist=autumn-collab-2026"), "youtube id link");
  assert.ok(hrefs.includes("/vid-bbb?playlist=autumn-collab-2026"), "internal id link");
  assert.ok(hrefs.includes("/list?event=autumn-collab-2026"), "total 12 > 2 shown");
  assert.ok(hrefs.includes("/user/shingainen"), "public profile staff");
  assert.ok(!hrefs.includes("/user/stick_nori"));
  assert.ok(hrefs.includes("https://x.com/shingainen"));
  // slot state is not baked: counts are placeholders until the live read
  assert.ok(main.includes("– / 4"));
  assert.equal(doc.querySelectorAll('[role="meter"]').length, 0);
  assert.ok(detailSrc.includes("EVENT_VIDEO_DISPLAY_LIMIT = 8"));
  const plain = text(load("event/past-event-2020/index.html").querySelector("main"));
  assert.ok(!plain.includes("枠を確保する") && plain.includes("終了済"));
  const noSlots = load("event/no-slot-event-2100/index.html");
  assert.ok(!text(noSlots.querySelector("main")).includes("上映枠"), "CURRENT hides the slot summary when there are no slots");
});

test("U02 model: status, entry action, day metric, slot parts follow CURRENT", () => {
  const detail = detailOf("autumn-collab-2026");
  const open = buildEventDetailData(detail, NOW);
  assert.equal(open.statusLabel, "募集期間中");
  assert.equal(open.entryAction, "reserve");
  assert.deepEqual(open.dayMetric, { label: "投稿期間まで", days: Math.ceil((detail.event.start_time - NOW) / 86400) });
  assert.deepEqual(open.slotParts.map((p) => [p.label, p.total, p.filled]), [["第1部", 2, null], ["第2部", 2, null]]);
  assert.equal(open.slotFilled, null);
  assert.deepEqual(open.schedule.map((r) => r.label), ["募集期間", "投稿期間"]);
  const live = { slots: [{ id: "s1", status: "reserved" }, { id: "s2", status: "available" }, { id: "s3", status: "submitted" }] };
  const withLive = buildEventDetailData(detail, NOW, live);
  assert.deepEqual(withLive.slotParts.map((p) => p.filled), [1, 1]);
  assert.equal(withLive.slotFilled, 2);
  // post period (entry closed, not started) -> submit
  const post = { ...detail, event: { ...detail.event, entry_end_time: NOW - 10 } };
  assert.equal(buildEventDetailData(post, NOW).entryAction, "submit");
  assert.equal(buildEventDetailData(post, NOW).statusLabel, "開始前");
  assert.equal(buildEventDetailData(detailOf("past-event-2020"), NOW).statusLabel, "終了済");
  assert.equal(buildEventDetailData(detailOf("past-event-2020"), NOW).entryAction, null);
  assert.deepEqual(getDayMetric(detailOf("past-event-2020").event, NOW), { label: "終了", days: 0 });
  assert.equal(formatEventRange(null, null), "-");
  assert.equal(buildEventDetailData(detail, NOW).videos.length, 2);
  assert.match(buildEventDetailData(detail, NOW).videos[0].metaLabel, /公開$/, "publication time on scheduled events");
  assert.equal(buildEventDetailData(detailOf("past-event-2020"), NOW).videos.length, 0);
});

// ---------- U03 slots + U06 zero-slot redirect (G19) ----------
test("U06 G19 zero-slot event: no slots page, `_redirects` 307 to /event/{id}; events with slots get a 200 page", { skip }, () => {
  assert.ok(!fs.existsSync(path.join(DIST, "event/no-slot-event-2100/slots")));
  assert.ok(fs.existsSync(path.join(DIST, "event/autumn-collab-2026/slots/index.html")));
  const redirects = read(path.join(DIST, "_redirects"));
  assert.ok(redirects.includes("/event/no-slot-event-2100/slots /event/no-slot-event-2100 307\n"));
  assert.ok(!redirects.includes("autumn-collab-2026"), "no redirect for an event that has slots");
  assert.ok(slotsSrc.includes("if (slotsForUi.length === 0) redirect(`/event/${event.id}`)"), "CURRENT: next/navigation redirect() = 307");
  // helper behaviour
  assert.deepEqual(eventSlotsRedirectLines([...data.details.values()]), ["/event/no-slot-event-2100/slots /event/no-slot-event-2100 307"]);
  const merged = mergeEventRedirects("/groups /event 307\n", ["/event/a/slots /event/a 307"]);
  assert.ok(merged.startsWith("/groups /event 307\n"));
  assert.equal(mergeEventRedirects(merged, ["/event/a/slots /event/a 307"]), merged, "idempotent");
  assert.equal(mergeEventRedirects(merged, []), "/groups /event 307\n", "block removed when no zero-slot events");
});

test("U03 slots built HTML: noindex, header, time grid with no slot state", { skip }, () => {
  const doc = load("event/autumn-collab-2026/slots/index.html");
  assert.equal(doc.title, "FlameNode Autumn Festival 2026 枠確保 | FlameNode");
  assert.equal(meta(doc, 'meta[name="robots"]'), "noindex, nofollow");
  const main = text(doc.querySelector("main"));
  assert.ok(main.includes("FlameNode Autumn Festival 2026 の枠確保") && main.includes("イベント詳細へ") && main.includes("埋まり枠"));
  assert.ok(main.includes("募集: "));
  assert.equal(doc.querySelectorAll(".srow2 .sl").length, 4);
  assert.equal([...doc.querySelectorAll(".srow2 .sl")].filter((e) => !e.classList.contains("pending")).length, 0, "every slot is pending: no state baked");
  assert.equal(doc.querySelectorAll(".sl.taken, .sl.open").length, 0);
  assert.equal(doc.querySelectorAll("main button").length, 0, "no do-nothing buttons: reservation belongs to MIG-0604/0606");
  assert.deepEqual([...doc.querySelectorAll(".plabel")].map(text), ["第1部", "第2部"]);
  assert.equal(doc.querySelectorAll(".pgap").length, 1);
  assert.ok(slotsSrc.includes("noIndex: true") && slotsSrc.includes("枠確保"));
});

test("U03 slots model: live fills names and counts; failed read keeps the grid and says so (T05)", () => {
  const detail = detailOf("autumn-collab-2026");
  const live = parseLiveSlots({ slots: [{ id: "s1", status: "reserved", display_name: "おたこ" }, { id: "s2", status: "available" }, { id: "s3", status: "submitted" }], truncated: false });
  const ready = buildEventSlotsModel(detail, NOW, "ready", live);
  assert.deepEqual(ready.stats, { filled: 2, total: 4, ratio: 50 });
  const cells = ready.days.flatMap((d) => d.blocks).filter((b) => b.kind === "slot");
  assert.deepEqual(cells.map((c) => [c.id, c.state, c.name]), [["s1", "taken", "おたこ"], ["s2", "open", null], ["s3", "taken", null], ["s4", "unknown", null]]);
  assert.equal(ready.days[0].filled, "2 / 4");
  assert.equal(ready.entryBadge.label, "受付中");
  assert.equal(ready.statusLabel, "開始前");
  assert.equal(buildEventSlotsModel(detailOf("past-event-2020"), NOW, "ready", { slots: [], truncated: false }).entryBadge, null);
  const failed = buildEventSlotsModel(detail, NOW, "unavailable", null);
  assert.equal(failed.stats, null);
  assert.ok(failed.days.flatMap((d) => d.blocks).filter((b) => b.kind === "slot").every((c) => c.state === "unknown"));
  const before = buildEventSlotsModel({ ...detail, event: { ...detail.event, entry_start_time: NOW + 100 } }, NOW, "loading", null);
  assert.equal(before.entryBadge.label, "募集開始前");
  const closed = buildEventSlotsModel({ ...detail, event: { ...detail.event, entry_end_time: NOW - 100 } }, NOW, "loading", null);
  assert.equal(closed.entryBadge.label, "募集終了");
  assert.equal(parseLiveSlots({ slots: [{ id: 1 }] }), null);
  assert.equal(parseLiveSlots(null), null);
});

test("fetchLiveSlots: ok, non-ok and thrown reads", async () => {
  const ok = await fetchLiveSlots("a b", undefined, async (url, init) => {
    assert.equal(url, "/api/live/events/a%20b/slots");
    assert.equal(init.credentials, "omit");
    return { ok: true, json: async () => ({ slots: [{ id: "x", status: "available" }] }) };
  });
  assert.equal(ok.slots.length, 1);
  assert.equal(await fetchLiveSlots("a", undefined, async () => ({ ok: false })), null);
  assert.equal(await fetchLiveSlots("a", undefined, async () => { throw new Error("net"); }), null);
});

// ---------- U04 release ----------
test("U04 release built HTML: order, JST date groups, links, member line", { skip }, () => {
  const doc = load("event/autumn-collab-2026/release/index.html");
  assert.equal(doc.title, "FlameNode Autumn Festival 2026 | Release | FlameNode");
  assert.equal(meta(doc, 'meta[name="description"]'), "イベントの公開作品一覧");
  const main = text(doc.querySelector("main"));
  assert.ok(main.includes("投稿予定のご案内") && main.includes("FlameNode Autumn Festival 2026"));
  assert.deepEqual([...doc.querySelectorAll(".rl-hd")].map(text), ["2100/01/02"]);
  assert.deepEqual([...doc.querySelectorAll(".rl-title")].map(text), ["【文字PV】スチールワンダー", "模範囚"]);
  assert.deepEqual([...doc.querySelectorAll(".rl-time")].map(text), ["12:46", "12:52"]);
  assert.ok(!main.includes("非公開"));
  const hrefs = [...doc.querySelectorAll("main a")].map((a) => a.getAttribute("href"));
  assert.ok(hrefs.includes("https://www.youtube.com/watch?v=dKw1xV41f8s"));
  assert.ok(hrefs.includes("/dKw1xV41f8s") && hrefs.includes("/vid-bbb"));
  assert.ok(main.includes("メンバー:") && main.includes("hato (動画)") && main.includes("あいこ — 音"));
  assert.ok(main.includes("個人") && main.includes("複数人"));
  assert.equal(doc.querySelectorAll('button[aria-pressed]').length, 3);
  for (const literal of ["投稿予定のご案内", "複数人", "個人", "視聴", "詳細", "メンバー:", "個人参加", "グループ参加", "公開中の作品はありません。", "先頭500作品を表示"]) assert.ok(releaseSrc.includes(literal) || read("app/(public)/event/[id]/release/page.tsx").includes(literal), literal);
  assert.ok(!fs.existsSync(path.join(DIST, "event/no-slot-event-2100/release")), "no release object -> no page (CURRENT: 404)");
});

test("U04 release model: CURRENT ordering and date key", () => {
  const model = buildEventReleaseModel(data.releases.get("autumn-collab-2026"));
  assert.deepEqual(model.videos.map((v) => v.id), ["vid-aaa", "vid-bbb"]);
  assert.equal(model.groups.length, 1);
  assert.equal(formatDateKey(null), "日時未定");
  assert.equal(formatDateKey(0), "1970/01/01");
  assert.equal(formatTime(null), "--:--");
  assert.equal(formatTime(15 * 3600), "00:00", "JST (UTC+9) midnight");
  assert.equal(model.videos[1].collab, true);
  assert.equal(model.videos[0].detailHref, "/dKw1xV41f8s");
  assert.equal(buildEventReleaseModel(data.releases.get("past-event-2020")).videos.length, 0);
  assert.equal(modeFromHash("#GRID"), "grid");
  assert.equal(modeFromHash("#creator"), "creator");
  assert.equal(modeFromHash("#nope"), "list");
  assert.equal(modeFromHash(""), "list");
});

// ---------- Islands (jsdom) ----------
test("Island /event: server HTML hydrates; query keys filter after mount (G03 reload/back)", async () => {
  dom.reconfigure({ url: "https://flamenode.net/event" });
  document.body.innerHTML = "";
  const props = { index: data.index, builtAt: NOW };
  const container = mount();
  container.innerHTML = renderToString(h(EventsIndexIsland, props));
  const errors = [];
  let root;
  await act(async () => {
    root = hydrateRoot(container, h(EventsIndexIsland, props), { onRecoverableError: (e) => errors.push(e) });
  });
  assert.deepEqual(errors, []);
  assert.equal(container.querySelectorAll("a.ev-visual").length, 3);
  await act(async () => root.unmount());

  for (const [search, ids] of [
    ["?status=ended", ["past-event-2020"]],
    ["?q=%E6%96%B0%E6%A6%82%E5%BF%B5", ["autumn-collab-2026"]],
    ["?q=&status=&sort=", ["autumn-collab-2026", "past-event-2020", "no-slot-event-2100"]],
    ["?q=zzzz", []],
  ]) {
    dom.reconfigure({ url: `https://flamenode.net/event${search}` });
    document.body.innerHTML = "";
    const c = mount();
    let r;
    await act(async () => {
      r = createRoot(c);
      r.render(h(EventsIndexIsland, props));
    });
    await settle();
    const found = [...c.querySelectorAll("a.ev-visual")].map((a) => a.getAttribute("href").replace("/event/", ""));
    assert.deepEqual(found.sort(), [...ids].sort(), search);
    if (search === "?q=zzzz") assert.ok(text(c).includes("条件に合うイベントが見つかりませんでした。"));
    if (search === "?status=ended") assert.equal(c.querySelector('.seg a[aria-current="page"]').textContent, "終了済み");
    await act(async () => r.unmount());
  }
  dom.reconfigure({ url: "https://flamenode.net/event" });
});

test("Island /event/[id]: live slots fill the counts; a failed read keeps the static body (T05)", async () => {
  const detail = detailOf("autumn-collab-2026");
  const props = { detail, builtAt: NOW };
  const run = async (fetchImpl) => {
    globalThis.fetch = fetchImpl;
    document.body.innerHTML = "";
    const c = mount();
    c.innerHTML = renderToString(h(EventDetailIsland, props));
    const errors = [];
    let r;
    await act(async () => {
      r = hydrateRoot(c, h(EventDetailIsland, props), { onRecoverableError: (e) => errors.push(e) });
    });
    await settle();
    assert.deepEqual(errors, []);
    const out = text(c);
    await act(async () => r.unmount());
    return out;
  };
  const ok = await run(async () => ({ ok: true, json: async () => ({ slots: [{ id: "s1", status: "reserved" }, { id: "s2", status: "available" }, { id: "s3", status: "submitted" }, { id: "s4", status: "available" }] }) }));
  assert.ok(ok.includes("2 / 4"), ok);
  assert.ok(ok.includes("模範囚"));
  const bad = await run(async () => ({ ok: false, status: 503 }));
  assert.ok(bad.includes("– / 4") && bad.includes("模範囚") && bad.includes("YouTube再生リスト"));
  const thrown = await run(async () => { throw new Error("offline"); });
  assert.ok(thrown.includes("– / 4") && thrown.includes("【文字PV】スチールワンダー"));
  // zero-slot event: no request at all
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: false }; };
  document.body.innerHTML = "";
  const c = mount();
  let r;
  await act(async () => {
    r = createRoot(c);
    r.render(h(EventDetailIsland, { detail: detailOf("no-slot-event-2100"), builtAt: NOW }));
  });
  await settle();
  assert.equal(calls, 0);
  await act(async () => r.unmount());
});

test("Island /event/[id]/slots: pending -> live names; failure notice; never a button", async () => {
  const detail = detailOf("autumn-collab-2026");
  const props = { detail, builtAt: NOW };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ slots: [{ id: "s1", status: "reserved", display_name: "おたこ" }, { id: "s2", status: "available" }, { id: "s3", status: "available" }, { id: "s4", status: "available" }] }) });
  document.body.innerHTML = "";
  let c = mount();
  c.innerHTML = renderToString(h(EventSlotsIsland, props));
  assert.equal(c.querySelectorAll(".sl.pending").length, 4);
  const errors = [];
  let r;
  await act(async () => {
    r = hydrateRoot(c, h(EventSlotsIsland, props), { onRecoverableError: (e) => errors.push(e) });
  });
  await settle();
  assert.deepEqual(errors, []);
  assert.equal(c.querySelectorAll(".sl.pending").length, 0);
  assert.equal(c.querySelectorAll(".sl.taken").length, 1);
  assert.ok(text(c).includes("おたこ") && text(c).includes("1 / 4"));
  assert.ok(text(c).includes("25% 埋まり"));
  assert.equal(c.querySelectorAll("button").length, 0);
  await act(async () => r.unmount());

  globalThis.fetch = async () => ({ ok: false });
  document.body.innerHTML = "";
  c = mount();
  await act(async () => {
    r = createRoot(c);
    r.render(h(EventSlotsIsland, props));
  });
  await settle();
  assert.ok(text(c).includes("枠の最新状況を取得できませんでした。"));
  assert.equal(c.querySelectorAll(".srow2").length, 4, "grid stays");
  await act(async () => r.unmount());
});

test("Island /event/[id]/release: list on the server, mode follows the URL hash like CURRENT", async () => {
  const model = buildEventReleaseModel(data.releases.get("autumn-collab-2026"));
  dom.reconfigure({ url: "https://flamenode.net/event/autumn-collab-2026/release" });
  document.body.innerHTML = "";
  let c = mount();
  c.innerHTML = renderToString(h(EventReleaseIsland, { model }));
  assert.equal(c.querySelectorAll(".rl-item").length, 2);
  const errors = [];
  let r;
  await act(async () => {
    r = hydrateRoot(c, h(EventReleaseIsland, { model }), { onRecoverableError: (e) => errors.push(e) });
  });
  await settle();
  assert.deepEqual(errors, []);
  assert.equal(dom.window.location.hash, "#list", "CURRENT syncs the hash to the mode");
  await act(async () => {
    c.querySelector('button[aria-label="カード表示"]').click();
  });
  assert.equal(c.querySelectorAll(".rl-tile").length, 2);
  assert.equal(dom.window.location.hash, "#grid");
  await act(async () => {
    c.querySelector('button[aria-label="作者別表示"]').click();
  });
  assert.ok(text(c).includes("個人参加") && text(c).includes("グループ参加"));
  assert.equal(c.querySelector('button[aria-label="作者別表示"]').getAttribute("aria-pressed"), "true");
  await act(async () => r.unmount());
  dom.reconfigure({ url: "https://flamenode.net/event/autumn-collab-2026/release#creator" });
  document.body.innerHTML = "";
  c = mount();
  await act(async () => {
    r = createRoot(c);
    r.render(h(EventReleaseIsland, { model }));
  });
  await settle();
  assert.ok(text(c).includes("グループ参加"));
  await act(async () => r.unmount());
});
