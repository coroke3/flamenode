// MIG-0510: CURRENT query keys, RH-032 transport/DTO and JS-off SSG parity.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import {
  LIST_EVENT_UNAVAILABLE_MESSAGE, LIST_NO_RESULTS_MESSAGE, LIST_SHORT_SEARCH_MESSAGE,
  LIST_UNAVAILABLE_MESSAGE, decodePublicList, isDefaultListQuery,
  listHref, listQueryFromSearch, publicListApiPath,
} from "../apps/site/src/lib/listFilterCore.ts";
import { fetchPublicJson } from "../apps/site/src/lib/publicApi.ts";
import { LIST_PAGE_SIZE } from "../apps/site/src/lib/listQuery.ts";
import { toTrendingRow } from "../apps/site/src/lib/videoCards.ts";
import { eventVideoPageHref, videoPageHref } from "../src/lib/youtube/id.ts";
import { videoPageHref as spaVideoPageHref, eventVideoPageHref as spaEventVideoPageHref } from "../apps/app/src/routes/ui/media.ts";

const dto = (id = "test") => ({
  id, title: "公開作品", youtube_video_id: "AAAAAAAAAAA", display_name: "作者",
  icon_url: null, primary_event_id: null, scheduled_time: 1790000000, status: "public",
});
const okPage = (query, items = [dto()]) => ({ items, total: items.length, page: query.page, limit: LIST_PAGE_SIZE });

test("T01: CURRENT q/sort/event/view/page keys normalize and URL deep links roundtrip", () => {
  const q = listQueryFromSearch("?q=%E3%83%86%E3%82%B9%E3%83%88&sort=score&event=e123&page=2&view=index");
  assert.deepEqual({ q: q.q, sort: q.sort, event: q.event, page: q.page, view: q.view },
    { q: "テスト", sort: "score", event: "e123", page: 2, view: "index" });
  assert.equal(publicListApiPath(q), "/api/videos?q=%E3%83%86%E3%82%B9%E3%83%88&sort=score&event=e123&page=2&limit=24");
  assert.equal(listHref(q), "/list?q=%E3%83%86%E3%82%B9%E3%83%88&sort=score&event=e123&view=index&page=2");
  assert.equal(listHref(q, { q: "", page: "1" }), "/list?sort=score&event=e123&view=index");
  assert.equal(listHref(q, { sort: "new", page: "1" }), "/list?q=%E3%83%86%E3%82%B9%E3%83%88&event=e123&view=index");
  assert.equal(listHref(q, { event: "", page: "1" }), "/list?q=%E3%83%86%E3%82%B9%E3%83%88&sort=score&view=index");
  assert.equal(listHref(q, { view: "grid", page: "1" }), "/list?q=%E3%83%86%E3%82%B9%E3%83%88&sort=score&event=e123");
  assert.equal(listQueryFromSearch(listHref(q).slice(5)).page, 2);
  assert.equal(isDefaultListQuery(listQueryFromSearch("")), true);
  assert.equal(isDefaultListQuery(q), false);
  assert.equal(listQueryFromSearch("?page=9999999999999999999").page, Math.ceil(5000 / 24));
  assert.equal(listQueryFromSearch("?page=9999").page, Math.ceil(5000 / 24));
  assert.equal(listQueryFromSearch("?sort=unknown&view=other").sort, "new");
  assert.equal(listQueryFromSearch("?sort=unknown&view=other").view, "grid");
});

test("T01: RH-032 DTO projection is public-only and preserves pagination", () => {
  const query = listQueryFromSearch("?q=abcd&sort=old&page=2&view=compact");
  const r = decodePublicList({ ...okPage(query), total: 52 }, query);
  assert.ok(r);
  assert.equal(r.page, 2);
  assert.equal(r.totalPages, 3);
  assert.equal(r.videos[0].href, "/AAAAAAAAAAA");
  assert.equal(r.videos[0].creatorName, "作者");
  assert.match(r.videos[0].thumbnailUrl, /^\/api\/youtube-thumbnail\//);
  assert.equal(decodePublicList(okPage(query, []), query)?.videos.length, 0);
  assert.equal(LIST_NO_RESULTS_MESSAGE, "条件に合う作品が見つかりませんでした。条件を変えてお試しください。");
  assert.equal(LIST_SHORT_SEARCH_MESSAGE, "検索は文字・数字を2文字以上入力してください。");
});

test("T03: malformed or nonpublic DTO cannot replace static default fallback", () => {
  const query = listQueryFromSearch("?q=abcd");
  for (const invalid of [
    { ...okPage(query), items: [dto("a"), { ...dto("private"), status: "private" }] },
    { ...okPage(query), items: [dto("a"), { ...dto("voided"), status: "voided" }] },
    { ...okPage(query), items: [dto("a"), { ...dto("m"), id: 42 }] },
    { ...okPage(query), page: 3 },
    { ...okPage(query), limit: 48 },
    { ...okPage(query), total: -1 },
    { ...okPage(query), items: Array.from({ length: 25 }, (_, i) => dto(String(i))) },
  ]) {
    assert.equal(decodePublicList(invalid, query), null);
  }
  assert.equal(LIST_UNAVAILABLE_MESSAGE, "作品一覧を一時的に表示できません。");
  assert.equal(LIST_EVENT_UNAVAILABLE_MESSAGE, "このイベントの作品一覧を一時的に表示できません。");
  assert.equal(listQueryFromSearch("?q=%E3%81%82").searchTooShort, true);
});

test("T03: public JSON transport uses same-origin/no-store; 503, bad JSON or network errors fail closed", async () => {
  let args;
  const fetcher = async (url, init) => {
    args = { url, init };
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  assert.deepEqual(await fetchPublicJson("/api/videos?limit=24", {}, fetcher),
    { ok: true, status: 200, data: { items: [] } });
  assert.equal(args.url, "/api/videos?limit=24");
  assert.equal(args.init.credentials, "same-origin");
  assert.equal(args.init.cache, "no-store");
  assert.equal(args.init.headers.get("Accept"), "application/json");
  assert.deepEqual(await fetchPublicJson("/api/videos", {}, async () => new Response("down", { status: 503 })),
    { ok: false, status: 503 });
  assert.deepEqual(await fetchPublicJson("/api/videos", {}, async () => new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } })),
    { ok: false, status: 0 });
  assert.deepEqual(await fetchPublicJson("/api/videos", {}, async () => new Response("invalid", { status: 200, headers: { "Content-Type": "application/json" } })),
    { ok: false, status: 0 });
  assert.deepEqual(await fetchPublicJson("/api/videos", {}, async () => { throw new Error("offline"); }),
    { ok: false, status: 0 });
  assert.deepEqual(await fetchPublicJson("https://evil.example/steal", {}, fetcher),
    { ok: false, status: 0 });
  // An absolute same-origin input is not sufficient: URL normalization could
  // otherwise turn /api/../admin into an authenticated non-API request.
  for (const unsafe of [
    "/api/../admin", "/api/./videos", "/api/%2e%2e/admin",
    "/api/%2Fadmin", "/api/%5cadmin", "/api/videos/..",
  ]) {
    assert.deepEqual(await fetchPublicJson(unsafe, {}, fetcher),
      { ok: false, status: 0 }, `must reject path escape: ${unsafe}`);
  }
  assert.deepEqual(await fetchPublicJson("/api/videos?q=%2E%2F", {}, fetcher),
    { ok: true, status: 200, data: { items: [] } },
    "percent-encoded search query is not a path escape");
});

test("T02/T04: top GET search works without JS; /list static fallback keeps legal controls absent", () => {
  const topPath = "apps/site/dist/index.html", listPath = "apps/site/dist/list/index.html";
  const source = fs.readFileSync("packages/ui/src/screens/TopView.tsx", "utf8");
  assert.match(source, /method="get" action="\/list" role="search"/);
  assert.match(source, /name="q"/);
  const page = fs.readFileSync("apps/site/src/pages/list.astro", "utf8");
  assert.match(page, /id="list-static-fallback"/);
  assert.match(page, /id: "list-filter-mount"/);
  assert.match(page, /"data-total"/, "build-time total feeds the default-view Pagination");
  assert.match(page, /toolbar=\{filterSlot\}/, "controls slot is passed into ListView below the header");
  assert.match(page, /mountListFilters\(\)/);
  if (!fs.existsSync(topPath) || !fs.existsSync(listPath)) {
    if (process.env.REQUIRE_BUILT) throw new Error("Built / and /list required");
    return;
  }
  const home = new JSDOM(fs.readFileSync(topPath, "utf8")).window.document;
  const form = home.querySelector('.tp-search-band form[method="get"][action="/list"] input[name="q"]');
  assert.ok(form, "real GET search input in static home");
  assert.equal(form.getAttribute("maxlength"), "100");
  assert.ok(form.closest("form").querySelector('button[type="submit"]'));
  const listing = new JSDOM(fs.readFileSync(listPath, "utf8")).window.document;
  assert.ok(listing.querySelector("#list-static-fallback main"));
  assert.equal(listing.querySelector("#list-static-fallback button"), null);
  assert.equal(listing.querySelector("#list-filter-mount button"), null);
  assert.ok(listing.querySelector("#list-static-fallback .lv-head + #list-filter-mount"),
    "filter slot sits below the 作品一覧 header, as in CURRENT");
});


const skipHydratedUi = !fs.existsSync("packages/ui/dist/index.js")
  ? (process.env.REQUIRE_BUILT ? false : "build @flamenode/ui to test hydration")
  : false;

test("T03/T04: mounted Island handles 503 without hiding the static list or exposing a false empty result", { skip: skipHydratedUi }, async () => {
  const { mountListFilters } = await import("../apps/site/src/components/ListFilterIsland.ts");
  const dom = new JSDOM(
    '<!doctype html><div id="list-filter-mount"></div><div id="list-static-fallback"><p>STATIC-DEFAULT</p></div>',
    { url: "https://flamenode.net/list?q=abcd&event=ev1&view=index" },
  );
  const old = {
    window: globalThis.window, document: globalThis.document,
    HTMLElement: globalThis.HTMLElement, Node: globalThis.Node,
    fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  let requested = "";
  try {
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.Node = dom.window.Node;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.fetch = async (url, init) => {
      requested = String(url);
      assert.equal(init.credentials, "same-origin");
      return new Response('{"error":"maintenance"}', {
        status: 503, headers: { "Content-Type": "application/json" },
      });
    };
    await act(async () => { mountListFilters(); });
    assert.equal(requested, "/api/videos?q=abcd&event=ev1&limit=24");
    const doc = dom.window.document;
    assert.equal(doc.getElementById("list-static-fallback").hidden, false, "503 must preserve static content");
    assert.match(doc.getElementById("list-static-fallback").textContent, /STATIC-DEFAULT/);
    assert.match(doc.getElementById("list-filter-mount").querySelector('[role="alert"]').textContent,
      /このイベントの作品一覧を一時的に表示できません。/);
    assert.equal(doc.getElementById("list-filter-mount").querySelector("main"), null,
      "503 must not render the wrong event results as an empty list");
    assert.equal(doc.querySelector('.lv-view-options a[aria-current="page"]').textContent, "一覧表示");
    assert.equal(doc.querySelector('input[name="event"]').value, "ev1");
  } finally {
    globalThis.window = old.window;
    globalThis.document = old.document;
    globalThis.HTMLElement = old.HTMLElement;
    globalThis.Node = old.Node;
    globalThis.fetch = old.fetch;
    globalThis.IS_REACT_ACT_ENVIRONMENT = old.act;
    dom.window.close();
  }
});

test("T01: an accepted RH-032 page replaces the static default and renders the selected mode", { skip: skipHydratedUi }, async () => {
  const { mountListFilters } = await import("../apps/site/src/components/ListFilterIsland.ts");
  const dom = new JSDOM(
    '<!doctype html><div id="list-filter-mount"></div><div id="list-static-fallback">STATIC-DEFAULT</div>',
    { url: "https://flamenode.net/list?q=abcd&view=compact" },
  );
  const old = {
    window: globalThis.window, document: globalThis.document,
    HTMLElement: globalThis.HTMLElement, Node: globalThis.Node,
    fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  try {
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.Node = dom.window.Node;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.fetch = async () => new Response(JSON.stringify(okPage(listQueryFromSearch("?q=abcd&view=compact"))), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
    await act(async () => { mountListFilters(); });
    const doc = dom.window.document;
    assert.equal(doc.getElementById("list-static-fallback").hidden, true);
    assert.match(doc.getElementById("list-results-mount").textContent, /公開作品/);
    assert.ok(doc.querySelector(".lv-grid.lv-compact"), "compact mode follows the query after the API load");
    assert.ok(doc.querySelector("#list-results-mount .lv-head + .lv-toolbar form"),
      "after a live load the controls stay below the header");
    assert.equal(doc.getElementById("list-filter-mount").querySelector("form"), null, "controls are not duplicated");
  } finally {
    globalThis.window = old.window;
    globalThis.document = old.document;
    globalThis.HTMLElement = old.HTMLElement;
    globalThis.Node = old.Node;
    globalThis.fetch = old.fetch;
    globalThis.IS_REACT_ACT_ENVIRONMENT = old.act;
    dom.window.close();
  }
});

test("UX-DISC-005: live pagination keeps CURRENT range summary, first/last jump and gaps", { skip: skipHydratedUi }, async () => {
  const { mountListFilters } = await import("../apps/site/src/components/ListFilterIsland.ts");
  const dom = new JSDOM(
    '<!doctype html><div id="list-filter-mount"></div><div id="list-static-fallback">STATIC-DEFAULT</div>',
    { url: "https://flamenode.net/list?q=abcd&page=5" },
  );
  const old = {
    window: globalThis.window, document: globalThis.document,
    HTMLElement: globalThis.HTMLElement, Node: globalThis.Node,
    fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  try {
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.Node = dom.window.Node;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.fetch = async () => new Response(JSON.stringify({ ...okPage(listQueryFromSearch("?q=abcd&page=5")), total: 240 }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
    await act(async () => { mountListFilters(); });
    const nav = dom.window.document.querySelector("#list-results-mount .fn-pagination");
    assert.ok(nav, "shared Pagination rendered");
    assert.match(nav.textContent, /97〜120 \/ 全 240 件 \(5 \/ 10 ページ\)/);
    const hrefs = [...nav.querySelectorAll("a")].map(a => a.getAttribute("href"));
    assert.ok(hrefs.includes("/list?q=abcd"), "page 1 reachable directly");
    assert.ok(hrefs.includes("/list?q=abcd&page=10"), "last page reachable directly");
    assert.ok(nav.querySelector(".fn-pagination-ellipsis"), "gap marker");
  } finally {
    globalThis.window = old.window;
    globalThis.document = old.document;
    globalThis.HTMLElement = old.HTMLElement;
    globalThis.Node = old.Node;
    globalThis.fetch = old.fetch;
    globalThis.IS_REACT_ACT_ENVIRONMENT = old.act;
    dom.window.close();
  }
});

test("UX-DISC-005: the default /list (no fetch) still shows Pagination from the build-time total", { skip: skipHydratedUi }, async () => {
  const { mountListFilters } = await import("../apps/site/src/components/ListFilterIsland.ts");
  for (const [total, expectNav] of [[240, true], [24, false]]) {
    const dom = new JSDOM(
      `<!doctype html><div id="list-static-fallback"><main><div id="list-filter-mount" data-total="${total}"></div></main></div>`,
      { url: "https://flamenode.net/list" },
    );
    const old = {
      window: globalThis.window, document: globalThis.document,
      HTMLElement: globalThis.HTMLElement, Node: globalThis.Node,
      fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT,
    };
    const fetched = [];
    try {
      globalThis.window = dom.window;
      globalThis.document = dom.window.document;
      globalThis.HTMLElement = dom.window.HTMLElement;
      globalThis.Node = dom.window.Node;
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      globalThis.fetch = async url => { fetched.push(String(url)); throw new Error("default view must not fetch"); };
      await act(async () => { mountListFilters(); });
      const doc = dom.window.document;
      assert.deepEqual(fetched, [], "default view stays static (no D1/API read)");
      assert.equal(doc.getElementById("list-static-fallback").hidden, false);
      const nav = doc.querySelector("#list-results-mount .fn-pagination");
      assert.equal(Boolean(nav), expectNav);
      if (nav) {
        assert.match(nav.textContent, /1〜24 \/ 全 240 件 \(1 \/ 10 ページ\)/);
        assert.ok([...nav.querySelectorAll("a")].some(a => a.getAttribute("href") === "/list?page=2"), "page 2 reachable");
      }
    } finally {
      globalThis.window = old.window;
      globalThis.document = old.document;
      globalThis.HTMLElement = old.HTMLElement;
      globalThis.Node = old.Node;
      globalThis.fetch = old.fetch;
      globalThis.IS_REACT_ACT_ENVIRONMENT = old.act;
      dom.window.close();
    }
  }
});


test("MIG-0510 regression: corrupt public IDs cannot produce cross-origin card links", () => {
  const query = listQueryFromSearch("?q=valid");

  // An unexpected youtube_video_id from the API must never turn /ID into //host.
  for (const badYoutube of [
    "//outside.example", "/outside.example", "https://outside.example/watch?v=AAAAAAAAAAA",
    "javascript:alert(1)", "\\\\outside.example", "bad-id",
  ]) {
    const result = decodePublicList(
      okPage(query, [{ ...dto("v_safe-1"), youtube_video_id: badYoutube }]), query,
    );
    assert.ok(result, "invalid optional YouTube IDs still allow the safe internal video route");
    assert.equal(result.videos[0].href, "/v_safe-1");
    assert.equal(new URL(result.videos[0].href, "https://flamenode.net").origin, "https://flamenode.net");
  }

  const normalized = decodePublicList(
    okPage(query, [{ ...dto("v_safe-1"), youtube_video_id: "https://youtu.be/AAAAAAAAAAA" }]), query,
  );
  assert.equal(normalized?.videos[0].href, "/AAAAAAAAAAA", "valid full YouTube URLs normalize to ID");

  // A broken internal ID fails the list boundary instead of rendering a link.
  for (const badId of ["//outside.example", "/outside", "..", ".", "bad?query", "", "x".repeat(129)]) {
    assert.equal(
      decodePublicList(okPage(query, [{ ...dto(badId), youtube_video_id: null }]), query),
      null, `unsafe ID must be rejected: ${badId}`,
    );
  }

  // The same shared card mapper is used by trending cards without the list DTO boundary.
  const trending = toTrendingRow({
    id: "//outside.example", youtube_video_id: "//outside.example",
    title: "corrupt card", display_name: "example", icon_url: null,
    primary_event_id: null, primary_event_title: null, views_7d: 0, rank: 1,
  }, 0);
  assert.equal(trending.href, "/list", "malformed trending URLs fall back to a same-origin route");

  assert.equal(videoPageHref({ id: "v_ok", youtube_video_id: "/outside.example" }), "/v_ok");
  assert.equal(videoPageHref({ id: "//outside.example", youtube_video_id: null }), "/list");
  assert.equal(videoPageHref({ id: "v_ok", youtube_video_id: "AAAAAAAAAAA" }), "/AAAAAAAAAAA");
  const currentVideoCard = fs.readFileSync("src/components/video/VideoCard.tsx", "utf8");
  assert.match(currentVideoCard, /href \?\? videoPageHref\(video\)/,
    "CURRENT Next VideoCard must use the same safe route helper as migrated Astro");
});

test("MIG-0510: CURRENT event-detail playlist cards never resolve off-origin", () => {
  const base = "https://flamenode.net";
  const eventId = "event/ID?bad=1&next=2";
  for (const youtube_video_id of [
    "/outside.example", "//outside.example", "javascript:alert(1)",
    "\\\\outside.example", "https://outside.example/watch?v=AAAAAAAAAAA",
  ]) {
    const href = eventVideoPageHref({ id: "safe_internal", youtube_video_id }, eventId);
    assert.equal(href, "/safe_internal?playlist="+encodeURIComponent(eventId));
    assert.equal(new URL(href, base).origin, base, youtube_video_id);
  }
  assert.equal(eventVideoPageHref({ id: "safe_internal", youtube_video_id: "AAAAAAAAAAA" }, "EV1"), "/AAAAAAAAAAA?playlist=EV1");
  assert.equal(eventVideoPageHref({ id: "//evil.example", youtube_video_id: null }, "EV1"), "/list");

  // Verify that CURRENT's explicit href override cannot bypass this shared helper.
  const eventPage = fs.readFileSync("app/(public)/event/[id]/page.tsx", "utf8");
  assert.match(eventPage, /href=\{eventVideoPageHref\(video, eventId\)\}/);
  assert.doesNotMatch(eventPage, /const target = video\.youtube_video_id\?\.trim\(\) \|\| video\.id/);
});

test("MIG-0510: remaining public video navigations use validated paths", () => {
  // An untrusted video ID must never be interpolated directly after a slash.
  const list = fs.readFileSync("app/(public)/list/ListIndexView.tsx", "utf8");
  const rail = fs.readFileSync("src/components/video/PlaylistRail.tsx", "utf8");
  const users = fs.readFileSync("apps/site/src/lib/userViews.ts", "utf8");

  assert.ok(list.includes("const href = videoPageHref(v);"),
    "CURRENT /list index mode must use the shared video route helper");
  assert.ok(rail.includes("playlistId ? eventVideoPageHref(item, playlistId) : videoPageHref(item)"),
    "CURRENT playlist rail and autoplay must navigate through the same-origin guard");
  assert.ok(!rail.includes("const target = item.youtube_video_id?.trim() || item.id"),
    "old unsafe protocol-relative route construction must not be reintroduced");
  assert.ok(users.includes("href: videoPageHref(video),"),
    "Astro user-profile works and collab cards must use the same guard");

  const site = "https://flamenode.net";
  const bad = { id: "safe_internal", youtube_video_id: "/outside.example" };
  const playlist = "list/123?next=https://outside.example&x=1";
  assert.equal(videoPageHref(bad), "/safe_internal");
  assert.equal(eventVideoPageHref(bad, playlist),
    "/safe_internal?playlist=" + encodeURIComponent(playlist));
  for (const target of [bad, { id: "//outside.example", youtube_video_id: null }]) {
    const href = videoPageHref(target);
    assert.equal(new URL(href, site).origin, site);
    assert.equal(new URL(eventVideoPageHref(target, playlist), site).origin, site);
  }
});

test("MIG-0510: personal SPA video links match CURRENT same-origin route semantics", () => {
  const site = "https://flamenode.net";
  const videos = [
    { id: "internal-1", youtube_video_id: "AAAAAAAAAAA" },
    { id: "internal-1", youtube_video_id: "https://youtu.be/AAAAAAAAAAA" },
    { id: "internal-1", youtube_video_id: "/outside.example" },
    { id: "internal-1", youtube_video_id: "//outside.example" },
    { id: "//outside.example", youtube_video_id: null },
    { id: "../path", youtube_video_id: "javascript:alert(1)" },
  ];
  for (const item of videos) {
    assert.equal(spaVideoPageHref(item), videoPageHref(item));
    assert.equal(spaEventVideoPageHref(item, "lib-like&bad=1"),
      eventVideoPageHref(item, "lib-like&bad=1"));
    assert.equal(new URL(spaVideoPageHref(item), site).origin, site);
    assert.equal(new URL(spaEventVideoPageHref(item, "lib-like&bad=1"), site).origin, site);
  }

  const sources = [
    ["apps/app/src/routes/dashboard/Library.tsx",
      "eventVideoPageHref(firstVideo, playlistId)", "eventVideoPageHref(video, playlistId)"],
    ["apps/app/src/routes/ui/ChapterItems.tsx", "href={videoPageHref({ id: chapter.video_id"],
    ["app/(auth)/dashboard/library/page.tsx",
      "eventVideoPageHref(firstVideo, playlistId)", "eventVideoPageHref(video, playlistId)",
      "href={videoPageHref({ id: chapter.video_id"],
    ["app/(auth)/dashboard/page.tsx", "href={videoPageHref({ id: chapter.video_id"],
    ["src/components/admin/AdminVideoMembersForm.tsx", "href={videoPageHref(video)}"],
  ];
  for (const [path, ...safeCalls] of sources) {
    const source = fs.readFileSync(path, "utf8");
    for (const call of safeCalls) {
      assert.ok(source.includes(call), `${path} missing same-origin route: ${call}`);
    }
  }
});

test("MIG-0510: video detail metadata and Astro related cards use safe routes", () => {
  // Metadata and VideoObject JSON-LD must not advertise an external canonical
  // when a broken legacy youtube_video_id begins with slash.
  const nextPage = fs.readFileSync("app/(public)/[id]/page.tsx", "utf8");
  const astroVideo = fs.readFileSync("apps/site/src/lib/videoPage.ts", "utf8");
  assert.ok(nextPage.includes("const videoPath = videoPageHref(video);"));
  assert.ok(nextPage.includes("url: absoluteUrl(videoPageHref(video)),"));
  assert.ok(astroVideo.includes("const canonicalSlug = youtubeId ?? video.id;"),
    "Astro canonical slug must use a normalized 11-char YouTube ID, never a raw URL");
  assert.ok(astroVideo.includes("href: videoPageHref(r),"),
    "Astro related cards must not interpolate an unchecked ID");

  const site = "https://flamenode.net";
  for (const bad of ["/evil.example", "//evil.example", "javascript:alert(1)", "https://evil.example/watch?v=AAAAAAAAAAA"]) {
    const href = videoPageHref({ id: "safe_internal", youtube_video_id: bad });
    assert.equal(href, "/safe_internal");
    assert.equal(new URL(href, site).origin, site);
  }
  assert.equal(videoPageHref({ id: "safe_internal", youtube_video_id: "https://youtu.be/AAAAAAAAAAA" }),
    "/AAAAAAAAAAA");
});

test("regression: admin, edit and event management detail links validate YouTube aliases", () => {
  assert.equal(videoPageHref({ id: "safe_internal", youtube_video_id: "/outside.example" }), "/safe_internal");
  assert.equal(videoPageHref({ id: "/unsafe-internal", youtube_video_id: "/outside.example" }), "/list");
  assert.equal(videoPageHref({ id: "safe_internal", youtube_video_id: "https://youtu.be/AAAAAAAAAAA" }), "/AAAAAAAAAAA");

  for (const filename of [
    "app/(admin)/admin/youtube-sync/page.tsx",
    "app/(admin)/admin/videos/[id]/page.tsx",
    "app/(auth)/dashboard/edit/[id]/page.tsx",
    "app/(manage)/manage/events/[id]/videos/[videoId]/page.tsx",
    "src/components/forms/VideoForm.tsx",
  ]) {
    const source = fs.readFileSync(new URL("../" + filename, import.meta.url), "utf8");
    assert.ok(source.includes("href={videoPageHref("), filename + " must use checked same-origin video href");
    assert.ok(!source.includes("href={`/${youtubeVideoId"), filename + " must not interpolate a raw YouTube alias");
    assert.ok(!source.includes("href={`/${result.youtubeVideoId"), filename + " must not interpolate an unchecked action result");
  }
  const adminTabs = fs.readFileSync(new URL("../src/components/admin/AdminVideoTabs.tsx", import.meta.url), "utf8");
  assert.ok(adminTabs.includes("href: videoPageHref({ id: videoId, youtube_video_id: youtubeVideoId })"));
  assert.ok(!adminTabs.includes("const publicId = encodeURIComponent"));
});
